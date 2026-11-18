#!/usr/bin/env bash
set -euo pipefail

DIST_DIR="${1:-/mnt/d/DSH/linux-deployment}"
SOURCE_CONFIG_DIR="${2:-/mnt/d/DSH/deepseek-harness-master/.local/multi-user}"
SOURCE_TENANT_ROOT="${3:-/mnt/d/DSH/runtime/tenants}"
NODE_VERSION=24.9.0
PNPM_VERSION=11.28.5
NODE_ARCHIVE="node-v${NODE_VERSION}-linux-x64.tar.xz"
APP_ARCHIVE=deepseek-harness-linux-x64.tar.gz
SERVICE_USER=dsh-gateway
SERVICE_HOME=/var/lib/dsh-gateway
CONFIG_DIR="$SERVICE_HOME/config"
TENANT_ROOT="$SERVICE_HOME/tenants"
UNIT=/etc/systemd/system/dsh-gateway.service

fail() {
  printf 'install-multi-user-gateway: %s\n' "$1" >&2
  exit 1
}

[[ "$(id -u)" -eq 0 ]] || fail 'run this script with sudo from Ubuntu'
[[ "$(uname -m)" == x86_64 ]] || fail 'target must be linux-x64'
[[ "$(ps -p 1 -o comm= | tr -d ' ')" == systemd ]] \
  || fail 'systemd is not PID 1; enable systemd in WSL and restart the distribution first'
command -v systemctl >/dev/null || fail 'systemctl is unavailable'
[[ -d "$DIST_DIR" ]] || fail "delivery directory not found: $DIST_DIR"
[[ -f "$SOURCE_CONFIG_DIR/gateway.json" ]] || fail "gateway configuration not found: $SOURCE_CONFIG_DIR/gateway.json"
[[ -f "$SOURCE_CONFIG_DIR/tenants.json" ]] || fail "tenant configuration not found: $SOURCE_CONFIG_DIR/tenants.json"
[[ -d "$SOURCE_TENANT_ROOT" ]] || fail "tenant data root not found: $SOURCE_TENANT_ROOT"

(
  cd "$DIST_DIR"
  sha256sum --check SHA256SUMS
)

APP_VERSION="$(<"$DIST_DIR/VERSION")"
[[ "$APP_VERSION" =~ ^[0-9A-Za-z.+-]+$ ]] || fail "invalid application version: $APP_VERSION"
NODE_DIR="/opt/node-v${NODE_VERSION}"
APP_DIR="/opt/deepseek-harness-${APP_VERSION}"
CURRENT_LINK=/opt/deepseek-harness
[[ ! -e "$NODE_DIR" ]] || fail "$NODE_DIR already exists; refusing to replace it"
[[ ! -e "$APP_DIR" ]] || fail "$APP_DIR already exists; refusing to replace it"
[[ ! -e "$CURRENT_LINK" ]] || fail "$CURRENT_LINK already exists; refusing to replace it"
[[ ! -e "$UNIT" ]] || fail "$UNIT already exists; refusing to replace it"
[[ ! -e "$SERVICE_HOME" ]] || fail "$SERVICE_HOME already exists; refusing to replace it"
! id "$SERVICE_USER" >/dev/null 2>&1 || fail "$SERVICE_USER already exists; inspect the existing installation first"

printf 'Will install customized DSH %s as the multi-user Gateway.\n' "$APP_VERSION"
printf 'Existing Gateway configuration: %s\n' "$SOURCE_CONFIG_DIR/gateway.json"
printf 'Existing tenant data: %s\n' "$SOURCE_TENANT_ROOT"
printf 'Gateway remains loopback-only on port 3000; admin remains loopback-only on port 3001.\n'
printf 'This writes /opt, %s and %s.\n' "$SERVICE_HOME" "$UNIT"
read -r -p 'Type MIGRATE-GATEWAY to continue: ' CONFIRM
[[ "$CONFIRM" == MIGRATE-GATEWAY ]] || fail 'confirmation did not match; no system changes were made'

INSTALL_COMPLETE=0
rollback_partial_install() {
  local status=$?
  if [[ "$status" -ne 0 && "$INSTALL_COMPLETE" -eq 0 ]]; then
    printf '\nInstallation failed; removing only paths created by this run...\n' >&2
    systemctl disable --now dsh-gateway >/dev/null 2>&1 || true
    rm -f -- "$UNIT" "$CURRENT_LINK"
    [[ -n "${STAGE:-}" && "${STAGE:-}" == /opt/dsh-gateway-install.* ]] && rm -rf -- "$STAGE"
    rm -rf -- "$APP_DIR" "$NODE_DIR" "$SERVICE_HOME"
    id "$SERVICE_USER" >/dev/null 2>&1 && userdel "$SERVICE_USER" >/dev/null 2>&1 || true
    systemctl daemon-reload >/dev/null 2>&1 || true
  fi
  trap - EXIT
  exit "$status"
}
trap rollback_partial_install EXIT

