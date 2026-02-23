#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_SCRIPT="$ROOT_DIR/scripts/keepwise_web_app.py"

if [[ ! -f "$APP_SCRIPT" ]]; then
  echo "未找到应用脚本: $APP_SCRIPT" >&2
  exit 1
fi

HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-8081}"

python3 "$APP_SCRIPT" --host "$HOST" --port "$PORT" --root "$ROOT_DIR"
