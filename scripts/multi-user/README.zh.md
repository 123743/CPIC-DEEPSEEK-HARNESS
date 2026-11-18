# 静态租户实例管理器

[English](README.md) | 中文

本目录定义外部用户到 DSH 资源的映射和本地进程生命周期管理器。管理器启动仓库已构建的 `dsh web`，等待其带认证信息的 readiness URL，报告状态，并在退出前停止自己拥有的进程。它不负责用户认证、HTTP 代理或空闲实例回收。

## 配置文件

提交的 `scripts/multi-user/tenants.example.json` 展示配置格式。能力插件 ID 由部署方定义，只有启动器注册过的 ID 才会被接受。本机部署使用这个被 Git 忽略的文件：

```text
.local/multi-user/tenants.json
```

复制示例，然后修改其中的路径：

```powershell
New-Item -ItemType Directory -Force .local\multi-user | Out-Null
Copy-Item scripts\multi-user\tenants.example.json .local\multi-user\tenants.json
```

每个租户固定绑定以下值：

- `tenantId`：生命周期状态和日志使用的稳定内部 ID，只接受小写字母、数字和连字符。
- `externalUserId`：外部认证服务提供的用户 ID。
- `port`：`1024` 到 `65535` 范围内的 loopback 端口。
- `dshHome`：该租户 DSH 状态使用的绝对 `DSH_HOME` 路径。
- `workspace`：该租户的绝对进程工作目录。
- `capabilities`：可选的内置能力列表，只能包含 `team`、`ptc` 或 `apply-patch`。
- `plugins`：可选的能力插件 ID 列表，ID 必须由启动器注册。启动器会将每个 ID 解析为 overlay，并在启动租户进程前检查所需文件。插件必须采用进程或工作区隔离；宿主级插件会被拒绝，因为它们无法维持租户隔离。

网关、静态注册表和每租户一个进程的生命周期仍位于插件契约之外。能力插件只添加租户本地行为，不负责用户认证、请求路由、共享存储或改变进程边界。共享主机租户管理器不提供 Computer Use，因为 native 和 MCP provider 可访问租户工作区之外的宿主桌面。

租户 ID、外部用户 ID、端口、`dshHome` 路径和 `workspace` 路径必须分别唯一。加载器会拒绝相对路径、重复值、未知字段、无效能力以及 `dshHome` 与 `workspace` 相同的记录。自动创建租户前，空租户列表是有效配置。

能力通过仓库内固定 overlay 启用。Agent Roles 默认包含原生 Team 工具及 Web 成员/任务面板，因此接受 `team` 配置但不再挂载另一份 overlay。PTC 会为租户配置的 Agent preset 启用 PTC 执行；`apply-patch` 会在 edit 旁增加补丁工具。PTC 与 `apply-patch` 仍仅对列出能力的租户启用。Computer Use 被排除，因为两个 provider 共享宿主桌面访问，无法通过租户工作区隔离。

MCP 服务器不写入此注册表。请在租户自己的 `$DSH_HOME/profiles/web/cordis.patch.yml` 中配置；gateway 不读取、复制或跨租户共享 MCP 命令、Cookie、API Key 或其他凭据。MCP 配置及服务器数据应保存在对应租户 home 或 workspace 中。

## 默认社区插件

每次启动租户时，都会挂载 [agency-agents.overlay.yml](agency-agents.overlay.yml)、[agent-teams.overlay.yml](agent-teams.overlay.yml) 和 [agent-roles.overlay.yml](agent-roles.overlay.yml)，覆盖已有租户和自动创建的租户。它们加载已发布的 Agency Agents 包及其顶层 Remote 服务、`@nanmicoder/dsh-agent-teams` 和 Delthin 的 Agent Roles 插件。角色插件使用仓库自带的原生 Agent Team provider，由其 overlay 启用；不会安装另一套 Harness。原生 Team 服务默认加载一次；已有 `team` 能力配置仍被接受，不重复挂载 provider。加载 Agency 不代表启用全部专家；各租户自行管理专家与角色选择。

