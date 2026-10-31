# 라벨코스트 서버. 표준 라이브러리 + sqlite3 + anthropic(선택). 실행: labelcoast 폴더에서 python -X utf8 server/app.py
# 역할: 상태 저장(state), 서류 추출(/api/extract: 키 있으면 LLM, 없으면 fixtures), 처리 기록, 바이어용 LOT 공개 면, 식약처 API 프록시, 정적 파일.
import base64, datetime, json, os, pathlib, re, secrets, shutil, sqlite3, subprocess, sys, tempfile, threading, time, urllib.parse, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent                      # labelcoast/
sys.path.insert(0, str(ROOT / 'agent'))
import graph                            # NAME_HINTS, SENSITIVE, SCHEMAS, llm
sys.path.insert(0, str(HERE)); import mfds as MF   # 식약처 공공데이터 정리
import mimetypes
def _opt(name):
    try: return __import__(name)
    except Exception as e: print('[모듈 없음]', name, type(e).__name__); return None
QR, NT, SD, RD, OCR = _opt('qr'), _opt('notify'), _opt('shipdocs'), _opt('redact'), _opt('ocr_extract')   # agent/ 안의 선택 모듈

# .env (labelcoast 의 부모 폴더). 키 값은 어디에도 찍지 않는다
ENV = ROOT.parent / '.env'
for line in (ENV.read_text('utf-8').splitlines() if ENV.exists() else []):
    if '=' in line and not line.startswith('#'):
        k, v = line.split('=', 1); os.environ.setdefault(k.strip(), v.strip())
MFDS_KEY = os.environ.get('FOODSAFETYKOREA_API_KEY', '')
COMPANY = os.environ.get('LC_COMPANY_NAME', '')     # 식약처 조회에 쓰는 회사명. 코드에 실명을 두지 않는다
PASSWORD = os.environ.get('LC_PASSWORD', '')          # 비어 있으면 무인증(개발 모드)
TOKEN = secrets.token_hex(16)                          # ponytail: 프로세스당 토큰 1개. 재시작하면 재로그인
PORT = int(os.environ.get('LC_PORT', 8765))
DB = HERE / 'labelcoast.db'
BACKUP = HERE / 'backup'
OPEN_PATHS = ('/api/health', '/api/login', '/login')   # 로그인 없이 되는 경로 (+ /api/lot/*/public, 정적 js/css)
LOGIN_HTML = ('<!doctype html><meta charset="utf-8"><title>라벨코스트 로그인</title>'
              '<body style="font-family:Malgun Gothic,sans-serif;max-width:360px;margin:80px auto"><h2>라벨코스트</h2>'
              '<form onsubmit="event.preventDefault();fetch(\'/api/login\',{method:\'POST\',headers:{\'Content-Type\':\'application/json\'},'
              'body:JSON.stringify({password:pw.value})}).then(r=>r.ok?location.href=\'/\':(msg.textContent=\'비밀번호가 틀립니다\'))">'
              '<input id="pw" type="password" placeholder="비밀번호" autofocus style="width:100%;padding:8px;font-size:16px"> '
              '<button style="margin-top:8px;padding:8px 16px">들어가기</button><p id="msg" style="color:#c0392b"></p></form>')
LOCK = threading.Lock()   # ponytail: 전역 락. 회사 한 곳용. 다중 테넌트면 행 단위로
STATIC_CT = {'.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml'}


def db():
    c = sqlite3.connect(DB); c.row_factory = sqlite3.Row
    c.execute('create table if not exists state(id text primary key, json text, updated text)')
    c.execute('create table if not exists docs(id integer primary key, at text, file text, doc_type text, mode text, decision text, result text, fields_json text)')
    return c


def now(): return datetime.datetime.now().isoformat(timespec='seconds')


# ---------- 규정 출처 감시: 각국 공식 페이지를 받아 글자 해시를 비교. 바뀌면 "변경 감지"만 알리고 해석은 하지 않는다(고시문을 올려 AI 추출 → 사람 승인) ----------
REG_SOURCES = [
    {'country': 'JP', 'name': '消費者庁 食品表示企画(식품표시 종합)', 'url': 'https://www.caa.go.jp/policies/policy/food_labeling/'},
    {'country': 'JP', 'name': '消費者庁 食品表示法(법령·기준 개정)', 'url': 'https://www.caa.go.jp/policies/policy/food_labeling/food_labeling_act/'},
    {'country': 'HK', 'name': '食物安全中心 食物規例/指引', 'url': 'https://www.cfs.gov.hk/tc_chi/food_leg/food_leg.html'},
    {'country': 'TW', 'name': '衛福部食藥署 法規資訊', 'url': 'https://www.fda.gov.tw/TC/lawContent.aspx?cid=183'},
    {'country': 'TH', 'name': 'อย. กองอาหาร(태국 FDA 식품국)', 'url': 'https://food.fda.moph.go.th/'},
    {'country': 'KR', 'name': '식약처 제·개정 고시 (수입·국내 표시)', 'url': 'https://www.mfds.go.kr/brd/m_207/list.do'},
    {'country': 'CN', 'name': '国家卫生健康委 食品安全标准(자동 접근 차단 → 수동 확인)', 'url': 'https://www.nhc.gov.cn/sps/', 'manual': True},
]
REG_LOCK = threading.Lock()


