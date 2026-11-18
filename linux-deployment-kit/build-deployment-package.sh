#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_MODE=upgrade
if [[ "${1:-}" == --full ]]; then
  PACKAGE_MODE=full
  shift
fi

REPO="${1:-/mnt/d/DSH/deepseek-harness-master}"
OUT="${2:-/mnt/d/DSH/linux-deployment}"

fail() {
  printf 'build-deployment-package: %s\n' "$1" >&2
  exit 1
}

if [[ "$PACKAGE_MODE" == full ]]; then
  exec bash "$SCRIPT_DIR/build-offline-package.sh" "$REPO" "$OUT"
fi

[[ ! -e "$OUT" ]] || fail "output path already exists: $OUT; choose a fresh output directory"
OUT_PARENT="$(dirname -- "$OUT")"
OUT_NAME="$(basename -- "$OUT")"
mkdir -p "$OUT_PARENT"
FULL_OUT="$(mktemp -d "$OUT_PARENT/.${OUT_NAME}.full.XXXXXX")"
OUTPUT_COMPLETE=0
cleanup() {
  local status=$?
  if [[ -d "$FULL_OUT" && ! -L "$FULL_OUT" ]]; then
    rm -rf -- "$FULL_OUT"
  fi
  if [[ "$status" -ne 0 && "$OUTPUT_COMPLETE" -eq 0 && -d "$OUT" && ! -L "$OUT" ]]; then
    rm -rf -- "$OUT"
  fi
  exit "$status"
}
trap cleanup EXIT

bash "$SCRIPT_DIR/build-offline-package.sh" "$REPO" "$FULL_OUT"
mkdir "$OUT"
cp "$FULL_OUT/deepseek-harness-linux-x64.tar.gz" "$OUT/"
cp "$FULL_OUT/VERSION" "$OUT/"
cp "$FULL_OUT/BUILD_SOURCE_COMMIT" "$OUT/"
printf '%s\n' 'application-upgrade' > "$OUT/PACKAGE_TYPE"
(
  cd "$OUT"
  sha256sum deepseek-harness-linux-x64.tar.gz VERSION BUILD_SOURCE_COMMIT PACKAGE_TYPE > SHA256SUMS
  sha256sum --check SHA256SUMS
)
OUTPUT_COMPLETE=1
trap - EXIT
rm -rf -- "$FULL_OUT"
printf '\nApplication upgrade package in %s:\n' "$OUT"
ls -lh "$OUT/deepseek-harness-linux-x64.tar.gz" "$OUT/VERSION" \
  "$OUT/BUILD_SOURCE_COMMIT" "$OUT/PACKAGE_TYPE" "$OUT/SHA256SUMS"
