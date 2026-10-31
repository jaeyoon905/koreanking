# 로컬 추출기: API 키 없이 PDF 텍스트 레이어(있으면) 또는 RapidOCR(이미지)로 칸을 뽑는다.
# 결과 형태는 fixtures/graph 와 같다: {'doc_type','method','fields':[{k,label,v,src}],'confidence','lines'}
# 실행: python -X utf8 agent/ocr_extract.py <파일> [종류]
# 원칙: 금액·단가·계좌·사람 이름은 반환하지 않는다. 회사·제조소 실명은 'A사'·'K사'로, 선박은 '삼○호' 식으로 가린다.
import json, pathlib, re, sys, time

import pymupdf

MONTHS = {m: i + 1 for i, m in enumerate(['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'])}
SENSITIVE_RE = re.compile(r'UNIT\s*PRICE|AMOUNT|¥|￥|Account|A/C|SWIFT|Beneficiary|계좌|단가|금액|JPY\)|\(JPY', re.I)
NAME_LINE_RE = re.compile(r'검수자|서명|담당자|대\s*표\s*자|생년월일|MR\.|Nobue|Takahashi|결근')
_ocr = None


def ocr_engine():
    global _ocr
    if _ocr is None:
        from rapidocr_onnxruntime import RapidOCR
        _ocr = RapidOCR()
    return _ocr


# ---------- 줄 모으기: (y, x, text) 를 y 로 묶어 왼→오 정렬 ----------
def group_rows(items, tol):
    rows = []
    for y, x, t in sorted(items, key=lambda a: (a[0], a[1])):
        if rows and abs(rows[-1][0] - y) <= tol: rows[-1][1].append((x, t))
        else: rows.append([y, [(x, t)]])
    return [(y, sorted(ws)) for y, ws in rows]


def load(path):
    """-> (method, pages) ; pages = [rows], rows = [(y, [(x, text), ...])]"""
    p = pathlib.Path(path)
    if p.suffix.lower() == '.pdf':
        doc = pymupdf.open(str(p)); pages = []
        if any(pg.get_text().strip() for pg in doc):
            for pg in doc:
                items = [((w[1] + w[3]) / 2, w[0], w[4]) for w in pg.get_text('words')]
                pages.append(group_rows(items, 4))
            return 'pdf-text', pages
        for pg in list(doc)[:2]:  # ponytail: 이미지 PDF 는 앞 2쪽만 OCR(신고서 12쪽 = 2분). 뒤쪽이 필요하면 페이지 인자 추가
            pix = pg.get_pixmap(dpi=170)
            import numpy as np
            img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.h, pix.w, pix.n)
            pages.append(ocr_rows(img))
        return 'ocr', pages
    return 'ocr', [ocr_rows(str(p))]


def ocr_rows(src):
    res, _ = ocr_engine()(src)
    items = [(sum(pt[1] for pt in box) / 4, min(pt[0] for pt in box), txt) for box, txt, score in (res or [])]
    return group_rows(items, 14)


def flat(pages):
    out = []
    for pi, rows in enumerate(pages):
        for ri, (y, ws) in enumerate(rows):
            out.append((f'p{pi + 1} 줄 {ri + 1}', ' '.join(t for _, t in ws), ws))
    return out


# ---------- 공통 유틸 ----------
def num(s):
    m = re.search(r'-?[\d,]*\.?\d+', str(s or '')); return float(m.group(0).replace(',', '')) if m else None


def iso(s, year=None):
    s = str(s or '').strip()
    m = re.search(r'(\d{4})[.\-/년]\s*(\d{1,2})[.\-/월]\s*(\d{1,2})', s)
    if m: return f'{int(m[1]):04d}-{int(m[2]):02d}-{int(m[3]):02d}'
    m = re.search(r'(\d{1,2})(?:st|nd|rd|th)?[.\s]+([A-Za-z]{3,9})[.,\s]+(\d{4})', s)  # 09.October.2026 / 15th September, 2026
    if m and m[2][:3].lower() in MONTHS: return f'{int(m[3]):04d}-{MONTHS[m[2][:3].lower()]:02d}-{int(m[1]):02d}'
    m = re.search(r'([A-Za-z]{3,9})[.\s]+(\d{1,2}),?\s*(\d{4})', s)  # May 19, 2026 / MAY.20.2026
    if m and m[1][:3].lower() in MONTHS: return f'{int(m[3]):04d}-{MONTHS[m[1][:3].lower()]:02d}-{int(m[2]):02d}'
    m = re.search(r'(\d{2})\.\s*(\d{1,2})\.\s*(\d{1,2})', s)  # 28. 4. 1
    if m: return f'20{m[1]}-{int(m[2]):02d}-{int(m[3]):02d}'
    m = re.search(r'(\d{1,2})/(\d{1,2})', s)  # 4/10 (+year)
    if m and year: return f'{year}-{int(m[1]):02d}-{int(m[2]):02d}'
    return ''


