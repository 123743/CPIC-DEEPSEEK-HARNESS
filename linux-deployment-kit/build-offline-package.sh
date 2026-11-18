#!/usr/bin/env bash
set -euo pipefail

REPO="${1:-/mnt/d/DSH/deepseek-harness-master}"
OUT="${2:-/mnt/d/DSH/linux-deployment}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
NODE_VERSION=24.9.0
PNPM_VERSION=11.28.5
NODE_ARCHIVE="node-v${NODE_VERSION}-linux-x64.tar.xz"

fail() {
  printf 'build-offline-package: %s\n' "$1" >&2
  exit 1
}

[[ "$(uname -m)" == x86_64 ]] || fail 'this script currently packages linux-x64 only'
[[ "$(getconf GNU_LIBC_VERSION 2>/dev/null || true)" == "glibc 2.31" ]] \
  || fail 'build host must use glibc 2.31 (Ubuntu 20.04 compatibility baseline)'
[[ -f "$REPO/package.json" && -f "$REPO/pnpm-lock.yaml" ]] || fail "repository or lockfile not found: $REPO"
command -v git >/dev/null || fail 'git is required to create temporary build provenance metadata'

mkdir -p "$OUT"
for artifact in \
  "$NODE_ARCHIVE" \
  "pnpm-${PNPM_VERSION}.tgz" \
  deepseek-harness-linux-x64.tar.gz \
  VERSION BUILD_SOURCE_COMMIT SHA256SUMS prepare-customized-source.sh build-deployment-package.sh \
  build-offline-package.sh install-offline-package.sh README.md
do
  [[ ! -e "$OUT/$artifact" ]] || fail "output artifact already exists: $OUT/$artifact; choose a fresh output directory"
done

BUILD_DIR="$(mktemp -d "$HOME/dsh-linux-build.XXXXXX")"
cleanup() {
  case "$BUILD_DIR" in
    "$HOME"/dsh-linux-build.*)
      [[ -d "$BUILD_DIR" && ! -L "$BUILD_DIR" ]] || return
      rm -rf -- "$BUILD_DIR"
      ;;
    *)
      printf 'build-offline-package: refusing to clean unexpected path: %s\n' "$BUILD_DIR" >&2
      ;;
  esac
}
trap cleanup EXIT
SRC="$BUILD_DIR/deepseek-harness"
mkdir -p "$SRC" "$OUT"

printf '%s\n' 'Downloading and verifying the Linux build runtime...'
CACHE_DIR="${DSH_DEPLOYMENT_CACHE:-$HOME/.cache/dsh-deployment}"
mkdir -p "$CACHE_DIR"
CACHED_NODE="$CACHE_DIR/$NODE_ARCHIVE"
CACHED_SUMS="$CACHE_DIR/node-v${NODE_VERSION}-SHASUMS256.txt"

sums_ready=0
for attempt in 1 2 3 4 5 6 7 8; do
  if curl --fail --location --http1.1 --connect-timeout 30 \
    --output "$CACHED_SUMS.tmp" "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt"; then
    mv "$CACHED_SUMS.tmp" "$CACHED_SUMS"
    sums_ready=1
    break
  fi
  rm -f -- "$CACHED_SUMS.tmp"
  printf 'SHASUMS download attempt %s failed; retrying.\n' "$attempt" >&2
  sleep 3
done
[[ "$sums_ready" -eq 1 ]] || fail 'cannot download the Node.js checksum manifest after 8 attempts'
EXPECTED_NODE_SHA="$(awk -v file="$NODE_ARCHIVE" '$2 == file { print $1 }' "$CACHED_SUMS")"
[[ "$EXPECTED_NODE_SHA" =~ ^[0-9a-f]{64}$ ]] || fail "checksum manifest does not contain $NODE_ARCHIVE"

