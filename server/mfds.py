# 식약처 식품안전나라 OpenAPI 정리. 키는 환경변수 FOODSAFETYKOREA_API_KEY (값은 어디에도 찍지 않는다).
# 우리 키로 열린 서비스: I2500 인허가(업소), I1250 품목제조보고, I0610 HACCP 적용업소, I0490 회수·판매중지.
# 미승인(식품안전나라에서 활용신청 필요): I0030 품목제조보고(상세), I2620/I2640 검사부적합, I0470/I2630 행정처분, I2860 인허가 변경이력.
# 응답 row 키는 2026-10-31 실제 호출로 확인한 것만 매핑한다. 주소는 시·군·구(읍면)까지만 남긴다.
import json, os, re, threading, time, urllib.parse, urllib.request

BASE = 'https://openapi.foodsafetykorea.go.kr/api'
TTL = 86400
_cache, _lock = {}, threading.Lock()   # ponytail: 프로세스 메모리 캐시. 재시작하면 비워짐


def call(svc, params=None, start=1, end=50):
    key = os.environ.get('FOODSAFETYKOREA_API_KEY', '')
    if not key: return {'error': '키 없음'}
    q = '&'.join(f'{k}={urllib.parse.quote(str(v))}' for k, v in (params or {}).items())
    url = f'{BASE}/{key}/{svc}/json/{start}/{end}' + (f'/{q}' if q else '')
    try:
        with urllib.request.urlopen(url, timeout=8) as r: d = json.loads(r.read().decode('utf-8'))
    except Exception as e:
        return {'error': type(e).__name__}          # 키가 든 URL 은 메시지에 안 넣는다
    b = d.get(svc) or {}
    res = b.get('RESULT') or d.get('RESULT') or {}
    code = res.get('CODE', '')
    if code == 'INFO-000': return {'rows': b.get('row') or [], 'total': int(b.get('total_count') or 0)}
    if code == 'INFO-200': return {'rows': [], 'total': 0}
    return {'error': f"{code} {res.get('MSG', '')[:60]}"}


def all_rows(svc, params=None, limit=2000):   # 50건씩 total_count 까지
    out, s = [], 1
    while s <= limit:
        r = call(svc, params, s, s + 49)
        if 'error' in r: return r if not out else {'rows': out, 'total': len(out), 'partial': r['error']}
        out += r['rows']
        if not r['rows'] or len(out) >= r['total']: break
        s += 50
    return {'rows': out, 'total': len(out)}


def cached(fn):
    def w(*a):
        k = (fn.__name__, a)
        with _lock:
            hit = _cache.get(k)
            if hit and time.time() - hit[0] < TTL: return dict(hit[1], cached=True)
        v = fn(*a)
        if 'error' not in v:
            with _lock: _cache[k] = (time.time(), v)
        return dict(v, cached=False)
    w.__name__ = fn.__name__
    return w


def sgg(addr):   # '경상북도 영덕군 강구면 강영로 84' → '경상북도 영덕군 강구면'
    m = re.match(r'\s*(\S+\s+\S+(?:\s+\S+(?:구|군|면|읍))?)', addr or '')
    return m.group(1) if m else ''


def ymd(v):      # '20260123' → '2026-01-23'
    v = re.sub(r'\D', '', str(v or ''))
    return f'{v[:4]}-{v[4:6]}-{v[6:8]}' if len(v) >= 8 else (v or '')


def digits(v): return re.sub(r'\D', '', str(v or ''))


@cached
def company(name):
    r = call('I2500', {'BSSH_NM': name}, 1, 50)
    if 'error' in r: return r
    rows = [{'lcns_no': x.get('LCNS_NO'), 'name': x.get('BSSH_NM'), 'industry': x.get('INDUTY_CD_NM'),
             'permit_date': ymd(x.get('PRMS_DT')), 'addr': sgg(x.get('ADDR'))} for x in r['rows']]
    return {'rows': rows, 'total': r['total'], 'source': '식약처 식품안전나라 OpenAPI I2500'}


@cached
def products(name):
    r = all_rows('I1250', {'BSSH_NM': name})
    if 'error' in r: return r
    rows = [{'report_no': x.get('PRDLST_REPORT_NO'), 'prdlst_nm': x.get('PRDLST_NM'), 'prdlst_dcnm': x.get('PRDLST_DCNM'),
             'report_date': ymd(x.get('PRMS_DT')), 'lcns_no': x.get('LCNS_NO'), 'shelf_life': x.get('POG_DAYCNT'),
             'usage': x.get('USAGE'), 'packaging': x.get('FRMLC_MTRQLT'), 'export_only': x.get('ETQTY_XPORT_PRDLST_YN'),
             'last_update': ymd(x.get('LAST_UPDT_DTM'))} for x in r['rows']]
    out = {'rows': rows, 'total': len(rows), 'source': '식약처 식품안전나라 OpenAPI I1250',
           'note': '원재료명은 I1250 응답에 없음(I0030 활용신청 필요)'}
    if r.get('partial'): out['partial'] = r['partial']
    return out


