# Static Tenant Instance Manager

English | [中文](README.zh.md)

This directory defines the external-user-to-DSH-resource mapping and local process lifecycle manager. The manager starts the repository-built `dsh web`, waits for its authenticated readiness URL, reports state, and stops owned processes before it exits. It does not authenticate users, proxy HTTP, or reclaim idle instances.

## Configuration File

The committed `scripts/multi-user/tenants.example.json` demonstrates the format. Capability plugin IDs are deployment-specific and are not accepted unless the launcher registers them. Local deployments use this Git-ignored file:

```text
.local/multi-user/tenants.json
```

Copy the example, then edit its paths:

```powershell
New-Item -ItemType Directory -Force .local\multi-user | Out-Null
Copy-Item scripts\multi-user\tenants.example.json .local\multi-user\tenants.json
```

Each tenant binds these fixed values:

- `tenantId`: Stable internal ID for lifecycle state and logs; accepts lowercase letters, digits, and hyphens.
- `externalUserId`: User ID supplied by the external authentication service.
- `port`: Loopback port from `1024` through `65535`.
- `dshHome`: Absolute `DSH_HOME` path for this tenant's DSH state.
- `workspace`: Absolute process working directory for this tenant.
- `capabilities`: Optional list of built-in capabilities: `team`, `ptc`, or `apply-patch`.
- `plugins`: Optional list of capability plugin IDs registered by the launcher. The launcher resolves each ID to an overlay and performs its artifact preflight before starting the tenant process. Plugins must use process or workspace isolation; host-scoped plugins are rejected because they cannot preserve tenant isolation.

The gateway, static registry, and one-process-per-tenant lifecycle remain outside the plugin contract. A capability plugin adds tenant-local behavior; it does not authenticate users, route requests, share storage, or change the process boundary. Computer Use is not available through the shared-host tenant manager because its native and MCP providers can access the host desktop outside a tenant workspace.

Tenant IDs, external user IDs, ports, `dshHome` paths, and `workspace` paths must each be unique. The loader rejects relative paths, duplicate values, unknown fields, invalid capabilities, and a record whose `dshHome` equals its `workspace`. An empty tenant list is valid before automatic provisioning.

Capabilities are applied through fixed repository overlays. Native Team tools and the Web roster/task board are included with Agent Roles by default, so `team` is accepted without another overlay. PTC selects PTC execution for the tenant's configured agent preset; `apply-patch` adds the patch tool beside edit. PTC and `apply-patch` remain disabled unless listed for the tenant. Computer Use is excluded because both providers share host desktop access and cannot be isolated by tenant workspaces.

MCP servers are not declared in this registry. Configure them in the tenant's own `$DSH_HOME/profiles/web/cordis.patch.yml`; the gateway does not read, copy, or share MCP commands, cookies, API keys, or other credentials between tenants. Keep MCP configuration and any server-owned storage inside that tenant's home or workspace.

## Default community plugins

Every tenant launch mounts [agency-agents.overlay.yml](agency-agents.overlay.yml), [agent-teams.overlay.yml](agent-teams.overlay.yml), and [agent-roles.overlay.yml](agent-roles.overlay.yml), including existing tenants and automatic provisioning. These load the published Agency Agents package and its top-level Remote service, `@nanmicoder/dsh-agent-teams`, and Delthin's Agent Roles plugin. The roles plugin uses the repository's native Agent Team provider, enabled by its overlay; it does not install a second Harness. Native Team services are loaded once by default; an existing `team` capability remains accepted without mounting a duplicate provider. Loading Agency does not enable all specialists; tenants manage their own expert and role selections.

