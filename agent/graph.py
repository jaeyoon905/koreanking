# 라벨코스트 AI 팀 (LangGraph). 서류 1장 → 접수부 → 읽기부 → 검증부/작성부/개발부 → 결재부(사람) → 원장 반영.
# 원칙: 판정은 규칙 엔진(data.js)이, 숫자 계산은 코드가, LLM은 읽기·짝짓기·초안·코드 제안만. 계좌·단가 안 가린 서류는 LLM에 안 보낸다.
# 실행: python -X utf8 agent/graph.py <파일> [--masked]   (ANTHROPIC_API_KEY 없으면 LLM 노드는 빈 값으로 건너뜀)
import base64, json, os, pathlib, re, subprocess, sys
from typing import Literal, TypedDict

from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, interrupt

HERE = pathlib.Path(__file__).parent
DATA_JS = HERE.parent / 'data.js'
LEDGER = HERE / 'ledger.json'
PROPOSALS = HERE / 'proposals'   # 개발부 산출물. 코드에 자동 적용하지 않는다
MODEL = os.environ.get('LC_MODEL', 'claude-sonnet-5-5')  # 대회용. 품질 아쉬우면 LC_MODEL=claude-opus-5-5

# ---------- 서류 종류와 뽑을 칸 (= 추출 스키마). 종류 추가 = 줄 하나 ----------
SCHEMAS = {
    '라벨':        ['name', 'ingredients', 'net', 'expiry', 'storage', 'origin', 'importer', 'allergen', 'nutrition', 'pack', 'lot_format', 'country'],   # pack: 容器包装 識別表示(プラ 마크, トレー:PP 등)
    '영양성적서':  ['issuer', 'report_no', 'date', 'product', 'kcal', 'protein', 'fat', 'satfat', 'transfat', 'carb', 'sugar', 'sodium_mg', 'cholesterol_mg', 'note'],
    '규격서양식':  ['buyer', 'form_title', 'fields'],          # fields: [{label, example, section}]
    '바이어지시':  ['buyer', 'product', 'spec_changes', 'label_text', 'date'],
    '패킹리스트':  ['invoice_no', 'date', 'buyer', 'vessel', 'from', 'to', 'departure', 'items'],  # items: [{desc, ct, net_kg}]
    '입고검사서':  ['species', 'fishing_period', 'received', 'vessel', 'landing', 'boxes_in', 'boxes_ok', 'total_kg', 'inspector'],
    '가공일지':    ['date', 'raw_sources', 'products_made', 'notes'],
    '포장일지':    ['date', 'rows'],                             # rows: [{buyer, product, ct, mfg, expiry, lot_code}]
    '위생증명서':  ['issuer', 'serial', 'date', 'applicant', 'commodity', 'quantity', 'form'],
    'HACCP인증서': ['cert_no', 'holder', 'valid_from', 'valid_to', 'category', 'ccp', 'issuer'],
    '메일':        ['from', 'date', 'subject', 'lang', 'product', 'questions', 'deadline'],   # questions: 질문 문장 배열. 주제 분류·근거 찾기는 코드(answer_evidence)
    '고시문':      ['country', 'title', 'effective', 'changed_articles', 'affects'],
    '품목대장':    ['rows'],   # rows: [{code, name_ko, name_en, name_ja, net, pack, shelf_months, storage, process, allergens, ingredients:[{name_ko, pct, type, func, ins}], kcal, protein, fat, satfat, transfat, carb, sugar, sodium_mg}]   # 개발부 입력
    # 수입 서류 (수입부 import.js 키와 맞춤)
    '수입인보이스': ['invoice_no', 'date', 'exporter', 'importer', 'from', 'to', 'vessel', 'items', 'total_ct', 'incoterms'],
    'BL':          ['bl_no', 'carrier', 'vessel', 'voyage', 'pol', 'pod', 'containers', 'cartons', 'net_kg', 'issued', 'shipment_no'],
    '수입신고서':   ['declaration_no', 'consignment_code', 'product', 'packages', 'net_kg', 'establishment', 'embarkation', 'date_embark', 'sampled', 'analyzed', 'lab', 'report_no', 'issued', 'prefecture_flag'],
    '운송장':      ['waybill', 'from', 'to', 'contents', 'shipped', 'eta'],
}
# 파일명으로 먼저 맞춰 보고(공짜), 안 맞으면 LLM 분류. 앞에 있는 것이 이긴다 → 수입 힌트를 '인보이스' 보다 앞에
NAME_HINTS = [('Declaration', '수입신고서'), ('선하증권', 'BL'), ('KMTCISI', 'BL'), ('B/L', 'BL'), ('DHL', '운송장'), ('운송장', '운송장'), ('NCSEW', '수입인보이스'),
              ('영양', '영양성적서'), ('성적서', '영양성적서'), ('規格書', '규격서양식'), ('규격서', '규격서양식'), ('Specification', '규격서양식'), ('Spec', '규격서양식'), ('spec', '규격서양식'), ('規格表', '규격서양식'), ('规格', '규격서양식'), ('仕様書', '바이어지시'),
              ('表示案', '바이어지시'), ('패킹', '패킹리스트'), ('인보이스', '패킹리스트'), ('입고', '입고검사서'), ('가공일지', '가공일지'),
              ('포장', '포장일지'), ('위생증명', '위생증명서'), ('HACCP', 'HACCP인증서'), ('라벨', '라벨'), ('제품사진', '라벨'), ('메일', '메일'),
              ('고시', '고시문'), ('告示', '고시문'), ('基準', '고시문'), ('公告', '고시문'), ('解读', '고시문'), ('改正', '고시문'), ('通则', '고시문'),
              ('품목대장', '품목대장'), ('품목 목록', '품목대장'), ('제품대장', '품목대장'), ('product master', '품목대장'), ('품목기본', '품목대장'),
              ('메일', '메일'), ('mail', '메일'), ('問い合わせ', '메일'), ('inquiry', '메일'), ('질의', '메일'), ('문의', '메일')]