def _page_items(url):
    """공지·법령 제목(링크 글) 목록. 방문자 수·배너 순서 같은 잡음에 흔들리지 않게 제목 집합으로 비교한다"""
    import html as _h
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (labelcoast regwatch)'})
    raw = urllib.request.urlopen(req, timeout=25).read().decode('utf-8', errors='replace')
    raw = re.sub(r'<(script|style|noscript)[^>]*>.*?</\\1>', ' ', raw, flags=re.S | re.I)
    items = []
    for m in re.finditer(r'<a\b[^>]*>(.*?)</a>', raw, flags=re.S | re.I):
        t = re.sub(r'\s+', ' ', _h.unescape(re.sub(r'<[^>]+>', ' ', m.group(1)))).strip()
        if len(t) >= 8 and not re.fullmatch(r'[\d\W]+', t) and '="' not in t and '<' not in t and 'class=' not in t and 'http' not in t.lower(): items.append(t[:120])   # 깨진 태그·속성 문자열은 제외
    seen = set(); uniq = [x for x in items if not (x in seen or seen.add(x))]
    return uniq


def regwatch_check(force=False):
    """모든 출처를 점검해 DB(regwatch 표)에 기록. 새 제목이 생기면 '변경 감지'. 반환: 출처별 상태 목록"""
    import hashlib
    out = []
    with REG_LOCK, db() as c:
        c.execute('create table if not exists regwatch(url text primary key, country text, name text, hash text, head text, checked_at text, changed_at text, note text)')
        for s in REG_SOURCES:
            row = c.execute('select hash, head, changed_at, note from regwatch where url=?', (s['url'],)).fetchone()
            prev_hash, prev_head, changed_at, prev_note = (row['hash'], row['head'], row['changed_at'], row['note']) if row else (None, None, None, '')
            status, note, head, h = 'ok', '', prev_head, prev_hash
            if s.get('manual'):
                status, note = 'manual', '자동 접근이 막힌 사이트. 링크를 열어 직접 확인'
            else:
                try:
                    items = _page_items(s['url']); head = json.dumps(items, ensure_ascii=False)[:20000]; h = hashlib.sha256(head.encode('utf-8')).hexdigest()
                    prev_items = set(json.loads(prev_head)) if prev_head and prev_head.startswith('[') else set()
                    new_items = [x for x in items if x not in prev_items] if prev_items else []
                    if prev_items and new_items:
                        status, changed_at = 'changed', now(); note = '새 제목 ' + str(len(new_items)) + '건: ' + ' / '.join(new_items[:3])
                    elif changed_at and not (prev_note or '').startswith('확인함'):
                        status, note = 'changed', prev_note or '변경 감지(확인 전)'
                    elif not prev_items: status, note = 'new', '기준선 저장(제목 ' + str(len(items)) + '건)'
                    else: note = '제목 ' + str(len(items)) + '건 · 새 것 없음'
                except Exception as e:
                    status, note = 'error', '점검 실패: %s' % type(e).__name__
            c.execute('insert into regwatch(url,country,name,hash,head,checked_at,changed_at,note) values(?,?,?,?,?,?,?,?) on conflict(url) do update set hash=excluded.hash, head=excluded.head, checked_at=excluded.checked_at, changed_at=excluded.changed_at, note=excluded.note',
                      (s['url'], s['country'], s['name'], h, head, now(), changed_at if status == 'changed' else (None if status in ('ok', 'new') else changed_at), note))
            out.append({'country': s['country'], 'name': s['name'], 'url': s['url'], 'status': status, 'checked_at': now(), 'changed_at': changed_at if status == 'changed' else None, 'note': note})
    return out


def regwatch_status():
    with db() as c:
        c.execute('create table if not exists regwatch(url text primary key, country text, name text, hash text, head text, checked_at text, changed_at text, note text)')
        rows = {r['url']: r for r in c.execute('select * from regwatch').fetchall()}
    return [{'country': s['country'], 'name': s['name'], 'url': s['url'], 'status': ('manual' if s.get('manual') else ('changed' if rows.get(s['url']) and rows[s['url']]['changed_at'] else ('ok' if rows.get(s['url']) else 'never'))),
             'checked_at': rows[s['url']]['checked_at'] if rows.get(s['url']) else None, 'changed_at': rows[s['url']]['changed_at'] if rows.get(s['url']) else None, 'note': rows[s['url']]['note'] if rows.get(s['url']) else ''} for s in REG_SOURCES]


def regwatch_ack(url):
    with REG_LOCK, db() as c:
        c.execute('update regwatch set changed_at=null, note=? where url=?', ('확인함 ' + now(), url))


def regwatch_loop():   # 서버가 떠 있는 동안 하루 한 번 자동 점검
    while True:
        try: regwatch_check()
        except Exception as e: print('[regwatch]', type(e).__name__)
        time.sleep(86400)


def get_state():
    with db() as c:
        r = c.execute("select json from state where id='main'").fetchone()
    return json.loads(r['json']) if r else {}


def put_state(s):
    with LOCK, db() as c:
        c.execute("insert into state(id,json,updated) values('main',?,?) on conflict(id) do update set json=excluded.json, updated=excluded.updated",
                  (json.dumps(s, ensure_ascii=False), now()))
    return now()