def F(k, label, v, src):
    return {'k': k, 'label': label, 'v': v, 'src': src}


def mask_vessel(v):
    v = re.sub(r'\s', '', v or ''); return (v[0] + '○호') if v else ''


# ---------- 종류 판별 ----------
def classify(text, name=''):
    t = text.upper(); n = name.upper()
    if 'DECLARATION FOR THE IMPORT' in t.replace('\n', ' ') or 'DECLARATION' in n: return '수입신고서'
    if 'DOCK RECEIPT' in t or 'BILL OF LADING' in t and 'WAYBILL' not in t or 'B/L NO' in t: return 'BL'
    if 'WAYBILL' in t: return '운송장'
    if 'PACKING' in t and 'LIST' in t or 'INVOICE' in t:
        return '수입인보이스' if re.search(r'NC[ES]+W?\d{4,}|SOLD TO', t) else '패킹리스트'
    if '입고' in text and '검사서' in text: return '입고검사서'
    if '포장 일지' in text or '포장일지' in text: return '포장일지'
    if '가공' in text and '일지' in text: return '가공일지'
    if 'HACCP' in t or '인증서' in text: return 'HACCP인증서'
    if 'SERIAL NO' in t or 'QUALITY MANAGEMENT' in t or '품질관리원' in text or 'SANITARY' in t: return '위생증명서'
    if '시험성적서' in text or '성적서' in text: return '영양성적서'
    if 'KCAL' in t or '食塩相当量' in text or '食相当量' in text or '原材料名' in text: return '라벨'
    return ''