SENSITIVE = {'패킹리스트', '메일', '수입인보이스'}  # 계좌·단가가 섞일 수 있는 종류. masked=True 아니면 LLM 금지

# 손글씨·고정 양식 전용 힌트. 추출 프롬프트 뒤에 붙는다. 실제 회사 양식(2026-04 서류) 기준
FORM_HINTS = {
    '입고검사서': ('SW-S-양식17 "원재료 입고 검사서". 상단에 원료명(학명)·조업일자(기간, 예 04/03~04/08)·입고일·원료형태·공급자(어선명)·보관방법·원산지·검수자. '
                  '가운데는 입고 검수 기준 표(성상, 이물, 중심온도 10℃ 이하, 사이즈 각고 6.8cm 이상)와 시간대별 검수 행. '
                  '아래 "원료판정" 표에 입고량(상자)·판정수량(상자)·단위중량(kg/상자)·총중량(kg)·공제수량(상자)·판정중량이 있고 옆에 공제 계산 메모(흑변·기본공제). '
                  '손글씨 숫자는 상자 수와 kg 를 혼동하지 말 것: boxes_in·boxes_ok 는 상자, total_kg 는 kg. fishing_period 는 "YYYY-MM-DD ~ MM-DD" 로, 연도는 입고일 기준.'),
    '가공일지':   ('"가공 일지". 맨 위 날짜(요일 포함), 가공 인원 현황 표(공정별 인원), Section 입출고 현황(전일 재고·금일 입고·금일 작업·현 재고, 품목 다리·몸살·몸통·집게·난방·파품). '
                  '"금일 작업" 표의 다리 작업 열에 원료 약어 한 글자(삼·구·대·화 등)가 시간대별로 적힌다 → raw_sources 는 등장 순서대로 배열(중복 포함). '
                  'products_made 는 만든 제품 코드 목록(LB·WF·L·M·S 등). notes 는 특이사항 요약이며 사람 이름은 절대 넣지 말고 "결근 n명·조퇴 n명" 식으로만.'),
    '포장일지':   ('"제품 포장 일지". 열: 제품명(바이어)/규격/수량(C/T)/제조일(월/일)/소비기한(YY. M. D)/LOT(알파벳 코드)/인원/시간/능률/비고. '
                  'rows 는 행마다 {buyer, product, ct, mfg, expiry, lot_code}. product 는 규격·제품명에서 코드(LB·WF·OT·LEG 등)만. '
                  'mfg·expiry 는 YYYY-MM-DD 로 정규화하고 연도는 문서 상단 날짜 기준(소비기한 "28. 4. 1" → 2028-04-01). 판매가 열은 뽑지 않는다.'),
    '패킹리스트': ('수출 PACKING LIST / COMMERCIAL INVOICE. SHIPPER·CONSIGNEE·INVOICE NO & DATE·DEPARTURE DATE·VESSEL/FLIGHT·FROM/TO, '
                  '품목 행은 DESCRIPTION OF GOODS·QUANTITY(C/T)·NET WEIGHT·GROSS WEIGHT. items 는 {desc, ct, net_kg}. '
                  '단가(UNIT PRICE)·금액(AMOUNT)·계좌(Account, Bank, SWIFT)는 절대 추출하지 말고, 보이면 해당 칸 값을 "가림" 으로 적는다.'),
    '규격서양식': ('바이어가 보낸 상품규격서 양식(xlsx·PDF). fields 는 양식의 입력 칸 라벨을 원문 그대로, 위→아래 순서대로 배열(예시값·설명문 말고 칸 이름만). '
                  '표 섹션(配合·調味液·重点管理·包装資材, Ingredients table 등)은 섹션 제목 하나를 라벨로 넣는다. buyer 는 양식을 보낸 바이어 이름(표제·파일명 기준), form_title 은 표제. '
                  '예시값이 채워져 있으면 recipe·seasoning·qc·packaging 도 뽑는다.'),
    '고시문':     ('정부가 낸 식품표시 규정 개정 고시·공고·해설(중국 GB 공告·解读, 일본 消費者庁 告示, 홍콩·대만·태국 공고 등). country 는 ISO 두 글자(CN·JP·HK·TW·TH), '
                  'title 은 규정 이름+번호, effective 는 시행일 YYYY-MM-DD(유예기간 끝나는 날이 따로 있으면 note 에). changed_articles 는 [{article: 조항 번호·이름, before: 전, after: 후}] 로 바뀐 조항만. '
                  'affects 는 라벨에서 고쳐야 할 표시 항목 이름 목록(예: 保质期到期日, 致敏物质, 数字标签). 문서에 없는 내용은 만들지 말고 null.'),
    '품목대장':   ('우리 회사 품목 기본정보 표(엑셀·PDF). 한 행이 품목 하나. rows 의 code 는 품목 코드(LB·WF·SR·LEG·CL 등 대문자), shelf_months 는 개월 숫자, '
                  'ingredients 는 [{name_ko, pct(숫자), type: raw|additive, func(첨가물 용도), ins(번호)}], allergens 는 영어 소문자 배열(crustacea 등), 영양은 100g 기준 숫자(kcal, protein, fat, satfat, transfat, carb, sugar, sodium_mg). 빈 칸은 null.'),
    '메일':       ('바이어가 보낸 문의 메일. from 은 회사·부서만(사람 이름 금지), lang 은 본문 언어 코드(ja·en·zh·ko), product 는 언급된 우리 품목 코드(LB·WF·SR 등, 없으면 null), '
                  'questions 는 질문 문장을 원문 그대로 하나씩 배열(번호 제거), deadline 은 회신 기한 YYYY-MM-DD. 단가·금액 숫자가 보여도 뽑지 않는다.'),
    '수입신고서': ('일본 정부 "Declaration for the import into the Republic of Korea of Food from Japan". Consignment Code, Declaration Number(NS…KR…), '
                  '제품명·포장 수·순중량, 승선지(embarked at)·승선일·선박, 제조소(establishment 이름·주소), 체크박스 3개 중 어느 것인지(prefecture_flag: "2011-03-11 이전" / "17개 도현 외" / "17개 도현 내, 검사함"), '
                  '시료 채취일(sampled)·분석일(analyzed)·검사기관(lab)·보고서 번호(report_no), 발급 기관·일자(issued). 한 장에 제품 하나다.'),
}


