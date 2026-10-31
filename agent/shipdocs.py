# 선적 서류·기록 묶음 자동 생성. 원장(state)에서만 만든다. 추정값 없음(모르면 빈칸).
# 실행: python -X utf8 agent/shipdocs.py mdl UE-2606 | pl UE-2606 | cert UE-2606 | bundle 2026-04-01 2026-05-31 | buyer 20260410-LB
import json, pathlib, sqlite3, subprocess, sys, zipfile, html
from openpyxl import Workbook
import pymupdf

HERE = pathlib.Path(__file__).parent
ROOT = HERE.parent
DB = ROOT / 'server' / 'labelcoast.db'
OUT = HERE / 'out'
FONT = r'C:\Windows\Fonts\malgun.ttf'
COMPANY = 'A사'


def node_dump(expr):
    js = "global.window={};eval(require('fs').readFileSync('data.js','utf8'));process.stdout.write(JSON.stringify(" + expr + "))"
    return json.loads(subprocess.run(['node', '-e', js], cwd=ROOT, capture_output=True, text=True, encoding='utf-8').stdout)


def load_state():
    st = {}
    if DB.exists():
        r = sqlite3.connect(DB).execute("select json from state where id='main'").fetchone()
        if r: st = json.loads(r[0])
    if not st.get('ledger'):
        st = node_dump("{ledger:LC.seedLedger,raw:LC.rawLots,registry:LC.registry,shipments:LC.shipmentsSeed||[],nutritionSources:LC.nutritionSources||[],specForms:{},importShipments:[],docs:[]}")
    for k in ('ledger', 'raw', 'registry', 'shipments', 'nutritionSources', 'docs', 'importShipments'): st.setdefault(k, [])
    st.setdefault('specForms', {})
    st['products'] = node_dump('LC.products')
    st['factory'] = node_dump('LC.product.factory')
    return st


def ship(st, no):
    s = next((x for x in st['shipments'] if x.get('no') == no), None)
    if not s: sys.exit(f'선적 {no} 없음')
    lots = [l for l in st['ledger'] if no in (l.get('ship') or '')]
    return s, lots


def wb_sheet(title):
    wb = Workbook(); ws = wb.active; ws.title = title[:30]; return wb, ws


def save(wb, name):
    OUT.mkdir(exist_ok=True); p = OUT / name; wb.save(p); return p


def pname(st, code):
    p = st['products'].get(code) or {}
    return p.get('name_en') or code


# 1) 제조일자 리스트 -----------------------------------------------------------
def manufacture_date_list(st, no):
    s, lots = ship(st, no)
    wb, ws = wb_sheet('제조일자 리스트')
    ws.append(['제조일자 리스트 / Manufacturing Date List'])
    ws.append(['선적번호 / Invoice No', s.get('no'), '출항일 / Departure', s.get('etd') or s.get('departure') or ''])
    ws.append(['바이어 / Consignee', s.get('buyer'), '선박 / Vessel', s.get('vessel')])
    ws.append(['제조자 / Manufacturer', COMPANY])
    ws.append([])
    ws.append(['품목 / Product', '회사 LOT / Lot Code', '제조일 / Mfg Date (YYYY-MM-DD)', '소비기한 / Best Before', 'C/T', 'kg'])
    tct = tkg = 0
    for l in sorted(lots, key=lambda x: x.get('mfg') or ''):
        rows = l.get('pack_rows') or [{'ct': l.get('qty_ct'), 'lot_code': l.get('company_code'), 'expiry': l.get('expiry')}]
        kg_per = (l.get('kg') or 0) / (l.get('qty_ct') or 1)
        for r in rows:
            kg = round((r.get('ct') or 0) * kg_per, 1) if l.get('kg') else ''
            ws.append([pname(st, l.get('product')), r.get('lot_code') or l.get('company_code'), l.get('mfg'), r.get('expiry') or l.get('expiry'), r.get('ct'), kg])
            tct += r.get('ct') or 0; tkg += kg or 0
    ws.append(['합계 / Total', '', '', '', tct, round(tkg, 1)])
    if not lots: ws.append(['(연결된 로트 없음. ⑦에서 패킹리스트를 승인해 로트를 연결하세요)'])
    for c, w in zip('ABCDEF', (40, 16, 26, 20, 8, 10)): ws.column_dimensions[c].width = w
    return save(wb, f'제조일자리스트_{no}.xlsx')


