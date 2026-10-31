# 보안부: 서류를 AI에 보내기 전에 계좌·금액·주민번호를 로컬에서 먼저 지운다. 원본은 건드리지 않고 agent/redacted/ 에 사본.
# 텍스트 PDF 는 pymupdf 로, 이미지(PNG/JPG, 스캔 PDF)는 rapidocr 로 글자 위치를 찾아 줄 단위로 가린다. boxes(비율 좌표)로 수동 가림도 가능.
# 사용: redact(path) / redact(path, boxes=[(0, 0.8, 1, 1)])   자가 점검: python -X utf8 agent/redact.py
import pathlib, re, sys

import pymupdf

HERE = pathlib.Path(__file__).parent
OUT_DIR = HERE / 'redacted'

CTX = re.compile(r'account|a/c|beneficiary|swift|계좌', re.I)              # 이 말이 있는 줄(과 다음 줄의 번호)은 통째로
ACCT = re.compile(r'(?<!\d)\d[\d\-]{8,18}\d(?!\d)')                         # 하이픈 포함 10~16자리
MONEY = re.compile(r'(?:[¥₩$]|USD|JPY|KRW)\s?\d[\d,]*(?:\.\d+)?', re.I)     # 통화 기호/코드 + 숫자
RRN = re.compile(r'(?<!\d)\d{6}-\d{7}(?!\d)')                                # 주민번호
COL_HDR = re.compile(r'unit\s*price|amount|단가|금액', re.I)                 # 이 헤더 아래 열 전체
PHONE = re.compile(r'tel|fax|phone|전화|팩스|\+\d', re.I)                         # 전화·팩스 줄의 숫자는 계좌가 아니다


def _mask(t): return t[:2] + '*' * max(1, len(t) - 2)
def _digits(t): return sum(c.isdigit() for c in t)


def _ocr_lines(path):
    """[(x0,y0,x1,y1,text,score)] 픽셀 좌표. OCR 실패/미설치면 None."""
    try:
        from rapidocr_onnxruntime import RapidOCR
        res, _ = RapidOCR()(str(path))
    except Exception:
        return None
    out = []
    for box, text, score in (res or []):
        xs = [pt[0] for pt in box]; ys = [pt[1] for pt in box]
        out.append((min(xs), min(ys), max(xs), max(ys), text, float(score)))
    return out


def _line_hits(lines):
    """줄 단위 (x0,y0,x1,y1,text) → [(rect4, kind, text)]. 텍스트 레이어가 없을 때(OCR) 쓴다. 줄 통째로 가린다."""
    hits, prev_ctx = [], False
    for ln in lines:
        x0, y0, x1, y1, text = ln[:5]
        ctx = bool(CTX.search(text)); kind = None
        if ctx or (prev_ctx and ACCT.search(text)): kind = '계좌'
        elif not PHONE.search(text) and any(_digits(m.group(0)) >= 10 for m in ACCT.finditer(text)): kind = '계좌'
        elif MONEY.search(text): kind = '금액'
        elif RRN.search(text): kind = '주민번호'
        prev_ctx = ctx
        if kind: hits.append(((x0, y0, x1, y1), kind, text.strip()))
    for hx0, hy0, hx1, hy1, htext in [l[:5] for l in lines if COL_HDR.search(l[4])]:
        for x0, y0, x1, y1, text in [l[:5] for l in lines]:
            if y0 > hy1 and x0 < hx1 + 4 and x1 > hx0 - 4 and re.search(r'\d', text):
                hits.append(((x0, y0, x1, y1), '금액열', text.strip()))
    return hits


def _has_sensitive_word(lines):
    t = ' '.join(l[4] for l in lines)
    # 숫자열만으로는 민감으로 보지 않는다(전화·팩스 번호가 OCR 에서 하이픈 없이 붙어 나옴). 계좌는 문맥어와 같이 있을 때만
    return bool(CTX.search(t) or MONEY.search(t) or COL_HDR.search(t))


