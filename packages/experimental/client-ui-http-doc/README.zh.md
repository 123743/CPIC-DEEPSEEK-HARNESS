---
description: "面向 Harness 用户和插件维护者的可选 HTTP 请求编辑器与可复用 Markdown 响应面板。"
kind: "package-reference"
---

# HTTP 请求面板

[English](README.md) | 中文

本文是可选 Client 插件 `@deepseek-ai/dsh-experimental-client-ui-http-doc` 的参考。插件在输入框加号菜单中提供带 API 图标的 **HTTP 请求**（`/http-request`）入口。单独输入 `/http` 也会打开面板；带参数的 `/http` 保留 Host 命令的正常行为。

## 启用

在本地 profile 补丁中将本包与 `@deepseek-ai/dsh-experimental-tool-http-doc` 一同挂载。启动 profile 前先构建 Client bundle。本实验性插件按需启用，不包含在默认组合中。

```yaml
- insert:
    - id: client-ui-http-doc
      name: '@deepseek-ai/dsh-experimental-client-ui-http-doc'
```

面板可编辑方法、绝对地址、有序请求头、可重复查询参数、请求体和文档标题。发送操作通过 commands Remote，以 JSON 规格调用 `/http`。对象和数组请求体必须是有效 JSON，其他请求体按文本发送。名称和值都为空的行会被省略。面板展示可选择复制的 Markdown 源文，命令的会话结果也会保留文档。失败后草稿仍可编辑。关闭或重新打开面板会取消请求，旧请求的延迟结果无法更新另一次打开的面板。插件卸载时会取消并等待活动请求结束。

草稿在内存中按 Session 隔离，面板重新挂载后仍保留，不写入浏览器存储。请求头可能包含敏感信息；提交请求遵循 Host 命令的日志和网络策略。

## 源码索引

- [Client 注册](src/client/index.ts) 管理菜单、语言字典和面板挂载。
- [草稿 store](src/client/draft-store.ts) 管理编辑字段，[控制器](src/client/controller.ts) 管理打开状态和取消。
- [面板](src/client/RequestPanel.tsx) 仅使用框架绑定的 props。

## Model Experience

### 直接执行命令

#### 模型看到什么

本 Client 插件不添加提示词、工具或模型消息，请求直接交给 Host 命令。

#### Token 影响

面板交互不消耗模型 token。Host 命令按自身策略记录交换结果。

#### KV Cache 影响

插件不改变模型请求组装，也不使原本可复用的前缀失效。

## 已知限制与后续工作

共享输入框将自定义入口归入“命令”组，通过加号打开时也如此。Host `/http` 和带图标的 `/http-request` 两个入口都会保留。每个浏览器插件实例同时只有一个面板处于打开状态。只有命令的空白 Session 会保留欢迎页；请在关闭面板前查看或复制 Markdown。命令结果仍保存在 Session 日志中，Session 有其他内容后会显示在会话里。Markdown 以方便复用的源文显示；集合管理、认证预设、文件上传、历史和响应可视化不属于本包。发送请求需要配套的 Host `/http` 命令；缺少命令时会显示可操作的错误信息。