def extract_prompt(doc_type: str) -> str:
    hint = FORM_HINTS.get(doc_type, '')
    return (f'이 {doc_type}에서 다음 칸을 뽑아라: {SCHEMAS.get(doc_type, [])}. 숫자는 단위 빼고 숫자만. 날짜는 YYYY-MM-DD. 추정값(推定値/目安)이면 note 에 적어라. 사람 이름은 어떤 칸에도 적지 마라(인원은 숫자만).'
            + (f'\n양식 설명: {hint}' if hint else ''))


class S(TypedDict, total=False):
    path: str
    masked: bool
    doc_type: str
    extracted: dict
    rule_results: list   # 라벨일 때 규칙 엔진 결과
    diffs: list          # 원장·품목과 다른 점
    mapping: dict        # 규격서양식: 바이어 칸 ↔ 우리 필드
    drafts: list         # 질의문·문구 초안
    proposals: list      # 개발부: 규칙 수정안·템플릿 코드 (파일로만, 자동 적용 없음)
    tests: dict          # 개발부: 회귀 테스트 결과
    approved: bool
    log: list


# ---------- LLM 한 함수. 키 없으면 {} ----------
def llm(instruction: str, path: str | None = None, want: Literal['json', 'text'] = 'json'):
    if not os.environ.get('ANTHROPIC_API_KEY'):
        return {} if want == 'json' else ''
    import anthropic
    content = []
    if path:
        p = pathlib.Path(path); data = base64.b64encode(p.read_bytes()).decode()
        if p.suffix.lower() == '.pdf':
            content.append({'type': 'document', 'source': {'type': 'base64', 'media_type': 'application/pdf', 'data': data}})
        elif p.suffix.lower() in ('.png', '.jpg', '.jpeg'):
            mt = 'image/png' if p.suffix.lower() == '.png' else 'image/jpeg'
            content.append({'type': 'image', 'source': {'type': 'base64', 'media_type': mt, 'data': data}})
        elif p.suffix.lower() in ('.txt', '.md', '.csv'):
            content.append({'type': 'text', 'text': p.read_text('utf-8', errors='replace')[:30000]})
        else:  # xlsx 등은 텍스트로 풀어서
            content.append({'type': 'text', 'text': sheet_text(p)[:30000]})
    content.append({'type': 'text', 'text': instruction + ('\nJSON만 출력. 값이 없으면 null. 읽은 위치(page/cell)를 _src 에 적어라.' if want == 'json' else '')})
    r = anthropic.Anthropic().messages.create(model=MODEL, max_tokens=16000, messages=[{'role': 'user', 'content': content}])
    txt = ''.join(b.text for b in r.content if getattr(b, 'type', '') == 'text')   # 생각 블록은 건너뜀
    if want == 'text': return txt
    m = re.search(r'\{.*\}|\[.*\]', txt, re.S)
    return json.loads(m.group(0)) if m else {}


