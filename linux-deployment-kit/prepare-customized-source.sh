#!/usr/bin/env bash
set -euo pipefail

LOCAL_SOURCE="${1:-/mnt/d/DSH/deepseek-harness-master}"
DESTINATION="${2:-$HOME/deepseek-harness-linux-source}"

fail() {
  printf 'prepare-customized-source: %s\n' "$1" >&2
  exit 1
}

[[ -f "$LOCAL_SOURCE/package.json" && -f "$LOCAL_SOURCE/pnpm-lock.yaml" ]] \
  || fail "local source tree is incomplete: $LOCAL_SOURCE"
[[ ! -e "$DESTINATION" ]] || fail "destination already exists: $DESTINATION"
command -v tar >/dev/null || fail 'tar is required'

mkdir -p "$DESTINATION"
cleanup_failed_copy() {
  local status=$?
  if [[ "$status" -ne 0 ]]; then
    case "$DESTINATION" in
      "$HOME"/*)
        [[ -d "$DESTINATION" && ! -L "$DESTINATION" ]] && rm -rf -- "$DESTINATION"
        ;;
    esac
  fi
  exit "$status"
}
trap cleanup_failed_copy EXIT

printf 'Copying local customized source into the Linux filesystem: %s\n' "$DESTINATION"
tar -C "$LOCAL_SOURCE" \
  --exclude=.git \
  --exclude=node_modules \
  --exclude='*/node_modules' \
  --exclude='.env*' \
  --exclude=.local \
  --exclude='*/.local' \
  --exclude=.dsh \
  --exclude=coverage \
  --exclude=./deliverables \
  --exclude=linux-deployment-kit \
  -cf - . | tar -C "$DESTINATION" -xf -

for required in package.json pnpm-lock.yaml apps/cli/lib/bin.js apps/web/dist/index.html; do
  [[ -f "$DESTINATION/$required" ]] || fail "copied local tree lacks required Gateway artifact: $required"
done

STATUS_FILE="${DESTINATION}.status.txt"
{
  printf 'local_source=%s\n' "$LOCAL_SOURCE"
  printf 'destination=%s\n' "$DESTINATION"
  printf 'copied_at_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'source_mode=direct-local-copy\n'
  printf 'excluded=.git,node_modules,.env*,.local,.dsh,coverage,deliverables,linux-deployment-kit\n'
} > "$STATUS_FILE"

trap - EXIT
printf 'Prepared direct local source copy: %s\n' "$DESTINATION"
printf 'Copy record: %s\n' "$STATUS_FILE"