def doc_type_of(name):
    return next((t for k, t in graph.NAME_HINTS if k.lower() in name.lower()), '')


def extract(body):
    name = body.get('filename', ''); t = doc_type_of(name)
    has_key = bool(os.environ.get('ANTHROPIC_API_KEY'))
    # 미리 읽어 둔 값이 있는 파일명은 그걸 우선 쓴다(시연 결정성, 실명 마스킹). 모르는 파일만 자동 가림 → AI/OCR 로 간다
    fx0 = subprocess.run(['node', str(HERE / 'fixture_dump.js'), name], capture_output=True, text=True, encoding='utf-8')
    fx = json.loads(fx0.stdout or 'null') if fx0.returncode == 0 else None
    if fx:
        if fx['doc_type'] in graph.SENSITIVE and not body.get('masked'):
            return {'doc_type': fx['doc_type'], 'mode': 'none', 'blocked': True, 'reason': '계좌·단가가 있을 수 있는 서류는 가린 뒤 처리. LLM에 보내지 않음', 'fields': []}
        return {'doc_type': fx['doc_type'], 'mode': 'fixture', 'blocked': False, 'fields': fx['fields'], 'source': fx.get('source')}
    tmp = None; redacted = None
    if body.get('b64'):
        with tempfile.NamedTemporaryFile(delete=False, suffix=pathlib.Path(name).suffix or '.bin') as f:
            f.write(base64.b64decode(body['b64'])); tmp = f.name
    use_llm = has_key and bool(tmp)
    try:
        if not t and tmp and OCR:                        # 파일명 힌트 없음 → 로컬 OCR 로 종류 판별(키 불필요)
            try: t = OCR.extract(tmp).get('doc_type') or ''
            except Exception as e: print('[ocr 분류 실패]', type(e).__name__)
        if not t and use_llm:
            t = graph.classify_content(tmp)              # 그래도 없으면 AI 로. 민감 종류면 아래에서 차단되고 추출은 안 함
        if not t:
            return {'doc_type': '', 'mode': 'none', 'blocked': False, 'reason': '종류 미확인', 'fields': []}
        auto = None
        if t in graph.SENSITIVE and not body.get('masked'):
            # 사람이 안 가렸으면 먼저 로컬 자동 가림. 안전 판정이 나야만 AI·OCR 로 넘어간다
            if tmp and RD:
                try: auto = RD.redact(tmp)
                except Exception as e: print('[자동 가림 실패]', type(e).__name__)
            if not auto or not auto.get('safe_for_llm'):
                why = (auto or {}).get('note') or '자동 가림 불가'
                return {'doc_type': t, 'mode': 'none', 'blocked': True, 'reason': '계좌·단가가 있을 수 있는 서류. 자동 가림: ' + why + '. 가린 뒤 올리거나 체크 후 진행', 'fields': []}
            redacted = auto['out']
        work = redacted or tmp
        extra = {'redacted': bool(redacted), 'redact_found': len((auto or {}).get('found', []))}
        if use_llm:
            r = graph.llm(graph.extract_prompt(t), work)
            r = r if isinstance(r, dict) else {}
            src = r.pop('_src', {}); src = src if isinstance(src, dict) else {}
            fields = [{'k': k, 'label': k, 'v': v, 'src': src.get(k, '')} for k, v in r.items()]
            if t == '규격서양식' and r.get('fields'):   # 새 바이어 양식: 칸 ↔ 우리 데이터 짝짓기(AI 제안). 승인 뒤 규격서 화면이 이 짝으로 채운다
                fields.append({'k': 'mapping', 'label': '칸 ↔ 우리 데이터 (AI 제안, 승인 전 확인)', 'v': graph.map_fields(r['fields']), 'src': 'AI'})
            if t == '메일' and r.get('questions'):   # 바이어 문의: 근거 찾기는 코드(answer_evidence), 답장 문장만 AI. 승인 전 사람이 카드에서 본다
                st = get_state()
                if SD:
                    for k, v in (SD.load_state() or {}).items(): st.setdefault(k, v)
                ans = graph.answer_evidence(r, st)
                fields.append({'k': 'answers', 'label': '질문별 근거 (코드가 찾음)', 'v': [{'질문': x['q'][:60], '주제': x['topic'], '상태': x['status'], '출처': x['source']} for x in ans], 'src': 'ledger·registry·products'})
                txt = graph.reply_draft(r, ans)
                if txt:
                    od = ROOT / 'agent' / 'out'; od.mkdir(exist_ok=True); fp = od / ('reply_%s.md' % datetime.date.today().isoformat()); fp.write_text(txt, 'utf-8')
                    fields.append({'k': 'reply_draft', 'label': '답장 초안 (AI · 값은 근거 그대로 · 보내기 전 사람이 확인)', 'v': txt, 'src': str(fp.relative_to(ROOT))})
            if t == '고시문' and r.get('country'):   # 개정 고시문: 규칙 파일 수정안(AI 초안). 파일로만 남기고 코드에 자동 적용하지 않는다
                pr = graph.rule_patch({'extracted': r}).get('proposals') or []
                if pr:
                    graph.PROPOSALS.mkdir(exist_ok=True)
                    out = graph.PROPOSALS / ('rule_patch_%s_%s.md' % (pr[0]['country'], datetime.date.today().isoformat()))
                    out.write_text(pr[0]['text'], 'utf-8')
                    fields.append({'k': 'rule_patch', 'label': '규칙 파일 수정안 (AI 초안 · 자동 적용 안 함 · 개발자가 data.js 반영)', 'v': pr[0]['text'], 'src': str(out.relative_to(ROOT))})
            return dict({'doc_type': t, 'mode': 'llm', 'blocked': False, 'fields': fields}, **extra)
        if work and OCR:                                  # 키 없음 → 로컬 OCR(인쇄 서류). 손글씨는 fields 가 비어 fixture 로 넘어간다
            try:
                o = OCR.extract(work, t)
                if o.get('fields'):
                    return dict({'doc_type': o.get('doc_type') or t, 'mode': 'ocr', 'blocked': False, 'fields': o['fields'], 'confidence': o.get('confidence'), 'note': o.get('note', '')}, **extra)
            except Exception as e: print('[ocr 추출 실패]', type(e).__name__)
    finally:
        if tmp: os.unlink(tmp)
        if redacted:
            try: os.unlink(redacted)
            except Exception: pass
    out = subprocess.run(['node', str(HERE / 'fixture_dump.js'), name], capture_output=True, text=True, encoding='utf-8')
    fx = json.loads(out.stdout or 'null')
    if fx:
        return {'doc_type': fx['doc_type'], 'mode': 'fixture', 'blocked': False, 'fields': fx['fields'], 'source': fx.get('source')}
    return {'doc_type': t, 'mode': 'none', 'blocked': False, 'reason': 'API 키 없음, 미리 읽어 둔 값도 없음. 수동 입력', 'fields': []}


