#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
APP_DIR="$ROOT_DIR/apps/keepwise-tauri"
ANDROID_GEN_DIR="$APP_DIR/src-tauri/gen/android"
KEYSTORE_PROPERTIES_PATH="$ANDROID_GEN_DIR/keystore.properties"
LOCAL_SIGNING_DIR="$ANDROID_GEN_DIR/.local"

find_keytool() {
  if command -v keytool >/dev/null 2>&1; then
    command -v keytool
    return 0
  fi

  local android_studio_keytool="/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin/keytool"
  if [[ -x "$android_studio_keytool" ]]; then
    echo "$android_studio_keytool"
    return 0
  fi

  return 1
}

if [[ -f "$KEYSTORE_PROPERTIES_PATH" ]]; then
  echo "Using existing Android release signing config:"
  echo "  $KEYSTORE_PROPERTIES_PATH"
  exit 0
fi

KEYTOOL_BIN="$(find_keytool || true)"
if [[ -z "$KEYTOOL_BIN" ]]; then
  echo "keytool not found. Install a JDK or Android Studio JBR before running Android release install." >&2
  exit 1
fi

mkdir -p "$LOCAL_SIGNING_DIR"

KEY_ALIAS="${KEEPWISE_ANDROID_KEY_ALIAS:-keepwise-local-release}"
KEY_PASSWORD="${KEEPWISE_ANDROID_KEY_PASSWORD:-keepwise-local}"
STORE_PASSWORD="${KEEPWISE_ANDROID_STORE_PASSWORD:-$KEY_PASSWORD}"
STORE_FILE="${KEEPWISE_ANDROID_KEYSTORE_PATH:-$LOCAL_SIGNING_DIR/keepwise-local-release.jks}"
KEY_DNAME="${KEEPWISE_ANDROID_KEYSTORE_DNAME:-CN=KeepWise Local Release, OU=Development, O=KeepWise, L=Shanghai, ST=Shanghai, C=CN}"

if [[ ! -f "$STORE_FILE" ]]; then
  "$KEYTOOL_BIN" -genkeypair \
    -keystore "$STORE_FILE" \
    -storepass "$STORE_PASSWORD" \
    -keypass "$KEY_PASSWORD" \
    -alias "$KEY_ALIAS" \
    -keyalg RSA \
    -keysize 2048 \
    -validity 10000 \
    -dname "$KEY_DNAME" \
    -noprompt
fi

cat > "$KEYSTORE_PROPERTIES_PATH" <<EOF
keyAlias=$KEY_ALIAS
keyPassword=$KEY_PASSWORD
storePassword=$STORE_PASSWORD
storeFile=$STORE_FILE
EOF

echo "Prepared local Android release signing config:"
echo "  keystore: $STORE_FILE"
echo "  properties: $KEYSTORE_PROPERTIES_PATH"
echo "This local keystore is for device installs and internal testing only."
