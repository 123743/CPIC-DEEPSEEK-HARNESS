# Repository Guidelines（仓库指南）

## 项目结构

这是一个基于 Cordis 的全插件代理框架。核心 TypeScript 包位于 `packages/<分组>/<包名>/`；Python SDK 在 `python/`，原生模块在 `native/`，文档和门禁分别在 `docs/`、`scripts/`，网站源文件在 `website/`，第三方源码在 `vendor/`。测试通常与包相邻，跨包快照位于 `snapshots/`。

修改 `packages/` 前先阅读 `docs/architecture.md`；文档修改还需遵循 `docs/AGENTS.md`。

## 构建、测试与开发

```sh
pnpm install                 # 安装依赖
pnpm run build               # 编译并打包
pnpm run test                # 单元测试
pnpm run typecheck           # 严格类型检查
pnpm run lint                # 代码检查
pnpm run test:docs           # 快速文档检查
pnpm run doc-sync            # 完整文档门禁
pnpm run dev:web             # 启动 Web 开发环境
```

按影响范围运行检查；发布路径还要验证构建。真实模型测试读取 `DEEPSEEK_API_KEY`，无密钥时部分 e2e 会跳过。

## 编码与命名

项目使用 ESM、TypeScript 严格模式和 `pnpm` 工作区。跨包使用包名，局部导入保留 `.ts` 扩展名；副作用通过 `ctx.effect()` 或 `ctx.on()` 注册。可变部署参数放入 `Config`，不要硬编码。保持现有格式化、JSDoc 和错误处理风格。

## 测试要求

测试文件通常为 `*.spec.ts` 或 `*.test.ts`，并与被测包相邻。行为或模型可见输出变化要同步更新测试和无密钥快照；提交前运行必要的单元测试、类型检查、lint、文档或快照检查。

## 提交与 PR

提交信息应简洁并说明受影响的包或行为，避免混入无关格式化。PR 需说明变化、测试命令和限制，关联 issue；界面改动附截图或录屏，破坏外部 API、配置或持久化数据时附升级指南。当前暂不接受外部 PR，请先通过 issue 或维护者沟通。

## 配置与安全

不要提交 `.env`、API 密钥或其他凭据。使用 `DEEPSEEK_API_KEY` 和可选的 `DEEPSEEK_BASE_URL` 运行真实 API 测试；`cordis.yml` 中条件配置使用 `!!js`，不要使用 `!js`。仅通过受支持的 `dsh` profile 启动 Node 应用。
