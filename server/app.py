# 라벨코스트 서버. 표준 라이브러리 + sqlite3 + anthropic(선택). 실행: labelcoast 폴더에서 python -X utf8 server/app.py
# 역할: 상태 저장(state), 서류 추출(/api/extract: 키 있으면 LLM, 없으면 fixtures), 처리 기록, 바이어용 LOT 공개 면, 식약처 API 프록시, 정적 파일.
import base64, datetime, json, os, pathlib, secrets, shutil, sqlite3, subprocess, sys, tempfile, threading, urllib.parse, urllib.request
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
    ThreadingHTTPServer(('0.0.0.0', PORT), H).serve_forever()
