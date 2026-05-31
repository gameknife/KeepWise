#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
APP_DIR="$ROOT_DIR/apps/keepwise-tauri"
TAURI_EXTERNAL_DEV_CONFIG="src-tauri/tauri.ios.external-dev-server.conf.json"
DEFAULT_DEVICE_NAME="${KEEPWISE_IOS_DEVICE_NAME:-恺铭易的iPad Pro}"
DEV_SERVER_LOG="${TMPDIR:-/tmp}/keepwise-ios-dev-server.log"

find_host_ip() {
  local default_interface
  default_interface="$(route get default 2>/dev/null | awk '/interface:/{print $2; exit}')"
  if [[ -z "$default_interface" ]]; then
    return 1
  fi

  ipconfig getifaddr "$default_interface" 2>/dev/null || true
}

stop_port_listener() {
  local port="$1"
  local pids=()

  while IFS= read -r pid; do
    [[ -n "$pid" ]] && pids+=("$pid")
  done < <(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null | awk '!seen[$0]++')

  if [[ "${#pids[@]}" -eq 0 ]]; then
    return 0
  fi

  echo "Stopping existing listener on :$port (${pids[*]})"
  kill "${pids[@]}"

  for _ in {1..15}; do
    if ! lsof -tiTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done

  echo "Port $port is still busy after stopping existing listener." >&2
  return 1
}

wait_for_dev_server() {
  local host_ip="$1"

  for _ in {1..30}; do
    if curl -sf "http://$host_ip:1420" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done

  return 1
}

device_name="$DEFAULT_DEVICE_NAME"
extra_args=()

if [[ "${1:-}" != "" && "${1:-}" != --* ]]; then
  device_name="$1"
  shift
fi
extra_args=("$@")

host_ip="$(find_host_ip)"
if [[ -z "$host_ip" ]]; then
  echo "Failed to detect the local network IP for iOS device development." >&2
  exit 1
fi

stop_port_listener 1421
stop_port_listener 1420

echo "Starting Vite dev server on $host_ip:1420"
(
  cd "$APP_DIR"
  export TAURI_DEV_HOST="$host_ip"
  nohup npm run dev >"$DEV_SERVER_LOG" 2>&1 &
)

if ! wait_for_dev_server "$host_ip"; then
  echo "Vite dev server did not become ready. Check $DEV_SERVER_LOG for details." >&2
  exit 1
fi

echo "Updating $device_name via $host_ip"

cd "$APP_DIR"
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
tauri_command=(npm run tauri -- ios dev "$device_name" --host "$host_ip" --no-watch --config "$TAURI_EXTERNAL_DEV_CONFIG")
if [[ "${#extra_args[@]}" -gt 0 ]]; then
  tauri_command+=("${extra_args[@]}")
fi

exec "${tauri_command[@]}"
