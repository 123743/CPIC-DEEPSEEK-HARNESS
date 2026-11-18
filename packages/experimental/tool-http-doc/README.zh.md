---
description: "面向类 Postman 的 HTTP 交换工具：供 agent（智能体）开发者与维护者选择、配置或排查请求执行与自动 Markdown API 文档生成。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-tool-http-doc

[English](README.md) | 中文

## 概述

使用 `http_request` 发送一次 HTTP 请求、接收响应，并自动完成文档化：工具把记录下来的交换以结构化数据返回，同时返回一份可复用的 Markdown 文档，包含请求头、查询参数、请求体、状态码、响应头与响应体。`/http` 命令向用户提供相同的交换能力，支持紧凑请求行或 JSON 请求规范。本包需要选择启用；启用后每次模型请求都会增加一个工具 schema；部署级边界决定调用预算与捕获上限。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

当模型或用户需要调用 HTTP API 并从交换结果生成 API 文档时挂载本包。`http_request` 工具面向模型调用；`/http` 命令用于用户显式发起请求。添加可选 Client 包 [`client-ui-http-doc`](../client-ui-http-doc/README.zh.md) 后，加号菜单会提供带自定义 API 图标的请求面板。

### 何时选择

当部署需要一步完成类 Postman 的请求构造、响应检查与文档化时选择它——例如 agent（智能体）对照运行中的服务器验证 API，并把验证过的请求/响应对写入项目文档。只关心页面内容时避免使用：`dsh-tool-web` 抓取并转换网页，但不支持请求体、自定义请求头或文档投影。

### 组合

本包是可选启用的：没有任何随发行的 bundle 挂载它，部署通过在自己的组合里添加配置行、并把本包加入自身的 workspace 依赖（`"@deepseek-ai/dsh-experimental-tool-http-doc": "workspace:*"`）来启用：

```yaml
- id: tool-http-doc
  name: '@deepseek-ai/dsh-experimental-tool-http-doc'
  config:
    requestTimeoutMs: 30000
    maxBodyChars: 200000
```

插件需要 `tools` 与 `commands` 服务；卸载时注销两项贡献。

### 用户命令

输入 `/http GET https://example.com/api?limit=10` 或 `/http {"method":"POST","url":"https://example.com/api","headers":[{"name":"Accept","value":"application/json"}],"query":[],"body":{"name":"demo"},"title":"Create item"}`。请求行之后可添加 `Name: value` 请求头行，再用空行分隔请求体；也可直接在 URL 后编写一份行内请求体。仅填写绝对 URL 时默认 GET。以对象或数组开头的请求体必须是有效 JSON，其他文本原样发送；请求体以类似请求头的文本开头时使用 JSON 请求规范。命令通过 `command/done` 返回 Markdown，不调度模型请求；非法输入、超时和取消以错误结果结束。可选 Client 面板自动提交 JSON 格式。两个入口都会通过工具注册表执行，因此会应用 `tools/pre-execute` 策略、guard 与每个 Agent 的限制。请求在 Host 执行，提供的请求头会记录到 Session，包括凭据。

### 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `requestTimeoutMs` | `30000` | 协作式调用预算（毫秒），附加到工具上供超时策略执行，同时作为传输层自身的截止时间兜底 |
| `maxBodyChars` | `200000` | 请求体与响应体的保留/回显字符上限；响应体会先完整读取，再进行截断 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-experimental-tool-http-doc)是每个受支持字段及其 JSDoc 的穷尽式真源。

### 模型可以做什么

| 工具 | 模型得到什么 |
|---|---|
| `http_request` | 一次交换：发出的请求行、请求头、查询参数与请求体，收到的状态码、响应头与响应体的结构化数据，以及同一事实的可复用 Markdown API 文档（`markdown` 字段） |

模型按 Postman 的方式构造请求：绝对 `http(s)` URL、有序的 `headers` 与 `query` 名/值条目（重复项保持顺序并合并进 URL），以及 `body`——字符串原样发送，其他值序列化为 JSON。可选的 `title` 成为文档标题。超过 `maxBodyChars` 的请求体与响应体会被截断，并在结构化数据和文档里标记为已截断。

### 失败与恢复