def _ocr_verdict(lines, found):
    low = sum(1 for l in lines if l[5] < 0.5)
    if lines and low / len(lines) > 0.3:
        return False, 'OCR 신뢰도 낮은 줄 ' + str(low) + '/' + str(len(lines)) + '. 사람이 확인해야 함'
    if found or not _has_sensitive_word(lines):
        return True, ('OCR로 ' + str(len(found)) + '건 가림') if found else 'OCR 결과에 계좌·금액 단어 없음'
    return False, '민감 단어는 있는데 패턴을 못 잡음. 사람이 확인해야 함'


def _pdf_hits(page):
    """(rect, kind, text) 목록. 줄 단위 문맥 + 패턴 + 헤더 열."""
    hits = []
    d = page.get_text('dict')
    lines = [(l['bbox'], ''.join(s['text'] for s in l['spans'])) for b in d['blocks'] if b.get('type') == 0 for l in b['lines']]
    prev_ctx = False
    for bbox, text in lines:
        ctx = bool(CTX.search(text))
        if ctx or (prev_ctx and ACCT.search(text)):
            hits.append((pymupdf.Rect(bbox), '계좌', text.strip()))
        prev_ctx = ctx
        for kind, rx, ok in (('계좌', ACCT, lambda m: _digits(m) >= 10 and not PHONE.search(text)), ('금액', MONEY, lambda m: True), ('주민번호', RRN, lambda m: True)):
            for m in rx.finditer(text):
                if ok(m.group(0)):
                    for r in page.search_for(m.group(0)):
                        if abs(r.y0 - bbox[1]) < 6: hits.append((r, kind, m.group(0)))
    # 헤더 열: 헤더 단어 x 범위와 겹치는 아래쪽 단어 전부
    words = page.get_text('words')  # x0,y0,x1,y1,text,...
    for i, w in enumerate(words):
        if COL_HDR.search(w[4]) or (i + 1 < len(words) and COL_HDR.search(w[4] + ' ' + words[i + 1][4])):
            x0, y1 = w[0], w[3]
            x1 = words[i + 1][2] if (i + 1 < len(words) and COL_HDR.search(w[4] + ' ' + words[i + 1][4])) else w[2]
            for v in words:
                if v[1] > y1 and v[0] < x1 + 2 and v[2] > x0 - 2 and re.search(r'\d', v[4]):
                    hits.append((pymupdf.Rect(v[:4]), '금액열', v[4]))
    return hits


