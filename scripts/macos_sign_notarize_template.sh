#!/usr/bin/env bash
set -euo pipefail

# Template script for macOS signing/notarization flow.
# Default behavior is "check-only" (validate inputs and print planned commands).
# It does NOT contain any real secrets and does NOT perform signing unless
# explicitly requested with --execute and all env vars are provided.

usage() {
  cat <<'EOF'
Usage:
  macos_sign_notarize_template.sh --app <path/to/KeepWise.app> [--dmg <path/to/KeepWise.dmg>] [--check-only] [--execute]

Modes:
  --check-only   Validate env vars / tools / file paths and print the planned commands (default)
  --execute      Execute signing + notarization commands (template only; review before use)

Required env vars for --execute (also validated in --check-only):
  APPLE_SIGNING_IDENTITY
  APPLE_ID_EMAIL
  APPLE_TEAM_ID
  APPLE_APP_SPECIFIC_PASSWORD

Optional env vars:
  CODESIGN_OPTIONS        Default: --options runtime --timestamp
  XCRUN_NOTARYTOOL_PROFILE  If set, uses keychain profile instead of Apple ID/password

Examples:
  bash scripts/macos_sign_notarize_template.sh --app /path/KeepWise.app --dmg /path/KeepWise.dmg
  bash scripts/macos_sign_notarize_template.sh --app /path/KeepWise.app --execute
EOF
}

APP_PATH=""
DMG_PATH=""
MODE="check-only"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app)
      APP_PATH="${2:-}"
      shift 2
      ;;
    --dmg)
      DMG_PATH="${2:-}"
      shift 2
      ;;
    --check-only)
      MODE="check-only"
      shift
      ;;
    --execute)
      MODE="execute"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown arg: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$APP_PATH" ]]; then
  echo "--app is required" >&2
  usage
  exit 1
fi

if [[ ! -d "$APP_PATH" ]]; then
  echo "App bundle not found: $APP_PATH" >&2
  exit 1
fi

if [[ -n "$DMG_PATH" && ! -f "$DMG_PATH" ]]; then
  echo "DMG not found: $DMG_PATH" >&2
  exit 1
fi

required_tools=(codesign xcrun)
for tool in "${required_tools[@]}"; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "Missing required tool: $tool" >&2
    exit 1
  fi
done

missing_env=()
for key in APPLE_SIGNING_IDENTITY APPLE_ID_EMAIL APPLE_TEAM_ID APPLE_APP_SPECIFIC_PASSWORD; do
  if [[ -z "${!key:-}" ]]; then
    missing_env+=("$key")
  fi
done

CODESIGN_OPTIONS="${CODESIGN_OPTIONS:---options runtime --timestamp}"
NOTARY_PROFILE="${XCRUN_NOTARYTOOL_PROFILE:-}"

echo "macOS sign/notarize template"
echo "mode=$MODE"
echo "app=$APP_PATH"
echo "dmg=${DMG_PATH:-<none>}"
echo "codesign_options=$CODESIGN_OPTIONS"
if [[ -n "$NOTARY_PROFILE" ]]; then
  echo "notarytool_profile=$NOTARY_PROFILE"
else
  echo "notarytool_profile=<none> (will use APPLE_ID_EMAIL / APPLE_TEAM_ID / APPLE_APP_SPECIFIC_PASSWORD)"
fi

if [[ ${#missing_env[@]} -gt 0 ]]; then
  echo "Missing env vars: ${missing_env[*]}"
  if [[ "$MODE" == "execute" ]]; then
    echo "Cannot execute without required env vars." >&2
    exit 1
  fi
fi

echo
echo "Planned commands:"
echo "1) codesign app bundle"
echo "   codesign --force --sign \"\$APPLE_SIGNING_IDENTITY\" $CODESIGN_OPTIONS \"$APP_PATH\""

if [[ -n "$DMG_PATH" ]]; then
  echo "2) codesign dmg (optional but recommended)"
  echo "   codesign --force --sign \"\$APPLE_SIGNING_IDENTITY\" --timestamp \"$DMG_PATH\""
fi

echo "3) notarize app/dmg via notarytool"
if [[ -n "$NOTARY_PROFILE" ]]; then
  target="${DMG_PATH:-$APP_PATH}"
  echo "   xcrun notarytool submit \"$target\" --keychain-profile \"$NOTARY_PROFILE\" --wait"
else
  target="${DMG_PATH:-$APP_PATH}"
  echo "   xcrun notarytool submit \"$target\" --apple-id \"\$APPLE_ID_EMAIL\" --team-id \"\$APPLE_TEAM_ID\" --password \"\$APPLE_APP_SPECIFIC_PASSWORD\" --wait"
fi

echo "4) staple"
echo "   xcrun stapler staple \"$APP_PATH\""
if [[ -n "$DMG_PATH" ]]; then
  echo "   xcrun stapler staple \"$DMG_PATH\""
fi

if [[ "$MODE" == "check-only" ]]; then
  echo
  echo "Check-only mode complete. No signing/notarization was executed."
  exit 0
fi

if [[ ${#missing_env[@]} -gt 0 ]]; then
  echo "Refusing to execute with missing env vars." >&2
  exit 1
fi

echo
echo "[execute] Signing app bundle"
codesign --force --sign "$APPLE_SIGNING_IDENTITY" $CODESIGN_OPTIONS "$APP_PATH"

if [[ -n "$DMG_PATH" ]]; then
  echo "[execute] Signing dmg"
  codesign --force --sign "$APPLE_SIGNING_IDENTITY" --timestamp "$DMG_PATH"
fi

NOTARY_TARGET="${DMG_PATH:-$APP_PATH}"
echo "[execute] Submitting for notarization: $NOTARY_TARGET"
if [[ -n "$NOTARY_PROFILE" ]]; then
  xcrun notarytool submit "$NOTARY_TARGET" --keychain-profile "$NOTARY_PROFILE" --wait
else
  xcrun notarytool submit "$NOTARY_TARGET" \
    --apple-id "$APPLE_ID_EMAIL" \
    --team-id "$APPLE_TEAM_ID" \
    --password "$APPLE_APP_SPECIFIC_PASSWORD" \
    --wait
fi

echo "[execute] Stapling"
xcrun stapler staple "$APP_PATH"
if [[ -n "$DMG_PATH" ]]; then
  xcrun stapler staple "$DMG_PATH"
fi

echo "Sign/notarize template execution complete."