def sheet_text(p: pathlib.Path) -> str:
    import openpyxl
    out = []
    for ws in openpyxl.load_workbook(p, data_only=True):
        out.append(f'## sheet {ws.title}')
        for row in ws.iter_rows():
            cells = [f'{c.coordinate}={c.value}' for c in row if c.value not in (None, '')]
            if cells: out.append(' | '.join(cells))
    return '\n'.join(out)


def judge(country: str, fields: dict) -> list:  # 규칙 엔진은 data.js 하나만. 여기선 호출만
    out = subprocess.run(['node', str(HERE / 'judge.js'), country, json.dumps(fields, ensure_ascii=False)], capture_output=True, text=True, encoding='utf-8')
    return json.loads(out.stdout or '[]')


# ---------- 접수부 ----------
def gate(s: S) -> S:
    name = pathlib.Path(s['path']).name
    t = next((t for k, t in NAME_HINTS if k.lower() in name.lower()), None)
    return {'doc_type': t or '', 'log': [f'gate: 파일명 힌트 → {t}']}


def classify_content(path: str) -> str:  # 내용으로 종류 판별. 키 없으면 ''
    r = llm(f'이 서류는 다음 중 무엇인가: {list(SCHEMAS) + ["기타"]}. 정확히 그 이름 하나로. {{"doc_type": ...}}', path)
    t = r.get('doc_type', '') if isinstance(r, dict) else ''
    return t if t in SCHEMAS else ''


def classify(s: S) -> S:
    if s.get('doc_type'): return {}
    t = classify_content(s['path'])
    return {'doc_type': t or '기타', 'log': [f'classify(LLM) → {t or "기타"}']}


# ---------- 읽기부 ----------
def extract(s: S) -> S:
    t = s['doc_type']
    if t in SENSITIVE and not s.get('masked'):
        return {'extracted': {}, 'log': [f'extract: {t} 은 계좌·단가 가린 뒤(--masked) 처리. LLM에 보내지 않음']}
    r = llm(extract_prompt(t), s['path'])
    if r:
        return {'extracted': r, 'log': [f'extract(AI) → {len(r)}칸']}
    # 키가 없거나 AI 가 비면 로컬 OCR(인쇄 서류). 손글씨는 비어서 사람 입력으로 넘어간다
    try:
        import ocr_extract as OCR
        o = OCR.extract(s['path'], t)
        r = {f['k']: f['v'] for f in o.get('fields', [])}
        return {'extracted': r, 'log': [f"extract(OCR {o.get('method')}) → {len(r)}칸" + (' · ' + o['note'] if o.get('note') else '')]}
    except Exception as e:
        return {'extracted': {}, 'log': [f'extract: AI 키 없음, OCR 실패({type(e).__name__}) → 사람 입력']}


# ---------- 검증부 ----------
def rules(s: S) -> S:
    f = {k: s['extracted'].get(k) or '' for k in SCHEMAS['라벨']}
    country = (s['extracted'].get('country') or 'JP')[:2].upper()
    res = judge(country, f)
    return {'rule_results': res, 'log': [f'rules {country}: ' + ', '.join(f"{r['item']}={r['status']}" for r in res)]}


def reconcile(s: S) -> S:  # 원장·품목 마스터와 대조. 계산은 코드가 한다
    ledger = json.loads(LEDGER.read_text('utf-8')) if LEDGER.exists() else {'products': {}, 'raw': [], 'lots': [], 'docs': []}
    e, t, diffs = s.get('extracted', {}), s['doc_type'], []
    if t == '영양성적서' and e.get('sodium_mg') is not None:
        salt = round(float(e['sodium_mg']) * 2.54 / 1000, 2)
        diffs.append({'item': '식염상당량(성적서 환산)', 'value': salt, 'note': 'Na mg×2.54/1000. 라벨 값과 비교'})
        for b, n in ledger.get('products', {}).get('LB', {}).get('label_nutrition', {}).items():
            if n.get('salt_g') is not None and abs(n['salt_g'] - salt) > 0.3:
                diffs.append({'item': f'{b} 라벨 식염상당량', 'label': n['salt_g'], 'report': salt, 'status': 'check'})
    if t == '포장일지':
        for r in e.get('rows', []):
            if r.get('lot_code') and not any(l.get('company_code') == r['lot_code'] for l in ledger['lots']):
                diffs.append({'item': '원장에 없는 회사 LOT', 'lot_code': r['lot_code'], 'mfg': r.get('mfg'), 'status': 'add'})
    if t == '가공일지':
        for src in e.get('raw_sources', []):
            hit = [r for r in ledger['raw'] if src and src in r.get('vessel', '')]
            diffs.append({'item': '원료 약어 → 입고분', 'abbr': src, 'match': [r['id'] for r in hit] or '없음', 'status': 'ok' if hit else 'check'})
    return {'diffs': diffs, 'log': [f'reconcile: {len(diffs)}건']}


