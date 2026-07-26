#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
APP_DIR="$ROOT_DIR/apps/keepwise-tauri"
LIB_RS="$APP_DIR/src-tauri/src/lib.rs"
PROTOCOL_DOC="$ROOT_DIR/docs/engineering/TAURI_IPC_API_PROTOCOL.md"
INVOKE_ENTRY="$APP_DIR/src/api/desktop/invoke.ts"

invoke_imports="$(rg -l '@tauri-apps/api/core' "$APP_DIR/src" --glob '*.{ts,tsx}' | sort)"
if [[ "$invoke_imports" != "$INVOKE_ENTRY" ]]; then
  echo "Tauri invoke 只能从 $INVOKE_ENTRY 引入" >&2
  printf '%s\n' "$invoke_imports" >&2
  exit 1
fi

handler_commands="$({
  sed -n '/\.invoke_handler(tauri::generate_handler!\[/,/^        ])/p' "$LIB_RS" \
    | rg '^            ([a-z_]+::)+[a-z_]+,?$' \
    | sed -E 's/^            ([a-z_]+::)+([a-z_]+),?$/\2/' \
    | sort
})"
documented_commands="$({
  sed -n '/| # | Command | Domain |/,/^## Payload Conventions/p' "$PROTOCOL_DOC" \
    | rg '^\| [0-9]+ \| `[^`]+` \|' \
    | sed -E 's/^\| [0-9]+ \| `([^`]+)` \|.*$/\1/' \
    | sort
})"

if ! diff -u <(printf '%s\n' "$handler_commands") <(printf '%s\n' "$documented_commands"); then
  echo "Tauri command 清单与 IPC 协议文档不一致" >&2
  exit 1
fi

handler_count="$(printf '%s\n' "$handler_commands" | sed '/^$/d' | wc -l | tr -d ' ')"
documented_count="$(rg -o 'Current registered command count: \*\*[0-9]+' "$PROTOCOL_DOC" | rg -o '[0-9]+')"
if [[ "$handler_count" != "$documented_count" ]]; then
  echo "IPC 协议命令数量不一致: Rust=$handler_count, doc=$documented_count" >&2
  exit 1
fi

loose_payload_count="$({ rg -n 'LoosePayload' "$APP_DIR/src" --glob '*.{ts,tsx}' || true; } | wc -l | tr -d ' ')"
wide_feature_props_count="$({ rg -n 'Record<string, any>' "$APP_DIR/src/features" --glob '*.{ts,tsx}' || true; } | wc -l | tr -d ' ')"

echo "Frontend boundary check passed. commands=$handler_count loose_payload_refs=$loose_payload_count wide_feature_props=$wide_feature_props_count"