# 2) 패킹리스트 초안 -----------------------------------------------------------
def packing_list_draft(st, no):
    s, lots = ship(st, no)
    wb, ws = wb_sheet('PACKING LIST')
    frm, to = ((s.get('route') or '').replace('→', '|').split('|') + ['', ''])[:2]
    ws.append(['PACKING LIST (초안 · 단가·금액 없음)'])
    ws.append(['SHIPPER / EXPORTER', COMPANY, 'INVOICE NO & DATE', f"{s.get('no')} {s.get('date') or ''}"])
    ws.append(['', '(주소)', 'DEPARTURE DATE', s.get('etd') or s.get('departure') or ''])
    ws.append(['CONSIGNEE', s.get('buyer'), 'VESSEL/FLIGHT', s.get('vessel')])
    ws.append(['NOTIFY PARTY', 'SAME AS ABOVE', 'FROM / TO', f"{frm.strip()} / {to.strip()}"])
    ws.append(['REMARK', 'ORIGIN: REPUBLIC OF KOREA', 'HS CODE', s.get('hs') or ''])
    ws.append([])
    ws.append(['MARKS & NUMBERS', 'DESCRIPTION OF GOODS', 'QUANTITY (C/T)', 'NET WEIGHT (KG)', 'GROSS WEIGHT (KG)', 'LOT'])
    lotcodes = ', '.join(l.get('company_code') or l['lot'] for l in lots)
    for i, it in enumerate(s.get('items') or []):
        ws.append([f"C/T NO 1-{s.get('total_ct') or ''}" if i == 0 else '', it.get('desc'), it.get('ct'), it.get('kg'), '', lotcodes if 'LB' in (it.get('desc') or '') else ''])
    ws.append(['G-TOTAL', '', s.get('total_ct') or sum(i.get('ct') or 0 for i in s.get('items') or []), s.get('total_kg') or sum(i.get('kg') or 0 for i in s.get('items') or []), ''])
    ws.append([]); ws.append(['GROSS WEIGHT 는 실측 후 기입(추정하지 않음). 단가·금액은 이 초안에 넣지 않음.'])
    for c, w in zip('ABCDEF', (20, 34, 16, 18, 18, 16)): ws.column_dimensions[c].width = w
    return save(wb, f'패킹리스트초안_{no}.xlsx')


# 3) 위생증명서 신청값 -----------------------------------------------------------
def sanitary_cert_request(st, no):
    s, lots = ship(st, no)
    wb, ws = wb_sheet('위생증명서 신청값')
    mfgs = sorted(l.get('mfg') for l in lots if l.get('mfg'))
    ws.append(['수품원 위생증명서 신청에 옮겨 적을 값 (공식 서식 아님)'])
    ws.append([])
    for k, v in [('신청인 / Applicant', COMPANY), ('품명(영문) / Commodity', ', '.join(sorted({pname(st, l.get('product')) for l in lots})) or ', '.join(i.get('desc') or '' for i in s.get('items') or [])),
                 ('포장 / Packing', 'CARTON BOX' + (' (VACUUM PACKED)' if any('진공' in (l.get('note') or '') for l in lots) else '')),
                 ('수량 / Quantity', f"{s.get('total_ct') or ''} CARTONS ({s.get('total_kg') or ''} KG)"), ('생산지 / Produced District', 'THE REPUBLIC OF KOREA'),
                 ('도착국·항구 / Destination', (s.get('route') or '').split('→')[-1].strip()), ('선박·출항일 / Vessel, ETD', f"{s.get('vessel') or ''} / {s.get('etd') or s.get('departure') or ''}"),
                 ('제조일 범위 / Mfg dates', f"{mfgs[0]} ~ {mfgs[-1]}" if mfgs else ''), ('연결 로트 / Lots', ', '.join(f"{l.get('company_code')}({l['lot']})" for l in lots)),
                 ('양식 / Form', '협약국이면 해당국 양식, 일본 등은 비협약국 양식(바이어 요청 시)'), ('기존 증명서 / Existing', s.get('cert') or '')]:
        ws.append([k, v])
    ws.column_dimensions['A'].width = 30; ws.column_dimensions['B'].width = 70
    return save(wb, f'위생증명서신청값_{no}.xlsx')


# 4) 기록 묶음 PDF -----------------------------------------------------------
def _table(title, head, rows):
    if not rows: return f'<h2>{title}</h2><p class="m">기간 내 기록 없음</p>'
    h = ''.join(f'<th>{html.escape(str(c))}</th>' for c in head)
    b = ''.join('<tr>' + ''.join(f'<td>{html.escape("" if v is None else str(v))}</td>' for v in r) + '</tr>' for r in rows)
    return f'<h2>{title}</h2><table><tr>{h}</tr>{b}</table>'