Install the pinned dependencies from [package.json](package.json) and [pnpm-lock.yaml](pnpm-lock.yaml) before starting the gateway or interactive manager. Agent Roles is pinned to `@delthin/dsh-agent-roles@0.6.1` from the maintained [dsh-plugins repository](https://github.com/Delthin/dsh-plugins/tree/main/packages/agent-roles). Its declared DSH minimum is `0.2.2-rc.3`; its patch updates the existing `agent-team.defaultEnabled` setting and uses the current subagent APIs. The base/Web profiles supply native Team services and UI, so the role overlay inserts only Agent Roles. Agency `1.2.34` and community AgentTeams `0.1.30` remain pinned candidates; their combined runtime behavior on this checkout still requires deployment validation.

```powershell
pnpm --dir scripts/multi-user install --frozen-lockfile --ignore-scripts --config.auto-install-peers=false
```

This separate dependency installation stays under this workspace and disables automatic peer installation; the running repository-built profile supplies Harness services. Neither the locally installed GUI/Harness nor tenant profile files are modified. Overlays resolve plugin entries relative to this directory, not tenant cwd. Missing plugin manifests, Host/Remote entries, or client bundles stop launch with an installation diagnostic. Missing native Team artifacts under `packages/team` or `packages/client/ui-agent-team` instead require `pnpm run build`; installing third-party packages cannot supply these workspace artifacts. Tenant processes set both `DSH_HOME` and `DSH_AGENTS_HOME` to the tenant home; community AgentTeams stores state under `.agent-teams` in the session workspace, and Agent Roles stores its catalog and run records under the tenant home's `agent-roles` directory. Restart the gateway and its owned tenant processes to apply these defaults. Verify deployment compatibility with the repository-built tenant runtime before production use; launcher tests do not exercise community plugin internals.

[host-peers.json](host-peers.json) records the canonical workspace packages linked by the independent manifest. The Host import audit covers Roles' five local modules, Agency's Host/Remote entries and shared chunk, and AgentTeams' twenty reachable Host modules, including dynamic native-executor imports. Cordis and all eight Roles peers are linked explicitly; Agency additionally needs Session, System Prompt and Typert Protocol, and AgentTeams needs Subagent. Browser-only peers (`react`, client UI/connection/locale packages) remain supplied by the Web module loader and are not installed as another Host runtime. The `zod` dependency belongs to Agency. These links make direct external overlay entries resolvable without profile-linked-root interception.

Run `node scripts/multi-user/verify-host-peers.mjs` after the repository build. It resolves every shared peer from each plugin's real entry and the built CLI and compares canonical filesystem paths without loading plugins or starting a server. It reports missing links, missing Host build artifacts, unresolved peers and duplicate runtimes separately. Run `node --test scripts/multi-user/host-peers.test.mjs` for its failure diagnostics. These checks do not establish plugin service/API compatibility or browser behavior; full composition validation remains required.

## Validate Configuration

Run this command from the repository root:

```powershell
pnpm run multi-user:validate
```

Pass another file when required:

```powershell
pnpm run multi-user:validate -- --config .local/multi-user/tenants.json
```

Success prints the non-secret routing fields. Do not store model API keys, Session cookies, or other credentials in this configuration.

## Linux Web Deployment

On the Linux host, clone this repository, install dependencies with `pnpm install --frozen-lockfile`, and build DSH with `pnpm run build`. Tenant profiles mount the gateway's HTTP, requirements, workflow, and Skills-management overlays from repository paths; no sibling checkout or Windows drive path is required.

Create `.local/multi-user/tenants.json` and `.local/multi-user/gateway.json` using the examples above, with absolute Linux paths for each tenant's `dshHome` and `workspace`. Start the gateway from the repository root with `pnpm run multi-user:gateway`; the same tenant process preflight and loopback-only gateway behavior apply. Put the trusted authentication reverse proxy in front of `127.0.0.1:3000`; do not expose that listener directly.

<a id="windows-web-deployment"></a>
## Windows Web Deployment

After building, [start-web.ps1](start-web.ps1) validates the built CLI, Web index, tenant registry, and gateway settings from the repository root, regardless of the caller's working directory. It prints no gateway secrets. Inspect without starting or stopping a process:

```powershell
.\scripts\multi-user\start-web.ps1 -CheckOnly -NodePath D:\local\nodejs\node.exe
```

Omit `-CheckOnly` to run the gateway in the foreground after the existing gateway has stopped. `-NodePath` defaults to `node`; `-Config` and `-GatewayConfig` select alternate files. An occupied port 3000 stops startup instead of replacing its owner. Continue to use the existing authenticated proxy entry; a direct browser visit to port 3000 has no trusted identity.

Newly provisioned profiles explicitly mount the in-page directory browser, confined to the tenant workspace, and disable automatic native-picker selection. Existing profile patches remain unchanged; review them separately before adopting these defaults. The browse fence constrains directory-picker navigation, not all tool filesystem access.

The local manager and gateway pass [http-doc.overlay.yml](http-doc.overlay.yml), [cpic-requirements.overlay.yml](cpic-requirements.overlay.yml), [workflow-panel.overlay.yml](workflow-panel.overlay.yml), [skill-management.overlay.yml](skill-management.overlay.yml), and [model-provider.overlay.yml](model-provider.overlay.yml) to every tenant launch through absolute `--patch` paths. They mount the optional HTTP tool/panel, the [CPICHarness requirement workbench](../../extensions/cpic-requirements/README.md), its case-design preset, the repository's official workflow engine/tool for that preset, and the read-only [workflow run panel](../../extensions/dsh-workflow-panel/README.md) over the community workflow plugin's run store, for existing and newly provisioned tenants without changing tenant profiles or shipped bundles. The requirements root and first-use default workspace are each tenant process's workspace. The overlay sets `workspace-controller.defaultWorkspacePath` explicitly, avoiding the operating system's shared Documents default. Existing default workspace registrations remain unchanged; this policy does not migrate, delete or relabel stored workspaces or Session data. The source preset resolves its worker by absolute file URL and completes preset registration before the tenant process advertises readiness. Build both optional HTTP packages and retain the requirement extension source before startup; preflight rejects missing artifacts and an Agent preset registry build without `definition(id)`. The requirements preflight list in [instance-manager.ts](instance-manager.ts) checks the extension entry files together with `pipeline.yaml`, `pipeline.js`, `roles.js`, `role.js`, and the six role `SKILL.md` procedure files. Rebuild Host libraries when that registry check fails. Restart the gateway and its owned tenant processes to adopt a changed launcher; refreshing the browser alone does not replace a running process. This launch integration does not install anything into the separately running desktop Harness.

The workflow list offers **Show run graph** at the end of each run row. Expanding it loads that run's graph in place; multiple previews can stay open while workspace and session grouping remain visible. Refresh reloads open previews. A failed preview keeps the list and any previously loaded graph visible and offers Retry. Older runs show recorded process items, or an empty state when neither graph nor items exist. Closing a preview or leaving the list cancels its pending read. This view uses the existing tenant-authenticated detail endpoint and does not execute workflows. Run `node --test scripts/multi-user/workflow-panel.test.js extensions/dsh-workflow-panel/tests/client.test.js` from the repository root to verify list previews and panel behavior.

Case-design traceability analysis checks IDs and references in committed requirement, feature, scenario, and test-case JSON and retains counts and bidirectional checks. Its directed graph shows every committed item and one arrow between each adjacent stage pair; uncommitted stages produce no nodes or arrows. The authenticated workflow panel renders this graph, and analysis remains read-only.

The gateway records each tenant process generation's stdout and stderr in `~/.dsh/multi-user-tenant-logs/<tenantId>-generation-<n>.log` (`C:\\Users\\<user>\\.dsh\\multi-user-tenant-logs` on Windows). The gateway omits the authenticated readiness URL and redacts common token, password and secret assignments. Logs may still contain operational data; restrict access to the gateway user's home directory and review them before sharing. A log-write failure is kept in the manager's bounded in-memory diagnostics and does not stop the tenant.

The gateway supplies CPIC-oa with an XTEST internal API root and secret. Set `cpicApiUrl` to the XTEST API root ending in `/api/dsh/internal/cpic` and set `cpicApiSecret` to the matching server-only secret. The gateway passes them to tenant processes as `CPIC_GATEWAY_CPIC_URL` and `CPIC_GATEWAY_CPIC_SECRET`; `CPIC_GATEWAY_USER` and `CPIC_GATEWAY_TENANT_ID` come from the server-side tenant registry. The CPIC adapter sends these values only in server-to-server headers. Use HTTPS for non-loopback XTEST endpoints. The browser cannot select the user or tenant and never receives the API URL or secret. XTEST authorizes assigned projects and owns the existing tenant-scoped `cpic_qa_*` records. No automatic migration runs; do not delete the local `.local/multi-user/requirements-db.json` file as part of startup cleanup because it is operator-owned local data. Restart owned tenant processes after changing settings.

## Manage Instances

Build DSH before the first run, then start the interactive manager from the repository root:

```powershell
pnpm run build
pnpm run multi-user:manage
```

The manager accepts these commands:

```text
list
start tenant-user1
status tenant-user1
stop tenant-user1
exit
```

`start` launches one process with the configured workspace as cwd, sets its `DSH_HOME`, binds its fixed port to `127.0.0.1`, and waits up to 60 seconds for the complete `dsh web:` readiness line. Concurrent starts for the same tenant join one startup. The returned `authenticatedUrl` is a process credential and must not be logged or shared with another user.

`stop` sends one `SIGTERM`, waits 15 seconds, then sends `SIGKILL` only if the process remains alive. `exit`, `Ctrl+C`, and `SIGTERM` stop every process owned by that manager before it exits. Process state exists only in the running manager; restarting the manager does not adopt DSH processes launched elsewhere.

The manager removes ambient environment variables whose names contain `KEY`, `SECRET`, `TOKEN`, or `PASSWORD` before launching DSH, then adds the assigned `DSH_HOME` and permission mode. Tenant credentials remain available through files in that tenant's DSH home.

## Run the Trusted-Header Gateway

The gateway reads its deployment settings from one Git-ignored file beside the tenant registry:

```text
.local/multi-user/gateway.json
```

Copy the committed example, then replace every placeholder secret in the copy:

```powershell
New-Item -ItemType Directory -Force .local\multi-user | Out-Null
Copy-Item scripts\multi-user\gateway.example.json .local\multi-user\gateway.json
```

Generate the shared secret that the front proxy sends, and paste the result into `proxySecret`:

```powershell
$secretBytes = New-Object byte[] 32
$random = [Security.Cryptography.RandomNumberGenerator]::Create()
try { $random.GetBytes($secretBytes) } finally { $random.Dispose() }
[Convert]::ToBase64String($secretBytes)
```

The settings file pins these values:

- `openAiChatCompletionsUrl` and `openAiModelId`: Complete OpenAI-compatible Chat Completions URL and the manual model id. The service does not need a models-list endpoint.
- `proxySecret`: Shared secret the trusted reverse proxy sends in `X-DSH-Proxy-Secret`; at least 32 UTF-8 bytes.
- `ticketResolverUrl`: HTTP or HTTPS Xtest2 endpoint that atomically consumes a jump ticket. Use HTTPS for the external XTEST base URL, or HTTP only for an operator-controlled internal route. HTTPS uses the Node.js trust store and does not disable certificate validation.
- `ticketResolverSecret`: Secret sent only from the gateway to that endpoint; at least 32 UTF-8 bytes. Configure it together with `ticketResolverUrl`, and give Xtest2 the same value as `DSH_GATEWAY_INTERNAL_SECRET`.
- `sessionCookieName`: Name of the private gateway session Cookie.
- `sessionTtlMs`: Session lifetime in milliseconds.
- `idleTimeoutMs`: Milliseconds without active traffic before the gateway stops a tenant; zero disables reclamation.

Model credentials remain outside the JSON file. Set `DSH_MULTI_USER_OPENAI_MODEL_API_KEY` to the OpenAI-compatible Bearer key to mount the deployment overlay after scrubbing ambient secrets. When it is absent, no model overlay is mounted and each tenant can create the route from the Models settings page, where credentials are stored in that tenant's credential store. The added route is an optional selection; the standard DeepSeek route remains the default.

Gateway control fields also accept an environment variable or a command-line override, and a value closer to the gateway process wins: command-line flag (`--ticket-resolver-url`, `--session-cookie-name`, `--session-ttl-ms`, `--idle-timeout-ms`), then environment variable (`DSH_MULTI_USER_PROXY_SECRET`, `DSH_TICKET_RESOLVER_URL`, `DSH_TICKET_RESOLVER_SECRET`, `DSH_GATEWAY_SESSION_COOKIE_NAME`, `DSH_GATEWAY_SESSION_TTL_MS`), then settings file. `--gateway-config <path>` reads another file. The example keeps its placeholder secrets below 32 UTF-8 bytes, so an unchanged copy fails validation instead of starting with a published secret.

The settings file configures the browser-facing listener (`host`, `port`), new-tenant port allocation (`tenantPortMin`, `tenantPortMax`), and the private management listener (`adminHost`, `adminPort`, `adminSecret`). The management listener starts only when `adminSecret` is configured and must use a dedicated secret of at least 32 UTF-8 bytes. Its default address is `127.0.0.1:3001`; bind a private network address only when Xtest2 can reach it over a trusted network or HTTPS proxy. Never expose this listener to browsers or the public Internet.

Xtest2 can call the management API using `X-DSH-Gateway-Admin-Secret`:

```text
GET  /internal/admin/config
PUT  /internal/admin/config
POST /internal/admin/restart
```

The `GET` response omits secrets. The `PUT` body accepts only `host`, `port`, `tenantPortMin`, and `tenantPortMax`; Gateway validates the full range, atomically saves the settings file, and rebinds the browser-facing listener before returning success. Existing tenant ports do not change; the new range applies to future tenant creation. Rebinding closes active browser-facing connections. If the new address cannot bind, Gateway attempts to restore the previous listener and settings. `POST /internal/admin/restart` rebinds the current listener settings without restarting the Node process or stopping tenant instances. These endpoints do not provide process execution or tenant process control.

Then start the gateway from the repository root:

```powershell
node --import tsx/esm scripts/multi-user/gateway-cli.ts
```

The gateway listens on the configured `host` and `port`, defaulting to `127.0.0.1:3000`. Set `DSH_GATEWAY_PUBLIC_URL` to the HTTP(S) root browsers use, such as `http://29.149.65.178:3000`; the Gateway passes that URL and its authority to each tenant as `--public-url` and `--trusted-host`. The default is `http://127.0.0.1:3000`. Restart the Gateway and its running tenant processes after changing this value; a tenant started with another authority rejects browser `/api/*` requests with HTTP 403.

Its trusted authentication proxy must preserve the browser-facing `Host`, remove any client-supplied `X-Auth-Request-User` and `X-DSH-Proxy-Secret` headers, then set both headers itself. The identity value must exactly equal one configured `externalUserId`, and the secret must equal the configured `proxySecret`. Do not expose the browser-facing port directly to untrusted local users or containers.

Test one request without a front proxy:

```powershell
$settings = Get-Content .local\multi-user\gateway.json | ConvertFrom-Json
$headers = @{
  'X-Auth-Request-User' = 'user1'
  'X-DSH-Proxy-Secret' = $settings.proxySecret
}
Invoke-WebRequest http://127.0.0.1:3000/ -Headers $headers
```

The first request starts the assigned DSH process and waits for readiness. The gateway exchanges the process token for a private, authority-bound DSH Cookie and never forwards that token, the Cookie, the trusted identity headers, or a backend `Set-Cookie` to the browser. HTTP bodies, streaming SSE responses, and WebSocket upgrades use the same tenant route. The gateway forwards request and response bodies without inspecting or redacting credential-looking text; browser masking changes only rendered Chat text.

The gateway reclaims a tenant after 15 minutes with no active HTTP request, SSE stream, or WebSocket connection. Set `idleTimeoutMs` in the settings file, or override it for one run:

```powershell
node --import tsx/esm scripts/multi-user/gateway-cli.ts --idle-timeout-ms 60000
node --import tsx/esm scripts/multi-user/gateway-cli.ts --idle-timeout-ms 0
```

A browser cannot set these trusted headers by itself. Place an authentication reverse proxy in front of this listener for browser use. Process and private Cookie state remain in memory, idle reclamation removes the stopped generation's private Cookies, and gateway shutdown waits for an in-progress reclaim before stopping every owned instance. The gateway does not adopt processes from an earlier run.

## Troubleshoot a Production Linux Deployment

Use this section after the Gateway and DSH artifacts have been deployed to the production host. Treat the running systemd user service and process metadata as the source of truth because the production service may use a different checkout, build artifact, working directory, or environment file than an interactive shell. Do not recursively search the complete deployment directory or `node_modules`; interrupt a long `grep -R` with `Ctrl+C`, then inspect the exact files named by the service and process.

```bash
GATEWAY_PID=$(systemctl --user show dsh-gateway.service -p MainPID --value)
systemctl --user show dsh-gateway.service -p ExecStart -p WorkingDirectory --no-pager
tr '\0' '\n' < "/proc/$GATEWAY_PID/cmdline"
readlink -f "/proc/$GATEWAY_PID/cwd"
```

### Xtest2 ticket validation reports invalid JSON or HTTPS failure

The gateway accepts HTTP and HTTPS ticket resolver URLs. It reports a non-200 response before attempting JSON parsing, so an invalid-JSON report for a current build means Xtest2 returned HTTP 200 with a body that is not valid JSON. Check the exact resolver URL from the service environment or gateway settings, then test TLS without using an ambient proxy:

```bash
curl --noproxy '*' -v "$DSH_TICKET_RESOLVER_URL"
```

For a private or self-signed Xtest2 CA, save the issuing certificate chain in a file readable by the gateway service and set `NODE_EXTRA_CA_CERTS` to its absolute path in the service's `EnvironmentFile`. Confirm the file path first instead of assuming one:

```bash
systemctl --user cat dsh-gateway.service
```

For example, when the unit declares `EnvironmentFile=/home/dcos/dsh-gateway/config/gateway.env`, add this line to that file, then restart the gateway:

```dotenv
NODE_EXTRA_CA_CERTS=/home/dcos/dsh-gateway/config/xtest-ca.pem
```

```bash
systemctl --user daemon-reload
systemctl --user restart dsh-gateway.service
```

The certificate must contain the resolver host or IP in its Subject Alternative Name. Do not set `NODE_TLS_REJECT_UNAUTHORIZED=0` and do not add `rejectUnauthorized: false`; either setting disables server identity verification. `NODE_EXTRA_CA_CERTS` changes only the gateway's outbound HTTPS trust and does not affect browser API authorization.

### Xtest2 entry succeeds but browser `/api/*` requests return 403

Set `DSH_GATEWAY_PUBLIC_URL` in the service's `EnvironmentFile` to the browser-visible gateway root, including its real scheme, host, and port. For example:

```dotenv
DSH_GATEWAY_PUBLIC_URL=http://29.149.65.178:3000
```

```bash
systemctl --user daemon-reload
systemctl --user restart dsh-gateway.service
```

Enter again through Xtest2 so the gateway starts a new tenant generation. Inspect that tenant process directly; its arguments must retain the loopback bind and include the browser authority:

```text
--host 127.0.0.1
--public-url http://29.149.65.178:3000
--trusted-host 29.149.65.178:3000
```

Do not bind a tenant to the public IP. The gateway proxies to the tenant's loopback port, and a public tenant bind bypasses the intended isolation.

### Plugins → Skills cannot load

The Skills browser callback, Host implementation, and generated Remote descriptors must use the same `list(request, signal)` signature. Rebuild `@deepseek-ai/dsh-api-session-controller` and `@deepseek-ai/dsh-client-ui-settings-skill-management` together, restart the affected tenant process, and refresh the browser. Run `node scripts/multi-user/verify-resource-artifacts.mjs` to verify that the built Skills page sends the required request object, including the selected preset when supplied. Skills Remote failures can arrive as successful HTTP responses containing `result.ok: false`; inspect the Remote response rather than only failed HTTP requests.

### A new user cannot close the preview notice or create the default Workspace

These two symptoms indicate an incomplete deployment or invalid tenant profile. The multi-user integration requires both the Host implementation of `workspace-controller.defaultWorkspacePath` and the Web Client implementation of `ui-settings-models.welcomeNotice`. Build and deploy the complete Host and Web artifacts together, then restart the gateway and its owned tenant processes; a browser refresh does not replace a running tenant.

Find the tenant child PID without scanning the deployment tree, then inspect its actual home, cwd, profile patch, and permissions:

```bash
pgrep -P "$GATEWAY_PID" -af
TENANT_PID=<tenant-process-pid>
DSH_HOME=$(tr '\0' '\n' < "/proc/$TENANT_PID/environ" | sed -n 's/^DSH_HOME=//p')
TENANT_CWD=$(readlink -f "/proc/$TENANT_PID/cwd")
printf 'DSH_HOME=%s\nTENANT_CWD=%s\n' "$DSH_HOME" "$TENANT_CWD"
sed -n '1,120p' "$DSH_HOME/profiles/web/cordis.patch.yml"
namei -l "$DSH_HOME/profiles/web/cordis.patch.yml"
test -w "$DSH_HOME/profiles/web/cordis.patch.yml" && echo 'profile patch writable' || echo 'profile patch NOT writable'
test -w "$TENANT_CWD" && echo 'workspace writable' || echo 'workspace NOT writable'
```

A multi-user tenant profile needs these effective rows, with the configured tenant workspace as an absolute path:

```yaml
- id: ui-settings-models
  config:
    welcomeNotice: false
- id: workspace-controller
  config:
    defaultWorkspacePath: /absolute/tenant/workspace
```

Automatic provisioning creates this profile patch only when the file does not exist; it preserves an existing operator-managed patch. Back up and update older tenant patches explicitly without deleting unrelated custom rows. Ensure the gateway service account owns or can write the tenant `dshHome` and workspace directories. Rebuild, restart the gateway, enter again through Xtest2, and verify that the new tenant process uses the expected `DSH_HOME`, cwd, public URL, and trusted host before testing the UI.

## Provision Tenants Through Xtest2

With the Xtest2 integration, the gateway also exposes a protected tenant-creation endpoint:

```text
POST /internal/tenants/provision
X-DSH-Tenant-Provision-Secret: <DSH_GATEWAY_INTERNAL_SECRET>
Content-Type: application/json

{"externalUserId":"user3","tenantId":"tenant-user3"}
```

The gateway checks `tenants.json` for that user. An existing user gets its `home` and `workspace` directories re-created and keeps its port. A new user gets directories under `D:\DSH\runtime\tenants\<externalUserId>`, an unused port from the configured `tenantPortMin` through `tenantPortMax`, an updated `tenants.json`, and immediate registration with the running gateway.

When `/entry?ticket=...` receives a ticket that Xtest2 accepts, the gateway automatically provisions a missing tenant using the returned user and tenant IDs before issuing a browser session. Ticket entry and the internal provisioning endpoint serialize configuration writes within this gateway process. Invalid or expired tickets and invalid access paths do not create tenants. A non-200 Xtest2 response reports its HTTP status; an accepted HTTP response that cannot be parsed reports invalid JSON. Provisioning failures do not issue a session; the response identifies disabled provisioning, invalid identifiers, tenant conflicts, exhausted ports, insufficient permissions, or disk exhaustion when known. Unexpected failures are logged by the gateway for administrator diagnosis. After correcting a failure, generate a new ticket from Xtest2.

This endpoint requires `ticketResolverUrl` and `ticketResolverSecret` in the gateway settings, and Xtest2's `DSH_GATEWAY_INTERNAL_SECRET` must equal `ticketResolverSecret`. The endpoint listens only on the gateway's internal address and must not be exposed to untrusted clients.
