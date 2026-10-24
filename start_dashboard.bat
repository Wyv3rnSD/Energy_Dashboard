@echo off
rem Starts the Energy Dashboard at http://localhost:8000: one process serves both
rem the API and the website. MySQL and MongoDB must be running (they normally run
rem as Windows services). Pass "nobrowser" to skip opening the browser.
cd /d "%~dp0"

if not exist "frontend\dist\index.html" (
  echo Building the dashboard website, first run only...
  pushd frontend
  if not exist node_modules call npm.cmd install
  call npm.cmd run build
  popd
)

if /i not "%~1"=="nobrowser" (
  start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep 4; Start-Process 'http://localhost:8000'"
)
python -m uvicorn api:app --host 127.0.0.1 --port 8000