def html_pdf(body, path, title):
    css = 'body{font-family:malgun;font-size:9pt} h1{font-size:15pt} h2{font-size:11pt;margin-top:10pt} table{border-collapse:collapse;width:100%} th,td{border:0.5pt solid #777;padding:2pt 3pt;text-align:left} th{background:#eef} .m{color:#666}'
    arch = pymupdf.Archive(); arch.add(pathlib.Path(FONT).parent)
    story = pymupdf.Story(html=f'<h1>{title}</h1>{body}', user_css=css, archive=arch)
    OUT.mkdir(exist_ok=True); p = OUT / path
    w = pymupdf.DocumentWriter(str(p)); rect = pymupdf.paper_rect('a4'); area = rect + (36, 36, -36, -36)
    more = 1
    while more:
        dev = w.begin_page(rect); more, _ = story.place(area); story.draw(dev); w.end_page()
    w.close(); return p


def records_bundle(st, d0, d1):
    inr = lambda d: d and d0 <= d[:10] <= d1
    raw = [[r.get('id'), r.get('vessel'), r.get('caught'), r.get('received'), r.get('kg'), r.get('note')] for r in st['raw'] if inr(r.get('received'))]
    lots = [[l.get('mfg'), l['lot'], l.get('company_code'), l.get('product'), l.get('qty_ct'), l.get('kg'), ', '.join(l.get('raw') or []), l.get('raw_by') or '', l.get('ship') or ''] for l in sorted(st['ledger'], key=lambda x: x.get('mfg') or '') if inr(l.get('mfg'))]
    ships = [[s.get('no'), s.get('etd') or s.get('departure'), s.get('buyer'), s.get('vessel'), s.get('total_ct'), s.get('total_kg'), s.get('cert')] for s in st['shipments'] if inr(s.get('etd') or s.get('departure') or s.get('date'))]
    reg = [[r.get('kind'), r.get('name'), r.get('no'), r.get('issuer'), r.get('expiry') or '-'] for r in st['registry']]
    docs = [[d.get('at'), d.get('doc_type'), d.get('file'), d.get('result')] for d in st['docs']][-60:]
    body = (f'<p>기간 {d0} ~ {d1} · 제조자 {COMPANY} · 생성 {__import__("datetime").date.today()}</p>'
            + _table('1. 원료 입고', ['입고 ID', '선박', '조업', '입고일', 'kg', '비고'], raw)
            + _table('2. 제조일별 로트', ['제조일', 'LOT', '회사 코드', '품목', 'C/T', 'kg', '원료 입고분', '연결 근거', '선적'], lots)
            + _table('3. 선적', ['선적번호', '출항', '바이어', '선박', 'C/T', 'kg', '증명서'], ships)
            + _table('4. 등록·인증', ['구분', '명칭', '번호', '기관', '만료'], reg)
            + _table('5. 서류 처리 기록', ['일자', '종류', '파일', '결과'], docs))
    return html_pdf(body, f'기록묶음_{d0}_{d1}.pdf', '기록 묶음 (HACCP 심사·바이어 실사용)')


# 5) 바이어 패키지 zip -----------------------------------------------------------
def cert_en(c):   # 위생증명서 표기(한국어 원장 값) → 영문
    c = str(c or '')
    if not c: return '-'
    return c.replace('수품원 위생증명서', 'NFQS Health Certificate').replace('(바이어 요청, 비협약국 양식)', '(on buyer request)').replace('바이어 요청', 'on buyer request').replace('비협약국 양식', 'non-agreement form')