# ---------- 작성부 ----------
# 우리가 가진 데이터 칸. 바이어 양식의 칸을 이 중 하나에 짝짓는다(값은 app.js oursValues 가 채운다). 여기 없는 건 null → 노란 빈칸
OURS = {
    'buyer.name': '바이어(양식을 보낸 회사) 이름', 'doc.date': '작성일(오늘)', 'doc.issuer': '작성자·공급자(우리 회사)',
    'product.name_ko': '제품명(한국어)', 'product.name_en': '제품명(영어)', 'product.name_ja': '제품명(일본어)', 'product.code': '우리 품목 코드',
    'product.species': '원료 어종·학명', 'product.origin': '원산지', 'product.ingredients': '원재료 배합(이름·비율)', 'product.additives': '식품첨가물(용도·이름·INS)',
    'product.allergen': '알레르겐', 'product.nutrition': '영양성분 100g', 'product.shelf_life_months': '소비(상미)기한 개월 수', 'product.net': '내용량(1팩)',
    'product.pack': '포장 단위·입수(荷姿)', 'product.process': '제조 공정', 'product.storage': '보존 방법·온도',
    'factory.name': '제조자·공장 이름', 'factory.lic': '영업등록 번호', 'factory.haccp': 'HACCP 인증 번호·기한', 'factory.registrations': '해외 등록(FDA·GACC 등) 목록',
    'lot.lot': 'LOT 번호', 'lot.company_code': '회사 로트 코드', 'lot.mfg': '제조일', 'lot.expiry': '소비기한(날짜)', 'lot.qty_ct': '수량 C/T', 'lot.kg': '중량 kg',
    'lot.raw': '원료 입고분(어선·입고일)', 'lot.ship': '선적', 'lot.cert': '위생증명서 번호',
}


def map_fields(fields: list) -> dict:  # 양식 칸 라벨 → OURS 키 또는 null. AI 제안이고 사람이 승인 카드에서 확인한다
    labels = [f if isinstance(f, str) else str(f.get('label', f)) for f in fields or []]
    if not labels: return {}
    r = llm('바이어 규격서 양식의 칸 라벨 목록과 우리 데이터 칸을 짝지어라. 뜻이 같을 때만 짝짓고 애매하면 null. 표 섹션(배합·조미액·중점관리·포장자재) 라벨은 null. '
            f'양식 칸: {labels} / 우리 데이터 칸(키: 뜻): {OURS} / 출력: {{"양식 칸 라벨": "우리 키 또는 null", ...}} 라벨 전부 빠짐없이.')
    r = r if isinstance(r, dict) else {}
    r.pop('_src', None)
    return {k: (v if v in OURS else None) for k, v in r.items() if k in labels}


def map_form(s: S) -> S:  # 바이어 양식 칸 ↔ 우리 필드. LLM이 제안, 사람이 승인, 그 뒤엔 저장된 매핑으로 채움
    m = map_fields((s.get('extracted') or {}).get('fields') or [])
    return {'mapping': m, 'log': [f'map_form: {sum(1 for v in m.values() if v)}칸 매핑, 미매핑 {sum(1 for v in m.values() if not v)}']}


def draft(s: S) -> S:  # 확인(check) 항목의 질의문·일본어 문구 초안. 판정 아님
    checks = [r for r in s.get('rule_results', []) if r['status'] in ('check', 'fix')] + [d for d in s.get('diffs', []) if d.get('status') == 'check']
    if not checks: return {'drafts': []}
    txt = llm('다음 확인 항목마다 (a) 바이어·검사기관에 보낼 질의문 2~3문장(한국어), (b) 라벨에 쓸 일본어 표시 문구 초안을 써라. 법령 해석은 확정하지 말고 질문으로 써라.\n'
              + json.dumps(checks, ensure_ascii=False), want='text')
    return {'drafts': [txt] if txt else [], 'log': ['draft: 초안 작성']}


# ---------- 바이어 문의 답변: 근거 찾기는 코드, 문장은 AI ----------
TOPIC_RULES = [  # 먼저 맞는 것이 이긴다
    ('가격', r'単価|価格|price|价格|단가|가격|見積|quotation'),
    ('소비기한', r'賞味期限|消費期限|shelf|保质期|소비기한|유통기한'),   # '製造日から何か月' 같은 문장이 로트로 새지 않게 로트보다 먼저
    ('로트', r'ロット|\blot\b|批次|로트|漁船|入荷|生产日期|원료 입고|製造日'),
    ('영양', r'栄養|nutrition|营养|열량|kcal|エネルギー|영양'),
    ('알레르겐', r'アレル|allerg|过敏|알레르'),
    ('보존', r'保存|storage|贮存|보관|保管'),
    ('인증', r'HACCP|認証|certif|证书|인증|FDA|GACC|登録|registration'),
    ('공정', r'工程|process|工艺|공정|製造方法'),
    ('원산지', r'原産|origin|产地|원산지'),
    ('원재료', r'原材料|ingredient|配料|원재료|添加物|additive'),
    ('포장', r'包装|pack|荷姿|規格|규격|spec'),
]


def _topic(q: str) -> str:
    for t, pat in TOPIC_RULES:
        if re.search(pat, q, re.I): return t
    return '기타'


