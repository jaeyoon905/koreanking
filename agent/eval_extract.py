# 2단계 검수 도구: 받은 원본 서류를 AI로 다시 읽혀, 사람이 미리 넣어 둔 값(fixtures.js)과 칸별로 대조한다.
# 실행: python -X utf8 agent/eval_extract.py [--only 7-3]   (ANTHROPIC_API_KEY 필요. 없으면 안내 후 종료)
# 출력: 종류별 일치/불일치 표 + agent/eval_report.json. 불일치가 많은 칸이 프롬프트·스키마를 고칠 자리다.
import json, os, pathlib, re, subprocess, sys

HERE = pathlib.Path(__file__).parent
sys.path.insert(0, str(HERE)); import graph as g  # noqa: E402

DOCS = pathlib.Path(r'C:\Users\User\Desktop\해커톤\회사에서 새로받은 파일')
# fixture id → 실제 파일 (사진은 1장만)
FILES = {
    '7-1': DOCS / '첨부자료/7-1.원료입고검사서.pdf', '7-2': DOCS / '첨부자료/7-2.가공일지.pdf', '7-3': DOCS / '첨부자료/7-3.포장 일지.pdf',
    '5-2': DOCS / '첨부자료/5-2.패킹리스트.png', '6': DOCS / '첨부자료/6.위생증명서.pdf', '8': DOCS / '첨부자료/8.HACCP인증서.pdf',
    '1': DOCS / '첨부자료/1.영양성분_LB.pdf', '4': next(iter((DOCS / '첨부자료').glob('4.*규격서.xlsx')), DOCS / '첨부자료/4.규격서.xlsx'), 'photo': DOCS / '첨부자료/추가_제품사진2.jpg',
}


def fixtures():
    js = ("global.window={};var fs=require('fs');eval(fs.readFileSync('data.js','utf8'));"
          "try{eval(fs.readFileSync('apply.js','utf8'))}catch(e){};eval(fs.readFileSync('fixtures.js','utf8'));"
          "process.stdout.write(JSON.stringify(LC.extractFixtures.map(function(f){return {id:f.id,doc_type:f.doc_type,fields:f.fields}})))")
    out = subprocess.run(['node', '-e', js], cwd=HERE.parent, capture_output=True, text=True, encoding='utf-8')
    return {f['id']: f for f in json.loads(out.stdout)}


def norm(v):
    s = json.dumps(v, ensure_ascii=False) if isinstance(v, (dict, list)) else str(v if v is not None else '')
    return re.sub(r'[\s,，、/／()（）:：\-~～]', '', s).lower()


def main():
    if not os.environ.get('ANTHROPIC_API_KEY'):
        env = HERE.parent.parent / '.env'
        if env.exists():
            for line in env.read_text('utf-8').splitlines():
                if line.startswith('ANTHROPIC_API_KEY=') and line.split('=', 1)[1].strip(): os.environ['ANTHROPIC_API_KEY'] = line.split('=', 1)[1].strip()
    if not os.environ.get('ANTHROPIC_API_KEY'):
        print('ANTHROPIC_API_KEY 없음. .env 에 넣으면 이 도구가 AI 추출과 사람 입력값을 칸별로 대조한다.'); return
    only = sys.argv[sys.argv.index('--only') + 1] if '--only' in sys.argv else None
    fx = fixtures(); report = {}
    for fid, path in FILES.items():
        if only and fid != only: continue
        f = fx.get(fid)
        if not f or not path.exists(): print(fid, '건너뜀(파일 또는 fixture 없음)'); continue
        keys = [x['k'] for x in f['fields']]
        got = g.llm(g.extract_prompt(f['doc_type']), str(path)) or {}   # 실제 파이프라인과 같은 프롬프트(양식 설명 포함)
        rows = []
        for x in f['fields']:
            exp, act = x.get('v'), got.get(x['k'])
            ok = norm(exp) == norm(act) or (norm(exp) and norm(exp) in norm(act)) or (norm(act) and norm(act) in norm(exp))
            rows.append({'k': x['k'], 'label': x.get('label'), 'expected': exp, 'got': act, 'ok': bool(ok)})
        n_ok = sum(r['ok'] for r in rows)
        report[fid] = {'doc_type': f['doc_type'], 'file': path.name, 'ok': n_ok, 'total': len(rows), 'rows': rows}
        print(f"{fid:5} {f['doc_type']:8} {n_ok}/{len(rows)} 일치  " + ', '.join('✗' + r['k'] for r in rows if not r['ok']))
    (HERE / 'eval_report.json').write_text(json.dumps(report, ensure_ascii=False, indent=1, default=str), 'utf-8')
    print('→ agent/eval_report.json')


if __name__ == '__main__':
    main()