PUB_KEYS = ('lot', 'company_code', 'product', 'mfg', 'expiry', 'qty_ct', 'kg', 'cert', 'spec_sent')


def public_of(l, st):  # 바이어 면: 서류로 이미 보낸 수준만. raw·buyer·ship 은 절대 안 나간다
    pub = {k: l.get(k) for k in PUB_KEYS}
    pub['product_name'] = st.get('product_name') or '냉동 자숙 붉은대게 다리살(LB)'
    pub['page_url'] = '/lot/' + urllib.parse.quote(str(l.get('lot', '')))
    pub['certs'] = [f"{r.get('name', '')} {r.get('no', '')}" + (f" (~{r['expiry']})" if r.get('expiry') else '')
                    for r in st.get('registry', []) if r.get('kind') == '법정인증' or 'HACCP' in str(r.get('name', ''))]
    return pub


def esc(s): return str(s if s is not None else '').replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def lot_html(pub):
    rows = [('製品名 / 제품명', pub['product_name']), ('LOT', f"{pub['lot']}" + (f" (회사 코드 {pub['company_code']})" if pub.get('company_code') else '')),
            ('製造日 / 제조일', pub['mfg']), ('賞味期限 / 소비기한', pub['expiry']), ('数量 / 수량', f"{pub['qty_ct']} C/T · {pub['kg']} kg"),
            ('衛生証明書 / 위생증명서', pub['cert'] or '해당 없음'), ('規格書送付日 / 규격서 발송일', pub['spec_sent'] or '-'),
            ('製造者 / 제조자', 'A사 (경북 영덕)'), ('認証 / 인증', ' · '.join(pub['certs']) or '-')]
    tr = ''.join(f'<tr><th>{esc(k)}</th><td>{esc(v)}</td></tr>' for k, v in rows)
    return ('<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            f'<title>LOT {esc(pub["lot"])}</title><body style="font-family:Malgun Gothic,Apple SD Gothic Neo,sans-serif;max-width:640px;margin:24px auto;padding:0 16px;color:#1c2430">'
            f'<h2 style="margin:0 0 12px">LOT {esc(pub["lot"])}</h2><table style="width:100%;border-collapse:collapse">{tr}</table>'
            '<style>th,td{border:1px solid #dfe3e8;padding:8px;text-align:left;vertical-align:top;font-size:15px}th{background:#f0f2f5;width:38%}</style>'
            '<p style="color:#6b7684;font-size:13px;margin-top:14px">이 페이지는 제조자가 서류로 이미 보낸 정보만 담고 있습니다 / 本ページは書類で送付済みの情報のみを掲載しています<br>'
            f'조회 시각 {esc(now())}</p></body></html>')


def mfds(svc, qs):
    if svc not in ('I2500', 'I1250', 'I0610'):
        return 400, {'error': '허용되지 않은 서비스'}
    if not MFDS_KEY:
        return 200, {'error': '키 없음'}
    q = urllib.parse.parse_qsl(qs)
    param = ('/' + urllib.parse.quote(q[0][0]) + '=' + urllib.parse.quote(q[0][1])) if q else ''
    url = f'https://openapi.foodsafetykorea.go.kr/api/{MFDS_KEY}/{svc}/json/1/50{param}'
    try:
        with urllib.request.urlopen(url, timeout=8) as r:
            return 200, json.loads(r.read().decode('utf-8'))
    except Exception as e:
        return 200, {'error': type(e).__name__}   # 키가 든 URL 은 메시지에 안 넣는다


