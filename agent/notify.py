# 만료 알림. 등록·인증 D-day와 수입 서류 미완을 모아 메일로 보낸다(SMTP 설정 없으면 본문만 출력).
# 실행: python -X utf8 agent/notify.py [--dry]   매일 08:00 자동 실행은 agent/notify_register.bat
import datetime, json, os, pathlib, smtplib, sqlite3, subprocess, sys
from email.mime.text import MIMEText

HERE = pathlib.Path(__file__).parent
ROOT = HERE.parent
TODAY = datetime.date.today()


def env():
    p = ROOT.parent / '.env'; d = {}
    if p.exists():
        for line in p.read_text('utf-8').splitlines():
            if '=' in line and not line.startswith('#'): k, v = line.split('=', 1); d[k.strip()] = v.strip()
    return d


def state():
    db = ROOT / 'server' / 'labelcoast.db'
    s = {}
    if db.exists():
        r = sqlite3.connect(db).execute("select json from state where id='main'").fetchone()
        if r: s = json.loads(r[0])
    if not s.get('registry'):  # 서버 상태가 없으면 data.js 시드
        js = "global.window={};eval(require('fs').readFileSync('data.js','utf8'));process.stdout.write(JSON.stringify({registry:LC.registry,importShipments:(LC.importSeed||LC.importShipments||[])}))"
        try: s.update(json.loads(subprocess.run(['node', '-e', js], cwd=ROOT, capture_output=True, text=True, encoding='utf-8').stdout))
        except Exception: pass
    return s


def report(s):
    exp, warn, ok = [], [], 0
    for r in s.get('registry', []):
        if not r.get('expiry'): continue
        d = (datetime.date.fromisoformat(r['expiry']) - TODAY).days
        line = f"- {r.get('name')} ({r.get('no', '')}) 만료 {r['expiry']} · D{d:+d}"
        if d < 0: exp.append(line)
        elif d <= max(int(r.get('lead') or 0), 90): warn.append(line + (' ★30일 이내' if d <= 30 else ''))
        else: ok += 1
    imp = []
    for sh in s.get('importShipments', []):
        left = [c['doc'] for c in sh.get('checklist', []) if c.get('required') and c.get('status') in ('확인', '없음')]
        if left: imp.append(f"- 수입 {sh.get('no')}: 미완 {len(left)}건 ({', '.join(left[:3])}{' 외' if len(left) > 3 else ''})")
    body = [f'[라벨코스트] 만료·서류 알림 {TODAY}', '']
    body += ['■ 만료됨'] + (exp or ['- 없음']) + ['', '■ 90일 이내(또는 설정 기간) 경고'] + (warn or ['- 없음'])
    body += ['', '■ 수입 서류 미완'] + (imp or ['- 없음']) + ['', f'정상 {ok}건. 대시보드 ⑥에서 확인.']
    return '\n'.join(body), len(exp) + len(warn) + len(imp)


def main():
    s = state(); text, n = report(s)
    e = env(); keys = ['LC_SMTP_HOST', 'LC_SMTP_PORT', 'LC_SMTP_USER', 'LC_SMTP_PASS', 'LC_NOTIFY_TO']
    (HERE / 'notify_last.txt').write_text(text, 'utf-8')
    if '--dry' in sys.argv or not all(e.get(k) for k in keys):
        print(text); print('\n(메일 미발송: ' + ('--dry' if '--dry' in sys.argv else 'SMTP 설정 없음') + ') → agent/notify_last.txt'); return
    msg = MIMEText(text, 'plain', 'utf-8'); msg['Subject'] = f'[라벨코스트] 알림 {n}건 {TODAY}'; msg['From'] = e['LC_SMTP_USER']; msg['To'] = e['LC_NOTIFY_TO']
    with smtplib.SMTP(e['LC_SMTP_HOST'], int(e['LC_SMTP_PORT']), timeout=15) as sm:
        sm.starttls(); sm.login(e['LC_SMTP_USER'], e['LC_SMTP_PASS']); sm.sendmail(e['LC_SMTP_USER'], [x.strip() for x in e['LC_NOTIFY_TO'].split(',')], msg.as_string())
    print(f'메일 발송 {n}건 → {e["LC_NOTIFY_TO"]}')


if __name__ == '__main__':
    main()