def buyer_package(st, lot_no, out_dir=None):
    lot = next((l for l in st['ledger'] if l['lot'] == lot_no), None)
    if not lot: sys.exit(f'LOT {lot_no} 없음')
    p = st['products'].get(lot.get('product')) or {}
    buyer = (lot.get('buyer') or '').replace('일본 바이어 ', '')
    buyer_disp = buyer.replace('사', '社')   # 일문 문서 표기
    tx = (st.get('tx') or {}).get('ja') or {}   # 화면에서 번역해 둔 값(일본어)이 있으면 바이어 쪽 말로
    certs = [f"{tx.get(r.get('name'), r.get('name'))} {r.get('no')} (~{r.get('expiry') or '-'})" for r in st['registry'] if r.get('kind') == '법정인증' or 'HACCP' in (r.get('name') or '')]
    maker = ((p.get('factory') or {}).get('name_en')) or 'A Co. (Republic of Korea)'
    pub = {'lot': lot['lot'], 'company_code': lot.get('company_code'), 'product': p.get('name_en') or lot.get('product'), 'mfg': lot.get('mfg'), 'expiry': lot.get('expiry'),
           'qty_ct': lot.get('qty_ct'), 'kg': lot.get('kg'), 'cert': lot.get('cert') or '', 'spec_sent': lot.get('spec_sent') or '', 'manufacturer': COMPANY, 'certs': certs}
    form = st['specForms'].get(buyer)
    ing = '、'.join(i.get('name_ko', '') for i in p.get('ingredients') or [])
    kv = lambda rows: '<table>' + ''.join(f'<tr><th>{html.escape(k)}</th><td>{html.escape(str(v))}</td></tr>' for k, v in rows) + '</table>'
    if form:  # 바이어 양식 칸 순서대로. 없는 값은 빈칸(추정 안 함)
        vals = {'会社名': buyer_disp, '作成日': str(__import__('datetime').date.today()), '韓国商品名': p.get('name_ko', ''), '日本商品名': p.get('name_ja', ''), '形態': '', '工場': maker,
                '規格': p.get('pack', ''), '賞味期限': f"{p.get('shelf_months', '')}か月" if p.get('shelf_months') else '', '単位': '', '商品番号': '', '商品コード': '',
                '重点管理': ' / '.join(form.get('qc') or []), '配合': ', '.join(f"{r['name']} {r.get('pct', '')}%" for r in form.get('recipe') or []),
                '調味液': ', '.join(f"{r['name']} {r.get('pct', '')}%" for r in form.get('seasoning') or []), '包装資材': ', '.join(form.get('packaging') or [])}
        body = f"<h2>{html.escape(form.get('form_title') or '規格書')} ({buyer_disp} 様式)</h2>" + kv([(k, vals.get(k, '')) for k in form.get('fields') or []])
    else:
        body = '<h2>ロット規格書 / Lot specification</h2>' + kv([('製品名 / Product', p.get('name_en', '')), ('原材料 / Ingredients', ing), ('内容量 / Net', p.get('pack', '')), ('保存 / Storage', 'Keep frozen at -18°C or below' if '-18' in str(p.get('storage', '')) else p.get('storage', ''))])
    body += '<h2>LOT</h2>' + kv([('LOT', f"{lot['lot']} ({lot.get('company_code')})"), ('製造日 / Production date', lot.get('mfg')), ('賞味期限 / Best before', lot.get('expiry')), ('数量 / Quantity', f"{lot.get('qty_ct')} C/T, {lot.get('kg')} kg"),
                                 ('衛生証明書 / Health certificate', cert_en(lot.get('cert'))), ('製造者 / Manufacturer', maker), ('認証 / Certificates', ' / '.join(certs))])
    pdf = html_pdf(body, f'규격서_{lot_no}.pdf', f'Lot specification {lot_no}')
    out = pathlib.Path(out_dir) if out_dir else OUT; out.mkdir(exist_ok=True)
    zp = out / f'바이어패키지_{lot_no}.zip'
    with zipfile.ZipFile(zp, 'w', zipfile.ZIP_DEFLATED) as z:
        z.write(pdf, pdf.name)
        z.writestr(f'LOT_{lot_no}.json', json.dumps(pub, ensure_ascii=False, indent=1))
        z.writestr(f'LOT_{lot_no}.html', '<meta charset="utf-8"><h2>LOT ' + lot_no + '</h2>' + kv(list(pub.items())))
        z.writestr('인증목록.txt', '\n'.join(certs) or '(없음)')
        z.writestr('위생증명서_메모.txt', (lot.get('cert') or '이 선적은 위생증명서 미발급(바이어 요청 시 비협약국 양식으로 발급)'))
    return zp


if __name__ == '__main__':
    a = sys.argv[1:]
    st = load_state()
    cmd = {'mdl': lambda: manufacture_date_list(st, a[1]), 'pl': lambda: packing_list_draft(st, a[1]), 'cert': lambda: sanitary_cert_request(st, a[1]),
           'bundle': lambda: records_bundle(st, a[1], a[2]), 'buyer': lambda: buyer_package(st, a[1])}
    if not a or a[0] not in cmd: sys.exit('사용: mdl|pl|cert <선적번호> | bundle <from> <to> | buyer <LOT>')
    print(cmd[a[0]]())
