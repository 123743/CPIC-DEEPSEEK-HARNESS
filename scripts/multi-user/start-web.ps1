[CmdletBinding()]
param(
    [switch]$CheckOnly,
    [string]$NodePath = 'node',
    [string]$Config = '.local/multi-user/tenants.json',
    [string]$GatewayConfig = '.local/multi-user/gateway.json'
)

$ErrorActionPreference = 'Stop'
$repository = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
Push-Location $repository
try {
    $node = (Get-Command $NodePath -ErrorAction Stop).Source
    foreach ($artifact in @(
        'apps/cli/lib/bin.js',
        'apps/web/dist/index.html',
        'node_modules/tsx/package.json',
        'scripts/multi-user/http-doc.overlay.yml',
        'scripts/multi-user/model-provider.overlay.yml',
        'scripts/multi-user/agency-agents.overlay.yml',
        'scripts/multi-user/agent-teams.overlay.yml',
        'scripts/multi-user/agent-roles.overlay.yml',
        'scripts/multi-user/node_modules/@delthin/dsh-agent-roles/package.json',
        'scripts/multi-user/node_modules/@delthin/dsh-agent-roles/index.js',
        'scripts/multi-user/node_modules/@delthin/dsh-agent-roles/client.js',
        'scripts/multi-user/node_modules/@delthin/dsh-agent-roles/runtime.js',
        'scripts/multi-user/node_modules/@delthin/dsh-agent-roles/fallback.js',
        'scripts/multi-user/node_modules/@delthin/dsh-agent-roles/store.js',
        'scripts/multi-user/node_modules/@delthin/dsh-agent-roles/skills.js',
        'packages/team/agent-team/lib/index.js',
        'packages/team/tool-agent-team/lib/index.js',
        'packages/client/ui-agent-team/lib/index.js',
        'scripts/multi-user/node_modules/@michengai/dsh-agency-agents/package.json',
        'scripts/multi-user/node_modules/@michengai/dsh-agency-agents/lib/index.js',
        'scripts/multi-user/node_modules/@michengai/dsh-agency-agents/lib/remote.js',
        'scripts/multi-user/node_modules/@michengai/dsh-agency-agents/lib/client.js',
        'scripts/multi-user/node_modules/@nanmicoder/dsh-agent-teams/package.json',
        'scripts/multi-user/node_modules/@nanmicoder/dsh-agent-teams/lib/index.js',
        'scripts/multi-user/node_modules/@nanmicoder/dsh-agent-teams/lib/client.js',
        'packages/experimental/tool-http-doc/lib/index.js',
        'packages/experimental/client-ui-http-doc/lib/index.js',
        'packages/experimental/client-ui-http-doc/lib/client.js',
        'scripts/multi-user/cpic-requirements.overlay.yml',
        'scripts/multi-user/workflow-panel.overlay.yml',
        'extensions/cpic-requirements/package.json',
        'extensions/cpic-requirements/index.js',
        'extensions/cpic-requirements/business.js',
        'extensions/cpic-requirements/engine.js',
        'extensions/cpic-requirements/xtest-http.js',
        'extensions/cpic-requirements/methods.js',
        'extensions/cpic-requirements/mode.js',
        'scripts/multi-user/cpic-preset.js',
        'extensions/cpic-requirements/client.js'
    )) {
        if (-not (Test-Path -LiteralPath $artifact -PathType Leaf)) {
            if ($artifact -like 'scripts/multi-user/node_modules/*') {
                throw "Missing $artifact. Run pnpm --dir scripts/multi-user install --frozen-lockfile --ignore-scripts --config.auto-install-peers=false from $repository first."
            }
            throw "Missing $artifact. Restore repository overlays and run pnpm run build from $repository first."
        }
    }
    $tenantFile = (Resolve-Path -LiteralPath $Config).Path
    $gatewayFile = (Resolve-Path -LiteralPath $GatewayConfig).Path
    & $node --import tsx/esm scripts/multi-user/tenant-config.ts --config $tenantFile
    if ($LASTEXITCODE -ne 0) { throw 'Tenant configuration validation failed.' }
    & $node --import tsx/esm --input-type=module --eval "import {loadGatewayConfig,resolveGatewaySettings} from './scripts/multi-user/gateway-config.ts'; resolveGatewaySettings(await loadGatewayConfig(process.argv[1]),process.env,{}); console.log('Gateway settings: valid (secrets omitted)')" $gatewayFile
    if ($LASTEXITCODE -ne 0) { throw 'Gateway settings validation failed.' }
    $listener = @(Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue)
    if ($CheckOnly) {
        if ($listener.Count -gt 0) {
            Write-Output "Port 3000 already listens (PID $($listener[0].OwningProcess)); no process changed."
        } else {
            Write-Output 'Port 3000 has no listener.'
        }
        Write-Output "Web deployment preflight passed: $repository"
        return
    }
    if ($listener.Count -gt 0) {
        throw "Port 3000 already listens (PID $($listener[0].OwningProcess)). Stop its owning gateway before starting this entry."
    }
    Write-Output 'Starting Web gateway at http://127.0.0.1:3000; use the existing authenticated proxy entry.'
    & $node --import tsx/esm scripts/multi-user/gateway-cli.ts --config $tenantFile --gateway-config $gatewayFile
    if ($LASTEXITCODE -ne 0) { throw "Web gateway exited with code $LASTEXITCODE." }
} finally {
    Pop-Location
}