STAGE="$(mktemp -d /opt/dsh-gateway-install.XXXXXX)"
mkdir "$NODE_DIR"
tar -xJf "$DIST_DIR/$NODE_ARCHIVE" -C "$NODE_DIR" --strip-components=1
export PATH="$NODE_DIR/bin:$PATH"
"$NODE_DIR/bin/npm" install --global --prefix "$NODE_DIR" \
  "$DIST_DIR/pnpm-${PNPM_VERSION}.tgz" --offline --ignore-scripts
[[ "$("$NODE_DIR/bin/node" --version)" == "v${NODE_VERSION}" ]] || fail 'installed Node.js version check failed'
[[ "$("$NODE_DIR/bin/pnpm" --version)" == "$PNPM_VERSION" ]] || fail 'offline pnpm installation or version check failed'

export PATH="$NODE_DIR/bin:$PATH"

tar -xzf "$DIST_DIR/$APP_ARCHIVE" -C "$STAGE"
mv "$STAGE/deepseek-harness" "$APP_DIR"
rmdir "$STAGE"
ln -s "$APP_DIR" "$CURRENT_LINK"

useradd --system --home-dir "$SERVICE_HOME" --create-home --shell /usr/sbin/nologin "$SERVICE_USER"
install -d -o "$SERVICE_USER" -g "$SERVICE_USER" -m 0700 \
  "$CONFIG_DIR" "$TENANT_ROOT" "$SERVICE_HOME/.dsh/multi-user-tenant-logs"
install -o "$SERVICE_USER" -g "$SERVICE_USER" -m 0600 \
  "$SOURCE_CONFIG_DIR/gateway.json" "$CONFIG_DIR/gateway.json"
printf '# Add model provider credentials here, one NAME=value entry per line.\n' > "$CONFIG_DIR/gateway.env"
chown "$SERVICE_USER:$SERVICE_USER" "$CONFIG_DIR/gateway.env"
chmod 0600 "$CONFIG_DIR/gateway.env"

SOURCE_TENANTS="$SOURCE_CONFIG_DIR/tenants.json" TARGET_TENANTS="$CONFIG_DIR/tenants.json" TENANT_ROOT="$TENANT_ROOT" \
  "$NODE_DIR/bin/node" <<'NODE'
const fs = require('node:fs')
const path = require('node:path')
const source = JSON.parse(fs.readFileSync(process.env.SOURCE_TENANTS, 'utf8'))
const tenants = source.tenants.map(tenant => {
  const root = path.join(process.env.TENANT_ROOT, tenant.externalUserId)
  return { ...tenant, dshHome: path.join(root, 'home'), workspace: path.join(root, 'workspace') }
})
fs.writeFileSync(process.env.TARGET_TENANTS, `${JSON.stringify({ version: 1, tenants }, null, 2)}\n`, { mode: 0o600 })
NODE
chown "$SERVICE_USER:$SERVICE_USER" "$CONFIG_DIR/tenants.json"

# Preserve existing tenant sessions and settings, then repair Windows-only workspace paths.
tar -C "$SOURCE_TENANT_ROOT" -cf - . | tar -C "$TENANT_ROOT" -xf -
CONFIG_FILE="$CONFIG_DIR/tenants.json" TENANT_ROOT="$TENANT_ROOT" \
  "$NODE_DIR/bin/node" <<'NODE'
const fs = require('node:fs')
const path = require('node:path')
const config = JSON.parse(fs.readFileSync(process.env.CONFIG_FILE, 'utf8'))
for (const tenant of config.tenants) {
  fs.mkdirSync(tenant.dshHome, { recursive: true })
  fs.mkdirSync(tenant.workspace, { recursive: true })
  const patch = path.join(tenant.dshHome, 'profiles', 'web', 'cordis.patch.yml')
  fs.mkdirSync(path.dirname(patch), { recursive: true })
  let text = fs.existsSync(patch) ? fs.readFileSync(patch, 'utf8') : ''
  const slashRoot = `D:/DSH/runtime/tenants/${tenant.externalUserId}/workspace`
  const backslashRoot = `D:\\DSH\\runtime\\tenants\\${tenant.externalUserId}\\workspace`
  text = text.split(slashRoot).join(tenant.workspace)
  text = text.split(backslashRoot).join(tenant.workspace)
  if (!/^\s*- id: workspace-controller\s*$/mu.test(text)) {
    text += `\n- id: workspace-controller\n  config:\n    defaultWorkspacePath: ${tenant.workspace}\n`
  }
  if (!/id: directory-picker-browse/u.test(text)) {
    text += `- id: directory-picker\n  disabled: true\n- insert:\n    - id: directory-picker-browse\n      name: '@deepseek-ai/dsh-host-directory-picker-browse'\n      config:\n        root: ${JSON.stringify(tenant.workspace)}\n    - id: ui-directory-picker-browse\n      name: '@deepseek-ai/dsh-client-ui-directory-picker-browse'\n`
  }
  fs.writeFileSync(patch, text.replace(/^\n+/u, '').replace(/\n*$/u, '\n'), 'utf8')
}
NODE
chown -R "$SERVICE_USER:$SERVICE_USER" "$SERVICE_HOME"
find "$TENANT_ROOT" -type f -name .credentials.yaml -exec chmod 600 {} +
chmod 0700 "$SERVICE_HOME" "$CONFIG_DIR" "$TENANT_ROOT"
chmod 0600 "$CONFIG_DIR/gateway.json" "$CONFIG_DIR/tenants.json" "$CONFIG_DIR/gateway.env"

