#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python manage.py init
if [ ! -f model_artifacts/bundle.joblib ]; then python manage.py train; fi
if [ ! -f frontend/dist/index.html ]; then (cd frontend && npm ci && npm run build); fi
echo 'Open http://localhost:8000 and create your account.'
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
