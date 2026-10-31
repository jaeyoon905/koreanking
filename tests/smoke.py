# 통합 점검. labelcoast 폴더에서: python -X utf8 tests/smoke.py
# A 정적 → B 오프라인(file://) → C 서버 모드 → D tests/last_run.txt. 하나 실패해도 끝까지 돌고 exit 1.
import json, os, pathlib, shutil, socket, subprocess, sys, time, urllib.error, urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
DOCS = ROOT.parent / '회사에서 새로받은 파일' / '첨부자료'
B = 'http://localhost:8765'
RESULTS = []


def check(name, ok, note=''):
    RESULTS.append((name, bool(ok), note)); print(('OK   ' if ok else 'FAIL ') + name + (('  — ' + str(note)[:160]) if (note and not ok) else ''))


def run(cmd, **kw):
    return subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, encoding='utf-8', errors='replace', **kw)


# ---------- A. 정적 ----------
def static_checks():
    for f in ['data.js', 'apply.js', 'fixtures.js', 'import.js', 'app.js']:
        r = run(['node', '-e', "new Function(require('fs').readFileSync(process.argv[1],'utf8'))", f])
        check(f'A 문법 {f}', r.returncode == 0, r.stderr.strip().splitlines()[-1:] if r.returncode else '')
    r = run([sys.executable, '-X', 'utf8', 'agent/graph.py'])
    check('A graph.py selftest', 'selftest OK' in r.stdout, (r.stdout + r.stderr).strip()[-200:])
    r = run(['node', 'agent/judge.js', 'JP', '{"ingredients":"紅ずわいがに（韓国）、食塩、ﾃﾞｷｽﾄﾘﾝ/ﾄﾚﾊﾛｰｽ、調味料（ｱﾐﾉ酸等）","nutrition":"食塩相当量0.6g","importer":"u","name":"a","net":"1","storage":"s","origin":"韓国"}'])
    try: ok = all(x['status'] == 'pass' for x in json.loads(r.stdout)); note = [x['item'] for x in json.loads(r.stdout) if x['status'] != 'pass']
    except Exception as e: ok, note = False, str(e)
    check('A judge.js JP U사 라벨 전부 pass', ok, note)
    banned = [x[::-1] for x in ['웅세', '호성삼', '노에우', '다모토', '이레산', 'IHSOYENAK', 'NEROYG', 'yraicifeneB', '0-851']]  # 뒤집어 보관(소스 자체가 검사에 걸리지 않게)
    for f in ['app.js', 'data.js', 'fixtures.js', 'apply.js', 'import.js', 'index.html', 'style.css']:
        p = ROOT / f
        if not p.exists(): check(f'A 금지어 {f}', False, '파일 없음'); continue
        t = p.read_text('utf-8'); hit = [w for w in banned if w in t]
        check(f'A 금지어 {f}', not hit, hit)


# ---------- 공용 Playwright ----------
def browser_session(fn):
    from playwright.sync_api import sync_playwright
    errs = []
    with sync_playwright() as p:
        b = p.chromium.launch(headless=True, channel='chrome'); pg = b.new_page(viewport={'width': 1280, 'height': 800})
        pg.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)))
        pg.on('console', lambda m: errs.append('console: ' + m.text) if m.type == 'error' else None)
        try: fn(pg, errs)
        finally: b.close()
    return errs


def click_btn(pg, text, wait=400):
    for el in pg.query_selector_all('#main button'):
        if text in el.inner_text(): el.click(); pg.wait_for_timeout(wait); return True
    return False


def approve_all(pg, n):
    for _ in range(n):
        for cb in pg.query_selector_all('#main [data-mask]'):
            try: cb.click(); pg.wait_for_timeout(600)
            except Exception: pass
        if not click_btn(pg, '승인', 500): break


def summary(pg):
    import re
    m = re.search(r'로트 \d+건[^\n]*', pg.inner_text('#main')); return m.group(0) if m else ''


# ---------- B. 오프라인 ----------
def offline_checks():
    url = (ROOT / 'index.html').as_uri()

    def fn(pg, errs):
        pg.goto(url); pg.wait_for_timeout(400); pg.evaluate('localStorage.clear()')
        for h in ['#label', '#product', '#spec', '#ship', '#lot/20260410-LB', '#dash', '#intake', '#import']:
            pg.goto(url + h); pg.wait_for_timeout(400)
            n = len(pg.inner_text('#main')) if pg.query_selector('#main') else 0
            check(f'B 렌더 {h}', n >= 100, f'{n}자')
        pg.goto(url + '#intake'); pg.wait_for_timeout(400)
        a = click_btn(pg, '빈 원장'); b_ = click_btn(pg, '7-3'); approve_all(pg, 1)
        check('B 오프라인 7-3 승인 → 로트 4건', a and b_ and '로트 4건' in summary(pg), summary(pg))
    errs = browser_session(fn)
    check('B 오프라인 콘솔·페이지 오류 0', not errs, errs[:3])


# ---------- C. 서버 ----------
def api(path, method='GET', body=None, raw=False):
    req = urllib.request.Request(B + path, method=method, data=json.dumps(body).encode() if body is not None else None, headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=30) as r:
        d = r.read(); return (r.status, d.decode('utf-8', 'replace')) if raw else json.loads(d.decode())


def port_busy():
    with socket.socket() as s: return s.connect_ex(('127.0.0.1', 8765)) == 0