class H(BaseHTTPRequestHandler):
    def end_headers(self):   # GitHub Pages 등 다른 출처의 화면이 이 서버를 부를 수 있게. 쿠키는 안 쓰므로 * 허용
        self.send_header('Access-Control-Allow-Origin', '*'); self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS'); self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204); self.send_header('Content-Length', '0'); self.end_headers()

    def log_message(self, fmt, *a):
        sys.stderr.write('%s %s\n' % (self.command, self.path.split('?')[0]))  # 쿼리는 안 찍음

    def send_json(self, code, obj):
        b = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(code); self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)

    def body(self):
        n = int(self.headers.get('Content-Length') or 0)
        return json.loads(self.rfile.read(n).decode('utf-8')) if n else {}

    def authed(self):
        if not PASSWORD: return True
        p = self.path.split('?')[0]
        if p in OPEN_PATHS or (p.startswith('/api/lot/') and p.endswith('/public')) or p.startswith('/lot/') or p == '/api/lots/public': return True
        if not p.startswith('/api/') and p not in ('/', '/index.html'): return True   # js/css 는 열어 둔다. 데이터는 전부 /api 뒤
        return ('lc=' + TOKEN) in (self.headers.get('Cookie') or '')

    def deny(self):
        if self.command == 'GET' and not self.path.startswith('/api/'):
            self.send_response(302); self.send_header('Location', '/login'); self.end_headers()
        else:
            self.send_json(401, {'error': '로그인 필요'})

    def send_file(self, path, ctype, download=False):
        b = pathlib.Path(path).read_bytes(); self.send_response(200); self.send_header('Content-Type', ctype)
        if download: self.send_header('Content-Disposition', "attachment; filename*=UTF-8''" + urllib.parse.quote(pathlib.Path(path).name))
        self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)

    def send_html(self, html):
        b = html.encode('utf-8'); self.send_response(200); self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)

    def do_GET(self):
        if not self.authed(): return self.deny()
        p, _, qs = self.path.partition('?')
        if p == '/api/regwatch/status':   # 마지막 점검 결과(재점검 없음)
            return self.send_json(200, {'sources': regwatch_status()})
        if p == '/api/regwatch/check':    # 지금 점검
            return self.send_json(200, {'sources': regwatch_check()})
        if p.startswith('/api/regwatch/ack'):
            q = urllib.parse.parse_qs(qs); regwatch_ack(q.get('url', [''])[0]); return self.send_json(200, {'ok': True})
        if p == '/api/health':
            return self.send_json(200, {'ok': True, 'llm': bool(os.environ.get('ANTHROPIC_API_KEY')), 'mfds': bool(MFDS_KEY), 'auth': bool(PASSWORD), 'today': datetime.date.today().isoformat()})
        if p == '/login':
            return self.send_html(LOGIN_HTML)
        if p == '/api/backup':
            with db() as c:
                docs = [dict(r) for r in c.execute('select * from docs order by id').fetchall()]
            b = json.dumps({'exported': now(), 'state': get_state(), 'docs': docs}, ensure_ascii=False).encode('utf-8')
            self.send_response(200); self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Disposition', f'attachment; filename="labelcoast-backup-{datetime.date.today():%Y%m%d}.json"')
            self.send_header('Content-Length', str(len(b))); self.end_headers(); return self.wfile.write(b)
        if p == '/api/state':
            return self.send_json(200, get_state())
        if p == '/api/docs':
            with db() as c:
                rows = c.execute('select id,at,file,doc_type,mode,decision,result from docs order by id desc limit 50').fetchall()
            return self.send_json(200, [dict(r) for r in rows])
        if p.startswith('/api/lot/') and p.endswith('/public'):
            lot = urllib.parse.unquote(p[len('/api/lot/'):-len('/public')])
            st = get_state()
            l = next((x for x in st.get('ledger', []) if x.get('lot') == lot), None)
            if not l:
                return self.send_json(404, {'error': 'LOT 없음'})
            return self.send_json(200, public_of(l, st))
        if p == '/api/lots/public':   # 회사 코드로 조회: ?codes=AJ,I
            codes = [c.strip() for c in urllib.parse.parse_qs(qs).get('codes', [''])[0].split(',') if c.strip()]
            st = get_state()
            return self.send_json(200, [public_of(l, st) for l in st.get('ledger', []) if l.get('company_code') in codes])
        if p.startswith('/lot/'):   # 바이어가 링크로 여는 HTML 면
            lot = urllib.parse.unquote(p[len('/lot/'):])
            st = get_state()
            l = next((x for x in st.get('ledger', []) if x.get('lot') == lot), None)
            if not l:
                b = '<!doctype html><meta charset="utf-8"><title>LOT 없음</title><body style="font-family:Malgun Gothic,sans-serif;margin:40px"><h2>해당 LOT 없음</h2></body>'.encode('utf-8')
                self.send_response(404); self.send_header('Content-Type', 'text/html; charset=utf-8'); self.send_header('Content-Length', str(len(b))); self.end_headers(); return self.wfile.write(b)
            return self.send_html(lot_html(public_of(l, st)))
        if p.startswith('/api/public/'):   # 식약처 공공데이터: 회사명은 .env 의 LC_COMPANY_NAME
            what = p[len('/api/public/'):]
            if not MFDS_KEY: return self.send_json(200, {'error': '키 없음'})
            if not COMPANY: return self.send_json(200, {'error': 'LC_COMPANY_NAME 없음 (.env)'})
            fn = {'company': lambda: MF.company(COMPANY), 'products': lambda: MF.products(COMPANY), 'haccp': lambda: MF.haccp(COMPANY, ''),
                  'recalls': lambda: MF.recalls(COMPANY), 'compare': lambda: MF.compare_haccp(COMPANY, get_state().get('registry', []))}.get(what)
            if not fn: return self.send_json(404, {'error': 'company|products|haccp|recalls|compare'})
            out = fn(); out['fetched_at'] = now()
            return self.send_json(200, out)
        if p.startswith('/api/lot/') and p.endswith('/qr.png'):   # 로트 QR 라벨 (포장에 붙이는 조회 링크)
            if not QR: return self.send_json(500, {'error': 'qr 모듈 없음'})
            lot = urllib.parse.unquote(p[len('/api/lot/'):-len('/qr.png')]); st = get_state()
            l = next((x for x in st.get('ledger', []) if x.get('lot') == lot), None)
            if not l: return self.send_json(404, {'error': 'LOT 없음'})
            host = self.headers.get('Host') or ('localhost:%s' % PORT)
            out = HERE.parent / 'agent' / 'qr' / (lot + '.png'); out.parent.mkdir(exist_ok=True)
            QR.label_png(l, 'http://%s/lot/%s' % (host, urllib.parse.quote(lot)), out)
            return self.send_file(out, 'image/png')
        if p == '/api/notify/preview':   # 만료 알림 본문 미리보기(발송은 agent/notify.py 스케줄러)
            if not NT: return self.send_json(500, {'error': 'notify 모듈 없음'})
            st = get_state(); st = st if st.get('registry') else NT.state()
            rep = NT.report(st); rep = rep[0] if isinstance(rep, (list, tuple)) else rep
            return self.send_json(200, {'text': rep})
        if p.startswith('/api/shipdocs/'):   # 선적 서류 자동 생성 → 파일 다운로드
            if not SD: return self.send_json(500, {'error': 'shipdocs 모듈 없음'})
            kind = p[len('/api/shipdocs/'):]; q = urllib.parse.parse_qs(qs); st = dict(get_state() or {})
            for k, v in (SD.load_state() or {}).items(): st.setdefault(k, v)   # products·factory 등 data.js 기준값 보강
            try:
                if kind == 'mdl': path = SD.manufacture_date_list(st, q['no'][0])
                elif kind == 'pl': path = SD.packing_list_draft(st, q['no'][0])
                elif kind == 'cert': path = SD.sanitary_cert_request(st, q['no'][0])
                elif kind == 'bundle': path = SD.records_bundle(st, q['from'][0], q['to'][0])
                elif kind == 'buyer': path = SD.buyer_package(st, q['lot'][0])
                else: return self.send_json(404, {'error': 'mdl|pl|cert|bundle|buyer'})
            except KeyError as e: return self.send_json(400, {'error': '파라미터 없음: %s' % e})
            except Exception as e: return self.send_json(500, {'error': '생성 실패: %s: %s' % (type(e).__name__, e)})
            return self.send_file(pathlib.Path(path), mimetypes.guess_type(str(path))[0] or 'application/octet-stream', download=True)
        if p.startswith('/api/mfds/'):
            return self.send_json(*mfds(p[len('/api/mfds/'):], qs))
        if p.startswith('/api/'):
            return self.send_json(404, {'error': 'no route'})
        return self.static(p)

    def do_PUT(self):
        if not self.authed(): return self.deny()
        if self.path == '/api/state':
            return self.send_json(200, {'ok': True, 'updated': put_state(self.body())})
        self.send_json(404, {'error': 'no route'})

    def do_POST(self):
        if self.path == '/api/login':
            if PASSWORD and secrets.compare_digest(str(self.body().get('password', '')), PASSWORD):
                b = b'{"ok": true}'; self.send_response(200); self.send_header('Content-Type', 'application/json')
                self.send_header('Set-Cookie', f'lc={TOKEN}; Path=/; HttpOnly; SameSite=Lax'); self.send_header('Content-Length', str(len(b))); self.end_headers(); return self.wfile.write(b)
            return self.send_json(401, {'error': '비밀번호 불일치'})
        if not self.authed(): return self.deny()
        if self.path == '/api/extract':
            return self.send_json(200, extract(self.body()))
        if self.path == '/api/package':   # 이 거래에 보낼 서류를 zip 하나로: PDF(HTML 렌더)·채운 엑셀·답장 txt·로트 패키지·QR·선적 서류
            b = self.body(); items = b.get('items') or []; name = re.sub(r'[\\/:*?"<>|]+', '_', str(b.get('name') or '서류패키지'))
            if not items: return self.send_json(400, {'error': 'items 없음'})
            import zipfile, io
            out = ROOT / 'agent' / 'out'; out.mkdir(exist_ok=True); zp = out / (name + '.zip'); made = []; css = (ROOT / 'style.css').read_text('utf-8', errors='replace') if (ROOT / 'style.css').exists() else ''
            st = get_state()
            if SD:
                for k, v in (SD.load_state() or {}).items(): st.setdefault(k, v)
            try:
                from playwright.sync_api import sync_playwright
                with zipfile.ZipFile(zp, 'w', zipfile.ZIP_DEFLATED) as z, sync_playwright() as pw:
                    br = pw.chromium.launch(channel='chrome', headless=True); pg = br.new_page()
                    for it in items[:30]:
                        t = it.get('type'); nm = re.sub(r'[\\/:*?"<>|]+', '_', str(it.get('name') or t))
                        try:
                            if t == 'pdf':
                                doc = '<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>' + css + '\n@page{size:A4;margin:14mm}body{background:#fff;padding:0;margin:0}.no-print,.actions{display:none!important}</style></head><body><main>' + str(it.get('html') or '') + '</main></body></html>'
                                pg.set_content(doc, wait_until='load'); pg.emulate_media(media='print'); z.writestr(nm + '.pdf', pg.pdf(format='A4', print_background=True)); made.append(nm + '.pdf')
                            elif t == 'txt': z.writestr(nm + '.txt', str(it.get('text') or '')); made.append(nm + '.txt')
                            elif t == 'xlsx' and it.get('b64'):
                                import openpyxl
                                wb = openpyxl.load_workbook(io.BytesIO(base64.b64decode(it['b64']))); norm = lambda s: re.sub(r'\s+', '', str(s or '')).strip().lower(); keys = {norm(k): v for k, v in (it.get('values') or {}).items() if v not in (None, '')}
                                for ws in wb.worksheets:
                                    for row in ws.iter_rows():
                                        for c in row:
                                            k = norm(c.value)
                                            if k and k in keys:
                                                tgt = ws.cell(row=c.row, column=c.column + 1)
                                                if tgt.value in (None, ''): tgt.value = str(keys[k])
                                bio = io.BytesIO(); wb.save(bio); z.writestr(nm + '.xlsx', bio.getvalue()); made.append(nm + '.xlsx')
                            elif t == 'lot' and SD and it.get('lot'):
                                z.write(SD.buyer_package(st, it['lot']), '로트패키지_' + it['lot'] + '.zip'); made.append('로트패키지_' + it['lot'] + '.zip')
                                if QR:
                                    l = next((x for x in st.get('ledger', []) if x.get('lot') == it['lot']), None)
                                    if l:
                                        qp = ROOT / 'agent' / 'qr' / (it['lot'] + '.png'); qp.parent.mkdir(exist_ok=True); QR.label_png(l, str(it.get('url') or ('http://localhost:%s/lot/%s' % (PORT, urllib.parse.quote(it['lot'])))), qp); z.write(qp, 'QR_' + it['lot'] + '.png'); made.append('QR_' + it['lot'] + '.png')
                            elif t == 'ship' and SD and it.get('no'):
                                for fn, lab in ((SD.packing_list_draft, '패킹리스트초안'), (SD.manufacture_date_list, '제조일자리스트'), (SD.sanitary_cert_request, '위생증명서신청값')):
                                    pth = fn(st, it['no']); z.write(pth, lab + '_' + it['no'] + pathlib.Path(pth).suffix); made.append(lab)
                        except Exception as e: z.writestr('오류_' + nm + '.txt', '%s: %s' % (type(e).__name__, e))
                    z.writestr('목록.txt', '\n'.join(made) + '\n'); br.close()
            except Exception as e: return self.send_json(500, {'error': '패키지 실패: %s' % type(e).__name__})
            return self.send_file(zp, 'application/zip', download=True)
        if self.path == '/api/pdf':   # 화면 조각(HTML) → PDF 파일. 인쇄창 없이 바로 내려받기(휴대폰 포함)
            b = self.body(); html = str(b.get('html') or ''); name = re.sub(r'[\\/:*?"<>|]+', '_', str(b.get('name') or 'document')) or 'document'
            if not html.strip(): return self.send_json(400, {'error': 'html 없음'})
            css = (ROOT / 'style.css').read_text('utf-8', errors='replace') if (ROOT / 'style.css').exists() else ''
            doc = ('<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>' + css + '\n@page{size:A4;margin:14mm}body{background:#fff;padding:0;margin:0}.no-print,.actions,nav,header{display:none!important}table{page-break-inside:auto}tr{page-break-inside:avoid}</style></head><body><main class="print-only">' + html + '</main></body></html>')
            out = ROOT / 'agent' / 'out'; out.mkdir(exist_ok=True); fp = out / (name if name.lower().endswith('.pdf') else name + '.pdf')
            try:
                from playwright.sync_api import sync_playwright
                with sync_playwright() as pw:
                    br = pw.chromium.launch(channel='chrome', headless=True); pg = br.new_page(); pg.set_content(doc, wait_until='load'); pg.emulate_media(media='print'); pg.pdf(path=str(fp), format='A4', print_background=True); br.close()
            except Exception as e: return self.send_json(500, {'error': 'PDF 생성 실패: %s' % type(e).__name__})
            return self.send_file(fp, 'application/pdf', download=True)
        if self.path == '/api/formfill':   # 바이어가 보낸 엑셀 양식(b64)에 값을 채워 그대로 돌려준다. 칸 이름이 있는 셀의 오른쪽 셀에 쓴다
            b = self.body(); vals = b.get('values') or {}; name = re.sub(r'[\\/:*?"<>|]+', '_', str(b.get('name') or 'form.xlsx'))
            if not b.get('b64'): return self.send_json(400, {'error': '양식 파일 없음'})
            try:
                import openpyxl, io
                wb = openpyxl.load_workbook(io.BytesIO(base64.b64decode(b['b64']))); filled = 0
                norm = lambda s: re.sub(r'\s+', '', str(s or '')).strip().lower()
                keys = {norm(k): v for k, v in vals.items() if v not in (None, '')}
                for ws in wb.worksheets:
                    for row in ws.iter_rows():
                        for c in row:
                            k = norm(c.value)
                            if k and k in keys:
                                tgt = ws.cell(row=c.row, column=c.column + 1)
                                if tgt.value in (None, ''): tgt.value = str(keys[k]); filled += 1
                out = ROOT / 'agent' / 'out'; out.mkdir(exist_ok=True); fp = out / ('채움_' + (name if name.lower().endswith('.xlsx') else name + '.xlsx')); wb.save(fp)
            except Exception as e: return self.send_json(500, {'error': '엑셀 채우기 실패: %s' % type(e).__name__})
            self.log_message('formfill %d cells', filled)
            return self.send_file(fp, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', download=True)
        if self.path == '/api/translate':   # 규격서 값 번역(AI 초안). 숫자·단위·코드·회사명은 그대로. 결과는 화면이 저장해 재사용
            b = self.body(); lang = str(b.get('lang') or 'en'); items = [str(x) for x in (b.get('items') or []) if str(x).strip()][:80]
            if not items: return self.send_json(200, {'map': {}})
            if not os.environ.get('ANTHROPIC_API_KEY'): return self.send_json(200, {'map': {}, 'note': 'API 키 없음'})
            names = {'en': '영어', 'ja': '일본어', 'zh-Hant': '번체 중국어(홍콩·대만)', 'zh-Hans': '간체 중국어', 'th': '태국어'}
            try:
                r = graph.llm('다음 한국어 문구(수산 가공식품 규격서·라벨 용어)를 ' + names.get(lang, lang) + '로 번역하라. 규칙: 숫자·단위·%·℃·코드(LB·WF 등)·학명·회사명(A사)·이미 외국어인 부분은 그대로 둔다. 식품 표시 관용 표현을 쓴다(예: -18℃ 이하 냉동 → Keep frozen at or below -18°C). 출력은 {"원문": "번역"} JSON 하나, 원문 전부 빠짐없이.\n' + json.dumps(items, ensure_ascii=False))
                r = r if isinstance(r, dict) else {}; r.pop('_src', None)
                return self.send_json(200, {'map': {k: v for k, v in r.items() if k in items and isinstance(v, str) and v.strip()}})
            except Exception as e: return self.send_json(500, {'error': '번역 실패: %s' % type(e).__name__})
        if self.path == '/api/label/fix':   # 라벨 수정안: 지적된 칸만 AI가 고침. 다시 판정은 화면의 규칙이 한다
            b = self.body()
            if not os.environ.get('ANTHROPIC_API_KEY'): return self.send_json(200, {'fields': b.get('fields') or {}, 'changes': [], 'note': 'API 키 없음'})
            try: return self.send_json(200, graph.label_fix(str(b.get('country') or ''), b.get('fields') or {}, b.get('results') or [], b.get('hints') or {}))
            except Exception as e: return self.send_json(500, {'error': '수정안 실패: %s' % type(e).__name__})
        if self.path == '/api/docs':
            b = self.body()
            with LOCK, db() as c:
                cur = c.execute('insert into docs(at,file,doc_type,mode,decision,result,fields_json) values(?,?,?,?,?,?,?)',
                                (now(), b.get('file'), b.get('doc_type'), b.get('mode'), b.get('decision'), b.get('result'), json.dumps(b.get('fields'), ensure_ascii=False)))
            return self.send_json(200, {'ok': True, 'id': cur.lastrowid})
        self.send_json(404, {'error': 'no route'})

    def static(self, p):
        rel = urllib.parse.unquote(p.lstrip('/')) or 'index.html'
        f = (ROOT / rel).resolve()
        if ROOT not in f.parents or not f.is_file() or f.suffix == '.db' or rel.startswith('server/'):
            self.send_response(404); self.end_headers(); return
        ct = STATIC_CT.get(f.suffix, 'application/octet-stream')
        b = f.read_bytes()
        self.send_response(200)
        self.send_header('Content-Type', ct + ('; charset=utf-8' if ct.startswith(('text/', 'application/j')) else ''))
        self.send_header('Content-Length', str(len(b))); self.send_header('Cache-Control', 'no-store'); self.end_headers(); self.wfile.write(b)


def daily_backup():  # 하루 1개. 이미 있으면 생략
    if not DB.exists(): return
    BACKUP.mkdir(exist_ok=True)
    dst = BACKUP / f'labelcoast-{datetime.date.today():%Y%m%d}.db'
    if not dst.exists(): shutil.copy2(DB, dst)


if __name__ == '__main__':
    daily_backup()
    print(f'labelcoast server http://localhost:{PORT}  (llm={bool(os.environ.get("ANTHROPIC_API_KEY"))}, mfds={bool(MFDS_KEY)}, auth={bool(PASSWORD)})')
    threading.Thread(target=regwatch_loop, daemon=True).start()   # 규정 출처 매일 점검
    ThreadingHTTPServer(('0.0.0.0', PORT), H).serve_forever()