# ---------- 종류별 파서 ----------
def parse_packing(lines, imp):
    f = []; text = '\n'.join(l for _, l, _ in lines)
    m = re.search(r'INVOICE\s*NO[.:&\sDATE]*\n?\s*:?\s*([A-Z]{2,}[-\s]?\d{3,})', text, re.I) or re.search(r'\b(UE[-\s]?\d{4}|NC[A-Z]*\d{4,})\b', text)
    if m:
        no = m.group(1).replace(' ', ''); no = re.sub(r'^([A-Z]+)(\d)', r'\1-\2', no) if no.startswith('UE') else no
        f.append(F('invoice_no', '선적번호', no, 'INVOICE NO'))
    dates = [(src, iso(l)) for src, l, _ in lines if iso(l)]
    if dates: f.append(F('date', '날짜', dates[0][1], dates[0][0]))
    for src, l, _ in lines:
        if re.search(r'DEPARTURE', l, re.I):
            d = iso(l) or next((iso(x) for _, x, _ in lines[lines.index((src, l, _)) + 1:lines.index((src, l, _)) + 4] if iso(x)), '')
            if d: f.append(F('departure', '출항일', d, src)); break
    vi = next((i for i, (src, l, _) in enumerate(lines) if re.search(r'VESSEL|SHIPPED PER', l, re.I)), None)
    if vi is not None:
        for src, l, _ in lines[vi:vi + 4]:
            m = re.search(r'\b([A-Z]{3,}(?: [A-Z]{2,})*)\s?(\d{3,4}[A-Z])\b', re.sub(r'^.*?(?:VESSEL/FLIGHT|SHIPPED PER:?)\s*', '', l))
            if m: f.append(F('vessel', '선박', m.group(1) + ' ' + m.group(2), src)); break
    for src, l, _ in lines:
        m = re.search(r'(?:FROM|SHIPPED\s*FROM)\s*:\s*([A-Z][A-Z ,]+?)(?=\s+TO\s*:|$)', l, re.I)
        if m and not any(x['k'] == 'from' for x in f): f.append(F('from', '출발', m.group(1).strip().rstrip(','), src))
        m = re.search(r'\b(?:TO|SHIPPED\s*TO)\s*:\s*([A-Z][A-Z ,]+)', l)
        if m and not any(x['k'] == 'to' for x in f): f.append(F('to', '도착', m.group(1).strip().rstrip(','), src))
    for i, (src, l, _) in enumerate(lines):
        if re.search(r'CONSIGNEE|SOLD TO', l, re.I):
            nxt = next((x for _, x, _ in lines[i + 1:i + 3] if re.search(r'CO\.?,?\s*LTD|CORP|INC', x, re.I)), '')
            if nxt: f.append(F('buyer' if not imp else 'importer', '바이어' if not imp else '수입자', '수입 법인' if imp else re.sub(r'\s+CO.*$', '', nxt)[:1] + '사', src))
            break
    if imp:
        for src, l, _ in lines[:4]:
            if re.search(r'CO\.?,?\s*LTD', l, re.I): f.append(F('exporter', '수출자', 'N사', src)); break
    # 품목 행: 같은 줄에 'N C/T' 가 있는 것
    items = []; last_name = ''
    for idx, (src, l, ws) in enumerate(lines):
        if SENSITIVE_RE.search(l): continue
        l = re.sub(r'C/T\s*NO\.?\s*[\d\-]+', '', l)
        nm = re.search(r'\b(FROZEN[A-Z ]+?)(?=\s*\(|$|\s{2})', l)
        if nm and 'C/T' not in l: last_name = re.sub(r'(SCALLOP|STEAMED|BOILED|KING|CRAB|LEG|MEAT)', r' \1', nm.group(1)).replace('  ', ' ').strip()
        m = re.search(r'(\d[\d,]*)\s*C/T', l)
        if not m or re.search(r'TOTAL', l, re.I): continue
        kgs = [num(x) for x in re.findall(r'([\d,]+\.\d{2})\s*KG', l, re.I)]
        packs = re.search(r'([\d,]+)\s*PACS', l, re.I)
        packer = re.search(r'PACKER\s*:\s*([A-Z]+)', l)
        desc = re.sub(r'\d[\d,]*\s*C/T.*$', '', l); desc = re.sub(r'PACKER\s*:[^0-9]*', '', desc); desc = re.sub(r'\b\d+\s*KG\s*\(.*?\)', '', desc, flags=re.I)
        desc = re.sub(r'[\d,]+\.\d{2}\s*KG', '', desc, flags=re.I); desc = re.sub(r'\b\d+\s*kg\b', '', desc, flags=re.I)
        desc = re.sub(r'\b(SEWOONG|FISHERIES|PRODUCT OF KOREA|CO\.,? LTD\.?|GYOREN)\b', '', desc, flags=re.I).strip(' ,.-')
        desc = re.sub(r'\b\d+\s*kgi?\b', '', desc, flags=re.I).strip(' ,.-')
        if imp and (not desc or desc.startswith('SIZE') or re.fullmatch(r'[\d\-/a-z ]+', desc)): desc = (last_name + ' ' + desc).strip()
        it = {'desc': desc, 'ct': int(num(m.group(1)) or 0)}
        if packer: it['packer'] = packer.group(1)[0] + '사'
        if kgs: it['kg'] = kgs[0]
        if len(kgs) > 1: it['gross_kg'] = kgs[1]
        if packs: it['packs'] = int(num(packs.group(1)))
        if it['desc'] or it['ct']: items.append(it)
    seen = set(); items = [i for i in items if not ((i['desc'], i['ct']) in seen or seen.add((i['desc'], i['ct'])))]
    if len(items) >= 2 and items[-1]['ct'] == sum(i['ct'] for i in items[:-1]):  # 마지막 행이 합계 행
        tot = items.pop(); f.append(F('total_ct', '합계 C/T', tot['ct'], '합계 행'))
        if tot.get('kg'): f.append(F('total_kg', '합계 kg', tot['kg'], '합계 행'))
    if items: f.append(F('items', '품목', items, 'C/T 가 있는 줄'))
    for src, l, _ in lines:
        if re.search(r'TOTAL', l, re.I) and not any(x['k'] == 'total_ct' for x in f):
            tc = re.search(r'(\d[\d,]*)\s*C/T', l); tk = re.search(r'([\d,]+\.\d{1,2})\s*KG', l, re.I)
            if tc: f.append(F('total_ct', '합계 C/T', int(num(tc.group(1))), src))
            if tk and all('kg' in i for i in items): f.append(F('total_kg', '합계 kg', num(tk.group(1)), src))
    if not any(x['k'] == 'total_ct' for x in f) and items: f.append(F('total_ct', '합계 C/T', sum(i['ct'] for i in items), '품목 합'))
    if not any(x['k'] == 'total_kg' for x in f) and items and all('kg' in i for i in items): f.append(F('total_kg', '합계 kg', round(sum(i['kg'] for i in items), 1), '품목 합'))
    m = re.search(r'HS\s*CODE\s*:?\s*([\d.\-]+)', text, re.I)
    if m: f.append(F('hs', 'HS 코드', m.group(1), 'HS CODE'))
    m = re.search(r'\b(CFR|CIF|FOB|EXW|DAP)\b\s*([A-Z ,]+)?', text)
    if m: f.append(F('incoterms', '조건', (m.group(1) + ' ' + (m.group(2) or '').split('\n')[0]).strip(), 'INCOTERMS'))
    return f