def answer_evidence(e: dict, st: dict) -> list:
    """질문마다 우리 데이터에서 근거를 찾는다(코드). value 가 None 이면 자료 없음. 가격은 영업 판단이라 AI 에 넘기지 않는다."""
    prods = st.get('products') or {}; code = (e.get('product') or '').upper()
    p = prods.get(code) or (prods.get('LB') if 'LB' in prods else (next(iter(prods.values())) if prods else {}))
    ledger, raw, reg, ns = st.get('ledger') or [], st.get('raw') or [], st.get('registry') or [], st.get('nutritionSources') or []
    out = []
    for q in e.get('questions') or []:
        q = str(q); t = _topic(q); v = None; src = ''
        if t == '영양':
            v = {'per_100g': p.get('nutrition100'), 'source': p.get('nutrition_source'), 'reports': [x for x in ns if '성적서' in str(x.get('buyer', ''))][:2]}; src = 'products.nutrition100 · nutritionSources'
            if not p.get('nutrition100'): v = None
        elif t == '알레르겐': v = p.get('allergens') or None; src = 'products.allergens'
        elif t == '소비기한': v = {'months': p.get('shelf_months'), 'storage': p.get('storage')} if p.get('shelf_months') else None; src = 'products.shelf_months·storage'
        elif t == '보존': v = p.get('storage'); src = 'products.storage'
        elif t == '공정': v = p.get('process'); src = 'products.process'
        elif t == '원산지': v = '韓国産 / 한국산'; src = '고정값'
        elif t == '원재료': v = p.get('ingredients'); src = 'products.ingredients'
        elif t == '포장': v = {'net': p.get('net'), 'pack': p.get('pack')}; src = 'products.net·pack'
        elif t == '인증':
            keys = [k for k in ('HACCP', 'FDA', 'GACC') if re.search(k, q, re.I)] or ['HACCP']
            rows = [r for r in reg if any(re.search(k, str(r.get('name', '')) + str(r.get('kind', '')), re.I) for k in keys)]
            v = [{'name': r.get('name'), 'no': r.get('no'), 'issuer': r.get('issuer'), 'expiry': r.get('expiry')} for r in rows] or None; src = 'registry'
        elif t == '로트':
            m = re.search(r'\b([A-Z]{1,2})\b(?=\W*[)）]|\s|$)', q); lc = m.group(1) if m else None
            md = re.search(r'(\d{1,2})月(\d{1,2})日|(\d{4})-(\d{2})-(\d{2})', q)
            hits = [l for l in ledger if (lc and l.get('company_code') == lc) or (md and str(l.get('mfg', '')).endswith('-%02d-%02d' % ((int(md.group(1)), int(md.group(2))) if md.group(1) else (int(md.group(4)), int(md.group(5))))))]
            if code: hits = [l for l in hits if l.get('product') == code] or hits
            v = []
            for l in hits[:3]:
                lr = l.get('raw') or []; lr = lr if isinstance(lr, list) else [lr]; rl = [r for r in raw if r.get('id') in lr]   # raw = 입고분 id 목록, raw_by 는 연결 방법 설명
                v.append({'lot': l.get('lot'), 'company_code': l.get('company_code'), 'mfg': l.get('mfg'), 'expiry': l.get('expiry'), 'raw': [{'id': r.get('id'), 'vessel': r.get('vessel'), 'received': r.get('received') or r.get('date')} for r in rl]})
            v = v or None; src = 'ledger · raw'
        status = '영업 판단' if t == '가격' else ('근거 있음' if v else '자료 없음')
        out.append({'q': q, 'topic': t, 'status': status, 'source': src if v else '', 'value': None if t == '가격' else v})
    return out


def reply_draft(e: dict, answers: list) -> str:
    """답장 초안(메일 언어). 값은 answers 의 value 만 쓰고 바꾸지 않는다. 사람 이름 없음. 끝에 한국어 내부 메모."""
    if not answers: return ''
    lang = (e.get('lang') or 'ja')
    return llm('바이어 문의에 대한 답장 초안을 써라. 언어: ' + lang + '. 규칙: (1) status 가 "근거 있음" 인 질문만 value 의 숫자·문자를 그대로 인용해 답한다(값 변형·추정 금지, 출처 이름은 쓰지 않는다). '
               '(2) "자료 없음" 은 "확인 후 회신" 한 문장. (3) "영업 판단" 은 영업 담당이 별도 회신한다는 한 문장. (4) 사람 이름은 쓰지 않고 회사·부서로만. (5) 맨 끝에 한국어로 "[내부 메모]" 를 달고 빠진 자료와 영업 회신 필요 항목을 적는다.\n'
               '문의: ' + json.dumps({k: e.get(k) for k in ('from', 'subject', 'date', 'deadline', 'product')}, ensure_ascii=False) + '\n질문과 근거: ' + json.dumps(answers, ensure_ascii=False), want='text')