node_ready=0
for attempt in 1 2 3 4 5 6 7 8; do
  if [[ -f "$CACHED_NODE" && "$(sha256sum "$CACHED_NODE" | awk '{print $1}')" == "$EXPECTED_NODE_SHA" ]]; then
    node_ready=1
    break
  fi
  printf 'Node download attempt %s of 8; cached bytes: %s\n' "$attempt" "$(stat -c %s "$CACHED_NODE" 2>/dev/null || printf 0)"
  curl_status=0
  curl --fail --location --http1.1 --connect-timeout 30 --speed-limit 1024 --speed-time 120 \
    --continue-at - --output "$CACHED_NODE" \
    "https://nodejs.org/dist/v${NODE_VERSION}/$NODE_ARCHIVE" || curl_status=$?
  if [[ -f "$CACHED_NODE" && "$(sha256sum "$CACHED_NODE" | awk '{print $1}')" == "$EXPECTED_NODE_SHA" ]]; then
    node_ready=1
    break
  fi
  if [[ "$curl_status" -eq 33 ]]; then
    printf '%s\n' 'Node server rejected the cached range; restarting the download.' >&2
    rm -f -- "$CACHED_NODE"
  else
    printf 'Node download attempt %s ended with curl status %s; retrying from the cached byte offset.\n' "$attempt" "$curl_status" >&2
  fi
  sleep 3
done
[[ "$node_ready" -eq 1 ]] || fail "Node.js archive remains incomplete after 8 attempts; cached partial file: $CACHED_NODE"

cd "$BUILD_DIR"
cp "$CACHED_NODE" "$NODE_ARCHIVE"
cp "$CACHED_SUMS" SHASUMS256.txt
sha256sum --check --ignore-missing SHASUMS256.txt
tar -xJf "$NODE_ARCHIVE"
export PATH="$BUILD_DIR/node-v${NODE_VERSION}-linux-x64/bin:$PATH"
[[ "$(node --version)" == "v${NODE_VERSION}" ]] || fail "build Node.js must be v${NODE_VERSION}"
command -v corepack >/dev/null || fail 'downloaded build Node.js does not provide Corepack'
[[ "$(corepack "pnpm@${PNPM_VERSION}" --version)" == "$PNPM_VERSION" ]] || fail "build pnpm must be $PNPM_VERSION"

printf '%s\n' 'Copying source into Linux filesystem...'
tar -C "$REPO" \
  --exclude=.git \
  --exclude=node_modules \
  --exclude='*/node_modules' \
  --exclude='.env*' \
  --exclude=.local \
  --exclude='*/.local' \
  --exclude=./.dsh \
  --exclude=coverage \
  --exclude=./deliverables \
  --exclude=linux-deployment-kit \
  -cf - . | tar -C "$SRC" -xf -

cd "$SRC"
printf '%s\n' 'Installing Linux dependencies from the local lockfile...'
corepack "pnpm@${PNPM_VERSION}" install --frozen-lockfile
(
  cd extensions/cpic-requirements
  corepack "pnpm@${PNPM_VERSION}" install --ignore-workspace --frozen-lockfile --prod
)

printf '%s\n' 'Creating temporary build provenance metadata...'
git init --quiet .
git config core.autocrlf false
git config gc.auto 0
git add -A
GIT_AUTHOR_NAME='DSH local deployment build' \
GIT_AUTHOR_EMAIL='local-build@invalid' \
GIT_AUTHOR_DATE='2000-01-01T00:00:00Z' \
GIT_COMMITTER_NAME='DSH local deployment build' \
GIT_COMMITTER_EMAIL='local-build@invalid' \
GIT_COMMITTER_DATE='2000-01-01T00:00:00Z' \
  git -c commit.gpgSign=false -c gc.auto=0 commit --quiet -m 'Copied local Linux Gateway deployment source'
BUILD_SOURCE_COMMIT="$(git rev-parse HEAD)"
printf '%s\n' "$BUILD_SOURCE_COMMIT" > "$BUILD_DIR/BUILD_SOURCE_COMMIT"

