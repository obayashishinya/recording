#!/bin/bash
# 会議録音アプリを起動してブラウザを開く

cd "$(dirname "$0")"

echo "サーバーを起動中... http://localhost:8000"

# バックグラウンドで少し待ってからブラウザを開く
(sleep 2 && open http://localhost:8000) &

python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