def parse_sanitary(lines):
    f = []; text = '\n'.join(l for _, l, _ in lines)
    f.append(F('issuer', '발급', '국립수산물품질관리원' + (' 부산지원' if 'Busan' in text else ''), '상단/하단'))
    m = re.search(r'Serial No\.?\s*:?\s*([A-Z0-9\-]{4,})', text)
    if m: f.append(F('serial', '발행번호', m.group(1), 'Serial No'))
    for src, l, _ in lines:
        d = iso(l)
        if d: f.append(F('date', '발급일', d, src)); break
    m = re.search(r'Applicant\s*:?\s*([A-Z][A-Z .,&]+)', text)
    if m: f.append(F('applicant', '신청인', 'A사', 'Applicant'))
    m = re.search(r'Commodity\s*:?\s*(.+)', text)
    if m: f.append(F('commodity', '품명', m.group(1).strip(), 'Commodity'))
    m = re.search(r'(\d[\d,]*)\s*CARTONS?\s*\(?\s*([\d,]+\.?\d*)\s*KG', text, re.I)
    if m:
        f.append(F('quantity_ct', '수량 C/T', int(num(m.group(1))), 'Quantity')); f.append(F('quantity_kg', '수량 kg', num(m.group(2)), 'Quantity'))
        f.append(F('quantity', '수량', f'{m.group(1)} CARTONS ({m.group(2)} KG)', 'Quantity'))
    f.append(F('form', '양식', '비협약국 양식(추정. 협약국 양식이면 상대국 서식명이 적힘)', '본문'))
    return f


def parse_haccp(lines):
    f = []; text = '\n'.join(l for _, l, _ in lines); t1 = re.sub(r'\s+', '', text)
    m = re.search(r'제(\d{4}-\d+-\d+)호', t1)
    if m: f.append(F('cert_no', '인증번호', '제' + m.group(1) + '호', '본문'))
    m = re.search(r'(\d{4})년(\d{2})월(\d{2})일부터(\d{4})년(\d{2})월(\d{2})일까지', t1)
    if m:
        f.append(F('valid_from', '유효 시작', f'{m[1]}-{m[2]}-{m[3]}', '유효기간')); f.append(F('valid_to', '유효 종료', f'{m[4]}-{m[5]}-{m[6]}', '유효기간'))
    m = re.search(r'식품종별:([^\n중]+)', t1)
    if m: f.append(F('category', '식품종별', m.group(1), '식품종별'))
    m = re.search(r'중요관리점:([^\n유]+?)(?:유효|조건|$)', t1)
    if m: f.append(F('ccp', '중요관리점', re.sub(r'공정,', '공정, ', m.group(1)).rstrip('효'), '중요관리점'))
    f.append(F('issuer', '발급', '식약처 (식품위생법 48조)', '본문'))
    f.append(F('holder', '업소', 'A사', '업소명(마스킹)'))
    m = re.search(r'최초인증일:(\d{4}\.\d{2}\.\d{2})', t1)
    if m: f.append(F('first_certified', '최초 인증', m.group(1).replace('.', '-'), '최초인증일'))
    return f


