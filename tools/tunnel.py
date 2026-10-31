# 노트북 서버(8765)를 인터넷에 열고, 그 주소를 api.json 에 적어 GitHub Pages 가 쓰게 한다.
# 실행: python -X utf8 tools/tunnel.py        (서버가 먼저 떠 있어야 함. 창을 닫으면 터널도 닫힘)
# 하는 일: cloudflared 빠른 터널 시작 → https://xxxx.trycloudflare.com 주소 추출 → api.json 갱신 → git commit·push (Pages 가 1~2분 뒤 새 주소로 배포)
import json, pathlib, re, shutil, subprocess, sys, time

ROOT = pathlib.Path(__file__).resolve().parent.parent
PORT = 8765
EXE = shutil.which('cloudflared') or r'C:\Program Files (x86)\cloudflared\cloudflared.exe'
if not pathlib.Path(EXE).exists():
    sys.exit('cloudflared 없음. winget install Cloudflare.cloudflared')

p = subprocess.Popen([EXE, 'tunnel', '--url', f'http://localhost:{PORT}', '--no-autoupdate'], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding='utf-8', errors='replace')
url = None; t0 = time.time()
for line in p.stdout:
    m = re.search(r'https://[a-z0-9\-]+\.trycloudflare\.com', line)
    if m: url = m.group(0); break
    if time.time() - t0 > 60: break
if not url:
    p.terminate(); sys.exit('터널 주소를 못 받음')
print('공개 주소:', url)
(ROOT / 'api.json').write_text(json.dumps({'api': url, 'note': '노트북 서버 터널 주소. tools/tunnel.py 가 갱신'}, ensure_ascii=False) + '\n', 'utf-8')
r = subprocess.run(['git', 'add', 'api.json'], cwd=ROOT); r = subprocess.run(['git', 'commit', '-q', '-m', '터널 주소 갱신 (api.json)'], cwd=ROOT, capture_output=True, text=True)
if r.returncode == 0:
    subprocess.run(['git', 'push', '-q', 'origin', 'main'], cwd=ROOT)
    print('api.json 푸시함 → 1~2분 뒤 https://jaeyoon905.github.io/koreanking/ 가 이 서버를 씀')
else:
    print('api.json 변경 없음(같은 주소)')
print('이 창을 닫으면 터널이 끊깁니다. 직접 접속:', url)
try:
    for line in p.stdout: pass
except KeyboardInterrupt:
    p.terminate()
