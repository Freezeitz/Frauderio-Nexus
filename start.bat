@echo off
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe py -3 -m venv .venv
call .venv\Scripts\activate.bat
python -m pip install -r requirements.txt
if errorlevel 1 goto fail
python manage.py init
if errorlevel 1 goto fail
if not exist model_artifacts\bundle.joblib python manage.py train
if errorlevel 1 goto fail
if not exist frontend\dist\index.html (
  cd frontend
  call npm ci
  if errorlevel 1 goto fail
  call npm run build
  if errorlevel 1 goto fail
  cd ..
)
echo Open http://localhost:8000 and create your account.
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
goto end
:fail
echo Setup failed. Read the error above and check README.md.
:end
pause