def parse_declaration(lines):
    f = []; text = ' '.join(l for _, l, _ in lines); t = re.sub(r'\.(?=[A-Za-z0-9(])', ' ', re.sub(r'\.{2,}', ' ', text))
    t = re.sub(r'\b0(?=[a-z]{3,})', 'O', t)  # '0ctober' → 'October'
    t = re.sub(r'GOVERNMENT\s*OF\s*JAPAN|GOVERNMENT|OF\s*JAPAN', ' ', t, flags=re.I)
    m = re.search(r'\b(NS\d{4}KR\d{4})\b', t)
    if m: f.append(F('declaration_no', '신고번호', m.group(1), '우상단'))
    m = re.search(r'\b(NC[ES]*W?\d{5})\b', t)
    if m: f.append(F('consignment_code', '화물 코드', m.group(1), 'Consignment Code'))
    m = re.search(r'Product\s*:?\s*((?:FROZEN|FRESH|DRIED)[A-Z ]+?)\s*(?:ENumber|Number|\d)', t)
    if m: f.append(F('product', '제품', m.group(1).replace('.', ' ').strip(), 'Product'))
    m = re.search(r'package\s*:?\s*(\d+)\s*c/?t', t, re.I)
    if m: f.append(F('packages', '포장 수', int(m.group(1)), 'Number and type of package'))
    m = re.search(r'Net\s*\.?\s*(\d+)\s*[oO0]?\s*kg', t, re.I)
    if m: f.append(F('net_kg', '순중량 kg', int(m.group(1)) * (10 if re.search(r'Net\s*\.?\s*\d+[oO]kg', t) else 1), 'Net weight'))
    m = re.search(r'establishment\W{0,3}(.{0,120}?)\b([A-Z]{4,})\W*CITY', t)
    if m: f.append(F('establishment', '제조소', f'K사 ({m.group(2)})', 'establishment'))
    m = re.search(r'embarked\s*at\s*([A-Z!]{4,})[ .,]*([A-Z]{4,})?', t)
    if m: f.append(F('embarkation', '선적지', (m.group(1).replace('!', 'I') + (', ' + m.group(2) if m.group(2) else '')), 'embarkation place'))
    m = re.search(r'on\s*(\d{1,2})\s*([A-Za-z]{3,9})\s*(\d{4})\s*\(?\s*date\s*of\s*embark', t, re.I)
    if m: f.append(F('date_embark', '선적일', iso(f'{m[1]} {m[2]} {m[3]}'), 'date of embarkation'))
    m = re.search(r'sampled\s*on\s*(\d{1,2})\s*([A-Za-z]{3,9})\s*(\d{4})', t, re.I)
    if m: f.append(F('sampled', '시료 채취', iso(f'{m[1]} {m[2]} {m[3]}'), 'sampled on'))
    m = re.search(r'analysis\s*on\s*(\d{1,2})\s*([A-Za-z]{3,9})\s*(\d{4})', t, re.I)
    if m: f.append(F('analyzed', '분석일', iso(f'{m[1]} {m[2]} {m[3]}'), 'laboratory analysis on'))
    m = re.search(r'((?:[A-Z][a-z]+ ){2,8}(?:Center|Centre|Laboratory|Institute))', t)
    if m: f.append(F('lab', '검사기관', m.group(1).strip(), 'name of laboratory'))
    m = re.search(r'Report\s*number\s*:?\s*([\d\-]{5,})', t, re.I)
    if m: f.append(F('report_no', '분석 보고서 번호', m.group(1), 'Report number'))
    m = re.search(r'Done\s*at.{0,120}?on\s*(\d{1,2})\s*([A-Za-z]{3,9})\s*(\d{4})', t, re.I)
    if m and iso(f'{m[1]} {m[2]} {m[3]}'): f.append(F('issued', '발급일', iso(f'{m[1]} {m[2]} {m[3]}'), 'Done at ... on'))
    m = re.search(r'harvested\s*in\W{0,3}([A-Za-z]{4,})', t, re.I)
    f.append(F('prefecture_flag', '해당 항목', f'17개 도현 생산분({m.group(1).title()}, 방사능 분석 첨부)' if m else '확인 필요(체크박스는 OCR로 못 읽음)', '체크박스'))
    f.append(F('note', '비고', '정부 워터마크 때문에 OCR 잡음 많음. 신고번호·중량·제조소·선적일 외는 원문 대조 필요', 'OCR'))
    return f


def parse_bl(lines):
    f = []; text = '\n'.join(l for _, l, _ in lines)
    m = re.search(r'\b([A-Z]{4}[A-Z]{2,3}\d{7,})\b', text)
    if m: f.append(F('bl_no', 'B/L 번호', m.group(1), 'B/L No')); f.append(F('carrier', '선사', m.group(1)[:4], 'B/L 번호 접두'))
    m = re.search(r'\n([A-Z][A-Z ]{3,30})\n/?(\d{3,4}[A-Z])\n', text)
    if m: f.append(F('vessel', '선박', m.group(1).strip(), 'Vessel/Voy')); f.append(F('voyage', '항차', m.group(2), 'Vessel/Voy'))
    if re.search(r'ISHIKAR', text): f.append(F('pol', '선적항', 'ISHIKARI, HOKKAIDO, JAPAN', 'Port of Loading'))
    if re.search(r'BU[Ss]AN', text): f.append(F('pod', '양하항', 'BUSAN, KOREA', 'Port of Discharge'))
    m = re.search(r'\b([A-Z]{4}\d{7})/?', text)
    if m: f.append(F('containers', '컨테이너', m.group(1) + (' (리퍼 20ft)' if 'REEFER' in text else ''), 'Container No'))
    m = re.search(r'(\d[\d,]*)\s*CARTONS', text)
    if m: f.append(F('cartons', '카톤 수', int(num(m.group(1))), 'Description'))
    m = re.search(r'NET WEIGHT\s*:?\s*([\d,]+\.?\d*)\s*KG', text, re.I)
    if m: f.append(F('net_kg', '순중량 kg', num(m.group(1)), 'NET WEIGHT'))
    m = re.search(r'Place and Date of Issue\n([A-Z ,]+)', text)
    if m: f.append(F('issued', '발행지', m.group(1).strip(), 'Place and Date of Issue'))
    m = re.search(r'\b(NC[ES]*W?\d{5})\b', text)
    if m: f.append(F('shipment_no', '선적 코드', m.group(1), '본문'))
    return f


