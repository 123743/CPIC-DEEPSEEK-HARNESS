/** Standalone workflow run dashboard; Harness services enter through injected callbacks. */
window.__ModuleLoader__.load({
  id: '@dsh-external/workflow-panel',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const NS = 'dsh.workflow.panel';
    const dictionaries = {
      en: {
        panel: 'Workflow runs', title: 'Workflow runs', refresh: 'Refresh', back: 'Back to runs',
        traceability: 'Traceability', traceTitle: 'Traceability analysis', traceLoadError: 'Could not analyze traceability. Try again.', traceLoading: 'Analyzing traceability', tracePass: 'All traceability links are connected', tracePartial: 'Partial traceability; not all stages are committed yet', traceIssues: 'Traceability issues found', incompleteStages: 'Not committed', forward: 'Forward', reverse: 'Reverse', total: 'Items', issueCount: 'Issues',
        stageCleanup: 'Requirement cleanup', stageFeatures: 'Feature analysis', stageOutline: 'Scenario outline', stageTestcases: 'Test case design',
        nodeClarify: 'Clarify requirements', nodeExtract: 'Extract requirements', nodeOutlineGen: 'Generate outline', nodeOutlineReview: 'Review outline', nodeCaseGen: 'Generate test cases', nodeCaseReview: 'Review test cases',
        loading: 'Loading', empty: 'No workflow or case-design runs yet.',
        queryError: 'Could not load workflow runs. Use Refresh to try again.',
        detailError: 'Could not load this run. Select it again to retry.',
        retry: 'Retry', retrying: 'Retrying…', retryError: 'Could not continue this case-design run. The displayed details are unchanged.',
        artifactError: 'Could not load this artifact. Try opening it again.',
        invalidResponse: 'The server returned an invalid response.',
        transportError: 'The server could not be reached.',
        statusRunning: 'Running', statusPaused: 'Paused', statusCompleted: 'Completed',
        statusFailed: 'Failed', statusDenied: 'Denied', statusStopped: 'Stopped', statusInterrupted: 'Interrupted', statusBlocked: 'Blocked',
        statusUnverified: 'Unverified', statusUncertain: 'Unconfirmed', statusUnknown: 'Other status', statusPending: 'Pending',
        statusIssues: 'Completed with issues', statusWaitingInput: 'Waiting for input', caseDesign: 'Case design',
        started: 'Started', ended: 'Ended', phase: 'Phase', agents: 'Agents', agentsStarted: 'started', agentsActive: 'active', agentsSeparator: ', ', tokens: 'Tokens',
        artifacts: 'Artifacts', result: 'Result', source: 'Source', execution: 'Execution',
        workflow: 'Workflow', description: 'Description', maxAgents: 'Max agents',
        maxConcurrency: 'Max concurrency', readOnly: 'Read-only', yes: 'Yes', no: 'No',
        allWorkspaces: 'All workspaces', workspace: 'Workspace', unassignedWorkspace: 'Unassigned workspace', unassignedSession: 'Session unavailable', session: 'Session',
        phases: 'Phases', counts: 'Process counts', progress: 'Progress', manifestTitle: 'Workflow',
        costTitle: 'Cost', totalTokens: 'Total tokens', totalCost: 'Cost (USD)', tier: 'Tier',
        calls: 'Calls', inputTokens: 'Input', outputTokens: 'Output',
        processTitle: 'Run graph', showGraph: 'Show run graph', hideGraph: 'Hide run graph', graphEmpty: 'No run graph recorded yet.', graphError: 'Could not load the run graph. Try again.', graphKind: 'Kind', graphItem: 'Item', graphStatus: 'Status',
        graphSummary: 'Summary', origin: 'Origin', originCache: 'From cache',
        eventsTitle: 'Recorded events', eventsEmpty: 'No events recorded for this run.',
        seq: '#', time: 'Time', type: 'Type', workflowLane: 'Workflow', eventLane: 'Event', artifactOpen: 'Preview artifact',
        kindPhase: 'Phase', kindAgent: 'Agent', kindStep: 'Step', kindArtifact: 'Artifact', kindWorkflow: 'Workflow',
        relationEvidence: 'References task evidence', rawJson: 'Raw JSON', nullValue: 'null',
        nodeStatusCompleted: 'Completed', nodeStatusRunning: 'In progress', nodeStatusBlocked: 'Blocked', nodeStatusPending: 'Not started', nodeStatusUncertain: 'Unconfirmed',
        kindGenerate: 'Generate', kindReview: 'Review', attempts: 'Attempts', judgeVerdict: 'Judge result', judgePassed: 'Passed', judgeNotPassed: 'Not passed',
        checksTitle: 'Checks', checksEmpty: 'No judge checks recorded yet.', outputTitle: 'Output', blockedReason: 'Blocked reason',
        role: 'Role', skill: 'Skill', judgeRole: 'Judge role', judgeRule: 'Judge rule', judgeSkill: 'Judge skill',
        pipelineTitle: 'Pipeline progress', pipelineConfigTitle: 'Pipeline configuration', pipelineShow: 'Show pipeline configuration', pipelineHide: 'Hide pipeline configuration',
        pipelineHint: 'Changes apply to new runs only.', pipelineUnavailable: 'Pipeline configuration is unavailable.', pipelineLoadError: 'Could not load the pipeline configuration. Try again.',
        pipelineSave: 'Save', pipelineSaving: 'Saving…', pipelineCancel: 'Cancel', pipelineSaveError: 'Could not save the pipeline configuration. The edits are kept.',
      },
      zh: {
        panel: 'Workflow 运行', title: 'Workflow 运行', refresh: '刷新', back: '返回运行列表',
        traceability: '溯源', traceTitle: '溯源分析', traceLoadError: '无法分析溯源链路，请重试', traceLoading: '正在分析溯源', tracePass: '溯源链路完整', tracePartial: '部分溯源，尚有阶段未提交', traceIssues: '发现溯源问题', incompleteStages: '尚未提交', forward: '正向', reverse: '反向', total: '项目数', issueCount: '问题数',
        stageCleanup: '需求整理', stageFeatures: '功能分析', stageOutline: '场景大纲', stageTestcases: '用例设计',
        nodeClarify: '需求澄清', nodeExtract: '需求提取', nodeOutlineGen: '大纲生成', nodeOutlineReview: '大纲评审', nodeCaseGen: '用例生成', nodeCaseReview: '用例评审',
        loading: '加载中', empty: '还没有 workflow 或案例设计运行记录。',
        queryError: '无法加载 workflow 运行记录，请点击刷新重试',
        detailError: '无法加载该运行，请重新选择以重试',
        retry: '重试', retrying: '正在重试…', retryError: '无法继续此案例设计运行，当前详情保持不变',
        artifactError: '无法加载该产物，请重新打开重试',
        invalidResponse: '服务器返回的数据无效', transportError: '无法连接服务器',
        statusRunning: '运行中', statusPaused: '已暂停', statusCompleted: '已完成',
        statusFailed: '失败', statusDenied: '被拒绝', statusStopped: '已停止', statusInterrupted: '已中断', statusBlocked: '已阻塞',
        statusUnverified: '结果未验证', statusUncertain: '状态待确认', statusUnknown: '其他状态', statusPending: '待处理',
        statusIssues: '已完成但有问题', statusWaitingInput: '等待输入', caseDesign: '案例设计',
        started: '开始', ended: '结束', phase: '阶段', agents: '子 Agent', agentsStarted: '已启动', agentsActive: '运行中', agentsSeparator: '，', tokens: 'Token',
        artifacts: '产物', result: '结果', source: '来源', execution: '执行方式',
        workflow: 'Workflow', description: '描述', maxAgents: '最大子 Agent 数',
        maxConcurrency: '最大并发', readOnly: '只读', yes: '是', no: '否',
        allWorkspaces: '全部工作区', workspace: '工作区', unassignedWorkspace: '未归属工作区', unassignedSession: '会话信息不可用', session: '会话',
        phases: '阶段列表', counts: '进程计数', progress: '进度', manifestTitle: 'Workflow 信息',
        costTitle: '成本', totalTokens: '总 Token', totalCost: '成本（美元）', tier: '档位',
        calls: '调用次数', inputTokens: '输入', outputTokens: '输出',
        processTitle: '运行图', showGraph: '查看运行图', hideGraph: '收起运行图', graphEmpty: '尚未记录运行图', graphError: '无法加载运行图，请重试', graphKind: '类型', graphItem: '条目', graphStatus: '状态',
        graphSummary: '摘要', origin: '来源', originCache: '来自缓存',
        eventsTitle: '已记录事件', eventsEmpty: '该运行没有记录事件。',
        seq: '序号', time: '时间', type: '类型', workflowLane: 'Workflow', eventLane: '事件', artifactOpen: '预览产物',
        kindPhase: '阶段', kindAgent: '子 Agent', kindStep: '步骤', kindArtifact: '产物', kindWorkflow: 'Workflow',
        relationEvidence: '引用任务证据', rawJson: '原始 JSON', nullValue: 'null',
        nodeStatusCompleted: '完成', nodeStatusRunning: '进行中', nodeStatusBlocked: '阻塞', nodeStatusPending: '未开始', nodeStatusUncertain: '待确认',
        kindGenerate: '生成', kindReview: '评审', attempts: '尝试次数', judgeVerdict: '评审结论', judgePassed: '通过', judgeNotPassed: '不通过',
        checksTitle: '核验记录', checksEmpty: '还没有核验记录。', outputTitle: '输出', blockedReason: '阻塞原因',
        role: '角色', skill: '技能', judgeRole: '评审角色', judgeRule: '评审规则', judgeSkill: '评审技能',
        pipelineTitle: '流水线进度', pipelineConfigTitle: '流水线配置', pipelineShow: '查看流水线配置', pipelineHide: '收起流水线配置',
        pipelineHint: '修改只影响新建运行。', pipelineUnavailable: '流水线配置不可用。', pipelineLoadError: '无法加载流水线配置，请重试',
        pipelineSave: '保存', pipelineSaving: '正在保存…', pipelineCancel: '取消', pipelineSaveError: '无法保存流水线配置，编辑内容保持不变。',
      },
    };
    const css = `
      .wf-panel{box-sizing:border-box;color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5;min-width:0}
      .wf-panel *{box-sizing:border-box}
      .wf-panel-page{width:100%;max-width:100%;height:100%;min-width:0;overflow:auto;padding:24px;container-type:inline-size}
      [data-platform='darwin'] .wf-panel-page{padding-top:calc(var(--dsh-frame-top-clearance,0px) + 24px)}
      .wf-panel h1,.wf-panel h2,.wf-panel h3{font-weight:500;margin:0}
      .wf-panel h1{font-size:20px}.wf-panel h2{font-size:16px}.wf-panel h3{font-size:13px}
      .wf-panel-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:16px}
      .wf-panel-toolbar h1,.wf-panel-toolbar h2{margin-right:auto}
      .wf-panel select{font:inherit;color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l3);border-radius:8px;background:var(--dsw-alias-bg-layer-2);padding:7px 10px;max-width:100%}
      .wf-panel button{font:inherit;color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l3);border-radius:8px;background:var(--dsw-alias-bg-layer-2);padding:7px 10px;max-width:100%;cursor:pointer;text-align:left}
      .wf-panel button:hover{background:var(--dsw-alias-interactive-bg-hover)}
      .wf-panel button:disabled{opacity:.5;cursor:default}
      .wf-panel button:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
      .wf-panel ul{list-style:none;padding:0;margin:0}.wf-panel li{margin-bottom:8px}
      .wf-panel-run{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:start;gap:8px}
      .wf-panel-row{display:block;width:100%;min-width:0;overflow-wrap:anywhere}
      .wf-panel-graph-preview{white-space:nowrap}
      .wf-panel-graph-preview-content{grid-column:1 / -1;min-width:0}
      .wf-panel-row-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
      .wf-panel-row-name{font-weight:500}
      .wf-panel-row-meta{display:flex;gap:8px;flex-wrap:wrap;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
      .wf-panel-row-summary{display:block;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;margin-top:2px}
      .wf-chip{display:inline-flex;align-items:center;gap:4px;padding:1px 8px;border:1px solid var(--dsw-alias-border-l3);border-radius:999px;background:var(--dsw-alias-bg-layer-2);font-size:12px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
      .wf-chip-dot{width:6px;height:6px;border-radius:50%;background:currentColor}
      .wf-status-running{color:var(--dsw-alias-state-business-primary)}
      .wf-status-completed{color:var(--dsw-alias-state-success-primary)}
      .wf-status-failed,.wf-status-denied{color:var(--dsw-alias-state-error-primary)}
      .wf-status-paused,.wf-status-stopped{color:var(--dsw-alias-label-secondary)}
      .wf-panel-card{border:1px solid var(--dsw-alias-border-l3);border-radius:8px;padding:16px;margin-bottom:16px}
      .wf-panel-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px}
      .wf-panel-kv{display:flex;gap:8px;flex-wrap:wrap;color:var(--dsw-alias-label-secondary)}
      .wf-panel-kv b{font-weight:500;color:var(--dsw-alias-label-primary)}
      .wf-panel-item{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap;border-bottom:1px solid var(--dsw-alias-border-l1);padding:6px 0;overflow-wrap:anywhere}
      .wf-panel-item-main{min-width:0;flex:1}
      .wf-run-graph-scroll{max-width:100%;overflow:auto;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1)}
      .wf-run-graph-canvas{position:relative;min-height:128px}
      .wf-run-graph-edges{position:absolute;inset:0;overflow:visible;pointer-events:none}
      .wf-run-graph-edge{fill:none;stroke:var(--dsw-alias-border-l3);stroke-width:1.5}
      .wf-run-graph-edge-reference{stroke:var(--dsw-alias-state-business-primary);stroke-width:2}
      .wf-run-graph-node{position:absolute;width:220px;min-height:74px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l3);border-left:3px solid var(--dsw-alias-border-l3);border-radius:6px;background:var(--dsw-alias-bg-layer-2);overflow-wrap:anywhere}
      .wf-run-graph-node-running{border-left-color:var(--dsw-alias-state-business-primary)}
      .wf-run-graph-node-completed{border-left-color:var(--dsw-alias-state-success-primary)}
      .wf-run-graph-node-failed,.wf-run-graph-node-denied{border-left-color:var(--dsw-alias-state-error-primary)}
      .wf-run-graph-node-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
      .wf-run-graph-node-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500}
      .wf-run-graph-node-summary{display:block;margin-top:4px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .wf-trace-graph-scroll{max-width:100%;overflow-x:auto;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1)}
      .wf-trace-graph-canvas{display:grid;grid-template-columns:repeat(4,minmax(260px,1fr));gap:12px;min-width:1088px;padding:12px}
      .wf-trace-graph-lane{display:flex;min-width:0;flex-direction:column;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1)}
      .wf-trace-graph-lane-title{position:sticky;top:0;z-index:1;padding:8px 10px;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);font-weight:500}
      .wf-trace-graph-lane-items{position:relative;height:520px;overflow-y:auto;overscroll-behavior:contain;padding:10px}
      .wf-trace-graph-lane-items>.wf-trace-graph-node+.wf-trace-graph-node{margin-top:8px}
      .wf-trace-graph-edge{fill:none;stroke:var(--dsw-alias-border-l3);stroke-width:1.5}
      .wf-trace-graph-edge-reference{stroke:var(--dsw-alias-state-business-primary);stroke-width:2}
      .wf-trace-graph-node{position:relative;width:100%;min-height:96px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l3);border-left:3px solid var(--dsw-alias-border-l3);border-radius:6px;background:var(--dsw-alias-bg-layer-2);overflow-wrap:anywhere}
      .wf-trace-graph-node-running{border-left-color:var(--dsw-alias-state-business-primary)}
      .wf-trace-graph-node-completed{border-left-color:var(--dsw-alias-state-success-primary)}
      .wf-trace-graph-node-failed,.wf-trace-graph-node-denied{border-left-color:var(--dsw-alias-state-error-primary)}
       .wf-trace-graph-node-selectable{cursor:pointer;text-align:left;font:inherit;color:inherit}
       .wf-trace-graph-node-selected{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}
       .wf-trace-graph-node-related{border-color:var(--dsw-alias-state-business-primary)}
       .wf-trace-graph-node-unrelated{opacity:.45}
      .wf-trace-graph-node-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
      .wf-trace-graph-node-title{min-width:0;overflow-wrap:anywhere;font-weight:500}
      .wf-trace-graph-node-summary{display:block;margin-top:4px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .wf-sequence-scroll{width:100%;min-width:0;max-width:100%;overflow-x:auto;overflow-y:hidden;scrollbar-gutter:stable;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1)}
       .wf-sequence-scrollbar{position:sticky;top:0;z-index:2;width:100%;height:48px;overflow-x:auto;overflow-y:hidden;background:var(--dsw-alias-bg-layer-1)}
       .wf-sequence-scrollbar-inner{display:grid;grid-template-columns:repeat(var(--wf-lane-count),220px);gap:24px;height:48px;align-items:start}
       .wf-sequence-scrollbar-title{justify-self:center;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:4px 10px;border:1px solid var(--dsw-alias-border-l3);border-radius:6px;background:var(--dsw-alias-bg-layer-2);font-weight:500}
      .wf-sequence{position:relative;min-height:120px;padding:16px}
      .wf-sequence-lanes{display:grid;grid-template-columns:repeat(var(--wf-lane-count),minmax(160px,1fr));gap:16px;min-width:max-content}
      .wf-sequence-lane{position:relative;min-height:100%;text-align:center}
      .wf-sequence-lane-title{display:inline-block;position:sticky;top:0;padding:4px 10px;border:1px solid var(--dsw-alias-border-l3);border-radius:6px;background:var(--dsw-alias-bg-layer-2);font-weight:500;z-index:1}
      .wf-sequence-lifeline{position:absolute;top:36px;bottom:0;left:50%;border-left:1px dashed var(--dsw-alias-border-l3)}
      .wf-sequence-events{position:absolute;inset:48px 16px 12px;pointer-events:none}
      .wf-sequence-event{position:absolute;width:100%;height:32px;color:var(--dsw-alias-label-secondary)}
      .wf-sequence-event-note{display:block;text-align:center}
      .wf-sequence-arrow{position:absolute;left:0;right:0;top:16px;height:0;border-top:1.5px solid var(--dsw-alias-state-business-primary)}
      .wf-sequence-arrow:after{content:'';position:absolute;right:-1px;top:-4px;border-top:3px solid transparent;border-bottom:3px solid transparent;border-left:5px solid var(--dsw-alias-state-business-primary)}
      .wf-sequence-arrow-reverse:after{right:auto;left:-1px;border-left:0;border-right:5px solid var(--dsw-alias-state-business-primary)}
      .wf-sequence-label{position:absolute;left:50%;top:0;transform:translateX(-50%);width:max-content;max-width:260px;padding:4px 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);text-align:left;overflow-wrap:anywhere;z-index:1}
      .wf-sequence-meta{display:flex;gap:8px;flex-wrap:wrap;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
      .wf-artifacts{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin:8px 0 16px}
      .wf-artifact-preview{flex-basis:100%;min-width:0}
       
              
      .wf-panel-meta strong{font-weight:500;color:var(--dsw-alias-label-primary)}
      .wf-panel-detail-title{font-size:20px;font-weight:500;margin:0 0 8px;overflow-wrap:anywhere}
      .wf-panel-error{color:var(--dsw-alias-state-error-primary);overflow-wrap:anywhere;margin:8px 0;min-height:20px}
      .wf-panel-loading{display:flex;justify-content:center;padding:24px}
      .wf-panel-spinner{width:20px;height:20px;border:2px solid var(--dsw-alias-border-l3);border-top-color:var(--dsw-alias-label-primary);border-radius:50%;animation:wf-panel-spin 1s linear infinite}
      @keyframes wf-panel-spin{to{transform:rotate(360deg)}}
      @media(prefers-reduced-motion:reduce){.wf-panel-spinner{animation:none}}
      .wf-panel pre{font-family:monospace;white-space:pre-wrap;overflow-wrap:anywhere;max-height:320px;overflow:auto;margin:8px 0;padding:16px;border:1px solid var(--dsw-alias-border-l3);border-radius:8px;background:var(--dsw-alias-bg-layer-2)}
      .wf-panel-empty{color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
      .wf-result-fields,.wf-result-array{margin:0 0 0 6px;padding:0 0 0 14px;list-style:none;border-left:1px solid var(--dsw-alias-border-l3)}
      .wf-result-field,.wf-result-entry{position:relative;display:grid;grid-template-columns:minmax(100px,180px) minmax(0,1fr);gap:12px;padding:7px 0;border-bottom:1px solid var(--dsw-alias-border-l1);overflow-wrap:anywhere}
      .wf-result-field:before,.wf-result-entry:before{content:'';position:absolute;left:-15px;top:15px;width:12px;border-top:1px solid var(--dsw-alias-border-l3)}
      .wf-result-key,.wf-result-index{color:var(--dsw-alias-label-secondary)}
      .wf-result-value{min-width:0;margin:0}
      .wf-result-value>.wf-result-fields,.wf-result-value>.wf-result-array{margin-top:6px}
      .wf-result-raw{margin-top:12px}
      .wf-result-raw summary{cursor:pointer;color:var(--dsw-alias-label-secondary)}
      @media(max-width:640px){.wf-result-field,.wf-result-entry{grid-template-columns:minmax(0,1fr);gap:2px}}
      @media(max-width:640px){.wf-panel-page{padding:16px}.wf-panel-grid{grid-template-columns:1fr}}
      .wf-panel input,.wf-panel textarea{font:inherit;color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l3);border-radius:8px;background:var(--dsw-alias-bg-layer-2);padding:7px 10px;max-width:100%}
      .wf-pipeline-config-content{margin:8px 0;min-width:0}
      .wf-pipeline-config-hint{color:var(--dsw-alias-label-secondary);margin:8px 0}
      .wf-pipeline-config-nodes{list-style:decimal;padding-left:24px;margin:8px 0}
      .wf-pipeline-config-node{border:1px solid var(--dsw-alias-border-l3);border-radius:8px;padding:10px 12px;margin-bottom:8px;min-width:0}
      .wf-pipeline-config-head{display:flex;gap:8px;align-items:center;flex-wrap:wrap;width:100%}
      .wf-pipeline-config-fields{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px;margin:8px 0}
      .wf-pipeline-config-field{display:flex;flex-direction:column;gap:4px;min-width:0;color:var(--dsw-alias-label-secondary)}
      .wf-pipeline-config-actions{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0}
      .wf-pipeline-nodes{list-style:none;padding:0;margin:0}
      .wf-pipeline-node{border:1px solid var(--dsw-alias-border-l3);border-left:3px solid var(--dsw-alias-border-l3);border-radius:8px;padding:10px 12px;margin-bottom:8px;min-width:0}
      .wf-pipeline-node-blocked{border-color:var(--dsw-alias-state-error-primary);border-left-color:var(--dsw-alias-state-error-primary)}
      .wf-pipeline-node-head{display:flex;gap:8px;align-items:center;flex-wrap:wrap;width:100%}
      .wf-pipeline-node-title{font-weight:500;min-width:0;overflow-wrap:anywhere}
      .wf-pipeline-blocked{color:var(--dsw-alias-state-error-primary);overflow-wrap:anywhere;margin:6px 0}
      .wf-pipeline-node-body{margin-top:8px;min-width:0}
      .wf-status-blocked{color:var(--dsw-alias-state-error-primary)}
    `;
    const isText = value => typeof value === 'string';
    const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
    const isRunSummary = value => isRecord(value) && isText(value.runId) && isText(value.status)
      && isText(value.workflow) && (value.displayName === undefined || isText(value.displayName))
      && (value.workspaceId === undefined || isText(value.workspaceId))
      && (value.workspaceName === undefined || isText(value.workspaceName))
      && (value.sessionId === undefined || isText(value.sessionId))
       && (value.sessionName === undefined || isText(value.sessionName))
      && (value.startedAt === undefined || isText(value.startedAt) || typeof value.startedAt === 'number')
      && (value.cost === undefined || isRecord(value.cost));
    const isDetail = value => isRecord(value) && isRecord(value.snapshot) && isText(value.snapshot.runId)
      && Array.isArray(value.events) && value.events.every(event => isRecord(event)
        && typeof event.seq === 'number' && isText(event.type));
    const TRACE_STAGE_KEYS = { stageCleanup: 'requirements', stageFeatures: 'features', stageOutline: 'scenarios', stageTestcases: 'testcases' };
    const isTraceability = value => isRecord(value) && ['PASS', 'ISSUES', 'PARTIAL'].includes(value.status)
      && Array.isArray(value.incompleteStages) && value.incompleteStages.every(stage => Object.hasOwn(TRACE_STAGE_KEYS, stage))
      && isRecord(value.counts) && Object.values(TRACE_STAGE_KEYS).every(key => Number.isSafeInteger(value.counts[key]) && value.counts[key] >= 0)
      && Number.isSafeInteger(value.sourceReferenceCount) && value.sourceReferenceCount >= 0
      && Array.isArray(value.checks) && value.checks.every(check => isRecord(check)
        && ['forward', 'reverse'].includes(check.direction) && Object.hasOwn(TRACE_STAGE_KEYS, check.from) && Object.hasOwn(TRACE_STAGE_KEYS, check.to)
        && Number.isSafeInteger(check.totalCount) && check.totalCount >= 0 && Number.isSafeInteger(check.issueCount) && check.issueCount >= 0
        && Array.isArray(check.issues) && check.issues.every(issue => isRecord(issue) && isText(issue.id) && isText(issue.title)))
      && (value.graph === null || value.graph === undefined || isFlowGraph(value.graph));
    const isArtifact = value => isRecord(value) && isText(value.name) && value.content !== undefined;
    const isFlowGraph = value => {
      if (!isRecord(value) || ![1, 2].includes(value.version) || !Array.isArray(value.nodes) || value.nodes.length === 0 || !Array.isArray(value.edges)) return false;
      const nodeIds = new Set(value.nodes.filter(node => isRecord(node) && isText(node.id)).map(node => node.id));
      // Version 2 graphs are generated from pipeline nodes: ids like `node:<node.id>`, edges of type `next`.
      const edgeTypes = value.version === 2 ? ['next'] : ['contains', 'phase-membership', 'evidence-reference'];
      const titled = node => isRecord(node) && isText(node.status)
        && (value.version === 1 ? isText(node.title) && isText(node.kind) : (node.title === undefined || isText(node.title)) && (node.kind === undefined || isText(node.kind)));
      return nodeIds.size === value.nodes.length
        && value.nodes.every(titled)
        && value.edges.every(edge => isRecord(edge) && isText(edge.id) && isText(edge.source) && isText(edge.target)
          && edgeTypes.includes(edge.type)
          && nodeIds.has(edge.source) && nodeIds.has(edge.target));
    };
    const isPipelineCheck = value => isRecord(value) && typeof value.passed === 'boolean' && Array.isArray(value.issues);
    const isPipelineNode = value => isRecord(value) && isText(value.id) && isText(value.stage)
      && ['generate', 'review'].includes(value.kind) && isRecord(value.actor) && isRecord(value.judge)
      && ['completed', 'running', 'blocked', 'pending', 'uncertain'].includes(value.status)
      && Number.isSafeInteger(value.attempts) && value.attempts >= 0
      && Array.isArray(value.checks) && value.checks.every(isPipelineCheck)
      && Array.isArray(value.artifactNames) && value.artifactNames.every(isText);
    // A missing or incomplete pipeline renders as a legacy run instead of a broken section.
    const isPipeline = value => isRecord(value) && value.version === 2
      && Array.isArray(value.nodes) && value.nodes.length > 0 && value.nodes.every(isPipelineNode);
    const isPipelineConfigNode = value => isRecord(value) && isText(value.id) && isText(value.stage)
      && ['generate', 'review'].includes(value.kind)
      && isRecord(value.actor) && isText(value.actor.role) && isText(value.actor.skill) && isText(value.actor.workspace)
      && isRecord(value.judge) && isText(value.judge.role) && isText(value.judge.rule);
    const isPipelineConfig = value => isRecord(value) && value.version === 2
      && Array.isArray(value.nodes) && value.nodes.length > 0 && value.nodes.every(isPipelineConfigNode);
    const STATUS_KEY = {
      running: 'statusRunning', paused: 'statusPaused', completed: 'statusCompleted',
      failed: 'statusFailed', denied: 'statusDenied', stopped: 'statusStopped', cancelled: 'statusStopped',
      interrupted: 'statusInterrupted', uncertain: 'statusUncertain', completed_unverified: 'statusUnverified', result_unverified: 'statusUnverified',
      pending: 'statusPending', starting: 'statusRunning', canceling: 'statusRunning',
      completed_with_issues: 'statusIssues', waiting_input: 'statusWaitingInput', blocked: 'statusBlocked',
    };
    const KIND_KEY = { workflow: 'kindWorkflow', phase: 'kindPhase', agent: 'kindAgent', step: 'kindStep', artifact: 'kindArtifact', generate: 'kindGenerate', review: 'kindReview' };
    const formatAgentCounts = (started, active, t) => t('agents') + ': ' + t('agentsStarted') + ' ' + started
      + t('agentsSeparator') + t('agentsActive') + ' ' + active;
    const formatTime = value => {
      if (value === undefined || value === null) return '';
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
    };
    const NODE_TITLE_KEY = { clarify: 'nodeClarify', extract: 'nodeExtract', 'outline-gen': 'nodeOutlineGen', 'outline-review': 'nodeOutlineReview', 'case-gen': 'nodeCaseGen', 'case-review': 'nodeCaseReview' };
    const NODE_STATUS_KEY = { completed: 'nodeStatusCompleted', running: 'nodeStatusRunning', blocked: 'nodeStatusBlocked', pending: 'nodeStatusPending', uncertain: 'nodeStatusUncertain' };
    const STAGE_KEY = { cleanup: 'stageCleanup', features: 'stageFeatures', outline: 'stageOutline', testcases: 'stageTestcases' };
    const STAGE_LABEL_KEYS = ['stageCleanup', 'stageFeatures', 'stageOutline', 'stageTestcases'];
    // An unknown node id falls back to the id itself so custom pipelines stay readable.
    const nodeTitle = (id, t) => {
      const key = NODE_TITLE_KEY[String(id).replace(/^node:/u, '')];
      return key ? t(key) : String(id);
    };
    // Pipeline stages carry bare ids ('cleanup'); recorded graph stages carry dictionary keys ('stageCleanup').
    const stageLabel = (stage, t) => {
      const key = Object.hasOwn(STAGE_KEY, stage) ? STAGE_KEY[stage] : STAGE_LABEL_KEYS.includes(stage) ? stage : null;
      return key === null ? String(stage) : t(key);
    };
    const issueText = issue => isText(issue) ? issue
      : isRecord(issue) && isText(issue.title) ? (isText(issue.id) ? issue.id + ': ' : '') + issue.title : JSON.stringify(issue);
    function Notice({ error, t, kind }) {
      if (!error) return null;
      return h('div', { className: 'wf-panel-error', role: 'alert' },
        h('div', null, t(kind)),
        error.code ? h('div', null, error.code, error.message ? ': ' + error.message : '') : null);
    }
    function Spinner({ t }) {
      return h('div', { className: 'wf-panel-loading', role: 'status', 'aria-label': t('loading') },
        h('span', { className: 'wf-panel-spinner', 'aria-hidden': true }));
    }
    function Icon({ size }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        h('circle', { cx: 6, cy: 6, r: 2 }), h('circle', { cx: 6, cy: 18, r: 2 }), h('circle', { cx: 18, cy: 12, r: 2 }),
        h('path', { d: 'M6 8v8M8 6h6a4 4 0 0 1 4 4M8 18h6a4 4 0 0 0 4-4' }));
    }
    function StatusChip({ status, t, keys = STATUS_KEY }) {
      return h('span', { className: 'wf-chip wf-status-' + String(status || 'unknown').replace(/[^a-z_]/gu, '') },
        h('span', { className: 'wf-chip-dot', 'aria-hidden': true }),
        t(keys[status] || 'statusUnknown'));
    }
    function FlowGraph({ graph, t, label = 'processTitle', variant = 'run' }) {
      const prefix = variant === 'trace' ? 'wf-trace-graph' : 'wf-run-graph';
      const nodeWidth = variant === 'trace' ? 450 : 220;
      const nodeHeight = variant === 'trace' ? 96 : 74;
      const markerId = 'wf-graph-arrow-' + React.useId().replace(/[^a-zA-Z0-9_-]/gu, '');
      const canvasRef = React.useRef(null);
      const [nodeHeights, setNodeHeights] = React.useState(new Map());
      React.useLayoutEffect(() => {
        const elements = [...canvasRef.current.querySelectorAll(`.${prefix}-node`)];
        const measure = () => {
          const measured = new Map(elements.map(element => [element.dataset.nodeId, Math.max(nodeHeight, element.getBoundingClientRect().height)]));
          setNodeHeights(previous => previous.size === measured.size && [...measured].every(([id, height]) => previous.get(id) === height) ? previous : measured);
        };
        measure();
        const observer = new ResizeObserver(measure);
        elements.forEach(element => observer.observe(element));
        return () => observer.disconnect();
      }, [graph, t, prefix, nodeHeight]);
      const traceStages = ['stageCleanup', 'stageFeatures', 'stageOutline', 'stageTestcases'];
      const [selectedId, setSelectedId] = React.useState(null);
      const relatedIds = new Set();
      if (selectedId) {
        relatedIds.add(selectedId);
        for (const direction of ['ancestors', 'descendants']) {
          const queue = [selectedId];
          const visited = new Set(queue);
          while (queue.length) {
            const current = queue.shift();
            for (const edge of graph.edges) {
              const neighbor = direction === 'ancestors' && edge.target === current ? edge.source
                : direction === 'descendants' && edge.source === current ? edge.target : null;
              if (neighbor && !visited.has(neighbor)) {
                visited.add(neighbor);
                relatedIds.add(neighbor);
                queue.push(neighbor);
              }
            }
          }
        }
      }
      React.useLayoutEffect(() => {
        if (variant !== 'trace' || !selectedId) return;
        const selectedStage = graph.nodes.find(node => node.id === selectedId)?.stage;
        for (const lane of canvasRef.current.querySelectorAll(`.${prefix}-lane-items`)) {
          if (lane.parentElement.dataset.stage === selectedStage) continue;
          const target = [...lane.querySelectorAll(`.${prefix}-node`)].find(node => relatedIds.has(node.dataset.nodeId));
          if (target) lane.scrollTop = Math.max(0, target.offsetTop - 10);
        }
      }, [selectedId, graph, prefix, variant]);
      if (variant === 'trace') {
        const columns = traceStages.map(stage => graph.nodes.filter(node => node.stage === stage));
        return h('div', { className: `${prefix}-scroll` },
          h('div', { className: `${prefix}-canvas`, ref: canvasRef, role: 'group', 'aria-label': t(label) },
            ...columns.map((nodes, index) => h('section', { key: traceStages[index], className: `${prefix}-lane`, 'data-stage': traceStages[index], 'aria-label': t(traceStages[index]) },
              h('h3', { className: `${prefix}-lane-title` }, t(traceStages[index])),
              h('div', { className: `${prefix}-lane-items` }, ...nodes.map(node => {
                const statusClass = String(node.status).replace(/[^a-z_]/gu, '');
                const selected = selectedId === node.id;
                const related = relatedIds.has(node.id);
                const title = isText(node.title) ? node.title : nodeTitle(node.id, t);
                const nodeClass = `${prefix}-node ${prefix}-node-${statusClass} ${prefix}-node-selectable`
                  + (selected ? ` ${prefix}-node-selected` : selectedId && related ? ` ${prefix}-node-related` : selectedId ? ` ${prefix}-node-unrelated` : '');
                return h('button', { key: node.id, type: 'button', 'data-node-id': node.id, className: nodeClass,
                  'aria-pressed': selected, 'aria-label': `${t(KIND_KEY[node.kind] || 'kindStep')}: ${title}, ${t(STATUS_KEY[node.status] || 'statusUnknown')}`,
                  onClick: () => setSelectedId(current => current === node.id ? null : node.id) },
                  h('div', { className: `${prefix}-node-head` },
                    h('span', { className: `${prefix}-node-title` }, title),
                    h('span', { className: 'wf-chip' }, t(KIND_KEY[node.kind] || 'kindStep'))),
                  h(StatusChip, { status: node.status, t }),
                  node.origin === 'replayed-from-cache' ? h('span', { className: 'wf-chip' }, t('originCache')) : null,
                  isText(node.stage) ? h('span', { className: `${prefix}-node-summary` }, stageLabel(node.stage, t)) : isText(node.summary) ? h('span', { className: `${prefix}-node-summary` }, node.summary) : null);
              }))))));
      }
      const levels = new Map(graph.nodes.map(node => [node.id, 0]));
      for (let pass = 0; pass < graph.nodes.length; pass++) {
        let changed = false;
        for (const edge of graph.edges) {
          const next = levels.get(edge.source) + 1;
          if (levels.get(edge.target) < next) { levels.set(edge.target, next); changed = true; }
        }
        if (!changed) break;
      }
      const layers = new Map();
      for (const node of graph.nodes) {
        const level = levels.get(node.id);
        if (!layers.has(level)) layers.set(level, []);
        layers.get(level).push(node);
      }
      const gapX = 72;
      const gapY = 20;
      const positions = new Map();
      let height = 32;
      for (const [level, nodes] of layers) {
        let y = 16;
        for (const node of nodes) {
          const measuredHeight = nodeHeights.get(node.id) ?? nodeHeight;
          positions.set(node.id, { x: 16 + level * (nodeWidth + gapX), y, height: measuredHeight });
          y += measuredHeight + gapY;
        }
        height = Math.max(height, y - gapY + 16);
      }
      const width = 32 + (Math.max(...layers.keys()) + 1) * nodeWidth + Math.max(...layers.keys()) * gapX;
      return h('div', { className: `${prefix}-scroll` },
        h('div', { className: `${prefix}-canvas`, ref: canvasRef, role: 'group', 'aria-label': t(label), style: { width, height } },
          h('svg', { className: `${prefix}-edges`, width, height, 'aria-hidden': true },
            h('defs', null, h('marker', { id: markerId, viewBox: '0 0 8 8', refX: 7, refY: 4, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' },
              h('path', { d: 'M0 0L8 4L0 8z', fill: 'currentColor' }))),
            ...graph.edges.map(edge => {
              const from = positions.get(edge.source);
              const to = positions.get(edge.target);
              const x1 = from.x + nodeWidth;
              const y1 = from.y + from.height / 2;
              const x2 = to.x;
              const y2 = to.y + to.height / 2;
              const bend = Math.max(24, (x2 - x1) / 2);
              return h('path', { key: edge.id, className: `${prefix}-edge` + (edge.type === 'evidence-reference' ? ` ${prefix}-edge-reference` : ''),
                d: `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`,
                markerEnd: `url(#${markerId})` },
                edge.type === 'evidence-reference' ? h('title', null, t('relationEvidence')) : null);
            })),
          ...graph.nodes.map(node => {
            const point = positions.get(node.id);
            const statusClass = String(node.status).replace(/[^a-z_]/gu, '');
            const title = isText(node.title) ? node.title : nodeTitle(node.id, t);
            return h('div', { key: node.id, 'data-node-id': node.id, className: `${prefix}-node ${prefix}-node-${statusClass}`, style: { left: point.x, top: point.y },
              role: 'group', 'aria-label': `${t(KIND_KEY[node.kind] || 'kindStep')}: ${title}, ${t(STATUS_KEY[node.status] || 'statusUnknown')}` },
              h('div', { className: `${prefix}-node-head` },
                h('span', { className: `${prefix}-node-title` }, title),
                h('span', { className: 'wf-chip' }, t(KIND_KEY[node.kind] || 'kindStep'))),
              h(StatusChip, { status: node.status, t }),
              node.origin === 'replayed-from-cache' ? h('span', { className: 'wf-chip' }, t('originCache')) : null,
              isText(node.stage) ? h('span', { className: `${prefix}-node-summary` }, stageLabel(node.stage, t)) : isText(node.summary) ? h('span', { className: `${prefix}-node-summary` }, node.summary) : null);
          })));
    }
    function RunProcess({ process, t }) {
      if (isRecord(process) && isFlowGraph(process.graph)) return h(FlowGraph, { graph: process.graph, t });
      const items = isRecord(process) && Array.isArray(process.items) ? process.items.filter(isRecord) : [];
      return items.length ? h('ul', null, ...items.map((item, index) => h('li', { key: index },
        h('div', { className: 'wf-panel-item' },
          h('span', { className: 'wf-chip' }, t(KIND_KEY[item.kind] || 'kindStep')),
          isText(item.title) ? h('span', { className: 'wf-panel-item-main' }, item.title) : null,
          isText(item.status) ? h(StatusChip, { status: item.status, t }) : null,
          item.origin === 'replayed-from-cache' ? h('span', { className: 'wf-chip' }, t('originCache')) : null),
        isText(item.summary) ? h('div', { className: 'wf-panel-row-summary' }, item.summary) : null)))
        : h('div', { className: 'wf-panel-empty' }, t('graphEmpty'));
    }
    function RunGraphPreview({ api, runId, revision, t }) {
      const [open, setOpen] = React.useState(false);
      const [detail, setDetail] = React.useState(null);
      const [error, setError] = React.useState(null);
      const [loading, setLoading] = React.useState(false);
      const [attempt, setAttempt] = React.useState(0);
      const contentId = React.useId();
      React.useEffect(() => {
        if (!open) return;
        const controller = new AbortController();
        setLoading(true); setError(null);
        api('detail', { runId }, controller.signal)
          .then(value => { if (!controller.signal.aborted) setDetail(value); })
          .catch(reason => { if (!controller.signal.aborted) setError(reason); })
          .finally(() => { if (!controller.signal.aborted) setLoading(false); });
        return () => controller.abort();
      }, [api, runId, open, revision, attempt]);
      return h(React.Fragment, null,
        h('button', { type: 'button', className: 'wf-panel-graph-preview', 'aria-expanded': open, 'aria-controls': contentId,
          onClick: () => setOpen(value => !value) }, t(open ? 'hideGraph' : 'showGraph')),
        h('div', { id: contentId, hidden: !open, className: 'wf-panel-graph-preview-content', 'aria-busy': open && loading },
          open ? h(React.Fragment, null,
            loading && !detail ? h(Spinner, { t }) : null,
            error ? h(React.Fragment, null, h(Notice, { error, t, kind: 'graphError' }),
              h('button', { type: 'button', onClick: () => setAttempt(value => value + 1) }, t('retry'))) : null,
            detail ? h(RunProcess, { process: detail.snapshot.process, t }) : null) : null));
    }
    function SequenceDiagram({ events, t }) {
      const workflowLane = t('workflowLane');
      const participants = [workflowLane];
      const taskNames = new Map();
      for (const event of events) {
        const data = isRecord(event.data) ? event.data : {};
        if (isText(data.taskId) && isText(data.name)) taskNames.set(data.taskId, data.name);
      }
      const actorFor = event => {
        const data = isRecord(event.data) ? event.data : {};
        const name = data.name || taskNames.get(data.taskId);
        return isText(name) && name ? name : isText(data.taskId) && data.taskId ? `Agent ${data.taskId}` : null;
      };
      for (const event of events) {
        if (['agent-started', 'agent-completed', 'agent-message'].includes(event.type)) {
          const actor = actorFor(event);
          if (actor && !participants.includes(actor)) participants.push(actor);
        }
      }
      const rows = events.map(event => {
        const data = isRecord(event.data) ? event.data : {};
        const actor = actorFor(event);
        const actorIndex = actor ? participants.indexOf(actor) : -1;
        let from = 0;
        let to = 0;
        if (event.type === 'agent-started' && actorIndex > 0) to = actorIndex;
        else if ((event.type === 'agent-completed' || event.type === 'agent-message') && actorIndex > 0) from = actorIndex;
        return { event, data, actor, from, to };
      });
      const laneWidth = 220;
      const laneGap = 24;
      const width = 32 + participants.length * laneWidth + (participants.length - 1) * laneGap;
      const rowHeight = 52;
      const height = 64 + rows.length * rowHeight;
      const topScrollRef = React.useRef(null);
      const diagramScrollRef = React.useRef(null);
      const syncScroll = (source, target) => { if (target && target.scrollLeft !== source.scrollLeft) target.scrollLeft = source.scrollLeft; };
      return h('div', { className: 'wf-sequence-frame' },
        h('div', { className: 'wf-sequence-scrollbar', role: 'region', 'aria-label': t('eventsTitle'), tabIndex: 0, onScroll: event => syncScroll(event.currentTarget, diagramScrollRef.current), ref: topScrollRef },
          h('div', { className: 'wf-sequence-scrollbar-inner', style: { '--wf-lane-count': participants.length, width } },
            ...participants.map(participant => h('span', { key: participant, className: 'wf-sequence-scrollbar-title' }, participant)))),
        h('div', { className: 'wf-sequence-scroll', onScroll: event => syncScroll(event.currentTarget, topScrollRef.current), ref: diagramScrollRef },
         h('div', { className: 'wf-sequence', role: 'group', 'aria-label': t('eventsTitle'), style: { width, height } },
          h('div', { className: 'wf-sequence-lanes', style: { '--wf-lane-count': participants.length, width } },
            ...participants.map(participant => h('div', { key: participant, className: 'wf-sequence-lane', style: { width: laneWidth } },
              
              h('span', { className: 'wf-sequence-lifeline', style: { height: Math.max(0, height - 72) } })))),
          h('div', { className: 'wf-sequence-events' },
            ...rows.map(({ event, data, actor, from, to }, index) => {
              const left = from * (laneWidth + laneGap) + (from === to ? 0 : laneWidth / 2);
              const right = Math.max(from, to) * (laneWidth + laneGap) + laneWidth / 2;
              const reverse = from > to;
              const isWorkflowEvent = from === to;
              const date = new Date(event.time);
              const time = event.time === undefined || Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString();
              const detail = isText(data.outcome) ? data.outcome : isText(data.name) && event.type.startsWith('phase-') ? data.name : '';
              return h('div', { key: event.seq, className: 'wf-sequence-event' + (isWorkflowEvent ? ' wf-sequence-event-note' : ''),
                role: 'group', 'aria-label': `${t('seq')} ${event.seq}, ${time}, ${event.type}${actor ? ', ' + actor : ''}`,
                style: { top: index * rowHeight, left, width: isWorkflowEvent ? laneWidth : Math.max(1, right - left) } },
                isWorkflowEvent ? null : h('span', { className: 'wf-sequence-arrow' + (reverse ? ' wf-sequence-arrow-reverse' : '') }),
                h('span', { className: 'wf-sequence-label' },
                  h('span', { className: 'wf-sequence-meta' }, h('span', null, t('seq') + ' ' + event.seq), time ? h('span', null, time) : null),
                  h('span', null, event.type), detail ? h('span', null, ': ' + detail) : null));
             })))));
    }
    function ResultValue({ value, t }) {
      if (value === null) return h('span', null, t('nullValue'));
      if (Array.isArray(value)) return value.length
        ? h('ol', { className: 'wf-result-array' }, ...value.map((entry, index) =>
          h('li', { key: index, className: 'wf-result-entry' },
            h('span', { className: 'wf-result-index' }, '[' + index + ']'),
            h('div', { className: 'wf-result-value' }, h(ResultValue, { value: entry, t })))))
        : h('span', { className: 'wf-panel-empty' }, '[]');
      if (isRecord(value)) {
        const entries = Object.entries(value);
        return entries.length
          ? h('dl', { className: 'wf-result-fields' }, ...entries.map(([key, entry]) =>
            h('div', { key, className: 'wf-result-field' },
              h('dt', { className: 'wf-result-key' }, key),
              h('dd', { className: 'wf-result-value' }, h(ResultValue, { value: entry, t })))))
          : h('span', { className: 'wf-panel-empty' }, '{}');
      }
      return h('span', null, String(value));
    }
    function ResultView({ value, t, label = 'result', Heading = 'h2' }) {
      let parsed;
      let isJson = false;
      if (isText(value)) {
        try { parsed = JSON.parse(value); isJson = true; } catch { parsed = value; }
      } else { parsed = value; isJson = value !== undefined; }
      if (!isJson) return h('div', { className: 'wf-panel-row-summary' }, t(label) + ': ' + String(value));
      return h('section', { className: 'wf-panel-card' }, h(Heading, null, t(label)),
        h('div', { className: 'wf-result-value' }, h(ResultValue, { value: parsed, t })),
        h('details', { className: 'wf-result-raw' }, h('summary', null, t('rawJson')),
          h('pre', null, JSON.stringify(parsed, null, 2))));
    }
    function ArtifactBlock({ api, runId, name, t }) {
      const [content, setContent] = React.useState(null);
      const [error, setError] = React.useState(null);
      const pending = React.useRef(null);
      React.useEffect(() => {
        const controller = new AbortController();
        pending.current = controller;
        api('artifact', { runId, name }, controller.signal)
          .then(value => { if (!controller.signal.aborted) setContent(value.content); })
          .catch(reason => { if (!controller.signal.aborted) setError(reason); });
        return () => controller.abort();
      }, [runId, name]);
      if (error) return h(Notice, { error, t, kind: 'artifactError' });
      if (content === null) return h(Spinner, { t });
      return h('pre', null, JSON.stringify(content, null, 2));
    }
    function Traceability({ api, runId, t }) {
      const [report, setReport] = React.useState(null);
      const [error, setError] = React.useState(null);
      const [busy, setBusy] = React.useState(false);
      const pending = React.useRef(null);
      React.useEffect(() => () => pending.current?.abort(), [api, runId]);
      async function analyze() {
        pending.current?.abort();
        const controller = new AbortController();
        pending.current = controller;
        setBusy(true); setError(null);
        try {
          const value = await api('traceability', { runId }, controller.signal);
          if (!controller.signal.aborted) setReport(value);
        } catch (reason) {
          if (!controller.signal.aborted) setError(reason);
        } finally {
          if (!controller.signal.aborted) { pending.current = null; setBusy(false); }
        }
      }
      return h('section', { className: 'wf-panel-card', 'aria-label': t('traceTitle'), 'aria-busy': busy },
        h('div', { className: 'wf-panel-toolbar' },
          h('h2', null, t('traceTitle')),
          h('button', { type: 'button', onClick: analyze, disabled: busy }, t(error ? 'retry' : 'traceability'))),
        busy ? h(Spinner, { t: () => t('traceLoading') }) : null,
        h(Notice, { error, t, kind: 'traceLoadError' }),
        report ? h(React.Fragment, null,
          h('p', { role: 'status' }, t(report.status === 'PASS' ? 'tracePass' : report.status === 'PARTIAL' ? 'tracePartial' : 'traceIssues')),
          report.incompleteStages.length ? h('p', null, t('incompleteStages') + ': ' + report.incompleteStages.map(stage => t(stage)).join(', ')) : null,
          h('div', { className: 'wf-panel-kv' }, ...Object.entries(TRACE_STAGE_KEYS).map(([key, name]) =>
            h('span', { key }, t(key) + ': ' + report.counts[name]))),
          isFlowGraph(report.graph) ? h(FlowGraph, { graph: report.graph, t, label: 'traceTitle', variant: 'trace' }) : null,
          h('ul', null, ...report.checks.map(check => h('li', { key: check.direction + ':' + check.from + ':' + check.to },
            h('div', { className: 'wf-panel-item' }, `${t(check.direction)} · ${t(check.from)} → ${t(check.to)} · ${t('total')}: ${check.totalCount} · ${t('issueCount')}: ${check.issueCount}`),
            check.issues.length ? h('ul', null, ...check.issues.map((issue, index) => h('li', { key: index }, issue.id + ': ' + issue.title))) : null)))) : null);
    }
    function PipelineNodeView({ node, t }) {
      const [open, setOpen] = React.useState(false);
      const contentId = React.useId();
      const latest = node.checks.length > 0 ? node.checks[node.checks.length - 1] : null;
      const blocked = node.status === 'blocked';
      return h('li', { className: 'wf-pipeline-node' + (blocked ? ' wf-pipeline-node-blocked' : '') },
        h('button', { type: 'button', className: 'wf-pipeline-node-head', 'aria-expanded': open, 'aria-controls': contentId,
          onClick: () => setOpen(value => !value) },
          h('span', { className: 'wf-pipeline-node-title' }, nodeTitle(node.id, t)),
          h(StatusChip, { status: node.status, t, keys: NODE_STATUS_KEY }),
          h('span', { className: 'wf-chip' }, t(KIND_KEY[node.kind] || 'kindStep')),
          isText(node.stage) ? h('span', { className: 'wf-chip' }, stageLabel(node.stage, t)) : null,
          h('span', { className: 'wf-chip' }, t('attempts') + ': ' + String(node.attempts))),
        latest ? h('div', { className: 'wf-panel-kv' },
          h('span', null, t('judgeVerdict') + ': ', h('b', null, t(latest.passed ? 'judgePassed' : 'judgeNotPassed')))) : null,
        latest && latest.issues.length > 0
          ? h('ul', null, ...latest.issues.map((issue, index) => h('li', { key: index }, issueText(issue)))) : null,
        blocked && isText(node.blockedReason) ? h('div', { className: 'wf-pipeline-blocked' }, t('blockedReason') + ': ' + node.blockedReason) : null,
        node.artifactNames.length > 0 ? h('div', { className: 'wf-panel-kv' }, h('span', null, t('artifacts') + ':'),
          ...node.artifactNames.map(name => h('span', { key: name, className: 'wf-chip' }, name))) : null,
        h('div', { id: contentId, hidden: !open, className: 'wf-pipeline-node-body' }, open ? h(React.Fragment, null,
          h('h3', null, t('checksTitle')),
          node.checks.length === 0 ? h('div', { className: 'wf-panel-empty' }, t('checksEmpty'))
            : h('ul', null, ...node.checks.map((check, index) => h('li', { key: index },
              h('div', { className: 'wf-panel-item' },
                h('span', { className: 'wf-chip' }, t(check.passed ? 'judgePassed' : 'judgeNotPassed')),
                isText(check.actorRole) ? h('span', null, t('role') + ': ' + check.actorRole) : null,
                isText(check.skill) ? h('span', null, t('skill') + ': ' + check.skill) : null,
                isText(check.judgeRole) ? h('span', null, t('judgeRole') + ': ' + check.judgeRole) : null,
                isText(check.judgeSkill) ? h('span', null, t('judgeSkill') + ': ' + check.judgeSkill) : null),
              check.issues.length > 0 ? h('ul', null, ...check.issues.map((issue, issueIndex) => h('li', { key: issueIndex }, issueText(issue)))) : null))),
          node.output !== undefined ? h(ResultView, { value: node.output, t, label: 'outputTitle', Heading: 'h3' }) : null) : null));
    }
    function RunPipeline({ pipeline, t }) {
      return h('section', { className: 'wf-panel-card', 'aria-label': t('pipelineTitle') },
        h('h2', null, t('pipelineTitle')),
        h('ol', { className: 'wf-pipeline-nodes' }, ...pipeline.nodes.map(node => h(PipelineNodeView, { key: node.id, node, t }))));
    }
    function PipelineConfigEditor({ node, t, error, saving, onSave, onCancel }) {
      const [draft, setDraft] = React.useState({
        role: isText(node.actor.role) ? node.actor.role : '',
        skill: isText(node.actor.skill) ? node.actor.skill : '',
        workspace: isText(node.actor.workspace) ? node.actor.workspace : '',
        judgeRole: isText(node.judge.role) ? node.judge.role : '',
        judgeRule: isText(node.judge.rule) ? node.judge.rule : '',
      });
      const field = (key, label, tag) => h('label', { key, className: 'wf-pipeline-config-field' }, h('span', null, label),
        h(tag, { value: draft[key], onChange: event => setDraft(current => ({ ...current, [key]: event.target.value })) }));
      return h('div', null,
        h('div', { className: 'wf-pipeline-config-fields' },
          field('role', t('role'), 'input'),
          field('skill', t('skill'), 'input'),
          field('workspace', t('workspace'), 'input'),
          field('judgeRole', t('judgeRole'), 'input'),
          field('judgeRule', t('judgeRule'), 'textarea')),
        h(Notice, { error, t, kind: 'pipelineSaveError' }),
        h('div', { className: 'wf-pipeline-config-actions' },
          h('button', { type: 'button', onClick: () => onSave(draft), disabled: saving }, t(saving ? 'pipelineSaving' : 'pipelineSave')),
          h('button', { type: 'button', onClick: onCancel, disabled: saving }, t('pipelineCancel'))));
    }
    function PipelineConfigNode({ node, t, editing, saveError, saving, onEdit, onSave, onCancel }) {
      return h('li', { className: 'wf-pipeline-config-node' },
        h('button', { type: 'button', className: 'wf-pipeline-config-head', 'aria-expanded': editing,
          onClick: () => (editing ? onCancel() : onEdit(node.id)) },
          h('span', { className: 'wf-pipeline-node-title' }, nodeTitle(node.id, t)),
          isText(node.stage) ? h('span', { className: 'wf-chip' }, stageLabel(node.stage, t)) : null,
          h('span', { className: 'wf-chip' }, t(KIND_KEY[node.kind] || 'kindStep'))),
        h('div', { className: 'wf-panel-kv' },
          h('span', null, t('role') + ': ', h('b', null, node.actor.role)),
          h('span', null, t('workspace') + ': ', h('b', null, node.actor.workspace)),
          h('span', null, t('skill') + ': ', h('b', null, node.actor.skill)),
          h('span', null, t('judgeRole') + ': ', h('b', null, node.judge.role))),
        h('div', { className: 'wf-panel-kv' }, h('span', null, t('judgeRule') + ': ', h('b', null, node.judge.rule))),
        editing ? h(PipelineConfigEditor, { node, t, error: saveError, saving, onSave, onCancel }) : null);
    }
    function PipelineConfigView({ api, t }) {
      const [open, setOpen] = React.useState(false);
      const [config, setConfig] = React.useState(null);
      const [error, setError] = React.useState(null);
      const [loading, setLoading] = React.useState(false);
      const [attempt, setAttempt] = React.useState(0);
      const [editingId, setEditingId] = React.useState(null);
      const [saveError, setSaveError] = React.useState(null);
      const [saving, setSaving] = React.useState(false);
      const contentId = React.useId();
      React.useEffect(() => {
        if (!open) return;
        const controller = new AbortController();
        setLoading(true); setError(null);
        api('getPipelineConfig', {}, controller.signal)
          .then(value => { if (!controller.signal.aborted) setConfig(value); })
          .catch(reason => { if (!controller.signal.aborted) setError(reason); })
          .finally(() => { if (!controller.signal.aborted) setLoading(false); });
        return () => controller.abort();
      }, [api, open, attempt]);
      const save = async (node, draft) => {
        if (saving) return;
        setSaving(true); setSaveError(null);
        try {
          const nodes = config.nodes.map(item => item.id === node.id
            ? { ...item, actor: { ...item.actor, role: draft.role, skill: draft.skill, workspace: draft.workspace },
                judge: { ...item.judge, role: draft.judgeRole, rule: draft.judgeRule } }
            : item);
          const value = await api('updatePipelineConfig', { nodes });
          setConfig(value);
          setEditingId(null);
        } catch (reason) {
          // The editor keeps its draft so the user can correct and retry the save.
          setSaveError(reason);
        } finally {
          setSaving(false);
        }
      };
      return h('section', { className: 'wf-pipeline-config', 'aria-label': t('pipelineConfigTitle') },
        h('button', { type: 'button', 'aria-expanded': open, 'aria-controls': contentId, onClick: () => setOpen(value => !value) },
          t(open ? 'pipelineHide' : 'pipelineShow')),
        h('div', { id: contentId, hidden: !open, className: 'wf-pipeline-config-content', 'aria-busy': open && loading },
          open ? h(React.Fragment, null,
            loading && config === null ? h(Spinner, { t }) : null,
            error ? h(React.Fragment, null,
              h('div', { className: 'wf-panel-empty', role: 'status' }, t('pipelineUnavailable')),
              h(Notice, { error, t, kind: 'pipelineLoadError' }),
              h('button', { type: 'button', onClick: () => setAttempt(value => value + 1) }, t('retry'))) : null,
            config ? h(React.Fragment, null,
              h('h2', null, t('pipelineConfigTitle')),
              h('div', { className: 'wf-pipeline-config-hint' }, t('pipelineHint')),
              h('ol', { className: 'wf-pipeline-config-nodes' }, ...config.nodes.map(node =>
                h(PipelineConfigNode, { key: node.id, node, t,
                  editing: editingId === node.id,
                  saveError: editingId === node.id ? saveError : null,
                  saving: saving && editingId === node.id,
                  onEdit: id => { setEditingId(id); setSaveError(null); },
                  onCancel: () => { setEditingId(null); setSaveError(null); },
                  onSave: draft => save(node, draft) })))) : null) : null));
    }
    function RunDetailView({ api, runId, onBack, t }) {
      const [detail, setDetail] = React.useState(null);
      const [error, setError] = React.useState(null);
      const [retryError, setRetryError] = React.useState(null);
      const [retrying, setRetrying] = React.useState(false);
      const [openArtifact, setOpenArtifact] = React.useState(null);
      const pending = React.useRef(null);
      const detailRef = React.useRef(null);
      const retryPending = React.useRef(false);
      const mounted = React.useRef(false);
      React.useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; pending.current?.abort(); };
      }, []);
      const load = (retainDetail = false) => {
        if (retryPending.current) return Promise.resolve();
        pending.current?.abort();
        const controller = new AbortController();
        pending.current = controller;
        setError(null);
        if (!retainDetail) { setDetail(null); setRetryError(null); }
        return api('detail', { runId }, controller.signal)
          .then(value => { if (mounted.current && !controller.signal.aborted) { detailRef.current = value; setDetail(value); } })
          .catch(reason => { if (mounted.current && !controller.signal.aborted) setError(reason); });
      };
      const retry = async () => {
        if (retryPending.current) return;
        retryPending.current = true;
        setRetrying(true); setRetryError(null);
        try {
          const value = await api('retry', { runId });
          if (mounted.current) { detailRef.current = value; setDetail(value); }
        } catch (reason) {
          if (mounted.current) setRetryError(reason);
        } finally {
          retryPending.current = false;
          if (mounted.current) setRetrying(false);
        }
      };
      React.useEffect(() => {
        let active = true;
        let timer;
        const poll = async () => {
          await load(true);
          if (active && !['completed', 'completed_with_issues', 'failed', 'cancelled', 'stopped', 'denied', 'interrupted', 'result_unverified', 'completed_unverified'].includes(detailRef.current?.snapshot.status)) timer = setTimeout(poll, 2500);
        };
        if (detailRef.current) timer = setTimeout(poll, 2500);
        else void poll();
        return () => { active = false; clearTimeout(timer); pending.current?.abort(); };
      }, [runId, retrying]);
      const toolbar = h('div', { className: 'wf-panel-toolbar' },
        h('button', { type: 'button', onClick: onBack }, t('back')),
        detail ? h(StatusChip, { status: detail.snapshot.status, t }) : null,
        detail && detail.snapshot.source === 'case-design' && ['pending', 'failed', 'cancelled'].includes(detail.snapshot.status)
          ? h('button', { type: 'button', onClick: retry, disabled: retrying }, t(retrying ? 'retrying' : 'retry')) : null,
        h('button', { type: 'button', onClick: () => load(), disabled: retrying }, t('refresh')));
      if (error && !detail) return h('div', null, toolbar, h(Notice, { error, t, kind: 'detailError' }));
      if (!detail) return h('div', null, toolbar, h(Spinner, { t }));
      const snapshot = detail.snapshot;
      const manifest = isRecord(detail.manifest) ? detail.manifest : null;
      const counts = isRecord(snapshot.counts) ? snapshot.counts : null;
      const cost = isRecord(snapshot.cost) ? snapshot.cost : null;
      const byTier = cost && isRecord(cost.byTier) ? cost.byTier : null;
      const tierDetails = byTier ? Object.entries(byTier).filter(([, value]) => isRecord(value)
        && [value.calls, value.inputTokens, value.outputTokens].some(item => typeof item === 'number')) : [];
      const hasCostDetails = Boolean(cost && (typeof cost.totalTokens === 'number'
        || typeof cost.totalCostUsd === 'number' || tierDetails.length > 0));
      const items = isRecord(snapshot.process) && Array.isArray(snapshot.process.items)
        ? snapshot.process.items.filter(isRecord) : [];
      const graph = isRecord(snapshot.process) && isFlowGraph(snapshot.process.graph) ? snapshot.process.graph : null;
      const artifacts = Array.isArray(snapshot.artifacts) ? snapshot.artifacts.filter(isRecord) : [];
      const events = detail.events;
      return h('div', null, toolbar,
        error ? h(Notice, { error, t, kind: 'detailError' }) : null,
        retryError ? h(Notice, { error: retryError, t, kind: 'retryError' }) : null,
        h('h1', { className: 'wf-panel-detail-title' }, t('workflow') + ': ' + (snapshot.displayName || snapshot.workflow)),
        h('div', { className: 'wf-panel-meta' },
          snapshot.startedAt !== undefined ? h('span', null, t('started') + ': ', h('strong', null, formatTime(snapshot.startedAt))) : null,
          snapshot.endedAt !== undefined ? h('span', null, t('ended') + ': ', h('strong', null, formatTime(snapshot.endedAt))) : null,
          isText(snapshot.phase) ? h('span', null, t('phase') + ': ' + snapshot.phase) : null,
          h('span', null, t('source') + ': ' + (snapshot.source === 'case-design' ? t('caseDesign') : isText(snapshot.source) ? snapshot.source : '-')),
          snapshot.progressText ? h('span', null, t('progress') + ': ' + snapshot.progressText) : h('span', null, formatAgentCounts(snapshot.totalSpawned, snapshot.activeAgents, t))),
        isPipeline(snapshot.pipeline) ? h(RunPipeline, { pipeline: snapshot.pipeline, t }) : null,
        snapshot.source === 'case-design' ? h(Traceability, { key: runId, api, runId, t }) : null,
        snapshot.resultSummary ? h(ResultView, { value: snapshot.resultSummary, t }) : null,
        snapshot.error ? h(Notice, { error: { message: String(snapshot.error) }, t, kind: 'detailError' }) : null,
        manifest ? h('section', { className: 'wf-panel-card' }, h('h2', null, t('manifestTitle')),
          h('div', { className: 'wf-panel-kv' }, h('b', null, manifest.name),
            isText(manifest.description) ? h('span', null, manifest.description) : null),
          h('div', { className: 'wf-panel-meta' },
            Array.isArray(manifest.phases) ? h('span', { className: 'wf-chip' }, t('phases') + ': ' + manifest.phases.join(' → ')) : null,
            h('span', { className: 'wf-chip' }, t('readOnly') + ': ' + (manifest.readOnly ? t('yes') : t('no'))),
            typeof manifest.maxAgents === 'number' ? h('span', { className: 'wf-chip' }, t('maxAgents') + ': ' + manifest.maxAgents) : null,
            typeof manifest.maxConcurrency === 'number' ? h('span', { className: 'wf-chip' }, t('maxConcurrency') + ': ' + manifest.maxConcurrency) : null)) : null,
        (counts || isText(snapshot.progress)) ? h('section', { className: 'wf-panel-card' }, h('h2', null, t('counts')),
          counts ? h('div', { className: 'wf-panel-grid' },
            ...['byKind', 'byStatus'].flatMap(key => isRecord(counts[key])
              ? Object.entries(counts[key]).map(([name, value]) =>
                h('span', { key: key + name, className: 'wf-chip' }, name + ': ' + value))
              : [])) : null,
          isText(snapshot.progress) ? h('div', { className: 'wf-panel-meta' }, t('progress') + ': ' + snapshot.progress) : null) : null,
        (graph || items.length) ? h('section', null, h('h2', null, t('processTitle')),
          h(RunProcess, { process: snapshot.process, t })) : null,
        hasCostDetails ? h('section', { className: 'wf-panel-card' }, h('h2', null, t('costTitle')),
          h('div', { className: 'wf-panel-meta' },
            typeof cost.totalTokens === 'number' ? h('span', null, t('totalTokens') + ': ' + cost.totalTokens) : null,
            typeof cost.totalCostUsd === 'number' ? h('span', null, t('totalCost') + ': ' + cost.totalCostUsd.toFixed(4)) : null),
          tierDetails.length ? h('div', { className: 'wf-panel-grid' },
            ...tierDetails.map(([name, value]) => h('span', { key: name, className: 'wf-chip' },
              name + ': ' + [value.calls, value.inputTokens, value.outputTokens]
                .filter(entry => typeof entry === 'number').join(' / ')))) : null) : null,
        artifacts.length ? h('section', null, h('h2', null, t('artifacts')),
          h('div', { className: 'wf-artifacts' }, ...artifacts.map((artifact, index) => h('button', { key: index, type: 'button', 'aria-label': t('artifactOpen') + ': ' + String(artifact.name ?? index),
            onClick: () => setOpenArtifact(previous => previous === index ? null : index) }, String(artifact.name ?? index))),
          openArtifact !== null && artifacts[openArtifact] ? h('div', { className: 'wf-artifact-preview' }, h(ArtifactBlock, { api, runId, name: String(artifacts[openArtifact].name), t })) : null)) : null,
        h('section', null, h('h2', null, t('eventsTitle')),
          events.length === 0 ? h('div', { className: 'wf-panel-empty' }, t('eventsEmpty'))
            : h(SequenceDiagram, { events, t })));
    }
    function RunListView({ api, t, onSelect }) {
      const [runs, setRuns] = React.useState([]);
      const [revision, setRevision] = React.useState(0);
      const [workspace, setWorkspace] = React.useState('all');
      const [loading, setLoading] = React.useState(true);
      const [loaded, setLoaded] = React.useState(false);
      const [error, setError] = React.useState(null);
      const pending = React.useRef(null);
      React.useEffect(() => () => pending.current?.abort(), []);
      const load = () => {
        pending.current?.abort();
        const controller = new AbortController();
        pending.current = controller;
        setError(null); setLoading(true);
        api('list', {}, controller.signal)
          .then(value => { if (!controller.signal.aborted) { setRuns(value); setRevision(current => current + 1); setLoaded(true); setLoading(false); } })
          .catch(reason => { if (!controller.signal.aborted) { setError(reason); setLoading(false); } });
      };
      React.useEffect(() => { load(); }, []);
      const toolbar = h('div', { className: 'wf-panel-toolbar' }, h('h1', null, t('title')),
        h('button', { type: 'button', onClick: load }, t('refresh')));
      // The pipeline configuration entry stays outside the run list and across every list state.
      const page = body => h('div', null, toolbar, h(PipelineConfigView, { api, t }), body);
      if (loading && !loaded) return page(h(Spinner, { t }));
      if (error && !loaded) return page(h(Notice, { error, t, kind: 'queryError' }));
      if (loaded && runs.length === 0) return page(h(React.Fragment, null,
        h(Notice, { error, t, kind: 'queryError' }), h('div', { className: 'wf-panel-empty' }, t('empty'))));
      const timeOf = run => {
        const time = typeof run.startedAt === 'number' ? run.startedAt : Date.parse(run.startedAt);
        return Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY;
      };
      const workspaces = new Map();
      for (const run of runs) {
        const id = run.workspaceId || '';
        if (!workspaces.has(id)) workspaces.set(id, run.workspaceName || (id || t('unassignedWorkspace')));
      }
      const visibleRuns = runs.filter(run => workspace === 'all' || (run.workspaceId || '') === workspace);
      const sessionGroups = new Map();
      for (const run of visibleRuns) {
        const workspaceId = run.workspaceId || '';
        const sessionId = run.sessionId || `run:${run.runId}`;
        const key = `${workspaceId}\u0000${sessionId}`;
        if (!sessionGroups.has(key)) sessionGroups.set(key, { workspaceId, sessionId: run.sessionId, runs: [] });
        sessionGroups.get(key).runs.push(run);
      }
      const groups = [...sessionGroups.values()].map(group => ({
        ...group,
        runs: group.runs.sort((left, right) => timeOf(right) - timeOf(left) || left.runId.localeCompare(right.runId)),
        latest: Math.max(...group.runs.map(timeOf)),
      })).sort((left, right) => right.latest - left.latest
        || left.workspaceId.localeCompare(right.workspaceId)
        || String(left.sessionId || left.runs[0].runId).localeCompare(String(right.sessionId || right.runs[0].runId)));
      const renderRun = run => h('li', { key: run.runId },
        h('div', { className: 'wf-panel-run' },
          h('button', { type: 'button', className: 'wf-panel-row', onClick: () => onSelect(run.runId) },
            h('span', { className: 'wf-panel-row-head' },
              h(StatusChip, { status: run.status, t }),
              h('span', { className: 'wf-panel-row-name' }, run.displayName || run.workflow),
              h('span', { className: 'wf-panel-row-meta' },
                h('span', null, formatTime(run.startedAt)),
                run.source === 'case-design' ? h('span', null, t('caseDesign')) : null,
                run.progressText ? h('span', null, t('progress') + ' ' + run.progressText) : h('span', null, formatAgentCounts(run.totalSpawned, run.activeAgents, t)),
                isText(run.phase) ? h('span', null, t('phase') + ' ' + run.phase) : null,
                run.cost && typeof run.cost.totalTokens === 'number' ? h('span', null, run.cost.totalTokens + ' ' + t('tokens')) : null,
                h('span', null, run.artifactCount + ' ' + t('artifacts')))),
            run.resultSummary ? h('span', { className: 'wf-panel-row-summary' }, run.resultSummary) : null,
            !run.resultSummary && run.error ? h('span', { className: 'wf-panel-row-summary' }, String(run.error)) : null),
          h(RunGraphPreview, { api, runId: run.runId, revision, t })));
      return page(h(React.Fragment, null,
        error ? h(Notice, { error, t, kind: 'queryError' }) : null,
        h('label', null, t('workspace') + ' ', h('select', { value: workspace, onChange: event => setWorkspace(event.target.value) },
          h('option', { value: 'all' }, t('allWorkspaces')),
          ...[...workspaces.entries()].sort((left, right) => left[1].localeCompare(right[1])).map(([id, name]) => h('option', { key: id, value: id }, name)))),
        h('ul', null, ...groups.map(group => h('li', { key: `${group.workspaceId}:${group.sessionId || group.runs[0].runId}` },
          group.sessionId ? h('h2', null, t('session') + ': ' + (group.runs.find(run => run.sessionName)?.sessionName || group.sessionId)) : null,
          h('ul', null, ...group.runs.map(renderRun)))))));
    }
    function PanelPage({ api, t }) {
      const [selected, select] = React.useState(null);
      return h('section', { className: 'wf-panel wf-panel-page' }, h('style', null, css),
        selected === null
          ? h(RunListView, { api, t, onSelect: select })
          : h(RunDetailView, { api, runId: selected, t, onBack: () => select(null) }));
    }
    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, dictionaries));
        const t = ctx.locale.bind(NS);
        const lifetime = new AbortController();
        ctx.effect(() => () => lifetime.abort());
        async function api(action, input, signal) {
          let response;
          try {
            response = await fetch('/api/dsh-workflow-panel', { method: 'POST', credentials: 'same-origin',
              headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...input }),
              signal: signal ? AbortSignal.any([signal, lifetime.signal]) : lifetime.signal });
          } catch (cause) { throw { code: 'NETWORK_ERROR', message: t('transportError'), cause }; }
          let result;
          try { result = await response.json(); }
          catch (cause) { throw { code: 'INVALID_RESPONSE', message: t('invalidResponse'), cause }; }
          if (isRecord(result) && result.ok === false && isRecord(result.error)
            && isText(result.error.code) && isText(result.error.message)) throw result.error;
          const valid = action === 'list'
            ? Array.isArray(result?.value) && result.value.every(isRunSummary)
            : action === 'detail' || action === 'retry' ? isDetail(result?.value)
              : action === 'artifact' ? isArtifact(result?.value)
                : action === 'traceability' ? isTraceability(result?.value)
                  : action === 'getPipelineConfig' || action === 'updatePipelineConfig' ? isPipelineConfig(result?.value)
                    : false;
          if (!response.ok || !isRecord(result) || result.ok !== true || !valid) {
            throw { code: 'INVALID_RESPONSE', message: t('invalidResponse') };
          }
          return result.value;
        }
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main', key: NS, locale: NS, inject: () => ({ api }),
        }, PanelPage));
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist', id: NS, order: 25, label: () => t('panel'), locale: NS,
        }, Icon));
      },
    };
  },
});