@cached
def haccp(name, appn_no=''):   # I0610 은 BSSH_NM 미지원 → 업소 영업등록번호마다 조회 + 인증번호로 1회
    c = company(name)
    if 'error' in c: return c
    seen, rows = set(), []
    keys = [('LCNS_NO', x['lcns_no']) for x in c['rows'] if x.get('lcns_no')]
    if appn_no: keys.append(('HACCP_APPN_NO', appn_no))
    for k, v in keys:
        r = call('I0610', {k: v}, 1, 50)
        if 'error' in r: return r
        for x in r['rows']:
            if x.get('HACCP_APPN_NO') in seen: continue
            seen.add(x.get('HACCP_APPN_NO'))
            rows.append({'haccp_no': x.get('HACCP_APPN_NO'), 'name': x.get('BSSH_NM'), 'industry': x.get('INDUTY_CD_NM'), 'lcns_no': x.get('LCNS_NO'),
                         'valid_from': ymd(x.get('HACCP_APPN_DT')), 'valid_to': ymd(x.get('CRTFC_ENDDT')), 'status': x.get('CLSBIZ_DVS_CD_NM'),
                         'cancelled': ymd(x.get('ASGN_CANCL_DT')), 'returned': ymd(x.get('CRTFC_RETN_DT')), 'addr': sgg(x.get('SITE_ADDR'))})
    return {'rows': rows, 'total': len(rows), 'source': '식약처 식품안전나라 OpenAPI I0610', 'queried': len(keys)}


@cached
def recalls(name):   # I0490 은 업소 필터 미지원 → 전건 받아 우리 영업등록번호로 거른다 (전국 400건 안팎)
    c = company(name)
    if 'error' in c: return c
    mine = {x['lcns_no'] for x in c['rows'] if x.get('lcns_no')}
    r = all_rows('I0490')
    if 'error' in r: return r
    rows = [{'product': x.get('PRDTNM'), 'type': x.get('PRDLST_CD_NM'), 'reason': x.get('RTRVLPRVNS'), 'method': x.get('RTRVLPLANDOC_RTRVLMTHD'),
             'grade': x.get('RTRVL_GRDCD_NM'), 'mfg': x.get('MNFDT'), 'report_no': x.get('PRDLST_REPORT_NO'), 'created': str(x.get('CRET_DTM') or '')[:10]}
            for x in r['rows'] if x.get('LCNS_NO') in mine]
    return {'rows': rows, 'total': len(rows), 'scanned': r['total'], 'source': '식약처 식품안전나라 OpenAPI I0490'}


def compare_haccp(name, registry):   # 우리 registry 의 HACCP 행 ↔ 식약처 I0610
    ours = next((r for r in registry or [] if 'HACCP' in str(r.get('name', ''))), None)
    if not ours: return {'haccp': {'ours': None, 'match': False, 'note': 'registry 에 HACCP 행 없음'}}
    appn = re.sub(r'^제|호$', '', str(ours.get('no', '')).strip())
    h = haccp(name, appn)
    if 'error' in h: return {'haccp': {'ours': {'no': ours.get('no'), 'expiry': ours.get('expiry')}, 'error': h['error']}}
    hit = next((x for x in h['rows'] if digits(x.get('haccp_no')) == digits(appn)), None)
    if not hit and h['rows']: hit = h['rows'][0]
    match = bool(hit) and digits(hit.get('haccp_no')) == digits(appn) and hit.get('valid_to') == ours.get('expiry')
    note = ('번호·만료일 일치' if match else ('식약처에 같은 번호 있음, 만료일 다름: ' + str(hit.get('valid_to')) if hit and digits(hit.get('haccp_no')) == digits(appn)
            else ('식약처 I0610 에 이 업소 기록 없음(영업등록번호 전부와 인증번호로 조회). 인증서 원본 값을 기준으로 유지' if not hit else '번호 다름: ' + str(hit.get('haccp_no')))))
    return {'haccp': {'ours': {'no': ours.get('no'), 'expiry': ours.get('expiry')}, 'mfds': hit, 'match': match, 'note': note, 'queried': h.get('queried')}}


if __name__ == '__main__':   # 자가 점검(네트워크 없이)
    assert sgg('경상북도 영덕군 강구면 강영로 84') == '경상북도 영덕군 강구면'
    assert sgg('서울특별시 금천구 가산디지털1로 24') == '서울특별시 금천구'
    assert ymd('20260123') == '2026-01-23' and digits('제2009-4-8012호') == '200948012'
    print('mfds selftest OK')