def parse_waybill(lines):
    f = []; text = '\n'.join(l for _, l, _ in lines)
    m = re.search(r'WAYBILL\s*([\d ]{10,14})', text)
    if m: f.append(F('waybill', '운송장 번호', m.group(1).replace(' ', ''), 'WAYBILL'))
    m = re.search(r'From\s*:.*?\n(?:.*\n){0,4}?.*?\b([A-Z]{4,})\b[^\n]*JAPAN', text)
    if m: f.append(F('from', '발송지', m.group(1), 'From'))
    m = re.search(r'\n([A-Z]{4,}),\s*KR', text)
    if m: f.append(F('to', '도착지', m.group(1), 'To'))
    m = re.search(r'Contents\s*:?\s*([^\n]+)', text)
    if m: f.append(F('contents', '내용물', m.group(1).strip(), 'Contents'))
    m = re.search(r'(\d{4}-\d{2}-\d{2})', text)
    if m: f.append(F('shipped', '발송일', m.group(1), '상단 날짜'))
    m = re.search(r'Estimated Del\w* date:?\s*([A-Za-z]+,?\s*\d{1,2}\s*[A-Za-z]+,?\s*\d{4})', text)
    if m: f.append(F('eta', '도착 예정', iso(m.group(1)), 'Estimated Del date'))
    return f


def parse_packing_log(pages, path):
    f = []; pg = pymupdf.open(str(path))[0]
    words = [((w[0] + w[2]) / 2, (w[1] + w[3]) / 2, w[4]) for w in pg.get_text('words')]  # (x중심, y중심, 글자)
    rows = group_rows([(y, x, t) for x, y, t in words], 4)
    year = None
    for y, ws in rows:
        t = ' '.join(x for _, x in ws); m = re.search(r'(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일', t)
        if m: year = m[1]; f.append(F('date', '날짜', f'{m[1]}-{int(m[2]):02d}-{int(m[3]):02d}', '상단 날짜')); break
    hdr = next(((y, ws) for y, ws in rows if any(x == '제품명' for _, x in ws) and any(x == 'LOT' for _, x in ws)), None)
    if not hdr: return f
    cols = sorted((x, t) for x, t in hdr[1] if t in ('제품명', '규격', '수량', '제조일', '소비기한', 'LOT', '인원', '시간', '능률', '판매가', '비고'))
    def col_of(x):  # 가장 가까운 헤더 중심. 제품명 열은 왼쪽으로 넓게
        return min(cols, key=lambda c: abs(c[0] - x) if c[1] != '제품명' else max(0, x - c[0] - 60))[1]
    out = []
    for y, ws in rows:
        if y <= hdr[0] + 25: continue
        t = ' '.join(x for _, x in ws)
        if re.search(r'총계', t): break
        cell = {}
        for x, tok in ws: cell.setdefault(col_of(x), []).append(tok)
        if '판매가' in cell: cell.pop('판매가')  # 단가는 읽지 않는다
        if not cell.get('수량') or not cell.get('제조일'): continue
        buyer = ' '.join(cell.get('제품명', [])[:1]); prod = ' '.join(cell.get('제품명', [])[1:])
        buyer = buyer[:1] + '사' if buyer and buyer not in ('국내', '기타') else buyer
        out.append({'buyer': buyer, 'product': prod, 'spec': ' '.join(cell.get('규격', [])), 'ct': int(num(cell['수량'][0]) or 0),
                    'mfg': iso(cell['제조일'][0], year), 'expiry': iso(' '.join(cell.get('소비기한', []))),
                    'lot_code': ' '.join(cell.get('LOT', [])) if re.fullmatch(r'[A-Z]{1,3}', ' '.join(cell.get('LOT', []))) else '',
                    'lot_note': '' if re.fullmatch(r'[A-Z]{0,3}', ' '.join(cell.get('LOT', []))) else 'LOT 칸 메모: ' + ' '.join(cell.get('LOT', [])),
                    'workers': num(' '.join(cell.get('인원', []))), 'note': ' '.join(cell.get('비고', []))})
    f.append(F('rows', '포장 행', out, '표 (헤더 좌표 기준)'))
    return f