cd "$CURRENT_LINK"
"$NODE_DIR/bin/node" --import tsx/esm scripts/multi-user/tenant-config.ts --config "$CONFIG_DIR/tenants.json" >/dev/null
"$NODE_DIR/bin/node" --import tsx/esm --input-type=module - "$CONFIG_DIR/gateway.json" <<'NODE'
import { loadGatewayConfig, resolveGatewaySettings } from './scripts/multi-user/gateway-config.ts'
const config = await loadGatewayConfig(process.argv[2])
resolveGatewaySettings(config, process.env, {})
NODE

cat > "$UNIT" <<EOF
[Unit]
Description=DeepSeek Harness Multi-User Gateway
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_USER
WorkingDirectory=$CURRENT_LINK
Environment=HOME=$SERVICE_HOME
Environment=PATH=$NODE_DIR/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
Environment=DSH_MULTI_USER_TENANT_ROOT=$TENANT_ROOT
EnvironmentFile=-$CONFIG_DIR/gateway.env
ExecStart=$NODE_DIR/bin/node --import tsx/esm scripts/multi-user/gateway-cli.ts --config $CONFIG_DIR/tenants.json --gateway-config $CONFIG_DIR/gateway.json
Restart=on-failure
RestartSec=5
TimeoutStopSec=30
UMask=0077

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now dsh-gateway
systemctl --no-pager --full status dsh-gateway
HTTP_CODE=000
for _ in $(seq 1 120); do
  HTTP_CODE="$(curl --max-time 2 -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/ 2>/dev/null || true)"
  [[ "$HTTP_CODE" != 000 ]] && break
  sleep 1
done
[[ "$HTTP_CODE" != 000 ]] || fail 'Gateway did not start listening on 127.0.0.1:3000 within 120 seconds'
printf '\nUnauthenticated Gateway response: %s\n' "$HTTP_CODE"

cd "$CURRENT_LINK"
CONFIG_DIR="$CONFIG_DIR" "$NODE_DIR/bin/node" <<'NODE'
import fs from 'node:fs'
import http from 'node:http'
const dir = process.env.CONFIG_DIR
const gateway = JSON.parse(fs.readFileSync(`${dir}/gateway.json`, 'utf8'))
const tenants = JSON.parse(fs.readFileSync(`${dir}/tenants.json`, 'utf8')).tenants
if (tenants.length === 0) {
  process.stdout.write('Trusted tenant smoke test skipped: no static tenant exists.\n')
  process.exit(0)
}
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
const requestTenant = () => new Promise(resolve => {
  const request = http.get({
    host: '127.0.0.1', port: 3000, path: '/',
    headers: {
      'X-Auth-Request-User': tenants[0].externalUserId,
      'X-DSH-Proxy-Secret': gateway.proxySecret,
    },
  }, response => {
    response.resume()
    response.on('end', () => resolve(response.statusCode ?? 500))
  })
  request.setTimeout(10000, () => {
    request.destroy()
    resolve(0)
  })
  request.on('error', () => resolve(0))
})
let status = 0
for (let attempt = 0; attempt < 120; attempt += 1) {
  status = await requestTenant()
  if (status > 0 && status < 400) break
  await sleep(1000)
}
process.stdout.write(`Trusted tenant smoke status: ${status}\n`)
if (status === 0 || status >= 400) {
  process.stdout.write('Trusted tenant smoke did not become healthy during installation; inspect the tenant log after installation.\n')
}
NODE

printf '\nGateway config migrated without printing secrets: %s\n' "$CONFIG_DIR/gateway.json"
printf 'Tenant data migrated to: %s\n' "$TENANT_ROOT"
printf 'Add model API keys locally to %s, then restart dsh-gateway.\n' "$CONFIG_DIR/gateway.env"
printf 'Do not expose ports 3000, 3001, or tenant ports directly.\n'