非法输入在任何发送之前失败：非 http URL、畸形请求头名、请求头值中的控制字符、空查询名，或 `GET`/`HEAD` 携带请求体，各自返回一条精确消息。传输失败、请求截止时间与调用方取消是相互区分的：取消保留为标准的中止工具错误，截止时间报告配置的预算，其他失败报告传输层消息。非 2xx 响应是一次成功的交换——状态码被记录进文档，而不是错误。目标地址策略由组合通过工具策略提供；`tools/pre-execute` 只能看到初始 URL，无法保证限制后续重定向跳转。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释工具背后的设计决策，并指出实现它们的代码位置；可观察行为已在[使用本包](#use-this-package)中完整说明。

### 设计理念

本包建立在一次分离与三项承诺之上：

- **一个显式的 resolve 步骤。** `resolveRequest` 把已校验的参数变成不可变的请求规范——URL 解析、查询合并、请求头校验、请求体序列化与 JSON Content-Type 默认值只发生在这里，别处不做。
- **一个传输边界。** `sendRequest` 执行该规范并记录交换；调用方的信号与截止时间兜底都到达网络层，只有记录下来的副本受捕获上限约束。
- **一个纯文档投影。** `renderExchangeMarkdown` 是记录交换的纯函数，因此 Markdown 文档可复现，且无需网络即可单测。
- **部署级边界属于 Config，策略不属于。** 调用预算与捕获上限是受校验的 `Config` 字段；请求目标与密钥处理策略留在部署拥有的 `tools/pre-execute` 监听器里。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`Config`、边界解析、工具/命令注册 |
| [`src/command.ts`](src/command.ts) | `/http` 输入语法、请求派发与 Markdown 结果 |
| [`src/request.ts`](src/request.ts) | 参数解析、HTTP 传输、交换捕获 |
| [`src/markdown.ts`](src/markdown.ts) | 纯 Markdown 文档投影 |
| [`src/tool.ts`](src/tool.ts) | `http_request` 的 schema、规范值、渲染与展示 |

### 操作流程

一次调用先把参数解析为请求规范，再经由传输层发出，同时融合取消信号与截止时间信号，并记录交换：一侧是发出的方法、最终 URL、请求头、查询条目与回显的请求体，另一侧是状态码、原因短语、响应头、捕获的响应体、内容类型与耗时。规范值投影该交换以及由它生成的 Markdown 文档；面向模型的渲染就是文档本身，可重放的展示元数据携带完成卡片显示的摘要。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级约定不够用时阅读以下页面。它们从工具表面逐步进入底层目录与工具编写约定。

- [生成的工具目录](../../../docs/tool-catalog.zh.md#deepseek-aidsh-experimental-tool-http-doc)——模型看到的 `http_request` schema。
- [生成的配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-experimental-tool-http-doc)——每个受支持 `Config` 字段及其 JSDoc。
- [工具编写参考](../../../docs/cookbook/adding-a-tool.zh.md)——该工具实现的执行、渲染与展示约定。
- [Cordis 入门](../../../docs/cordis-primer.zh.md)——挂载本包的组合所需的插件加载、副作用与配置。

-----

<a id="model-experience"></a>
## 模型体验

### 工具 schema

#### 模型看到什么

模型会看到生成的 [`http_request` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-experimental-tool-http-doc)：`method`、`url`、`headers`、`query`、`body` 与 `title`。超时、输出上限与目标地址设置都不对模型可见。

#### Token 影响

工具可见期间，每次请求都会发送一个固定的工具 schema。

#### KV Cache 影响

工具可见性与定义不变时，前缀稳定。

### 工具结果

#### 模型看到什么

每次成功调用返回一个纯文本块：Markdown API 文档。它以请求行或 `title` 为标题，带有稳定的 `## Request` 与 `## Response` 小节，其中 `### Request headers`、`### Query parameters`、`### Request body`、`### Response headers` 与 `### Response body` 在缺失时渲染 `_None._` 或 `_Empty response body._`，在捕获体提前停止时标注 `_Body truncated by the configured capture cap._`。

#### Token 影响

结果取决于数据，并保留在已记录的工具历史中直到压缩（compaction）；`maxBodyChars` 限制每个捕获体。

#### KV Cache 影响

仅追加的结果文本位于可复用请求前缀之后，不会使较早的缓存条目失效。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制定义了本包何时不适用或需要特殊运维注意。它们是当前的包约束，不是任务待办。

- **一份文档对应一次实时交换**——文档记录产生它的那次调用；端点变化时，下一次调用会产生不同的文档。
- **保留的请求体受上限约束**——`maxBodyChars` 限制回显内容；响应会先由 `response.text()` 完整缓冲，再进行截断，因此它不会限制网络流量或响应峰值内存。
- **没有内置目标地址或密钥策略**——提供的请求头会原样记录；部署通过工具策略为模型与用户请求提供限制。
- **自动跟随重定向**——传输层会跟随重定向；策略只能看到初始 URL，无法逐跳限制目标。交换记录原始请求 URL 与最终响应，不包含重定向链。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作语境——点击展开</summary>

本开发备注是维护者的工作语境：尚未决定的开放设计问题与方向。它明确不具权威性——已发布的行为、限制与已接受的理由在上文章节、包代码与链接的 Agent Note 中。

#### 未来：请求集合

Postman 的另一个核心概念——可保存、可重放的请求集合——不在这里。请求集合属于本包、一个 skill 还是工作区文件，尚未决定。

</details>