def parse_receiving(pages):
    rows = pages[0]; text = '\n'.join(' '.join(x for _, x in ws) for _, ws in rows); f = []
    m = re.search(r'원료명\(학명\)\s*(\S+)\s*\(?([a-z]+\s+[a-z]+)\)?', text, re.I)
    if m: f.append(F('species', '원료명', f'{m[1]} ({m[2].capitalize()})', '원료명(학명)'))
    m = re.search(r'입고일\s*(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일', text); year = m[1] if m else None
    if m: f.append(F('received', '입고일', f'{m[1]}-{int(m[2]):02d}-{int(m[3]):02d}', '입고일'))
    m = re.search(r'조업일자\s*(\d{1,2})/(\d{1,2})\s*~\s*(\d{1,2})/(\d{1,2})', text)
    if m and year: f.append(F('fishing_period', '조업일자', f'{year}-{int(m[1]):02d}-{int(m[2]):02d}~{int(m[3]):02d}-{int(m[4]):02d}', '조업일자'))
    m = re.search(r'공급자\(어선\)\s*(\S+)', text)
    if m: f.append(F('vessel', '선박(가림)', mask_vessel(m.group(1)), '공급자(어선)'))
    m = re.search(r'원산지\s*(\S+\s*\S*)', text)
    if m: f.append(F('landing', '원산지', re.sub(r'\s*검수자.*', '', m.group(1)).strip(), '원산지'))
    m = re.search(r'원료형태\s*(.+)', text)
    if m: f.append(F('form', '원료형태', m.group(1).strip(), '원료형태'))
    m = re.search(r'(\d{1,2})℃\s*이하', text)
    if m: f.append(F('temp_limit_c', '중심온도 기준', int(m.group(1)), '입고 검수 기준'))
    # 3. 원료판정 행: 입고량 판정수량 단위중량 총중량 공제수량
    for y, ws in rows:
        t = [x for _, x in ws]
        if len(t) >= 5 and re.fullmatch(r'\d{2,4}', t[0]) and 'kg' in t:
            nums = [num(x) for x in t if num(x) is not None]
            if len(nums) >= 5:
                f += [F('boxes_in', '입고량(상자)', int(nums[0]), '원료판정'), F('boxes_ok', '판정수량(상자)', int(nums[1]), '원료판정'),
                      F('unit_kg', '단위중량 kg/상자', nums[2], '원료판정'), F('total_kg', '총중량 kg', nums[3], '원료판정'), F('deduct', '공제수량(상자)', int(nums[4]), '원료판정')]
            break
    m = re.search(r'\*흑변원료[^\n]*?=\s*(\d+)상자', text)
    if m: f.append(F('black_boxes', '흑변 공제(상자)', int(m.group(1)), '검품의견'))
    return f


HEADER_CHARS = set('탈갑채육뒷일기청남포위품자식당조퇴계현합')  # 가공일지 헤더에 한 글자로 나오는 것들


def parse_process_log(pages):
    rows = pages[0]; f = []
    text = '\n'.join(' '.join(x for _, x in ws) for _, ws in rows)
    m = re.search(r'(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일', text)
    if m: f.append(F('date', '날짜', f'{m[1]}-{int(m[2]):02d}-{int(m[3]):02d}', '상단 날짜'))
    start = next((y for y, ws in rows if '입출고' in ' '.join(x for _, x in ws)), None)
    end = next((y for y, ws in rows if '특이사항' in ' '.join(x for _, x in ws)), 1e9)
    abbrs = []
    for y, ws in rows:
        if start is None or y <= start or y >= end: continue
        for x, tok in ws:
            if len(tok) == 1 and '가' <= tok <= '힣' and tok not in HEADER_CHARS: abbrs.append(tok)
    if abbrs: f.append(F('raw_sources', '원료 약어(등장 순)', abbrs, 'Section 입출고 현황 표'))
    prods = sorted({t for _, ws in rows for _, t in ws if t in ('LB', 'WF', 'OT', 'L', 'M', 'S')})
    if prods: f.append(F('products_made', '작업 품목 열', prods, '금일 작업 헤더'))
    m = re.search(r'결근\s*:?\s*([^\n]*)', text)
    if m:
        n = len([x for x in re.split(r'[,.\s]+', m.group(1)) if re.fullmatch(r'[가-힣]{2,4}', x)])
        f.append(F('notes', '특이사항', f'결근·조퇴 메모 있음 (이름 {n}건, 비식별)', '특이사항'))
    return f