# ---------- 라벨 수정안: 규칙이 지적한 칸만 AI가 고쳐 쓴다. 다시 판정은 규칙(app.js judge)이 한다 ----------
def label_fix(country: str, fields: dict, results: list, hints: dict) -> dict:
    bad = [{'item': x.get('item'), 'status': x.get('status'), 'msg': x.get('msg'), 'fix': x.get('fix')} for x in results or [] if x.get('status') in ('fix', 'check')]
    if not bad: return {'fields': fields, 'changes': []}
    r = llm('수출 라벨 수정안. country=' + country + '. fields 는 현재 라벨 칸(원문), results 는 규칙 판정이 지적한 항목(item·msg·fix), hints 는 코드가 품목 데이터로 만든 확정 문구(영양표·알레르겐·첨가물). '
            '규칙: (1) results 에 지적된 칸만 고치고 나머지 칸은 글자 하나 바꾸지 않는다. (2) hints 에 문구가 있으면 그 문구를 그대로 쓴다(숫자 변형 금지). (3) 새 사실·수치를 만들지 않는다. 자료가 없어 못 고치는 항목은 그대로 두고 changes 에 "자료 필요" 로 적는다. '
            '(4) 출력은 {"fields": {모든 칸 그대로 또는 수정}, "changes": [{"k": 칸 이름, "before": 요약, "after": 요약, "why": 지적 항목 이름}]} JSON.\n'
            + json.dumps({'fields': fields, 'results': bad, 'hints': hints}, ensure_ascii=False))
    r = r if isinstance(r, dict) else {}
    out = dict(fields); out.update({k: v for k, v in (r.get('fields') or {}).items() if k in fields or v})
    return {'fields': out, 'changes': r.get('changes') or []}


# ---------- 개발부: 코드는 제안만, 적용은 사람 ----------
def rule_patch(s: S) -> S:  # 개정 고시문 → data.js 규칙 수정안 (AI ③)
    e = s.get('extracted', {}); country = (e.get('country') or '')[:2].upper()
    cur = ''
    if country:
        src = DATA_JS.read_text('utf-8'); m = re.search(chr(10) + '  ' + country + ': ' + chr(123), src)
        if m: cur = src[m.start():m.start() + 6000]   # 그 나라 규칙 블록 앞부분(id·src·run 구조를 AI가 보고 같은 모양으로 쓴다)
    txt = llm(f'아래는 {country} 규칙 파일 현재 내용이고, 그 다음은 개정 고시 요약이다. 바뀐 조항만 반영한 수정안을 (1) 바뀐 점 요약 3줄, (2) effective 필드 값, '
              f'(3) checks 에 추가·수정할 항목의 JS 코드 로 써라. 법 해석이 애매한 곳은 코드 대신 "// 확인:" 주석으로 남겨라.\n--- 현재 규칙 ---\n{cur}\n--- 고시 ---\n'
              + json.dumps(e, ensure_ascii=False), want='text')
    return {'proposals': [{'kind': 'rule_patch', 'country': country, 'text': txt}] if txt else [], 'log': [f'rule_patch {country}: ' + ('수정안 작성' if txt else '키 없음, 건너뜀')]}


def template_gen(s: S) -> S:  # 승인될 매핑 → 규격서 HTML 템플릿 코드 (③ 화면이 그대로 쓰는 형태)
    mp = s.get('mapping', {})
    if not mp.get('mapping'): return {'proposals': [], 'log': ['template_gen: 매핑 없음']}
    txt = llm(f'바이어 {mp.get("buyer")} 규격서 양식을 HTML 표로 재현하는 템플릿을 써라. 값 자리는 {{{{product.name_ja}}}} 처럼 필드 경로 그대로 둔다. '
              f'매핑: {json.dumps(mp["mapping"], ensure_ascii=False)}. 양식 칸 순서와 묶음(기본정보·중점관리·배합·조미액·포장자재)을 지켜라. HTML만 출력.', want='text')
    return {'proposals': [{'kind': 'template', 'buyer': mp.get('buyer'), 'text': txt}] if txt else [], 'log': ['template_gen: ' + ('템플릿 작성' if txt else '키 없음, 건너뜀')]}


def selftest(s: S) -> S:  # 회귀 테스트. 규칙·시드가 깨졌으면 여기서 막는다
    hk = judge('HK', {'name': 'x', 'ingredients': '雪蟹、食鹽／山梨醇、調味料（胺基酸）、增稠劑 (GUAR GUM)', 'net': '250克', 'mfg': 'x', 'expiry': '有効日期',
                      'storage': 'x', 'origin': '韓國', 'importer': 'x', 'manufacturer': '', 'allergen': '本產品部分含有小麥，大豆，雞肉', 'nutrition': ''})
    jp = judge('JP', {'name': 'a', 'ingredients': '紅ずわいがに（韓国）、食塩、ﾃﾞｷｽﾄﾘﾝ/ﾄﾚﾊﾛｰｽ、調味料（ｱﾐﾉ酸等）', 'net': '1kg', 'storage': 's', 'origin': '韓国', 'importer': 'u', 'nutrition': '食塩相当量0.6g', 'pack': 'プラ トレー:PP 内装袋:PE,PA'})
    res = {'HK 샘플 fix 4·check 2': (sum(r['status'] == 'fix' for r in hk), sum(r['status'] == 'check' for r in hk)) == (4, 2),
           'JP U사 라벨 전부 pass': bool(jp) and all(r['status'] == 'pass' for r in jp),
           'data.js 문법': subprocess.run(['node', '-e', "new Function(require('fs').readFileSync(process.argv[1],'utf8'))", str(DATA_JS)], capture_output=True).returncode == 0,
           'seedLedger 회사 코드 있음': 'company_code' in DATA_JS.read_text('utf-8')}
    return {'tests': res, 'log': ['selftest: ' + ', '.join(f"{k}={'OK' if v else 'FAIL'}" for k, v in res.items())]}


