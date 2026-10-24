@echo off
rem One-time setup for the Energy Dashboard. Safe to run again: each step checks
rem whether it is already done and skips it. Needs Python 3.10+, Node.js 22,
rem MySQL 8 and MongoDB 7+ installed, with MySQL and MongoDB running.
setlocal
cd /d "%~dp0"
echo ===== Energy Dashboard setup =====
echo.

rem 1. Required programs
where python >nul 2>nul || (echo [missing] Python was not found. Install Python 3.10 or newer, then run this again. & goto :fail)
where npm.cmd >nul 2>nul || (echo [missing] Node.js was not found. Install Node.js 22 LTS, then run this again. & goto :fail)
echo [ok]    Python and Node.js found

rem 2. Python packages
python -c "import fastapi, uvicorn, pandas, sqlalchemy, pymysql, pymongo, dotenv, sklearn" >nul 2>nul
if errorlevel 1 (
  echo [setup] Installing Python packages...
  python -m pip install -r requirements.txt || goto :fail
) else (
  echo [skip]  Python packages are already installed
)

rem 3. Settings file
if exist .env (
  echo [skip]  .env already exists
) else (
  copy .env.example .env >nul
  echo [setup] Created .env. Notepad will open: set MYSQL_PASSWORD to your MySQL password, save, and close Notepad.
  start /wait notepad .env
)

rem 4. Database servers reachable?
python -c "import os, pymysql, pymongo, dotenv; dotenv.load_dotenv(); pymysql.connect(host=os.getenv('MYSQL_HOST','localhost'), port=int(os.getenv('MYSQL_PORT','3306')), user=os.getenv('MYSQL_USER','root'), password=os.getenv('MYSQL_PASSWORD','')).close(); pymongo.MongoClient(os.getenv('MONGO_URI','mongodb://localhost:27017'), serverSelectionTimeoutMS=3000).admin.command('ping')" >nul 2>nul
if errorlevel 1 (
  echo [error] Could not connect to MySQL or MongoDB. Check that both are running and that the password in .env is correct.
  goto :fail
)
echo [ok]    Connected to MySQL and MongoDB

rem 5. Databases
python -c "import sys, queries as q; from sqlalchemy import text; n=q.get_engine().connect().execute(text('SELECT COUNT(*) FROM energy_data')).scalar(); m=q.get_mongo()['country_profiles'].count_documents({}); sys.exit(0 if n and m else 1)" >nul 2>nul
if errorlevel 1 (
  echo [setup] Building the MySQL and MongoDB databases...
  python build_databases.py || goto :fail
) else (
  echo [skip]  Databases already exist
)

rem 6. Forecasts, one run per target
for %%T in (renewable_generation_twh total_generation_twh fossil_generation_twh) do (
  python -c "import sys, queries as q; sys.exit(0 if q.get_mongo()['forecast_runs'].count_documents({'target': '%%T'}) else 1)" >nul 2>nul
  if errorlevel 1 (
    echo [setup] Creating forecasts for %%T...
    python forecasting.py --target %%T || goto :fail
  ) else (
    echo [skip]  Forecasts for %%T already exist
  )
)

rem 7. Website
if exist "frontend\dist\index.html" (
  echo [skip]  Website is already built
) else (
  echo [setup] Building the website...
  pushd frontend
  if not exist node_modules call npm.cmd install
  call npm.cmd run build
  popd
  if not exist "frontend\dist\index.html" goto :fail
)

echo.
echo Setup complete. Double-click start_dashboard.bat to open the dashboard.
pause
exit /b 0

:fail
echo.
echo Setup stopped. Fix the problem above and run setup_dashboard.bat again; finished steps will be skipped.
pause
exit /b 1