printf '%s\n' 'Building Linux native and deployment-sensitive application artifacts...'
corepack "pnpm@${PNPM_VERSION}" run build:native-system
corepack "pnpm@${PNPM_VERSION}" exec tsdown --config-loader native --env.DSH_BUILD_FACE host --filter @deepseek-ai/dsh-mcp-client
corepack "pnpm@${PNPM_VERSION}" exec tsdown --config-loader native --env.DSH_BUILD_FACE host --filter @deepseek-ai/dsh-mcp-manager
corepack "pnpm@${PNPM_VERSION}" --filter @deepseek-ai/dsh-api-workspace-controller run bundle
corepack "pnpm@${PNPM_VERSION}" --filter @deepseek-ai/dsh-api-workspace-files run bundle
corepack "pnpm@${PNPM_VERSION}" --filter @deepseek-ai/dsh-api-remotes run bundle
corepack "pnpm@${PNPM_VERSION}" --filter @deepseek-ai/dsh-client-resources run bundle
corepack "pnpm@${PNPM_VERSION}" --filter @deepseek-ai/dsh-client-ui-schedule run bundle
corepack "pnpm@${PNPM_VERSION}" --filter @deepseek-ai/dsh-client-ui-settings run bundle
corepack "pnpm@${PNPM_VERSION}" --filter @deepseek-ai/dsh-client-ui-settings-models run bundle
corepack "pnpm@${PNPM_VERSION}" --filter @deepseek-ai/dsh-client-ui-plugin-manager run bundle
corepack "pnpm@${PNPM_VERSION}" --filter @deepseek-ai/dsh-client-ui-plugin-market run bundle
corepack "pnpm@${PNPM_VERSION}" --filter @deepseek-ai/dsh-client-ui-settings-plugin-inventory run bundle
corepack "pnpm@${PNPM_VERSION}" run build:web

for runtime_artifact in \
  apps/cli/lib/bin.js \
  packages/mcp/mcp-manager/lib/index.js \
  apps/web/dist/index.html \
  packages/client/ui-schedule/lib/client.js \
  packages/client/ui-settings/lib/client.js \
  packages/client/ui-settings-models/lib/client.js \
  packages/client/ui-plugin-manager/lib/client.js \
  packages/client/ui-plugin-market/lib/client.js \
  packages/client/ui-settings-plugin-inventory/lib/client.js \
  packages/experimental/tool-http-doc/lib/index.js \
  packages/experimental/client-ui-http-doc/lib/index.js \
  packages/experimental/client-ui-http-doc/lib/client.js \
  extensions/cpic-requirements/index.js \
  extensions/cpic-requirements/roles/clarifier/.dsh/skills/requirement-clarification/SKILL.md \
  extensions/cpic-requirements/roles/extractor/.dsh/skills/feature-point-extraction/SKILL.md \
  extensions/cpic-requirements/roles/outline-gen/.dsh/skills/test-outline-writing/SKILL.md \
  extensions/cpic-requirements/roles/outline-review/.dsh/skills/test-outline-review/SKILL.md \
  extensions/cpic-requirements/roles/case-gen/.dsh/skills/testcase-writing/SKILL.md \
  extensions/cpic-requirements/roles/case-review/.dsh/skills/testcase-review/SKILL.md \
  extensions/dsh-workflow-panel/index.js \
  native/system/packages/entry/lib/index.js
do
  [[ -f "$runtime_artifact" ]] || fail "required local Gateway runtime artifact is missing: $runtime_artifact"
done

grep -q 'defaultWorkspacePath' packages/api/workspace-controller/lib/index.js \
  || fail 'workspace-controller Host bundle lacks defaultWorkspacePath'
grep -Eq 'remote\.schedule\.catalog\(' packages/client/ui-schedule/lib/client.js \
  || fail 'ui-schedule Client bundle lacks the full catalog reader; rebuild it before packaging'
if grep -Eq 'remote\.schedule\.list\(' packages/client/ui-schedule/lib/client.js; then
  fail 'ui-schedule Client bundle still uses the paginated list reader; rebuild it before packaging'