启动网关或交互式管理器前，先安装 [package.json](package.json) 与 [pnpm-lock.yaml](pnpm-lock.yaml) 固定的依赖。Agent Roles 固定为维护中的 [dsh-plugins 仓库](https://github.com/Delthin/dsh-plugins/tree/main/packages/agent-roles) 发布的 `@delthin/dsh-agent-roles@0.6.1`。其声明的最低 DSH 版本为 `0.2.2-rc.3`；补丁更新已有的 `agent-team.defaultEnabled` 设置，代码使用当前 subagent API。Base/Web profile 提供原生 Team 服务与 UI，因此角色 overlay 仅插入 Agent Roles。Agency `1.2.34` 与社区 AgentTeams `0.1.30` 保持为固定版本候选；它们在当前 checkout 的组合运行行为仍须部署验证。

```powershell
pnpm --dir scripts/multi-user install --frozen-lockfile --ignore-scripts --config.auto-install-peers=false
```

此独立依赖安装限定在本工作区，并禁用自动安装 peer 依赖；Harness 服务由运行中的仓库构建 profile 提供。不修改本地安装的 GUI/Harness 或租户 profile 文件。Overlay 相对此目录解析插件入口，不依赖租户 cwd。缺失插件清单、Host/Remote 入口或客户端 bundle 时，会停止启动并提示安装依赖。缺失 `packages/team` 或 `packages/client/ui-agent-team` 下的原生 Team 产物时，则须运行 `pnpm run build`；安装第三方包不能提供这些工作区产物。租户进程将 `DSH_HOME` 与 `DSH_AGENTS_HOME` 均设为租户 home；社区 AgentTeams 在会话工作区的 `.agent-teams` 下保存状态；Agent Roles 在租户 home 的 `agent-roles` 目录保存角色目录和运行记录。重新启动网关及其拥有的租户进程后应用这些默认插件。生产使用前须通过仓库构建的租户运行时验证部署兼容性；启动器测试不执行社区插件内部逻辑。

[host-peers.json](host-peers.json) 记录独立清单链接的工作区标准包目录。Host 导入审计覆盖 Roles 的五个本地模块、Agency 的 Host/Remote 入口及共享 chunk，以及 AgentTeams 的二十个可达 Host 模块，包括动态 native-executor 导入。Cordis 与 Roles 全部八项 peer 均显式链接；Agency 额外需要 Session、System Prompt 与 Typert Protocol，AgentTeams 需要 Subagent。仅浏览器使用的 peer（`react`、client UI/connection/locale 包）仍由 Web 模块加载器提供，不作为另一套 Host 运行时安装。`zod` 由 Agency 自身声明。这些链接使外部 overlay 的直接入口无需 profile linked-root 拦截即可解析依赖。

仓库构建后运行 `node scripts/multi-user/verify-host-peers.mjs`。它从各插件真实入口及构建后的 CLI 解析每个共享 peer，比较标准文件系统路径，不加载插件或启动服务器；分别报告缺失链接、缺失 Host 构建产物、无法解析的 peer 与重复运行时。运行 `node --test scripts/multi-user/host-peers.test.mjs` 检查失败诊断。这些检查不证明插件服务/API 兼容性或浏览器行为，仍须完整装配验证。

## 验证配置

在仓库根目录执行：

```powershell
pnpm run multi-user:validate
```

需要时可以指定其他文件：

```powershell
pnpm run multi-user:validate -- --config .local/multi-user/tenants.json
```

成功时输出非敏感路由字段。不要在该配置中保存模型 API Key、Session Cookie 或其他凭据。

## Linux Web 部署

在 Linux 主机上克隆本仓库，执行 `pnpm install --frozen-lockfile` 安装依赖，再运行 `pnpm run build` 构建 DSH。租户 profile 从仓库路径挂载 gateway 的 HTTP、需求和 workflow overlays。不需要兄弟目录 checkout 或 Windows 盘符路径。

参照上文示例创建 `.local/multi-user/tenants.json` 与 `.local/multi-user/gateway.json`，并为每个租户的 `dshHome` 和 `workspace` 配置 Linux 绝对路径。在仓库根目录运行 `pnpm run multi-user:gateway`；租户进程预检和仅监听 loopback 的网关行为相同。请在 `127.0.0.1:3000` 前配置可信认证反向代理，不要直接暴露该监听端口。

<a id="windows-web-deployment"></a>
## Windows Web 部署

构建后，[start-web.ps1](start-web.ps1) 会从仓库根目录校验已构建 CLI、Web 首页、租户注册表与网关设置，不受调用者工作目录影响。脚本不会打印网关密钥。只检查、不启停进程：

```powershell
.\scripts\multi-user\start-web.ps1 -CheckOnly -NodePath D:\local\nodejs\node.exe
```

现有网关停止后，去掉 `-CheckOnly` 即可前台运行网关。`-NodePath` 默认为 `node`；`-Config` 和 `-GatewayConfig` 可选择其他配置文件。3000 端口已占用时会停止启动，不替换已有进程。浏览器继续使用现有认证代理入口；直接访问 3000 端口没有可信身份。

新创建的 profile 明确挂载页面内目录浏览器，将浏览范围限定到租户 workspace，并禁用自动原生目录选择器。已有 profile 补丁保持不变，采用这些默认值前需单独检查。浏览范围限制只约束目录选择器导航，不约束全部工具的文件系统访问。

本地管理器与网关在启动每个租户时，通过绝对路径的 `--patch` 传入 [http-doc.overlay.yml](http-doc.overlay.yml)、[cpic-requirements.overlay.yml](cpic-requirements.overlay.yml)、[workflow-panel.overlay.yml](workflow-panel.overlay.yml)、[skill-management.overlay.yml](skill-management.overlay.yml) 和 [model-provider.overlay.yml](model-provider.overlay.yml)。它们为现有和新建租户挂载可选 HTTP 工具/面板、[CPICHarness 需求工作台](../../extensions/cpic-requirements/README.zh.md)、案例设计模式、该模式使用的仓库官方 workflow 引擎和工具，以及读取社区 workflow 插件运行存储的只读[运行面板](../../extensions/dsh-workflow-panel/README.zh.md)，不修改租户 profile 或发行 bundle。需求根目录与首次默认工作区均固定为每个租户进程的工作区。补丁显式设置 `workspace-controller.defaultWorkspacePath`，避免使用操作系统共享的 Documents 默认目录。已有默认工作区关联保持不变；该策略不会迁移、删除或重新标记已保存的工作区和会话数据。源码 preset 以绝对文件 URL 定位工作模块，并在租户进程报告就绪前完成 preset 注册。启动前须构建两个可选 HTTP 包并保留需求扩展源码；预检会拒绝缺失产物，以及缺少 `definition(id)` 的 Agent preset registry 构建版本。需求预检清单由 [instance-manager.ts](instance-manager.ts) 维护，除扩展入口文件外还检查 `pipeline.yaml`、`pipeline.js`、`roles.js`、`role.js` 和六个角色 `SKILL.md` 流程文件。Registry 检查失败时应重新构建 Host libraries。修改启动器后，需要重新启动网关及其拥有的租户进程；只刷新浏览器不会替换运行中的进程。此启动集成不会向单独运行的桌面 Harness 安装任何内容。

工作流列表在每条运行记录行末提供**查看运行图**。展开后会在列表内加载该次运行的图；多个预览可同时保持展开，工作区与会话分组仍然可见。刷新会重新加载已展开的预览。预览加载失败时保留列表和此前已加载的图，并提供重试入口。旧运行显示已记录的进程条目；图和条目均不存在时显示空状态。收起预览或离开列表会取消其待完成的读取。此视图复用租户已认证的详情接口，不执行工作流。在仓库根目录运行 `node --test scripts/multi-user/workflow-panel.test.js extensions/dsh-workflow-panel/tests/client.test.js`，验证列表预览与面板行为。

案例设计详情的溯源分析会检查已提交 JSON 中的需求、功能点、场景和用例 ID，并保留统计及正反向检查结果。有向图展示每个已提交条目，并按相邻阶段产物中的实际引用逐项连边；点击条目会高亮其跨阶段祖先与后代，不会高亮同阶段的兄弟产物；其他阶段列会自动定位到该列第一个高亮产物，被点击产物所在列保持原位。未提交阶段不会生成节点或边。该图通过租户已认证的现有工作流面板展示；分析是只读操作。

网关会将每个租户进程世代的 stdout 和 stderr 记录到 `~/.dsh/multi-user-tenant-logs/<tenantId>-generation-<n>.log`（Windows 路径为 `C:\\Users\\<user>\\.dsh\\multi-user-tenant-logs`）。日志会省略认证就绪 URL，并对常见 token、password 和 secret 赋值做脱敏。日志仍可能包含运行数据；请限制网关用户主目录的访问权限，并在分享前检查日志。写日志失败会保留在管理器有长度限制的内存诊断中，不会停止租户。

网关向 CPIC-oa 提供 XTEST 内部 API 根地址和密钥。将 `cpicApiUrl` 设置为以 `/api/dsh/internal/cpic` 结尾的 XTEST API 根地址，并将 `cpicApiSecret` 设置为匹配的仅服务端密钥。网关通过 `CPIC_GATEWAY_CPIC_URL` 和 `CPIC_GATEWAY_CPIC_SECRET` 将它们传给租户进程；`CPIC_GATEWAY_USER` 和 `CPIC_GATEWAY_TENANT_ID` 来自服务端租户注册表。CPIC 适配器只在服务间请求头中发送这些值。非 loopback 的 XTEST 地址必须使用 HTTPS。浏览器不能选择用户或租户，也不会收到 API 地址或密钥。XTEST 授权已分配项目，并拥有现有按租户隔离的 `cpic_qa_*` 记录。不会执行自动迁移；启动清理不得删除操作员管理的本地 `.local/multi-user/requirements-db.json` 文件。修改设置后须重启所拥有的租户进程。

## 管理实例

首次运行前构建 DSH，然后在仓库根目录启动交互式管理器：

```powershell
pnpm run build
pnpm run multi-user:manage
```

管理器接受以下命令：

```text
list
start tenant-user1
status tenant-user1
stop tenant-user1
exit
```

`start` 使用配置的 workspace 作为 cwd 启动一个进程，设置其 `DSH_HOME`，将固定端口绑定到 `127.0.0.1`，并等待最长 60 秒直到收到完整的 `dsh web:` readiness 行。同一租户的并发启动会等待同一次启动。返回的 `authenticatedUrl` 是进程凭据，不得记录或分享给其他用户。

`stop` 发送一次 `SIGTERM` 并等待 15 秒，只在进程仍存活时发送 `SIGKILL`。`exit`、`Ctrl+C` 和 `SIGTERM` 会在管理器退出前停止其拥有的全部进程。进程状态只存在于当前管理器中；管理器重启后不会接管由其他位置启动的 DSH 进程。

管理器启动 DSH 前会删除名称包含 `KEY`、`SECRET`、`TOKEN` 或 `PASSWORD` 的环境变量，然后加入分配的 `DSH_HOME` 和权限模式。租户凭据仍通过该租户 DSH home 中的文件提供。

## 运行可信请求头网关

网关从租户注册表旁的一个被 Git 忽略的文件读取部署设置：

```text
.local/multi-user/gateway.json
```

复制随仓库提供的示例，然后替换副本中的所有占位密钥：

```powershell
New-Item -ItemType Directory -Force .local\multi-user | Out-Null
Copy-Item scripts\multi-user\gateway.example.json .local\multi-user\gateway.json
```

生成可信反向代理要发送的共享密钥，并把结果填入 `proxySecret`：

```powershell
$secretBytes = New-Object byte[] 32
$random = [Security.Cryptography.RandomNumberGenerator]::Create()
try { $random.GetBytes($secretBytes) } finally { $random.Dispose() }
[Convert]::ToBase64String($secretBytes)
```

设置文件固定以下值：

- `openAiChatCompletionsUrl` 与 `openAiModelId`：完整 OpenAI 兼容 Chat Completions URL 与手工模型 ID；服务无需提供模型列表接口。
- `proxySecret`：可信反向代理在 `X-DSH-Proxy-Secret` 中发送的共享密钥，至少 32 个 UTF-8 字节。
- `ticketResolverUrl`：原子消费跳转 ticket 的 Xtest2 HTTP 或 HTTPS 接口。外部 XTEST 根地址使用 HTTPS；只有运维受控的内部路由可使用 HTTP。HTTPS 使用 Node.js 信任库，且不会关闭证书校验。
- `ticketResolverSecret`：只由网关发往该接口的密钥，至少 32 个 UTF-8 字节。必须与 `ticketResolverUrl` 一起配置，并与 Xtest2 的 `DSH_GATEWAY_INTERNAL_SECRET` 保持同一个值。
- `sessionCookieName`：网关私有会话 Cookie 的名称。
- `sessionTtlMs`：会话有效期，单位毫秒。
- `idleTimeoutMs`：网关停止租户前的无活跃流量时长，单位毫秒；零表示禁用回收。

模型凭据不进入 JSON 文件。将 `DSH_MULTI_USER_OPENAI_MODEL_API_KEY` 设置为 OpenAI 兼容服务的 Bearer Key 后，启动器会清理 ambient 密钥并挂载部署 overlay。该变量缺省时不会挂载模型 overlay，各租户可在 Models 设置页创建路由，凭据进入该租户自己的凭据存储。新增路由供用户按需选择；标准 DeepSeek 路由仍是默认值。

网关控制字段也可以用命令行参数或环境变量覆盖，离网关进程更近的值优先：命令行参数（`--ticket-resolver-url`、`--session-cookie-name`、`--session-ttl-ms`、`--idle-timeout-ms`），然后是环境变量（`DSH_MULTI_USER_PROXY_SECRET`、`DSH_TICKET_RESOLVER_URL`、`DSH_TICKET_RESOLVER_SECRET`、`DSH_GATEWAY_SESSION_COOKIE_NAME`、`DSH_GATEWAY_SESSION_TTL_MS`），最后是设置文件。`--gateway-config <path>` 读取其他文件。示例文件把占位密钥保持在 32 个 UTF-8 字节以下，未修改的副本会校验失败，而不会带着公开已知的密钥启动。

设置文件可以配置浏览器业务监听器（`host`、`port`）、新租户端口分配范围（`tenantPortMin`、`tenantPortMax`）和私有管理监听器（`adminHost`、`adminPort`、`adminSecret`）。只有配置 `adminSecret` 后才会启动管理监听器；密钥至少包含 32 个 UTF-8 字节，且必须单独设置。管理监听器默认地址为 `127.0.0.1:3001`；只有 Xtest2 能通过可信网络或 HTTPS 代理访问时，才绑定私有网络地址。不要将管理监听器暴露给浏览器或公网。

Xtest2 可通过 `X-DSH-Gateway-Admin-Secret` 调用管理 API：

```text
GET  /internal/admin/config
PUT  /internal/admin/config
POST /internal/admin/restart
```

`GET` 响应不包含密钥。`PUT` 请求体只接受 `host`、`port`、`tenantPortMin` 和 `tenantPortMax`；Gateway 校验完整端口范围、原子写入设置文件，并在返回成功前重新绑定浏览器业务监听器。已有租户端口不会改变；新范围只用于之后创建的租户。重绑定会关闭当前业务监听器上的活动连接。如果新地址无法监听，Gateway 会尝试恢复先前监听地址和设置。`POST /internal/admin/restart` 使用当前监听设置重新绑定，但不会重启 Node 进程或停止租户进程。这些接口不提供进程执行或租户进程控制能力。

然后从仓库根目录启动网关：

```powershell
node --import tsx/esm scripts/multi-user/gateway-cli.ts
```

网关监听由配置文件中的 `host` 和 `port` 决定，默认是 `127.0.0.1:3000`。将 `DSH_GATEWAY_PUBLIC_URL` 设置为浏览器实际使用的 HTTP(S) 根地址，例如 `http://29.149.65.178:3000`；Gateway 会把该 URL 及其 authority 分别作为 `--public-url` 和 `--trusted-host` 传给每个租户。默认值为 `http://127.0.0.1:3000`。修改后必须重启 Gateway 及其正在运行的租户进程；使用其他 authority 启动的租户会对浏览器的 `/api/*` 请求返回 HTTP 403。

可信认证代理必须保留浏览器侧 `Host`，删除客户端提供的所有 `X-Auth-Request-User` 和 `X-DSH-Proxy-Secret` 请求头，然后自行设置这两个请求头。身份值必须与一个已配置的 `externalUserId` 完全相同，密钥必须等于配置的 `proxySecret`。不要把业务监听端口直接暴露给不受信任的本机用户或容器。

没有前置代理时，可以这样测试一次请求：

```powershell
$settings = Get-Content .local\multi-user\gateway.json | ConvertFrom-Json
$headers = @{
  'X-Auth-Request-User' = 'user1'
  'X-DSH-Proxy-Secret' = $settings.proxySecret
}
Invoke-WebRequest http://127.0.0.1:3000/ -Headers $headers
```

首次请求会启动分配的 DSH 进程并等待 readiness。网关把进程 token 交换为私有、绑定 authority 的 DSH Cookie，并且绝不把该 token、Cookie、可信身份请求头或后端 `Set-Cookie` 转发给浏览器。HTTP 请求体、流式 SSE 响应和 WebSocket upgrade 使用同一租户路由。网关不检查或脱敏看起来像凭据的请求和响应正文；浏览器遮罩只改变 Chat 的显示文本。

网关会在一个租户连续 15 分钟没有活跃 HTTP 请求、SSE 流或 WebSocket 连接后回收该租户。可以在设置文件的 `idleTimeoutMs` 中指定其他间隔，也可以为单次运行覆盖它：

```powershell
node --import tsx/esm scripts/multi-user/gateway-cli.ts --idle-timeout-ms 60000
node --import tsx/esm scripts/multi-user/gateway-cli.ts --idle-timeout-ms 0
```

浏览器无法自行设置这些可信请求头。浏览器使用场景必须在该监听器前部署认证反向代理。进程和私有 Cookie 状态仍保存在内存中；空闲回收会删除已停止 generation 的私有 Cookie；网关关闭时会等待进行中的回收，然后停止其拥有的全部实例。

## 排查 Linux 正式环境部署

本节用于 Gateway 和 DSH 产物已经部署到正式环境之后。以正在运行的 systemd 用户服务和进程元数据为准，因为正式服务使用的 checkout、构建产物、工作目录或环境文件可能与交互式 shell 不同。不要递归搜索整个部署目录或 `node_modules`；长时间运行的 `grep -R` 可用 `Ctrl+C` 中断，然后只检查服务和进程实际指向的文件。

```bash
GATEWAY_PID=$(systemctl --user show dsh-gateway.service -p MainPID --value)
systemctl --user show dsh-gateway.service -p ExecStart -p WorkingDirectory --no-pager
tr '\0' '\n' < "/proc/$GATEWAY_PID/cmdline"
readlink -f "/proc/$GATEWAY_PID/cwd"
```

### Xtest2 票据验证报告 JSON 无效或 HTTPS 失败

Gateway 接受 HTTP 和 HTTPS 票据验证地址。Gateway 在解析 JSON 前先报告非 200 响应，因此当前构建报告 JSON 无效时，表示 Xtest2 返回了 HTTP 200，但响应正文不是有效 JSON。先从服务环境或 Gateway 设置中核对实际验证地址，再绕过 ambient 代理测试 TLS：

```bash
curl --noproxy '*' -v "$DSH_TICKET_RESOLVER_URL"
```

Xtest2 使用私有或自签 CA 时，将签发证书链保存到 Gateway 服务可读取的文件，并在服务实际使用的 `EnvironmentFile` 中把 `NODE_EXTRA_CA_CERTS` 设置为其绝对路径。先确认文件路径，不要自行假定：

```bash
systemctl --user cat dsh-gateway.service
```

例如，unit 声明 `EnvironmentFile=/home/dcos/dsh-gateway/config/gateway.env` 时，在该文件中加入以下配置，再重启 Gateway：

```dotenv
NODE_EXTRA_CA_CERTS=/home/dcos/dsh-gateway/config/xtest-ca.pem
```

```bash
systemctl --user daemon-reload
systemctl --user restart dsh-gateway.service
```

证书的 Subject Alternative Name 必须包含验证地址使用的主机名或 IP。不要设置 `NODE_TLS_REJECT_UNAUTHORIZED=0`，也不要增加 `rejectUnauthorized: false`；这两种做法都会关闭服务器身份校验。`NODE_EXTRA_CA_CERTS` 只改变 Gateway 对外发起 HTTPS 请求时的信任，不影响浏览器 API 授权。

### Xtest2 跳转成功但浏览器 `/api/*` 请求返回 403

在服务实际使用的 `EnvironmentFile` 中，将 `DSH_GATEWAY_PUBLIC_URL` 设置为浏览器实际访问的 Gateway 根地址，包括真实 scheme、主机和端口。例如：

```dotenv
DSH_GATEWAY_PUBLIC_URL=http://29.149.65.178:3000
```

```bash
systemctl --user daemon-reload
systemctl --user restart dsh-gateway.service
```

从 Xtest2 重新进入，使 Gateway 启动新的租户 generation。直接检查该租户进程；参数必须保留 loopback 绑定，并包含浏览器 authority：

```text
--host 127.0.0.1
--public-url http://29.149.65.178:3000
--trusted-host 29.149.65.178:3000
```

不要把租户绑定到公网 IP。Gateway 通过租户的 loopback 端口代理请求；公开绑定租户会绕过预期隔离。

### 插件 → Skills 无法读取

Skills 的浏览器回调、Host 实现与生成的 Remote 描述必须使用一致的 `list(request, signal)` 签名。一起重新构建 `@deepseek-ai/dsh-api-session-controller` 与 `@deepseek-ai/dsh-client-ui-settings-skill-management`，重启受影响的租户进程，再刷新浏览器。运行 `node scripts/multi-user/verify-resource-artifacts.mjs`，验证构建后的 Skills 页面会发送必需的请求对象，并在指定预设时携带该预设。Skills Remote 失败可能通过成功的 HTTP 响应返回 `result.ok: false`；应检查 Remote 响应，而不只是失败的 HTTP 请求。

### 新用户无法关闭预览版说明或创建默认工作区

这两个现象表示部署产物不完整或租户 profile 无效。多用户集成同时依赖 Host 对 `workspace-controller.defaultWorkspacePath` 的实现，以及 Web Client 对 `ui-settings-models.welcomeNotice` 的实现。必须一起构建和部署完整 Host 与 Web 产物，再重启 Gateway 及其拥有的租户进程；刷新浏览器不会替换正在运行的租户。

无需扫描部署目录即可找到租户子进程 PID，然后检查其实际 home、cwd、profile patch 和权限：

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

多用户租户 profile 需要包含以下有效配置行，其中工作区必须是该租户的绝对路径：

```yaml
- id: ui-settings-models
  config:
    welcomeNotice: false
- id: workspace-controller
  config:
    defaultWorkspacePath: /absolute/tenant/workspace
```

自动创建租户时，仅在 profile patch 不存在的情况下创建该文件；已存在的运维配置会被保留。请先备份，再显式更新旧租户 patch，且不要删除无关的自定义配置行。确保 Gateway 服务账号拥有租户 `dshHome` 与 workspace 目录，或至少可写这些目录。重新构建并重启 Gateway，从 Xtest2 再次进入；测试 UI 前，先确认新租户进程使用预期的 `DSH_HOME`、cwd、public URL 和 trusted host。

## 通过 Xtest2 自动创建租户

与 Xtest2 对接时，Gateway 还提供受保护的租户创建接口：

```text
POST /internal/tenants/provision
X-DSH-Tenant-Provision-Secret: <DSH_GATEWAY_INTERNAL_SECRET>
Content-Type: application/json

{"externalUserId":"user3","tenantId":"tenant-user3"}
```

Gateway 会检查 `tenants.json` 中是否已有该用户；已有用户会重新确保 `home` 和 `workspace` 目录存在并返回原端口，未配置用户会在 `D:\DSH\runtime\tenants\<externalUserId>` 下创建目录，从 `gateway.json` 配置的 `tenantPortMin` 到 `tenantPortMax` 分配未使用端口，更新 `tenants.json`，并立即注册到当前 Gateway 进程。

当 `/entry?ticket=...` 收到 Xtest2 验证通过的票据时，Gateway 会使用返回的用户和租户编号自动补建缺失租户，然后才签发浏览器会话。票据入口与内部租户创建接口在当前 Gateway 进程内串行写入配置。无效或过期票据以及无效访问路径不会创建租户。Xtest2 返回非 200 响应时，Gateway 报告其 HTTP 状态；HTTP 响应成功但无法解析时，Gateway 报告 JSON 无效。创建失败时不签发会话；响应会在原因已知时说明未启用自动创建、标识无效、租户冲突、端口耗尽、权限不足或磁盘空间不足。Gateway 会记录意外错误供管理员排查。处理失败原因后，请从 Xtest2 重新生成票据。

启用此接口需要在网关设置中配置 `ticketResolverUrl` 和 `ticketResolverSecret`；Xtest2 的 `DSH_GATEWAY_INTERNAL_SECRET` 必须与 `ticketResolverSecret` 使用同一个值。接口只监听 Gateway 内部地址，不应直接暴露给不受信任的客户端。
