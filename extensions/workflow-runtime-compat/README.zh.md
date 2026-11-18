# Workflow 运行时兼容补丁

[English](README.md) | 中文

此本地补丁使社区 Workflow 0.1.2 使用当前 Harness 的托管子 Agent API。构建只读策略时仅查询允许的工具，并将启动错误保留在运行存储中。即使脚本捕获错误或返回失败对象，包含失败子任务的运行也会以失败状态结束。

对已安装的插件目录应用补丁：

```powershell
node extensions/workflow-runtime-compat/apply.mjs 'D:\DSH\runtime\tenants\admin\home\profiles\web\node_modules\@dsh-external\workflow'
```

补丁在写入前检查包版本和所有替换位置。每个原始模块都会保存在旁边，文件名后缀为 `.pre-activation-compat`。重复应用同一补丁不会进一步修改模块。重新安装或更新社区插件可能替换这些文件；适配其他版本前必须重新检查插件。

重启所属租户后端才能加载修改后的模块。刷新浏览器不会重新加载服务端模块。新运行快照会包含发起会话 ID 和带版本号的 `process.graph`。图中记录 Workflow 包含关系、阶段成员关系，以及由 `task_id:` 输入声明的任务间证据引用；证据引用不会控制任务调度，图也不会按顺序或时间戳推断执行依赖。已有运行记录保持原样，不会按时间或标题猜测会话归属。

使用普通 Node 能够解析依赖的安装副本运行隔离回归：

```powershell
node extensions/workflow-runtime-compat/test.mjs 'C:\Users\admin\.dsh\profiles\web\node_modules\@dsh-external\workflow'
```

测试将已安装模块复制到私有临时目录，并在结束后删除该目录。测试通过受控子任务覆盖受限脚本运行器、子任务同时准入、任务证据引用图投影、取消和持久化失败报告。测试未验证真实模型提供方或浏览器渲染。