fi
if grep -q 'isLoopback.*"host".*"memory"' packages/client/ui-settings/lib/client.js \
  || grep -q 'persistence === "memory"' packages/client/ui-settings/lib/client.js
then
  fail 'ui-settings Client bundle still disables Host settings on non-loopback pages'
fi
grep -q 'settings describe settled with neither a view nor an error' packages/client/ui-settings-models/lib/client.js \
  || fail 'ui-settings-models Client bundle lacks the settings describe invariant'
grep -q 'welcomeNotice' packages/client/ui-settings-models/lib/index.js \
  || fail 'ui-settings-models Host bundle lacks welcomeNotice'
grep -q 'manifest.webmanifest.*crossorigin="use-credentials"' apps/web/dist/index.html \
  || fail 'Web build manifest link lacks credentialed fetch mode'

printf '%s\n' 'Validating file resource activation and complete offline editor assets...'
node scripts/multi-user/verify-resource-artifacts.mjs .
node --input-type=module - <<'NODE'
import { createRequire } from 'node:module'
const require = createRequire(new URL('./extensions/cpic-requirements/package.json', import.meta.url))
for (const dependency of ['yaml', 'zod']) {
  require(dependency)
  console.log(`CPIC dependency verified: ${dependency}`)
}
await import('./packages/mcp/mcp-manager/lib/index.js')
console.log('MCP manager Host bundle imports successfully.')
NODE

printf '%s\n' 'Validating the copied multi-user Gateway entrypoint...'
node --import tsx/esm --input-type=module - <<'NODE'
await import('./scripts/multi-user/gateway-config.ts')
await import('./scripts/multi-user/tenant-config.ts')
await import('./scripts/multi-user/instance-manager.ts')
await import('./scripts/multi-user/gateway.ts')
NODE
node -e 'const fs=require("node:fs");const p=JSON.parse(fs.readFileSync("package.json","utf8"));process.stdout.write(`${p.version}\n`)' > "$OUT/VERSION"

printf '%s\n' 'Packing pnpm and the Linux application...'
npm pack "pnpm@${PNPM_VERSION}" --pack-destination "$BUILD_DIR"
rm -rf -- "$SRC/.git"
tar -czf "$OUT/deepseek-harness-linux-x64.tar.gz" \
  -C "$BUILD_DIR" deepseek-harness
cp "$BUILD_DIR/$NODE_ARCHIVE" "$OUT/"
cp "$BUILD_DIR/pnpm-${PNPM_VERSION}.tgz" "$OUT/"
cp "$BUILD_DIR/BUILD_SOURCE_COMMIT" "$OUT/"
cp "$SCRIPT_DIR/prepare-customized-source.sh" "$OUT/"
cp "$SCRIPT_DIR/build-deployment-package.sh" "$OUT/"
cp "$SCRIPT_DIR/build-offline-package.sh" "$OUT/"
cp "$SCRIPT_DIR/install-offline-package.sh" "$OUT/"
cp "$SCRIPT_DIR/README.md" "$OUT/"

(
  cd "$OUT"
  sha256sum \
    "$NODE_ARCHIVE" \
    "pnpm-${PNPM_VERSION}.tgz" \
    deepseek-harness-linux-x64.tar.gz \
    VERSION \
    BUILD_SOURCE_COMMIT \
    prepare-customized-source.sh \
    build-deployment-package.sh \
    build-offline-package.sh \
    install-offline-package.sh \
    README.md > SHA256SUMS
  sha256sum --check SHA256SUMS
  printf '\nArtifacts in %s:\n' "$OUT"
  ls -lh "$NODE_ARCHIVE" "pnpm-${PNPM_VERSION}.tgz" \
    deepseek-harness-linux-x64.tar.gz VERSION BUILD_SOURCE_COMMIT prepare-customized-source.sh \
    build-deployment-package.sh build-offline-package.sh install-offline-package.sh README.md SHA256SUMS
)
