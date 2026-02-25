#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$ROOT_DIR/apps/keepwise-tauri"
PACKAGE_JSON="$APP_DIR/package.json"

MODE="${1:-debug}"

if [[ "$MODE" != "debug" && "$MODE" != "release" && "$MODE" != "mac" ]]; then
  echo "Usage: $0 [debug|release|mac]"
  echo "  debug   -> tauri build --debug"
  echo "  release -> tauri build"
  echo "  mac     -> tauri build --bundles app,dmg"
  exit 1
fi

APP_VERSION="$(node -p "require('$PACKAGE_JSON').version")"
GIT_SHA="$(git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)"
BUILD_STAMP="$(date +%Y%m%d-%H%M%S)"
ARTIFACT_PREFIX="${KEEPWISE_ARTIFACT_PREFIX:-keepwise-desktop-v${APP_VERSION}-${MODE}-${GIT_SHA}-${BUILD_STAMP}}"
EXPORT_ROOT="${KEEPWISE_DESKTOP_EXPORT_ROOT:-$ROOT_DIR/.artifacts/desktop-builds}"
EXPORT_DIR="$EXPORT_ROOT/$ARTIFACT_PREFIX"

mkdir -p "$EXPORT_DIR"

echo "[meta] version=$APP_VERSION"
echo "[meta] mode=$MODE"
echo "[meta] git_sha=$GIT_SHA"
echo "[meta] artifact_prefix=$ARTIFACT_PREFIX"
echo "[meta] export_dir=$EXPORT_DIR"

if [[ "${KEEPWISE_SKIP_PREFLIGHT:-0}" == "1" ]]; then
  echo "[preflight] skipped (KEEPWISE_SKIP_PREFLIGHT=1)"
else
  echo "[preflight] desktop rust regression subset"
  bash "$ROOT_DIR/scripts/validate_tauri_desktop_rust_regression.sh"

  echo "[preflight] frontend build"
  cd "$APP_DIR"
  npm run build

  echo "[preflight] rust check"
  cargo check --manifest-path src-tauri/Cargo.toml
fi

cd "$APP_DIR"

case "$MODE" in
  debug)
    echo "[build] tauri debug bundle"
    npm run tauri:build:debug
    ;;
  release)
    echo "[build] tauri release bundle"
    npm run tauri:build
    ;;
  mac)
    echo "[build] tauri mac bundle (app,dmg)"
    npm run tauri:build:mac
    ;;
esac

TARGET_MODE_DIR="$APP_DIR/src-tauri/target/$([[ "$MODE" == "debug" ]] && echo debug || echo release)"
BUNDLE_DIR="$TARGET_MODE_DIR/bundle"

echo "[post] collect bundle artifacts into export dir"
{
  echo "{"
  echo "  \"artifact_prefix\": \"$ARTIFACT_PREFIX\","
  echo "  \"version\": \"$APP_VERSION\","
  echo "  \"mode\": \"$MODE\","
  echo "  \"git_sha\": \"$GIT_SHA\","
  echo "  \"build_stamp\": \"$BUILD_STAMP\","
  echo "  \"bundle_dir\": \"$BUNDLE_DIR\""
  echo "}"
} > "$EXPORT_DIR/build_meta.json"

if [[ -d "$BUNDLE_DIR" ]]; then
  artifact_count=0
  app_bundle_count=0
  file_bundle_count=0
  while IFS= read -r file; do
    cp "$file" "$EXPORT_DIR/"
    ((file_bundle_count+=1))
    ((artifact_count+=1))
  done < <(find "$BUNDLE_DIR" -type f \( \
    -name '*.dmg' -o -name '*.msi' -o -name '*.deb' -o -name '*.rpm' -o -name '*.AppImage' -o -name '*.exe' \
  \) | sort)

  while IFS= read -r app_dir; do
    cp -R "$app_dir" "$EXPORT_DIR/"
    ((app_bundle_count+=1))
    ((artifact_count+=1))
  done < <(find "$BUNDLE_DIR" -type d -name '*.app' | sort)

  {
    echo "artifact_prefix=$ARTIFACT_PREFIX"
    echo "bundle_dir=$BUNDLE_DIR"
    echo "file_bundle_count=$file_bundle_count"
    echo "app_bundle_count=$app_bundle_count"
    echo "artifact_count=$artifact_count"
  } > "$EXPORT_DIR/artifact_inventory.txt"

  if [[ "$artifact_count" -eq 0 ]]; then
    echo
    echo "[ERROR] Tauri build completed but no distributable artifacts were found in:"
    echo "  $BUNDLE_DIR"
    echo "Expected at least one of: .app/.dmg/.msi/.deb/.rpm/.AppImage/.exe"
    echo "Inspect target output manually:"
    echo "  $TARGET_MODE_DIR"
    exit 2
  fi
else
  echo
  echo "[ERROR] Expected Tauri bundle directory not found:"
  echo "  $BUNDLE_DIR"
  echo "Inspect target output manually:"
  echo "  $TARGET_MODE_DIR"
  exit 2
fi

echo
echo "Desktop build finished. Check artifacts under:"
echo "  $APP_DIR/src-tauri/target/"
echo "Exported artifact snapshot:"
echo "  $EXPORT_DIR"
echo "Artifact inventory:"
echo "  $EXPORT_DIR/artifact_inventory.txt"