def server_checks():
    db = ROOT / 'server' / 'labelcoast.db'; bak = db.with_suffix('.db.smokebak'); proc = None
    own = not port_busy()
    if own:
        if db.exists(): shutil.copy(db, bak)
        proc = subprocess.Popen([sys.executable, '-X', 'utf8', 'server/app.py'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(30):
            if port_busy(): break
            time.sleep(0.3)
    try:
        try: h = api('/api/health'); check('C health ok', h.get('ok') is True, h)
        except Exception as e: check('C health ok', False, e); return
        st = {'ledger': [{'lot': 'SMOKE-1', 'company_code': 'X', 'product': 'LB', 'mfg': '2026-01-01', 'expiry': '2028-01-01', 'qty_ct': 1, 'kg': 12, 'raw': [], 'country': 'JP', 'buyer': 'U사', 'ship': '', 'cert': '', 'spec_sent': ''}]}
        api('/api/state', 'PUT', st); got = api('/api/state')
        check('C state PUT→GET 왕복', got.get('ledger', [{}])[0].get('lot') == 'SMOKE-1', got.keys())
        r = api('/api/extract', 'POST', {'filename': '7-3.포장 일지.pdf'}); check('C extract 7-3 → fixture', r.get('mode') == 'fixture' and r.get('fields'), r.get('mode'))
        r = api('/api/extract', 'POST', {'filename': '5-2.패킹리스트.png'}); check('C extract 5-2 → blocked', r.get('blocked') is True, r)
        r = api('/api/extract', 'POST', {'filename': '5-2.패킹리스트.png', 'masked': True}); check('C extract 5-2 masked → fields', not r.get('blocked') and len(r.get('fields') or []) > 0, r.get('mode'))
        r = api('/api/extract', 'POST', {'filename': 'IMG_없는파일.jpg'}); check('C extract 미확인 → none', r.get('mode') == 'none', r.get('mode'))
        try:
            api('/api/lot/20260410-LB/public')
        except urllib.error.HTTPError:
            seed = {'ledger': [{'lot': '20260410-LB', 'company_code': 'AJ', 'product': 'LB', 'mfg': '2026-04-10', 'expiry': '2028-04-01', 'qty_ct': 205, 'kg': 2460, 'raw': ['R-20260408-01'], 'country': 'JP', 'buyer': '일본 바이어 U사', 'ship': 'UE-2606', 'cert': '', 'spec_sent': ''}]}
            api('/api/state', 'PUT', seed)
        try: pub = api('/api/lot/20260410-LB/public'); check('C lot public 200', pub.get('lot') == '20260410-LB' and 'buyer' not in pub, pub)
        except Exception as e: check('C lot public 200', False, e)
        try: api('/api/docs'); check('C docs 200', True)
        except Exception as e: check('C docs 200', False, e)
        try: api('/../.env', raw=True); check('C /../.env 404', False, '200 반환')
        except urllib.error.HTTPError as e: check('C /../.env 404', e.code == 404, e.code)
        try: s, body = api('/', raw=True); check('C / → index.html', s == 200 and '<div id="main">' in body, s)
        except Exception as e: check('C / → index.html', False, e)

        def fn(pg, errs):
            pg.goto(B + '/#intake'); pg.wait_for_timeout(900)
            badge = pg.inner_text('#mode') if pg.query_selector('#mode') else ''
            check('C 모드 배지 서버 연결', '서버 연결' in badge, badge)
            click_btn(pg, '빈 원장', 800)
            files = [DOCS / '7-3.포장 일지.pdf', DOCS / '7-1.원료입고검사서.pdf', DOCS / '7-2.가공일지.pdf', DOCS / '5-2.패킹리스트.png']
            missing = [f.name for f in files if not f.exists()]
            if missing: check('C 업로드 파일 존재', False, missing); return
            pg.set_input_files('#main input[type=file]', [str(f) for f in files]); pg.wait_for_timeout(3000)
            cards = [c for c in pg.query_selector_all('#main .card') if '접수부' in c.inner_text()]
            check('C 업로드 카드 4장', len(cards) == 4, len(cards))
            check('C 5-2 접수부 차단 문구', '접수부 차단' in pg.inner_text('#main'))
            approve_all(pg, 4); pg.wait_for_timeout(800)
            check("C 승인 4번 → 요약 '로트 4건 · 입고 4건 · 선적 1건'", '로트 4건 · 입고 4건 · 선적 1건' in summary(pg), summary(pg))
        errs = browser_session(fn)
        check('C 서버 모드 콘솔·페이지 오류 0', not errs, errs[:3])
        st = api('/api/state'); check('C 서버 state ledger 4 · shipments 1', len(st.get('ledger', [])) == 4 and len(st.get('shipments', [])) == 1, (len(st.get('ledger', [])), len(st.get('shipments', []))))
    finally:
        if proc:
            proc.terminate()
            try: proc.wait(5)
            except Exception: proc.kill()
            time.sleep(0.5)
            if bak.exists(): shutil.move(str(bak), str(db))
            elif db.exists(): db.unlink()
        else:
            print('     (이미 떠 있던 8765 서버를 사용. DB는 그 서버 것이 바뀌었음)')


if __name__ == '__main__':
    os.chdir(ROOT)
    for name, f in [('A', static_checks), ('B', offline_checks), ('C', server_checks)]:
        try: f()
        except Exception as e: check(f'{name} 단계 예외', False, repr(e))
    ok = sum(1 for _, o, _ in RESULTS if o); total = len(RESULTS)
    line = f'합계 {ok}/{total} OK' + ('' if ok == total else f', FAIL {total - ok}')
    print(line)
    (ROOT / 'tests' / 'last_run.txt').write_text('\n'.join(('OK   ' if o else 'FAIL ') + n + (('  — ' + str(t)[:200]) if (t and not o) else '') for n, o, t in RESULTS) + '\n' + line + '\n', 'utf-8')
    sys.exit(0 if ok == total else 1)
