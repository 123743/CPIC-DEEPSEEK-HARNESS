---
description: "CPICHarness 需求分析和基于已完成案例的人工 QA 流程。"
kind: "package-bundle"
---

# CPICHarness 需求工作台

[English](README.md) | 中文

## 概述

导入 Markdown 或文本需求，生成可追溯的案例设计，并将完成的用例计划带入 CPIC-oa 质量控制台，供人工审批、执行和缺陷跟踪。

## 目录

- [启用](#activate)
- [配置来源](#configure-the-source)
- [使用工作台](#use-the-workbench)
- [溯源分析](#traceability-analysis)
- [案例设计流水线](#case-design-pipeline)
- [CPIC-oa 质量控制台](#cpic-oa-quality-console)
- [执行与存储](#execution-and-storage)
- [验证](#verification)
- [模型体验](#model-experience)
- [已知限制](#known-limitations)

<a id="activate"></a>
## 启用

仓库的[多用户 Gateway 启动器](../../scripts/multi-user/README.zh.md#windows-web-deployment)通过专用补丁挂载此扩展。变更启动组合后，重启 Gateway 及其租户进程，再刷新已认证页面。

通过 Harness 插件管理器将此目录作为 bundle 安装到所选配置档案。补丁将需求根目录设为租户工作区；独立桌面 Harness 不受影响。Host 需提供 storageDomain、fs、workspaceRegistry、sessionController、connection、tools、subagents、agents、credentials、skills，以及 persona、文件和问答工具。扩展自行注册 `cpic-case-design` 子 Agent 提供方。

<a id="configure-the-source"></a>
## 配置来源

需求来源和 QA 记录由 XTEST 内部 CPIC HTTP API 提供。Host 可通过 `POST /projects/list` 并提交 `{}`，获取绑定用户获分配的项目 `{ p_sid, p_name }` 列表；该列表独立于需求记录，XTEST 根据可信身份请求头执行授权。浏览器不会收到 API 地址或密钥。

将仅服务端使用的 `database.apiUrl` 配置为以 `/api/dsh/internal/cpic` 结尾的 XTEST CPIC API 根地址，并配置 `database.apiSecret`、`database.userIdentity` 和 `database.tenantId`。Gateway 将地址和密钥注入各租户进程；用户和租户请求头来自服务端租户注册表。缺少配置或可信租户身份时 Host 启动失败。非 loopback 的 XTEST 地址必须使用 HTTPS。浏览器不会收到该地址或密钥。XTEST 在现有 `cpic_qa_*` 记录上读写；不执行自动迁移，也不提供公开的旧数据迁移接口。XTEST 返回的业务失败原因会以受限长度显示在 Host 错误后，便于管理员定位服务端配置或数据库问题。需求正文保存使用当前正文哈希执行条件更新，正文冲突时拒绝覆盖并要求刷新。

<a id="use-the-workbench"></a>
## 使用工作台

打开“需求分析”，点击“导入 Markdown”打开弹窗。弹窗上方集中填写基本信息，下方分别显示文件选择区和全宽 Markdown 编辑器，底部固定显示关闭和导入操作；窄窗口下信息字段自动排成单列。按名称选择已授权系统，加载 `.md`/`.txt` 文件或在 Vditor 中编辑 Markdown，然后提交导入。经认证的 `/api/cpic.requirements` `projects` 操作独立返回 XTEST 分配项目，不依赖需求或本地导入；空列表是有效结果，响应字段无效或超限时会报错。工作台通过经认证的 `/api/cpic.requirements` `projects` 操作加载授权项目，导入弹窗和系统筛选器共用 `{ p_sid, p_name }` 列表，因此没有需求的项目也可选择。空列表有效，响应无效或超限时会报错；项目加载失败会保留需求列表、提供重试，并在列表加载成功前禁用系统选择。来源、系统和稳定 ID 决定工作区身份。新导入的租户本地 Markdown 需求将所选系统 sid 保存到 `p_sid`、系统名称保存到 `p_name`，同时保留 `system` 和 `systemName` 供工作台读取；不自动回填已有记录。需求列表合并已授权的 XTEST 需求与租户本地导入。工作台启动时会从需求存储中删除来源为 `ta4cpic` 的历史本地需求，并拒绝该来源的新导入；已有分析运行和不可变快照会保留。列表显示 XTEST 系统名称，系统 ID 仅用于稳定身份和 Host 请求；可通过紧凑的需求搜索框和系统下拉框筛选已授权结果。系统展示名称优先读取 XTEST 响应和租户本地记录中的 `p_name`，其次使用 `systemName` 或 XTEST 的 `projectName`；没有可用名称时仍回退为系统 ID。点击需求可查看正文；Vditor Markdown 编辑器默认以所见即所得模式打开，可按需切换编辑模式或进入全屏，再保存 Markdown 原文。编辑器使用 shell 中的 Vditor 3.11.3 实现，并通过经认证的同源 `/api/cpic.assets/vditor/3.11.3` 加载随包携带的完整 3.11.3 资源，无需公共 CDN。`/api/cpic.editor` 返回统一版本和资源根地址。`editorAssets.directory` 可指定包含同版本 `package.json` 和完整 `dist` 的绝对目录；`editorAssets.baseUrl` 可指定提供同版本资源的同源路径或 HTTP(S) 根地址。不能混用 XTEST 的 3.11.2 资源。缺少本地必要文件或清单版本不匹配时启动失败；编辑器配置或样式加载失败时显示编辑器告警。Host 通过 XTEST 的项目权限和正文哈希执行条件更新。保存后的内容用于后续新建分析会话；已经准备的分析仍使用原有不可变快照。浏览不会创建工作区、会话或模型请求。准备操作写入不可变快照，创建案例设计会话并初始化草稿；工作区和会话均命名为“需求名称 - 需求编号”。会话输入栏的“项目雷达”会打开右侧会话页，显示当前运行状态、阶段、已提交的需求/功能/场景/案例数量和可用产物；产物以可换行的浮动按钮呈现。点击任意产物都会在右侧资源查看器中打开。运行中的分析会自动刷新。发送草稿或点击“开始分析”。

<a id="traceability-analysis"></a>
## 溯源分析

会话侧栏“项目雷达”读取当前打开会话绑定的运行，并依据持久化运行记录显示已提交阶段；仅有终态状态不会将未提交阶段标记为完成。在 [workflow 面板](../dsh-workflow-panel/README.zh.md#use-the-panel)打开任意案例设计运行，选择“溯源分析”。CPIC 服务提供该次运行的固定快照与已提交阶段数据用于只读校验；需求列表不提供溯源操作。报告会立即检查连续已提交阶段，并将后续未提交阶段标记为部分溯源，不隐藏入口。图中展示每个已提交条目，并依据功能点的 `requirementIds`、场景的 `featureIds` 和用例的 `scenarioIds` 为相邻阶段的实际引用逐项连边；点击条目会高亮其跨阶段祖先与后代，不会高亮同阶段的兄弟条目；其他阶段列会自动定位到该列第一个高亮条目，被点击条目所在列保持原位。

重新发起分析时使用新的请求 ID；同一工作区可保留多次独立运行。浏览器通过 `crypto.getRandomValues` 生成准备请求 ID，支持内网 HTTP 地址。准备失败时显示错误并允许再次操作。相同请求 ID 的重试复用其会话和快照。内容或版本变化产生新的不可变快照。若关联目录缺失或路径被其他内容占用，准备操作会停止，不会静默重建或迁移目录。

[案例设计流水线](#case-design-pipeline)以六个串行节点执行 cleanup、features、outline 和 testcases 四个阶段。每个阶段产物中的 `id` 是程序生成的阶段对象 ID；`sourceRefs` 则必须是固定快照中的一基线一行号范围，不能把对象 ID 当作行号，也不能引用快照范围之外的行。影响行为、覆盖范围、前置条件或预期结果的缺口会阻止后续阶段，直到用户通过 `clarify` 提供答复。用户可授权模型对列明的缺口提出标记为“模型判断，待确认”的候选解释；这些解释不是已确认的需求事实。生成后更改输入需新建分析。

<a id="case-design-pipeline"></a>
## 案例设计流水线

案例设计运行以六个串行节点执行 cleanup、features、outline 和 testcases 四个阶段：`clarify` 与 `extract` 生成 cleanup 和 features 阶段，`outline-gen` 生成、`outline-review` 评审 outline 阶段，`case-gen` 生成、`case-review` 评审 testcases 阶段。每个节点指定一个绑定专属技能和角色工作区的执行角色，以及一个按该节点门禁规则核验节点产物并记录节点检查的独立评审角色；独立评审不改写产物，也不批准自己的生成。只有该阶段的全部节点检查按流水线顺序通过，阶段才会提交。

每个节点在自己的 `case-role-<role>` 预设下运行：角色 persona、限定到唯一角色工作区技能目录的 skill provider，以及角色 guard。guard 仅按名称为执行角色重新放行全局 `skill` 工具，并在执行时只接受其绑定技能，因此每个角色只能发现并加载自己的流程；评审角色没有技能。六个随附角色流程以 create-if-absent 方式写入 `<rootDirectory>/workspaces/<workspace>/.dsh/skills/` 下的 `SKILL.md`；已有文件保持不变，部署方可自定义角色流程。

评审检查失败会拒绝本次尝试。尝试次数低于 `maxAttempts` 加已授予修订数时，阶段重新进入修订，否则进入 blocked；`case_design` 的 `unblock` 携带用户的明确原因，每次授予将被阻塞的阶段重新开放恰好一次修订，并把原因记录在阶段上，被阻塞的节点在此之前保持阻塞。流水线运行以 `completed` 或 `blocked` 结束：评审用尽不再带问题提交候选，因此 `completed_with_issues` 不再出现。

生效模板是经过校验的 YAML 定义 [pipeline.yaml](pipeline.yaml)（schema 版本 2，serial 模式），或 `pipelinePath` 选定的文件。`cpicRequirements` 服务通过 `getPipelineConfig` 和 `updatePipelineConfig` 读取和整体替换它，替换前校验完整节点列表，无效定义整份拒绝且不保存；每次运行在开始时固化生效定义，因此修改只影响新运行。[workflow 面板](../dsh-workflow-panel/README.zh.md#use-the-panel)展示每次运行的节点状态和流水线配置编辑器。流水线模型之前的运行不带流水线定义，保持记录时的四阶段执行语义；存储声明 `compatibleVersions: [1]` 使其无需迁移即可读取，任何操作都不会改写它们。

案例设计任务数据受 `maxTaskInputBytes` 限制（默认 16000 个 UTF-8 字节）；组装后的任务提示受 `maxTaskPromptBytes` 限制（默认 32768 字节），不含提供方系统提示和工具 schema。需求清理优先按 Markdown 段落、标题分片，并保留原始行号；后续阶段每批最多处理 `maxBatchItems` 个上游条目（默认 4），携带关联祖先及引用原文。独立评审和 Judge 检查所有输出分片。Host 在提交前校验汇总结果的 ID、原文引用和覆盖关系。模型返回 `max-tokens` 时，受影响分片会拆小后重试；单个不可再分的条目仍超限时，以 `MODEL_OUTPUT_LIMIT` 停止。不接受或直接拼接截断的结构化 JSON。`maxOutputBytes` 限制汇总后的阶段产物。这些字节预算不保证模型 token 数，运维须为分词器、角色流程、系统提示和工具留出余量。分片任务的跨章节上下文有限，用户须复核文档级规则和矛盾。

`stageTimeoutMs` 默认 900000 毫秒，限制一次 advance 操作的所有分片及检查。超时报告 `STAGE_TIMEOUT`，保留最后已提交检查点供重试；显式取消仍会取消运行。普通对话中的输出上限提示表示模型用尽输出预算，散文回答可发送“继续”，案例设计的结构化任务通过细分恢复。

<a id="cpic-oa-质量控制台"></a>
## CPIC-oa 质量控制台

Gateway 租户通过已发现的浏览器入口加载 CPIC-oa。控制台仅将已完成案例设计运行导入为版本化用例计划，并校验不可变快照和用例数据。Host 校验审批版本、执行权限、缺陷状态和项目门禁；客户端字段不作为授权依据。XTEST 根据已绑定用户及其被分配项目授权需求列表和详情访问。

QA 项目、计划、人工执行记录、缺陷和审计由 XTEST 保存在现有 `cpic_qa_projects`、`cpic_qa_plans`、`cpic_qa_executions`、`cpic_qa_defects` 和 `cpic_qa_audits` 记录中。所有读写均使用 Gateway 提供的可信租户 ID。旧记录保持原位；租户进程启动时不会复制或删除记录。

证据是文本说明或工作区文件引用，不上传附件。当前不提供浏览器自动化、跨租户共享、团队角色、自动发布或 XTEST 源数据写回。

独立 dsh-qa 工作台将项目数据保存在本地 JSON 文件中，其内置 Host 代理只接受 loopback 请求。Gateway 租户改用已认证的 CPIC-oa Host 操作和由 XTEST 保存、按 tenant-key 隔离的记录；不会将 dsh-qa 的完整看板作为远程租户页面挂载。

<a id="execution-and-storage"></a>
## 执行与存储

案例设计运行和需求快照保存在本地 `cpic_requirements` storage domain 及租户工作区。QA 数据只保存在 XTEST QA 表。完成态要求所有阶段的必要评审或节点检查通过、用例 JSON 有效，并且最终文件回读一致。进程重启后，未完成或执行结果不明的运行不会自动重放模型请求。用户显式重试时，如果原顶层 Session 当前不在内存中，工作台会通过 Host sessionController 恢复该 Session，再继续可恢复的 pending、failed 或 cancelled checkpoint。

适配器从 XTEST 加载租户记录，并使用服务端 SHA-256 哈希执行条件更新和删除。审计记录只允许追加。数据库访问、项目授权和租户隔离由 XTEST 管理。

<a id="verification"></a>
## 验证

从扩展目录运行测试：

```powershell
pnpm test
```

测试使用受控模型和模拟 HTTP 响应；它们不验证生产 XTEST 凭据、数据库权限、真实模型输出或已运行 Gateway 页面的外观。

<a id="model-experience"></a>
## 模型体验

`requirements` 工具提供与工作台相同的需求操作。`case_design` 工具只在案例设计预设中可用，按单个流水线节点推进一个运行；它不接受任意运行 ID。每个流水线节点在自己的 `case-role-<role>` 预设下运行，接收任务提供的快照、上游产物和门禁规则；该预设只暴露 `structured_output`，执行角色另有一个加载其绑定角色流程的 `skill` 工具，评审角色没有技能，角色 guard 拒绝其他所有工具调用。独立的 `cpic-case-design-worker` 预设服务四阶段运行，只提供结构化输出。工作器不继承主会话的编排指令。成本随需求长度和修订次数增长。需求正文和模型输出按既有会话日志规则处理；Host 将 QA 业务记录发送给 XTEST，由 XTEST 保存为按租户隔离的 `cpic_qa_*` 记录。

<a id="known-limitations"></a>
## 已知限制

此工作台面向个人负责人，不提供租户成员管理或共享授权。Gateway 租户身份来自服务器端租户注册表。部署方须验证数据库连接、账号权限和现有 QA 表结构。手工执行不等同于自动化执行，证据文件仍由用户管理。
