# CLAUDE.md

本文件为 Claude Code (claude.ai/code) 在本仓库中工作时提供指引。

## 项目概述

DeepSeek Harness (`dsh`) 是一个基于 [Cordis](https://github.com/cordiverse/cordis) 构建的开源智能体运行框架，采用**一切皆插件**的架构。产品的每个组成部分——模型适配器、工具注册表、会话日志、智能体循环——都是 Cordis 插件，均可通过配置替换。没有需要修补的核心特权模块；通过挂载插件来扩展 dsh。

## 常用命令

### 安装与构建

```sh
pnpm install                  # 安装依赖（需要 Node ^22.19 || >=24，通过 corepack 启用 pnpm 11.28.5）
pnpm run build                # 完整构建：tsc 输出 lib/types，tsdown 打包运行时，构建 Web 前端
pnpm run build:lib            # 仅构建库文件（host + client）
pnpm run typecheck            # 类型检查（先运行 Host 库阶段，再运行 Client）
pnpm run clean                # 清理构建产物和已删除包的残留
```

### 测试

```sh
pnpm run test                 # 单元测试（vitest）
pnpm run test:coverage        # CI 覆盖率门禁：packages/*/*/src 下每个文件 100%
pnpm run test:e2e             # 真实 API 测试；未设置 DEEPSEEK_API_KEY 时自动跳过
pnpm run test:snapshot        # 无密钥的录制会话回放；按名称过滤：-t <name>
pnpm run test:snapshot:record # 重新录制预期输出（需要密钥）
pnpm run test:expected        # 所有者本地的流程预期测试
pnpm run test:web             # Web 测试（先构建再运行）
```

### 代码检查与质量

```sh
pnpm run lint                 # oxlint 代码检查（先构建 Host 契约）
pnpm run lint:fix             # 自动修复 lint 问题
pnpm run duplication          # 跨文件 TypeScript 重复检测（jscpd）
pnpm run hygiene              # publint + 工作区/包/依赖检查 + NodeNext 消费者检查
pnpm run doc-sync             # 文档门禁
pnpm run test:docs            # 快速文档检查（无需构建）
pnpm run check:all            # 本地综合检查集（独立于 git hooks）
```

### 运行应用

```sh
pnpm dsh web                  # 启动 Web UI，默认 http://127.0.0.1:3080（使用已构建产物）
pnpm run start:web            # 同上
pnpm run dev:web              # 构建、启动服务，并在源码编辑时重建客户端 bundle
pnpm run start:desktop        # 启动已构建的 Desktop 产物
pnpm run dev:desktop          # 构建后启动 Desktop
make web|dev-web|desktop|dev-desktop|build  # 等价命令；ARGS='--no-open' 传递选项
```

### Profile 演示（需要 `DEEPSEEK_API_KEY`）

```sh
pnpm dsh --profile headless "task"   # 运行一次性无头编码智能体
pnpm run demo:ptc -- "task"          # 无头 PTC 模式演示
```

### 运行单个测试

测试运行器为 Vitest。运行单个测试文件或按名称过滤：

```sh
pnpm vitest run path/to/test.spec.ts
pnpm vitest run -t "test name pattern"
```

## 架构

### 核心概念

- **Cordis 框架**（`vendor/cordis/`）：插件向共享的 `Context` 贡献服务、类型化事件和可逆效果。注册本身就是效果，插件卸载时自动回滚。
- **Profile（配置文件）**：存储在 Harness home 中的命名组合。内置 profile：`web`、`headless`、`sdk`、`sdk-minimal`、`acp`。通过 `dsh --profile <name>` 选择。
- **Bundle（包束）**：Cordis 配置行的分发格式。`dsh-base` 是共享的底层；`dsh-web-app`、`dsh-headless`、`dsh-sdk-app`、`dsh-acp-app` 添加各自 profile 特有的层。
- **能力接缝（Capability Seam）**：三个角色——服务定义、服务提供者、消费者。替换一个提供者即可改变整个产品（例如文件系统/子进程/沙箱提供者共享同一个执行世界）。

### TypeScript 项目布局

仓库使用隔离的 **Host** 和 **Client** 两个 TypeScript 聚合体：
- `tsconfig.host.json` — Host 聚合体：所有 Host 包、示例、测试、脚本
- `tsconfig.client.json` — Client 聚合体：`packages/client/*`、`apps/web`
- `tsconfig.base.json` — 共享的 compilerOptions 和源码 `paths` 映射
- `tsconfig.base.client.json` — 浏览器编译设置（jsx、DOM 类型库）

Host 和 Client 必须分开，因为两者都通过声明合并（declaration merging）向 Cordis 的 `Context` 接口注入同名但不同服务的属性。解决方案根 `tsconfig.json` 引用两个聚合体，但绝不会创建单一的扁平化程序。

构建顺序：`tsc -b tsconfig.host.json` → `tsdown --env.DSH_BUILD_FACE host` → `tsc -b tsconfig.client.json` → `tsdown --env.DSH_BUILD_FACE client` → `pnpm run build:web`。

**Typert** 仅在 Host tsdown 阶段运行，生成 Host-for-Client 的 Remote 投影类型。

### 核心包（`packages/core/`）

| 包 | 职责 | `ctx` 键 |
|---|---|---|
| `core/session` | 追加式 `SessionEvent` 日志和内存存储 | `ctx.sessions` |
| `core/system-prompt` | 提示词段落和工具 schema 组装 | `ctx.systemPrompt` |
| `core/tools` | 作用域工具注册表和受保护的执行管道 | `ctx.tools` |
| `core/agent` | `Agent` 接口、实时注册表、`agent/*` 事件 | `ctx.agents` |
| `core/agent-loop` | 实现 Agent 接口的默认驱动 | `ctx.agentLoop` |
| `core/scope` | 每个智能体的作用域注册原语 | 库，无键 |
| `llm/llm` | 消息/流词汇表及适配器接缝 | `ctx.llm` |

### 轮次流程

**Step（步骤）** 是一次模型请求加上它调用的工具。**Turn（轮次）** 是零个或多个步骤：

```
turn/start → 声明输入 → 组装提示词 + 工具 schema
  → agent/pre-step（重写/拒绝）
  → step/start → agent/request → prepareCall
  → 流式传输 → llm/stream → agent/assistant-stream
  → tool/call → tools/pre-execute → tools/execute → tools/post-execute → tool/result
  → step/end（如果工具产生后续请求则循环）
→ agent/turn-stopping → turn/end
```

`turn/*`、`step/*`、`system/message`、`user/message`、`assistant/message`、`tool/*` 是持久化会话事件。其余是实时扩展点。**模型可见即已记录**——每个模型请求必须能从会话日志中重建。

### 仓库目录结构

```
vendor/          已 vendor 的 Cordis 框架（私有，重命名为 @deepseek-ai 作用域）
packages/        @deepseek-ai/dsh-<pkg> 工作区，位于 packages/<group>/<pkg>/
  core/          智能体/会话 API
  api/           远程 BFF、Typert RPC 网关
  typert/        类型图
  llm/           模型提供者
  shell/         命令执行
  subprocess/    子进程管理
  sandbox/       进程沙箱（bwrap/Landlock/Seatbelt）
  fs/            文件系统访问
  lsp/           语言服务器
  skill/         技能加载
  web/           搜索/抓取工具
  bundle/        Profile 包束（dsh-base、dsh-web-app 等）
  boot/          应用启动、插件管理器
  session/       持久会话存储、投影接缝
  sdk/           JSON-RPC SDK
  acp/           仅自动化的 ACP 服务器
  host/          Web GUI 宿主服务
  client/        Web GUI 浏览器端
  mcp/           外部 MCP 服务器作为原生工具
  experimental/  评估中的能力，无产品支持承诺
  test-support/  测试基础设施
  util/          零依赖工具库
python/          Python SDK/运行时
native/          @deepseek-ai/node-addon-system 源码
benchmarks/      性能门禁
.agents/         智能体工作流、笔记、技能
docs/            文档
scripts/         门禁脚本和生成器
website/         VitePress 文档站点
apps/            CLI（apps/cli）、Web 前端（apps/web）、Desktop（apps/desktop）
```

## 关键约定

- **纯 ESM**（`"type": "module"`）。跨包使用包名导入，本地相对导入使用 `.ts` 后缀。
- **注册即效果**：所有贡献通过 `ctx.effect()` / `ctx.on()` 进行；注册表的 `register()` 返回销毁函数。
- **类型化事件使用声明合并**和可合并扩展的映射。瀑布监听器**必须**调用 `next()` 进行委托。
- **按判别标签进行 switch**。封闭联合类型以 `assertNever` 结尾。
- **源码面与产物面不可混用。** 静态门禁通过 tsconfig `paths` 解析到 `src`；消费已构建 `lib/` 的门禁显式声明该依赖。
- **优先使用维护良好的依赖而非手写实现**，前提是它们确实删除了自有代码和测试。
- **插件中不可硬编码可调参数**：随部署变化的选择必须是经过验证的 `Config` 字段。
- **跨边界的不透明 ID 使用品牌化类型**（`Branded<B>`，来自 `dsh-brand`），绝不用裸 `string`。
- **信任 TypeScript 在类型化同进程边界上的保证。** 仅在解析器/配置、队列、模型/工具 JSON、持久化/文件、工作进程、进程和网络边界进行验证。
- **禁止新的 `unknown` 断言**——保持或减少现有的遗留基线。
- **错误处理**：使用类型化、结构化的失败。空 `catch` 必须命名错误及其原因。
- **客户端 UI 文案由本地化系统管理。** 通过类型化字典路由产品文本。
- **TODO 标记**：`FIXME`（发布阻塞）、`TODO`（尽快修复）、`XXX`（将来可能修复）。
- **文件以恰好一个换行符结尾。**

## Git 与 CI

- **lefthook** 管理 pre-commit（oxlint、配对检查、空白字符、vendor 守卫）、pre-merge-commit 和 pre-push（`pnpm run typecheck`）。
- **推送前**：针对变更的代码面运行相关检查。`test:coverage`（而非 `test`）是 CI 覆盖率门禁。
- **Vendor 清单守卫**：对 `vendor/*/src` 下的更改必须与匹配的 `vendor/README.md` 清单更新一起暂存。
- **`pnpm run constraints`**：验证工作区项目引用和编译器面分配。

## 环境变量

```sh
DEEPSEEK_API_KEY=sk-...          # 用于真实 API 测试和演示
DEEPSEEK_BASE_URL=https://...    # 可选，默认使用公共 API
```

绝不可提交凭证。真实 API 的 e2e 测试套件在未设置 `DEEPSEEK_API_KEY` 时自动跳过。

## 文档

- 修改 `packages/` 下的任何内容前，先阅读 `docs/architecture.md`。
- 如果不熟悉 Cordis，先阅读 `docs/cordis-primer.md`。
- 文档随每次代码变更一起更新：同步更新受影响的 README 和 JSDoc 契约。
- 双语对（`.zh.md`）通过翻译工作流一起更新。
- 根目录和 `packages/` 的 `CLAUDE.md` 镜像自 `AGENTS.md`；请编辑 `AGENTS.md` 作为真实文件。