def redact(path_in, path_out=None, boxes=None):
    src = pathlib.Path(path_in); OUT_DIR.mkdir(exist_ok=True)
    out = pathlib.Path(path_out) if path_out else OUT_DIR / (src.stem + '_redacted' + src.suffix)
    found, note = [], '이름은 패턴으로 못 잡는다. 추출 단계에서 비식별'
    if src.suffix.lower() == '.pdf':
        doc = pymupdf.open(src)
        has_text = any(p.get_text().strip() for p in doc)
        ocr_ok, ocr_lines_all = True, []
        for pno, page in enumerate(doc, 1):
            if has_text:
                for r, kind, text in _pdf_hits(page):
                    page.add_redact_annot(r, fill=(0, 0, 0)); found.append({'kind': kind, 'text_masked': _mask(text), 'page': pno})
            else:  # 이미지 PDF: 200dpi 렌더 → OCR → PDF 좌표로 환산
                pix = page.get_pixmap(dpi=200); tmp = OUT_DIR / ('_p' + str(pno) + '.png'); pix.save(tmp)
                lines = _ocr_lines(tmp); tmp.unlink(missing_ok=True)
                if lines is None: ocr_ok = False; continue
                ocr_lines_all += lines; sx, sy = page.rect.width / pix.width, page.rect.height / pix.height
                for (x0, y0, x1, y1), kind, text in _line_hits(lines):
                    page.add_redact_annot(pymupdf.Rect(x0 * sx, y0 * sy, x1 * sx, y1 * sy), fill=(0, 0, 0)); found.append({'kind': kind, 'text_masked': _mask(text), 'page': pno})
            for b in boxes or []:
                W, H = page.rect.width, page.rect.height
                page.add_redact_annot(pymupdf.Rect(b[0] * W, b[1] * H, b[2] * W, b[3] * H), fill=(0, 0, 0)); found.append({'kind': '수동', 'text_masked': '-', 'page': pno})
            page.apply_redactions()
        doc.save(out, garbage=3, deflate=True); doc.close()
        if has_text:
            return {'out': str(out), 'found': found, 'method': 'text', 'safe_for_llm': True, 'note': note}
        if ocr_ok:
            safe, vn = _ocr_verdict(ocr_lines_all, [f for f in found if f['kind'] != '수동'])
            return {'out': str(out), 'found': found, 'method': 'image-ocr', 'safe_for_llm': safe or bool(boxes), 'note': vn + '. ' + note}
        return {'out': str(out), 'found': found, 'method': 'image-none', 'safe_for_llm': bool(boxes), 'note': 'OCR 실패. 사람이 가렸음을 확인해야 함. ' + note}
    # PNG/JPG
    from PIL import Image, ImageDraw
    im = Image.open(src).convert('RGB'); W, H = im.size; dr = ImageDraw.Draw(im)
    lines = _ocr_lines(src)
    for (x0, y0, x1, y1), kind, text in (_line_hits(lines) if lines else []):
        dr.rectangle([x0 - 2, y0 - 2, x1 + 2, y1 + 2], fill=(0, 0, 0)); found.append({'kind': kind, 'text_masked': _mask(text), 'page': 1})
    for b in boxes or []:
        dr.rectangle([b[0] * W, b[1] * H, b[2] * W, b[3] * H], fill=(0, 0, 0)); found.append({'kind': '수동', 'text_masked': '-', 'page': 1})
    im.save(out)
    if lines is None:
        return {'out': str(out), 'found': found, 'method': 'image-none', 'safe_for_llm': bool(boxes), 'note': 'OCR 실패. 사람이 가렸음을 확인해야 함. ' + note}
    safe, vn = _ocr_verdict(lines, [f for f in found if f['kind'] != '수동'])
    return {'out': str(out), 'found': found, 'method': 'image-ocr', 'safe_for_llm': safe or bool(boxes), 'note': vn + '. ' + note}


if __name__ == '__main__':
    scratch = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else pathlib.Path(__file__).parent / 'redacted'
    scratch.mkdir(exist_ok=True)
    fake = scratch / 'fake_invoice.pdf'
    d = pymupdf.open(); p = d.new_page()
    p.insert_text((50, 80), 'FROZEN SCALLOP MEAT 49 C/T', fontsize=12)
    p.insert_text((50, 110), 'UNIT PRICE', fontsize=12); p.insert_text((200, 110), 'AMOUNT', fontsize=12)
    p.insert_text((50, 130), '6,800', fontsize=12); p.insert_text((200, 130), '3,332,000', fontsize=12)
    p.insert_text((50, 160), 'AMOUNT ¥3,332,000', fontsize=12)
    p.insert_text((50, 200), 'Beneficiary Account No:', fontsize=12); p.insert_text((50, 220), '123-456789-012', fontsize=12)
    d.save(fake); d.close()
    r = redact(fake)
    txt = pymupdf.open(r['out'])[0].get_text()
    assert 'FROZEN SCALLOP MEAT 49 C/T' in txt, txt
    for bad in ('123-456789-012', '3,332,000', '6,800', 'Beneficiary'): assert bad not in txt, (bad, txt)
    assert r['method'] == 'text' and r['safe_for_llm']
    print('PDF OK:', len(r['found']), '건 가림, 종류', sorted(set(f['kind'] for f in r['found'])))
    png = scratch / 'fake.png'
    from PIL import Image; Image.new('RGB', (200, 100), 'white').save(png)
    r2 = redact(png); assert r2['method'] in ('image-ocr', 'image-none'), r2
    r3 = redact(png, boxes=[(0, 0.8, 1, 1)]); assert r3['safe_for_llm'] and pathlib.Path(r3['out']).exists()
    print('이미지 OK:', r2['method'], '| boxes →', r3['found'])
