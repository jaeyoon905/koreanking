# 로트 QR 라벨. 왼쪽 QR(바이어 공개 주소), 오른쪽 LOT·회사 코드·제조일·소비기한·수량.
# 실행: python -X utf8 agent/qr.py 20260410-LB http://localhost:8765/lot/20260410-LB   → agent/qr/20260410-LB.png
import json, pathlib, sqlite3, sys

import qrcode
from PIL import Image, ImageDraw, ImageFont

HERE = pathlib.Path(__file__).parent
FONT = r'C:\Windows\Fonts\malgun.ttf'


def make_qr(text: str):  # 2차원 bool 행렬(조용 영역 제외)
    q = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, border=0); q.add_data(text); q.make(fit=True)
    return q.get_matrix()


def label_png(lot: dict, url: str, out_path, size=(600, 400)):
    q = make_qr(url); n = len(q); quiet = 4; scale = max(2, (size[1] - 40) // (n + 2 * quiet))
    img = Image.new('RGB', size, 'white'); d = ImageDraw.Draw(img)
    ox, oy = 20, (size[1] - scale * (n + 2 * quiet)) // 2
    for y in range(n):
        for x in range(n):
            if q[y][x]: d.rectangle([ox + (x + quiet) * scale, oy + (y + quiet) * scale, ox + (x + quiet + 1) * scale - 1, oy + (y + quiet + 1) * scale - 1], fill='black')
    big, mid, small = ImageFont.truetype(FONT, 34), ImageFont.truetype(FONT, 20), ImageFont.truetype(FONT, 14)
    tx = ox + scale * (n + 2 * quiet) + 16
    d.text((tx, 28), 'LOT ' + str(lot.get('lot', '')), font=big, fill='black')
    y = 90
    for k, v in [('회사 코드', lot.get('company_code', '')), ('품목', lot.get('product', '')), ('제조일', lot.get('mfg', '')), ('소비기한', lot.get('expiry', '')), ('수량', f"{lot.get('qty_ct', '')} C/T")]:
        d.text((tx, y), f'{k}  {v}', font=mid, fill='black'); y += 32
    d.text((tx, size[1] - 60), '제조자 A사 (경북 영덕)', font=small, fill='#333'); d.text((tx, size[1] - 38), url, font=small, fill='#555')
    pathlib.Path(out_path).parent.mkdir(parents=True, exist_ok=True); img.save(out_path)
    return out_path


def lot_from_db(lot_no):
    db = HERE.parent / 'server' / 'labelcoast.db'
    if db.exists():
        r = sqlite3.connect(db).execute("select json from state where id='main'").fetchone()
        for l in (json.loads(r[0]).get('ledger', []) if r else []):
            if l.get('lot') == lot_no or l.get('company_code') == lot_no: return l
    return {'lot': lot_no}


def selftest():
    q = make_qr('http://localhost:8765/lot/20260410-LB'); n = len(q)
    assert n in (29, 33) and q[0][0] and q[6][8] == (8 % 2 == 0), ('QR 행렬', n)
    out = label_png({'lot': 'TEST-LB', 'company_code': 'ZZ', 'product': 'LB', 'mfg': '2026-01-01', 'expiry': '2028-01-01', 'qty_ct': 1}, 'http://localhost:8765/lot/TEST-LB', HERE / 'qr' / '_selftest.png')
    with Image.open(out) as im: assert im.size == (600, 400) and im.mode == 'RGB'
    pathlib.Path(out).unlink()
    print('selftest OK: QR 버전', (n - 17) // 4, '· 라벨 PNG 600×400')


if __name__ == '__main__':
    selftest()
    if len(sys.argv) >= 3:
        lot_no, url = sys.argv[1], sys.argv[2]
        print('saved', label_png(lot_from_db(lot_no), url, HERE / 'qr' / f'{lot_no}.png'))
