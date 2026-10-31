@echo off
chcp 65001 >nul
cd /d "%~dp0"
where python >nul 2>nul
if errorlevel 1 (
  echo python 이 없습니다. 오프라인 모드로 index.html 을 엽니다 ^(상태는 브라우저 localStorage, 추출은 미리 읽어 둔 값^).
  start "" index.html
  exit /b
)
echo 라벨코스트 서버 시작: http://localhost:8765  ^(끄려면 이 창을 닫으세요^)
start "" /b python -X utf8 serverpp.py
timeout /t 2 /nobreak >nul
start "" http://localhost:8765
pause
