#!/bin/bash
cd "$(dirname "$0")"
echo "サーバーを起動中... http://localhost:8000"
python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