# ---------- 결재부 ----------
def review(s: S) -> S:  # 사람 검토. 여기서 멈춘다
    ok = interrupt({'doc_type': s['doc_type'], 'extracted': s.get('extracted'), 'rule_results': s.get('rule_results'), 'diffs': s.get('diffs'),
                    'mapping': s.get('mapping'), 'drafts': s.get('drafts'), 'proposals': s.get('proposals'), 'tests': s.get('tests')})
    return {'approved': bool(ok), 'log': [f'review: {"승인" if ok else "반려"}']}


def commit(s: S) -> S:
    ledger = json.loads(LEDGER.read_text('utf-8')) if LEDGER.exists() else {'products': {}, 'raw': [], 'lots': [], 'docs': [], 'mappings': {}}
    ledger.setdefault('docs', []).append({'file': pathlib.Path(s['path']).name, 'type': s['doc_type'], 'extracted': s.get('extracted'), 'diffs': s.get('diffs')})
    if s.get('mapping', {}).get('buyer'):
        ledger.setdefault('mappings', {})[s['mapping']['buyer']] = s['mapping'].get('mapping', {})
    for i, pr in enumerate(s.get('proposals') or []):  # 개발부 산출물은 파일로만. data.js·app.js는 사람이 고친다
        PROPOSALS.mkdir(exist_ok=True)
        (PROPOSALS / f"{pr['kind']}_{pr.get('country') or pr.get('buyer') or 'x'}_{i}.txt").write_text(pr['text'], 'utf-8')
    LEDGER.write_text(json.dumps(ledger, ensure_ascii=False, indent=1), 'utf-8')
    return {'log': ['commit: ledger.json 반영' + (f', 제안 {len(s.get("proposals") or [])}건 → proposals/' if s.get('proposals') else '')]}


# ---------- 갈래 ----------
def after_extract(s: S) -> str:
    return {'라벨': 'rules', '규격서양식': 'map_form', '고시문': 'rule_patch'}.get(s['doc_type'], 'reconcile')


def after_review(s: S) -> str:
    return 'commit' if s.get('approved') else END


def build():
    g = StateGraph(S)
    for n in (gate, classify, extract, rules, reconcile, map_form, draft, rule_patch, template_gen, selftest, review, commit): g.add_node(n.__name__, n)
    g.add_edge(START, 'gate'); g.add_edge('gate', 'classify'); g.add_edge('classify', 'extract')
    g.add_conditional_edges('extract', after_extract, ['rules', 'reconcile', 'map_form', 'rule_patch'])
    g.add_edge('rules', 'reconcile'); g.add_edge('reconcile', 'draft'); g.add_edge('draft', 'review')          # 검증부 → 작성부 → 결재
    g.add_edge('map_form', 'template_gen'); g.add_edge('template_gen', 'selftest')                            # 작성부 → 개발부
    g.add_edge('rule_patch', 'selftest'); g.add_edge('selftest', 'review')                                    # 개발부 → 결재
    g.add_conditional_edges('review', after_review, ['commit', END]); g.add_edge('commit', END)
    return g.compile(checkpointer=MemorySaver())


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if not args:  # 자가 점검: 키 없이, U사 라벨 값으로 규칙 노드까지 + 개발부 회귀 테스트
        fake = {'path': 'U사_라벨.jpg', 'masked': False, 'extracted': {'name': '紅ずわいがにむき身', 'ingredients': '紅ずわいがに（韓国）、食塩、ﾃﾞｷｽﾄﾘﾝ/ﾄﾚﾊﾛｰｽ、調味料（ｱﾐﾉ酸等）',
                'net': '1kg', 'storage': '要冷凍', 'origin': '韓国', 'importer': 'U사', 'nutrition': '40kcal 食塩相当量0.6g', 'pack': 'プラ トレー:PP 内装袋:PE,PA', 'country': 'JP'}}
        r = rules(fake); assert any(x['id'] == 'nutrition' and x['status'] == 'pass' for x in r['rule_results']), r
        assert after_extract({'doc_type': '포장일지'}) == 'reconcile' and after_extract({'doc_type': '라벨'}) == 'rules' and after_extract({'doc_type': '고시문'}) == 'rule_patch'
        assert gate({'path': '7-3.포장 일지.pdf'})['doc_type'] == '포장일지' and gate({'path': '食品表示基準_改正.pdf'})['doc_type'] == '고시문'
        t = selftest({}); assert all(t['tests'].values()), t
        print('selftest OK:', r['log'][0], '|', t['log'][0]); sys.exit()
    app = build(); cfg = {'configurable': {'thread_id': args[0]}}
    out = app.invoke({'path': args[0], 'masked': '--masked' in sys.argv, 'log': []}, cfg)
    print(json.dumps(out.get('__interrupt__', out), ensure_ascii=False, indent=1, default=str))
    ans = input('승인? (y/n) ').strip().lower() == 'y'
    out = app.invoke(Command(resume=ans), cfg)
    print('\n'.join(out.get('log', [])))