def parse_label(lines):
    f = []; text = '\n'.join(l for _, l, _ in lines)
    nums = re.findall(r'(\d+(?:\.\d+)?)\s*(kcal|g)\b', text)
    kcal = next((v for v, u in nums if u == 'kcal'), None); gs = [v for v, u in nums if u == 'g']
    if kcal: f.append(F('nutrition', '영양(100g)', f'エネルギー{kcal}kcal ' + ' '.join(f'{v}g' for v in gs[:4]) + ' (순서는 OCR 배치 기준, 확인 필요)', 'OCR 숫자'))
    m = re.search(r'(\d{4}\.\d{2}\.\d{2})', text)
    if m: f.append(F('expiry', '賞味期限', m.group(1), 'OCR'))
    if re.search(r'推定', text): f.append(F('basis', '근거', '推定値', 'OCR'))
    m = re.search(r'(\d{6})\b', text)
    if m: f.append(F('code', '商品コード', m.group(1), 'OCR'))
    m = re.search(r'(\d{13})', text)
    if m: f.append(F('jan', 'JAN', m.group(1), 'OCR'))
    if re.search(r'-18', text): f.append(F('storage', '保存方法', '要冷凍（-18℃以下）', 'OCR'))
    m = re.search(r'([^\s]+市)', text)
    if m: f.append(F('importer', '輸入者(도시만)', m.group(1), 'OCR'))
    if re.search(r'韓国|韓國', text): f.append(F('origin', '原産国', '韓国', 'OCR'))
    if re.search(r'原材料', text): f.append(F('ingredients', '原材料名', '(OCR 일본어 인식 불안정. 원문 확인 필요)', 'OCR'))
    f.append(F('country', '나라', 'JP', '판별'))
    return f


def extract(path, doc_type=None):
    t0 = time.time(); method, pages = load(path)
    lines = flat(pages)
    text = '\n'.join(l for _, l, _ in lines)
    dt = doc_type or classify(text, pathlib.Path(path).name)
    f, conf = [], 0.0
    if dt in ('패킹리스트', '수입인보이스'): f = parse_packing(lines, dt == '수입인보이스'); conf = 0.75 if method == 'ocr' else 0.9
    elif dt == '위생증명서': f = parse_sanitary(lines); conf = 0.9
    elif dt == 'HACCP인증서': f = parse_haccp(lines); conf = 0.9
    elif dt == '수입신고서': f = parse_declaration(lines); conf = 0.6
    elif dt == 'BL': f = parse_bl(lines); conf = 0.7
    elif dt == '운송장': f = parse_waybill(lines); conf = 0.8
    elif dt == '포장일지': f = parse_packing_log(pages, path) if method == 'pdf-text' else []; conf = 0.85 if f else 0.2
    elif dt == '입고검사서': f = parse_receiving(pages) if method == 'pdf-text' else []; conf = 0.8 if f else 0.2
    elif dt == '가공일지': f = parse_process_log(pages) if method == 'pdf-text' else []; conf = 0.7 if f else 0.2
    elif dt == '라벨': f = parse_label(lines); conf = 0.4
    note = ''
    if dt in ('포장일지', '입고검사서', '가공일지') and method == 'ocr':
        note = 'OCR은 인쇄 글자만 인식. 손글씨 값은 AI 키 연결 또는 수동 입력'
    if method == 'pdf-text' and dt in ('포장일지', '입고검사서', '가공일지'): note = 'PDF 텍스트 레이어에서 직접 읽음(전산 출력 양식)'
    def mask_line(l):
        if SENSITIVE_RE.search(l): return '[가림]'
        if NAME_LINE_RE.search(l): return '[이름 줄]'
        if dt in ('패킹리스트', '수입인보이스'): l = re.sub(r'\b\d{1,3}(?:,\s?\d{3})+\b(?!\.\d|\s*(?:KG|kg|PACS|C/T))', '[가림]', l)
        return l
    masked = [mask_line(l) for _, l, _ in lines]
    return {'doc_type': dt, 'method': method, 'fields': f, 'confidence': round(conf, 2), 'lines': masked, 'note': note, 'seconds': round(time.time() - t0, 1)}


if __name__ == '__main__':
    if len(sys.argv) < 2: print(__doc__ or 'usage: ocr_extract.py <file> [doc_type]'); sys.exit(1)
    r = extract(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None)
    r['lines'] = r['lines'][:40]
    print(json.dumps(r, ensure_ascii=False, indent=1))
