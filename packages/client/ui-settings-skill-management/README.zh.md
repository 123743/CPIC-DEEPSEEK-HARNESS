---
description: "在 DSH Web 插件控制台管理用户 Skills，并为现有 Agent preset 分别配置加载的 Skills。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-skill-management

[English](README.md) | 中文

## 概述

在 Web 侧栏选择**插件**，可查看 DSH 用户 Skills，以及来自共享 Agent 目录和已配置自定义目录的只读全局 Skills。打开 **Skills** 后，用户可以新建或编辑 Skill、复制全局 Skill，或删除个人覆盖以恢复全局来源。选择一个现有 Agent preset 后，可以单独选择该 preset 要加载的 Skills；系统不会注册复制出来的 Agent preset，现有会话保持不变。

## 使用本包

用户打开 **插件 → Skills** 页面时，页面会读取目录，并调用 `ctx.remote.skillManagement.list/read/write/deleteSkill/select`。每项操作都指定一个现有 Agent preset ID。页面在使用结果前会检查每次调用的 `RemoteResult.ok`。Client 不会编辑全局来源文件；编辑全局 Skill 会创建 DSH 用户级副本。

编辑器要求填写名称、描述和指令正文，可选填写 `whenToUse`。删除用户级 Skill 只移除个人定义；若存在全局版本，列表随后重新显示它。Agent preset 各自保存 Skill 允许清单，但 Skill 文档在 preset 之间共享。

启用 preset 或更改允许清单只影响之后组合的 Agent；现有 Agent 保留创建时的 composition。若文件已写入但 scoped 激活失败，全局 overlay 会报告结果，页面提供操作以重试所选 preset。关闭 Skills 页面后，操作结果仍会显示在全局 overlay 中。

## 理解实现

本包拥有浏览器端 Plugins 控制台贡献及其 locale 字典，与 `ui-skill` 对话 composer 的目录功能分离。所有修改都通过生成的 `skillManagement` Remote；本包没有文件系统能力，不能写入全局来源。

## 进一步探索

- [Plugins 插件管理页](../ui-plugin-manager/README.zh.md)
- [API remotes](../../api/remotes/README.zh.md)
- [Skill filesystem provider](../../skill/skill-filesystem/README.zh.md)

### 开发备注

`./client` entry 导出 `apply` 与 `inject`，并通过 Plugins 的 `plugins.item` slot 注册 Skills 页面。操作 Toast 注册到 `shell.overlay`，并共享由插件 fiber 管理的 observable。

## 模型体验

无，因为此页面仅编辑 Host 管理的文件并选择未来会话的 preset，不添加面向模型的消息或工具。

#### KV Cache 影响

页面自身不改变模型输入或缓存前缀；所选 preset 中的 Skill 消费方负责后续面向模型的内容。

## 已知限制与延期工作

- 全局来源清单及来源标识由 Host 提供，不能在此页面配置。
