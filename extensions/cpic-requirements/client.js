/** Standalone requirements workbench; Harness services enter through injected callbacks. */
window.__ModuleLoader__.load({
  id: '@cpic/requirements-workbench',
  factory(require) {
    const React = require('react');
    const { Modal, MarkdownText } = require('@deepseek-ai/dsh-client-ui-primitives');
    const Vditor = require('vditor').default;
    const h = React.createElement;
    const NS = 'cpic.requirements';
    const RADAR_KIND = 'cpic-requirements-radar';
    /** Mint preparation keys on HTTP intranet origins using Web Crypto random bytes. */
    function preparationRequestId() {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
    const dictionaries = {
      en: {
        editorAssetsError: 'Could not load editor resources. Check the deployment assets and reopen the editor.',
        analysisDetails: 'View analysis details', closeAnalysis: 'Close analysis details',
        
        details: 'Requirement details', closeDetails: 'Close requirement details',
        panel: 'Requirement analysis', search: 'Search requirements', systemFilter: 'Search systems', allSystems: 'All systems', chooseSystem: 'Choose a system', refresh: 'Refresh', projectsError: 'Could not load authorized systems. Retry to choose or filter by system.', noSystems: 'No authorized systems are available.',
        import: 'Import Markdown', importSubmit: 'Import requirement', source: 'Source',
        system: 'System', id: 'Stable requirement ID', title: 'Title', version: 'Version',
        markdown: 'Markdown source', edit: 'Edit Markdown', previewMarkdown: 'Preview', copy: 'Copy', copied: 'Copied', footnotes: 'Footnotes', save: 'Save changes', cancelEdit: 'Cancel editing', saving: 'Saving', saved: 'Requirement saved.', saveError: 'Could not save this requirement. Refresh and try again.', conflictError: 'This requirement changed elsewhere. Refresh before saving.', file: 'Load a .md or .txt file', close: 'Close import',
        empty: 'No requirements found. Import a Markdown document or change your search.',
        select: 'Select a requirement to read its source and prepare an analysis session.',
        prepare: 'Prepare analysis session', loading: 'Loading', run: 'Requirement analysis',
        start: 'Start analysis', cancel: 'Cancel analysis', preview: 'Preview snapshot',
        stage: 'Stage', attempts: 'Attempts', artifacts: 'Artifacts', snapshot: 'Snapshot',
        queryError: 'Could not load requirements. Use Refresh to try again.',
        detailError: 'Could not load this requirement. Select it again to retry.',
        importError: 'Import failed. Review the document and try again.',
        fileError: 'Could not read the file. Choose a readable .md or .txt file.',
        prepareError: 'Could not open the analysis session. Retry preparation with the same requirement.',
        runError: 'Could not load the run. Use Refresh before starting or cancelling.',
        actionError: 'The action could not be confirmed. Refresh the run before trying again.',
        previewError: 'Could not open the snapshot. Keep this session open and try Preview again.',
        invalidResponse: 'The server returned an invalid response.',
        transportError: 'The server could not be reached.',
        draftBlocked: 'The session draft is busy. Open the prepared session and try again.',
        imported: 'Requirement imported.', draftPreserved: 'Your existing session draft was preserved.',
        prepared: 'Session prepared. Open session',
        statusPrepared: 'Prepared', statusRunning: 'Running', statusQueued: 'Queued',
        statusCompleted: 'Completed', statusSucceeded: 'Succeeded', statusFailed: 'Failed',
        statusCancelled: 'Cancelled', statusCancelling: 'Cancelling', statusUnknown: 'Other status',
        statusStarting: 'Starting', statusUncertain: 'Delivery unverified', statusWaitingInput: 'Waiting for your answers',
        statusWithIssues: 'Completed with issues', statusUnverified: 'Artifacts unverified',
        stageCleanup: 'Requirement cleanup', stageFeatures: 'Feature analysis',
        stageOutline: 'Scenario outline', stageTestcases: 'Test case design',
        questions: 'Questions to clarify', openArtifact: 'Preview artifact', radar: 'Project radar', requirements: 'Requirements', features: 'Features', scenarios: 'Scenarios', cases: 'Test cases', notGenerated: 'Not generated', stages: 'Stages', stageDone: 'Completed', stageCurrent: 'In progress', stagePending: 'Pending', noRun: 'No analysis run is linked to this session.',
      },
      zh: {
        editorAssetsError: '无法加载编辑器资源，请检查部署资源并重新打开编辑器',
        analysisDetails: '查看分析详情', closeAnalysis: '关闭分析详情',
        
        details: '需求详情', closeDetails: '关闭需求详情',
        panel: '需求分析', search: '搜索需求', systemFilter: '搜索系统', allSystems: '全部系统', chooseSystem: '请选择系统', refresh: '刷新', projectsError: '无法加载有权访问的系统，请重试后再选择或筛选', noSystems: '当前没有可访问的系统', import: '导入 Markdown',
        importSubmit: '导入需求', source: '来源', system: '系统', id: '稳定需求编号',
        title: '标题', version: '版本', markdown: 'Markdown 原文', edit: '编辑 Markdown', previewMarkdown: '预览', copy: '复制', copied: '已复制', footnotes: '脚注', save: '保存修改', cancelEdit: '取消编辑', saving: '保存中', saved: '需求已保存', saveError: '无法保存需求，请刷新后重试', conflictError: '需求已被其他人修改，请刷新后再保存', file: '加载 .md 或 .txt 文件',
        close: '关闭导入', empty: '没有找到需求，请导入 Markdown 文档或调整搜索条件',
        select: '选择需求以查看原文并准备分析会话', prepare: '准备分析会话', loading: '加载中',
        run: '需求分析', start: '开始分析', cancel: '取消分析', preview: '预览快照',
        stage: '阶段', attempts: '尝试次数', artifacts: '产物', snapshot: '快照',
        queryError: '无法加载需求，请点击刷新重试',
        detailError: '无法加载该需求，请重新选择以重试',
        importError: '导入失败，请检查文档后重试',
        fileError: '无法读取文件，请选择可读取的 .md 或 .txt 文件',
        prepareError: '无法打开分析会话，请对同一需求重试准备',
        runError: '无法加载任务，请刷新后再开始或取消分析',
        actionError: '无法确认操作结果，请刷新任务后再重试',
        previewError: '无法打开快照，请保持此会话打开并再次点击预览',
        invalidResponse: '服务器返回的数据无效', transportError: '无法连接服务器',
        draftBlocked: '会话草稿正在处理中，请打开已准备的会话后重试',
        imported: '需求已导入', draftPreserved: '已保留会话中现有的草稿', prepared: '会话已准备，打开会话',
        statusPrepared: '已准备', statusRunning: '运行中', statusQueued: '排队中',
        statusCompleted: '已完成', statusSucceeded: '成功', statusFailed: '失败',
        statusCancelled: '已取消', statusCancelling: '取消中', statusUnknown: '其他状态',
        statusStarting: '启动中', statusUncertain: '输入送达尚未确认', statusWaitingInput: '等待你的补充答复',
        statusWithIssues: '已完成但存在问题', statusUnverified: '产物尚未验证',
        stageCleanup: '需求整理', stageFeatures: '功能分析', stageOutline: '场景大纲',
        stageTestcases: '用例设计', questions: '待澄清问题', openArtifact: '预览产物', radar: '项目雷达', requirements: '需求数', features: '功能数', scenarios: '场景数', cases: '案例数', notGenerated: '待生成', stages: '会话阶段', stageDone: '已完成', stageCurrent: '进行中', stagePending: '未开始', noRun: '当前会话尚未绑定分析运行',
      },
    };
    const css = `
      .cpic-req{box-sizing:border-box;color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5;min-width:0}
      .cpic-req *{box-sizing:border-box}
      .cpic-req-page{height:100%;overflow:auto;padding:24px;container-type:inline-size}
      [data-platform='darwin'] .cpic-req-page{padding-top:calc(var(--dsh-frame-top-clearance,0px) + 24px)}
      .cpic-req h1,.cpic-req h2,.cpic-req h3{font-weight:500;margin:0}
      .cpic-req h1{font-size:20px}.cpic-req h2{font-size:16px}.cpic-req h3{font-size:13px}
      .cpic-req-details-content>.cpic-req-detail{flex:1;min-height:0}
      .cpic-req-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:16px}
      .cpic-req-detail .cpic-req-toolbar{position:sticky;top:40px;z-index:2;padding:8px 0;background:var(--dsw-alias-bg-layer-1)}
      
      
             .cpic-req-editor-grid{display:grid;grid-template-columns:minmax(0,1fr);gap:12px;align-items:stretch}
       
      .cpic-req-detail-header{position:sticky;top:0;z-index:3;padding:12px 16px;border-bottom:1px solid var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-layer-1)}
      .cpic-req-toolbar h1,.cpic-req-toolbar h2{margin-right:auto}
      .cpic-req-columns{display:grid;grid-template-columns:minmax(0,1fr);min-height:0}
      .cpic-req.cpic-req-details-modal{width:min(1100px,100%);max-height:100%}
      .cpic-req-details-content{min-height:0;overflow:auto}
      .cpic-req-list,.cpic-req-detail{min-width:0}
      .cpic-req-detail{min-width:0}
      .cpic-req-detail-header{flex:none;padding:12px 16px;border-bottom:1px solid var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-layer-1)}
      .cpic-req-detail-body{flex:1;min-height:0;overflow:auto;padding:12px 16px}
      .cpic-req button:not(.vditor button),.cpic-req input:not(.vditor input),.cpic-req select,.cpic-req textarea:not(.vditor textarea){font:inherit;color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l3);border-radius:8px;background:var(--dsw-alias-bg-layer-2);padding:7px 10px;max-width:100%}
      .cpic-req button:not(.vditor button){cursor:pointer}.cpic-req button:not(.vditor button):hover{background:var(--dsw-alias-interactive-bg-hover)}
      .cpic-req button:not(.vditor button):disabled{opacity:.5;cursor:default}
      .cpic-req button:not(.vditor button):focus-visible,.cpic-req input:not(.vditor input):focus-visible,.cpic-req select:focus-visible,.cpic-req textarea:not(.vditor textarea):focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
      .cpic-req-search{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px}
      .cpic-req-search input{flex:0 1 240px;min-width:160px;width:240px;height:32px}
      .cpic-req-search select{flex:0 1 180px;min-width:140px;width:180px;height:32px;padding-top:4px;padding-bottom:4px}
      .cpic-req-search button{height:32px;padding-top:4px;padding-bottom:4px}
      .cpic-req-list ul{list-style:none;padding:0;margin:0}.cpic-req-list li{margin-bottom:8px}
      .cpic-req-row{display:block;text-align:left;width:100%;overflow-wrap:anywhere}
      .cpic-req-row[aria-pressed=true]{border-color:var(--dsw-alias-state-business-primary)}
      .cpic-req-meta,.cpic-req-empty{color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
      .cpic-req-meta{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0;position:sticky;top:0;z-index:2;padding:8px 0;background:var(--dsw-alias-bg-layer-1)}
      .cpic-req-detail pre:not(.vditor pre){font-family:monospace;white-space:pre-wrap;overflow-wrap:anywhere;margin:12px 0;padding:16px;border:1px solid var(--dsw-alias-border-l3);border-radius:8px;background:var(--dsw-alias-bg-layer-2)}
       
       
       
       .cpic-req .cpic-req-save{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}
       .cpic-req .cpic-req-save:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}
       .cpic-req-editor-actions{position:sticky;bottom:0;z-index:2;display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap;margin:12px -16px -16px;padding:12px 16px;background:var(--dsw-alias-bg-layer-1);border-top:1px solid var(--dsw-alias-border-l3)}
       
       
      .cpic-req-vditor{width:100%;min-width:0}
      .cpic-req-preview-pane{display:none}
.cpic-req-error{color:var(--dsw-alias-state-error-primary);overflow-wrap:anywhere;margin:8px 0;min-height:20px}
      .cpic-req-form{display:flex;flex-direction:column;gap:16px;min-width:0;padding:4px 16px 0}
      .cpic-req-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr));gap:12px 16px}
      .cpic-req label{display:flex;flex-direction:column;gap:4px;margin-bottom:12px}
      .cpic-req-form label{min-width:0;margin:0}
      .cpic-req-form input,.cpic-req-form select{width:100%;min-width:0}
      .cpic-req-import-file{padding:12px;border:1px dashed var(--dsw-alias-border-l3);border-radius:8px;background:var(--dsw-alias-bg-layer-2)}
      .cpic-req-import-editor{display:flex;flex-direction:column;gap:8px;min-width:0}
      .cpic-req-import-editor .vditor-toolbar{flex-wrap:wrap}
      .cpic-req-import-actions{position:sticky;bottom:0;z-index:2;display:flex;align-items:center;justify-content:flex-end;gap:12px;flex-wrap:wrap;margin:0 -16px;padding:12px 16px;border-top:1px solid var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-layer-1)}
      .cpic-req-import-actions>.cpic-req-error{flex:1 1 240px;margin:0}
      .cpic-req-import-buttons{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap;margin-left:auto}
      .cpic-req textarea{width:100%;resize:vertical;min-height:180px}
      .cpic-req-dock{display:inline-flex;min-width:0;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px))}
      .cpic-req-radar{height:100%;overflow:auto;padding:16px;min-width:0}
      .cpic-req-radar .cpic-req-toolbar{position:sticky;top:0;z-index:2;padding:8px 0;background:var(--dsw-alias-bg-layer-1)}
      .cpic-req-radar-metrics{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:12px 0}
      .cpic-req-radar-metric,.cpic-req-radar-stage{padding:8px 0;border-bottom:1px solid var(--dsw-alias-border-l3);overflow-wrap:anywhere}
      .cpic-req-radar-artifacts{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin:8px 0 16px}
      .cpic-req-radar-artifacts button{max-width:100%;overflow-wrap:anywhere}
      .cpic-req-radar-metric strong{display:block;font-size:16px;font-weight:500}
      .cpic-req-run-stage{min-width:0;overflow:hidden;text-overflow:ellipsis}
      .cpic-req-loading{display:flex;justify-content:center;padding:24px}
      .cpic-req-spinner{width:20px;height:20px;border:2px solid var(--dsw-alias-border-l3);border-top-color:var(--dsw-alias-label-primary);border-radius:50%;animation:cpic-req-spin 1s linear infinite}
      .cpic-req-skeleton{height:48px;margin-bottom:8px;border-radius:8px;background:var(--dsw-alias-bg-skeleton)}
      @keyframes cpic-req-spin{to{transform:rotate(360deg)}}
      @media(prefers-reduced-motion:reduce){.cpic-req-spinner{animation:none}}
      @container(max-width:640px){.cpic-req-columns{grid-template-columns:1fr}.cpic-req-fields{grid-template-columns:1fr}.cpic-req-editor-grid{grid-template-columns:minmax(0,1fr)}.cpic-req-search input{flex:1 1 180px}.cpic-req-search select{flex:1 1 150px}}
      @media(max-width:640px){.cpic-req-page{padding:16px}.cpic-req-columns{grid-template-columns:1fr}}
      @media(pointer:coarse){.cpic-req-search input,.cpic-req-search select,.cpic-req-form input,.cpic-req-form select,.cpic-req-import-editor [contenteditable=true],.cpic-req-import-editor textarea{font-size:16px}}
    `;
    const isText = value => typeof value === 'string';
    const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
    const isSummary = value => isRecord(value)
      && ['id', 'title', 'version', 'source', 'system', 'systemName'].every(key => isText(value[key]))
      && (isText(value.updatedAt) || typeof value.updatedAt === 'number');
    const isDetail = value => isSummary(value) && isText(value.markdown);
    const isProject = value => isRecord(value) && isText(value.p_sid) && isText(value.p_name);
    const isPrepared = value => isRecord(value)
      && ['sessionId', 'workspaceId', 'snapshotPath', 'prompt', 'runId'].every(key => isText(value[key]));
    const isRun = value => value === null || (isRecord(value) && isText(value.id) && isText(value.status)
      && isRecord(value.snapshot) && isText(value.snapshot.path) && isText(value.snapshot.version)
      && (value.stage === undefined || isText(value.stage)));
    function Notice({ error, t, kind }) {
      if (!error) return null;
      return h('div', { className: 'cpic-req-error', role: 'alert' },
        h('div', null, t(kind)),
        error.code ? h('div', null, error.code, error.message ? ': ' + error.message : '') : null);
    }
    function Spinner({ t }) {
      return h('div', { className: 'cpic-req-loading', role: 'status', 'aria-label': t('loading') },
        h('span', { className: 'cpic-req-spinner', 'aria-hidden': true }));
    }
    function Icon({ size }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
      h('path', { d: 'M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z M14 3v5h5 M8 12h8 M8 16h6' }));
    }
    function MarkdownEditor({ value, disabled, label, onChange, height = 520 }) {
      const [assetError, setAssetError] = React.useState(false);
      const host = React.useRef(null);
      const editor = React.useRef(null);
      const ready = React.useRef(false);
      const change = React.useRef(onChange);
      const latestValue = React.useRef(value);
      const latestDisabled = React.useRef(disabled);
      change.current = onChange;
      latestValue.current = value;
      latestDisabled.current = disabled;
      React.useEffect(() => {
        if (!host.current) return undefined;
        const cancellation = new AbortController();
        const stylesheet = document.createElement('link');
        stylesheet.rel = 'stylesheet';
        document.head.append(stylesheet);
        const dark = document.body.hasAttribute('data-ds-dark-theme');
        const theme = dark ? 'dark' : 'light';
        let initialized = false;
        let disposed = false;
        let instance;
        void (async () => {
          const response = await fetch('/api/cpic.editor', { signal: cancellation.signal, credentials: 'same-origin' });
          if (!response.ok) throw new Error('EDITOR_ASSETS_UNAVAILABLE');
          const settings = await response.json();
          if (settings.version !== '3.11.3' || typeof settings.cdn !== 'string' || !/^(?:\/(?!\/)|https?:\/\/)/.test(settings.cdn)) throw new Error('EDITOR_ASSETS_VERSION');
          if (disposed) return;
          const cdn = settings.cdn;
          stylesheet.href = `${cdn}/dist/index.css`;
          stylesheet.onerror = () => setAssetError(true);
          instance = new Vditor(host.current, {
          mode: 'wysiwyg', value, height, theme: dark ? 'dark' : 'classic',
          lang: document.documentElement.lang.toLowerCase().startsWith('zh') ? 'zh_CN' : 'en_US',
          cdn, cache: { enable: false },
          toolbar: ['headings', 'bold', 'italic', 'strike', '|', 'quote', 'list', 'ordered-list', 'check', 'code', 'inline-code', 'link', 'table', 'undo', 'redo', 'fullscreen', 'edit-mode'],
          preview: { delay: 120, theme: { current: theme, path: `${cdn}/dist/css/content-theme` }, markdown: { sanitize: true }, hljs: { enable: false } },
          upload: { url: '' },
          input: text => { if (initialized) change.current(text); },
          after: () => {
            if (disposed) { instance.destroy(); return; }
            initialized = true;
            ready.current = true;
            if (instance.getValue() !== latestValue.current) instance.setValue(latestValue.current);
            if (latestDisabled.current) instance.disabled();
            else instance.enable();
          },
        });
          editor.current = instance;
        })().catch(error => { if (!cancellation.signal.aborted) setAssetError(true); });
        return () => {
          disposed = true;
          cancellation.abort();
          if (initialized) instance.destroy();
          if (editor.current === instance) editor.current = null;
          stylesheet.remove();
          ready.current = false;
        };
      }, []);
      React.useEffect(() => {
        if (ready.current && editor.current && editor.current.getValue() !== value) editor.current.setValue(value);
      }, [value]);
      React.useEffect(() => {
        if (!ready.current || !editor.current) return;
        if (disabled) editor.current.disabled();
        else editor.current.enable();
      }, [disabled]);
      return h('div', null,
        assetError ? h('div', { role: 'alert', className: 'cpic-req-error' }, document.documentElement.lang.toLowerCase().startsWith('zh') ? dictionaries.zh.editorAssetsError : dictionaries.en.editorAssetsError) : null,
        h('div', { ref: host, className: 'cpic-req-vditor', 'aria-label': label }));
    }

    function ImportForm({ api, t, onImported, onCancel, systems, projectsLoading, projectsError, onRetryProjects }) {
      const [form, setForm] = React.useState({ source: '', system: '', systemName: '', id: '', title: '', version: '', markdown: '' });
      const [busy, setBusy] = React.useState(false);
      const [error, setError] = React.useState(null);
      const pending = React.useRef(null);
      const fileRead = React.useRef(0);
      React.useEffect(() => () => { pending.current?.abort(); fileRead.current++; }, []);
      const change = (key, value) => setForm(previous => ({ ...previous, [key]: value }));
      async function loadFile(event) {
        const file = event.target.files?.[0];
        if (!file) return;
        const generation = ++fileRead.current;
        if (!/\.(md|txt)$/i.test(file.name)) { setError({ kind: 'fileError' }); return; }
        setBusy(true); setError(null);
        try {
          const markdown = await file.text();
          if (generation === fileRead.current) change('markdown', markdown);
        } catch (reason) {
          if (generation === fileRead.current) setError({ kind: 'fileError', cause: reason });
        } finally { if (generation === fileRead.current) setBusy(false); }
      }
      async function submit(event) {
        event.preventDefault();
        if (pending.current || busy) return;
        const controller = new AbortController(); pending.current = controller;
        setBusy(true); setError(null);
        try {
          const detail = await api('import', form, controller.signal);
          if (!controller.signal.aborted) onImported(detail);
        } catch (reason) { if (!controller.signal.aborted) setError(reason); }
        finally { if (!controller.signal.aborted) { pending.current = null; setBusy(false); } }
      }
      return h('form', { className: 'cpic-req-form', onSubmit: submit, 'aria-busy': busy },
        h('div', { className: 'cpic-req-fields' },
          ...['source', 'id', 'title', 'version'].map(key =>
            h('label', { key }, t(key), h('input', { value: form[key], required: true, disabled: busy,
              onChange: event => change(key, event.target.value) }))),
          h('label', { key: 'system' }, t('system'),
            h('select', { value: form.system, required: true, disabled: busy || projectsLoading || Boolean(projectsError) || systems.length === 0, onChange: event => {
              const system = systems.find(item => item.id === event.target.value);
              setForm(previous => ({ ...previous, system: event.target.value, systemName: system?.name ?? '' }));
            } },
              h('option', { value: '', disabled: true }, projectsLoading ? t('loading') : t('chooseSystem')),
              ...systems.map(system => h('option', { key: system.id, value: system.id }, system.name))),
            projectsError ? h(Notice, { error: projectsError, t, kind: 'projectsError' }) : systems.length === 0 && !projectsLoading ? h('span', { className: 'cpic-req-empty' }, t('noSystems')) : null,
            projectsError ? h('button', { type: 'button', onClick: onRetryProjects }, t('refresh')) : null),
        ),
        h('label', { className: 'cpic-req-import-file' }, t('file'), h('input', { type: 'file', accept: '.md,.txt,text/markdown,text/plain', disabled: busy, onChange: loadFile })),
        h('section', { className: 'cpic-req-import-editor', 'aria-label': t('markdown') },
          h('h3', null, t('markdown')),
          h(MarkdownEditor, { value: form.markdown, disabled: busy, onChange: value => change('markdown', value), label: t('markdown'), height: 360 })),
        h('footer', { className: 'cpic-req-import-actions' },
          h(Notice, { error, t, kind: error?.kind || 'importError' }),
          h('div', { className: 'cpic-req-import-buttons' },
            h('button', { type: 'button', disabled: busy, onClick: onCancel }, t('close')),
            h('button', { className: 'cpic-req-save', type: 'submit', disabled: busy || projectsLoading || Boolean(projectsError) || systems.length === 0 || !form.markdown.trim() || !form.system }, busy ? t('saving') : t('importSubmit')))));
    }
    function Workbench({ api, prepareSession, openPrepared, t }) {
      const [query, setQuery] = React.useState('');
      const [search, setSearch] = React.useState('');
      const [systemFilter, setSystemFilter] = React.useState('');
      const [revision, refresh] = React.useReducer(value => value + 1, 0);
      const [items, setItems] = React.useState([]);
      const [systems, setSystems] = React.useState([]);
      const [projectsLoading, setProjectsLoading] = React.useState(true);
      const [projectsError, setProjectsError] = React.useState(null);
      const [projectsRevision, refreshProjects] = React.useReducer(value => value + 1, 0);
      const [selected, select] = React.useState(null);
      const [detail, setDetail] = React.useState(null);
      const [listing, setListing] = React.useState(true);
      const [reading, setReading] = React.useState(false);
      const [error, setError] = React.useState(null);
      const [detailError, setDetailError] = React.useState(null);
      const [prepareError, setPrepareError] = React.useState(null);
      const [importing, setImporting] = React.useState(false);
      const [notice, setNotice] = React.useState('');
      const [preparing, setPreparing] = React.useState(false);
      const [prepared, setPrepared] = React.useState(null);
       const [editing, setEditing] = React.useState(false);
       const [draft, setDraft] = React.useState('');
       const [saving, setSaving] = React.useState(false);
       const [saveError, setSaveError] = React.useState(null);
       const [saveNotice, setSaveNotice] = React.useState('');
       const requests = React.useRef(new Map());
      const operation = React.useRef(null);
      React.useEffect(() => () => operation.current?.abort(), []);
      React.useEffect(() => {
        const controller = new AbortController();
        setProjectsLoading(true); setProjectsError(null);
        api('projects', {}, controller.signal).then(value => {
          if (!controller.signal.aborted) {
            const authorized = value.map(project => ({ id: project.p_sid, name: project.p_name }));
            setSystems(authorized);
            setSystemFilter(current => current && !authorized.some(project => project.id === current) ? '' : current);
          }
        }).catch(reason => { if (!controller.signal.aborted) setProjectsError(reason); })
          .finally(() => { if (!controller.signal.aborted) setProjectsLoading(false); });
        return () => controller.abort();
      }, [api, projectsRevision]);
      React.useEffect(() => {
        const controller = new AbortController();
        setListing(true); setError(null);
        api('list', search ? { query: search } : {}, controller.signal).then(value => {
          if (!controller.signal.aborted) {
            setItems(value);
            setSystemFilter(current => current && !value.some(item => item.system === current) ? '' : current);
          }
        }).catch(reason => { if (!controller.signal.aborted) setError(reason); })
          .finally(() => { if (!controller.signal.aborted) setListing(false); });
        return () => controller.abort();
      }, [api, search, revision]);
      React.useEffect(() => {
        if (!selected) return;
        const controller = new AbortController();
        setReading(true); setDetail(null); setDetailError(null); setPrepareError(null); setPrepared(null); setEditing(false); setDraft(''); setSaveError(null); setSaveNotice('');
        api('detail', { id: selected }, controller.signal).then(value => {
          if (!controller.signal.aborted) setDetail(value);
        }).catch(reason => { if (!controller.signal.aborted) setDetailError(reason); })
          .finally(() => { if (!controller.signal.aborted) setReading(false); });
        return () => controller.abort();
      }, [api, selected, revision]);
      async function saveMarkdown() {
         if (!detail || saving || !draft.trim()) return;
         const controller = new AbortController();
         setSaving(true); setSaveError(null); setSaveNotice('');
         try {
           const updated = await api('update', { id: detail.id, markdown: draft, expectedHash: detail.hash }, controller.signal);
           setDetail(updated); setEditing(false); setSaveNotice('saved');
         } catch (reason) { setSaveError(reason); }
         finally { setSaving(false); }
       }
       async function prepare() {
        if (!detail || operation.current) return;
        const controller = new AbortController(); operation.current = controller;
        setPreparing(true); setPrepareError(null); setNotice('');
        try {
          let requestId = requests.current.get(detail.id);
          if (!requestId) { requestId = preparationRequestId(); requests.current.set(detail.id, requestId); }
          const result = await prepareSession(detail.id, requestId, controller.signal);
          if (!controller.signal.aborted) {
            setPrepared(result.prepared);
            if (result.draft === 'preserved') setNotice('draftPreserved');
          }
        } catch (reason) { if (!controller.signal.aborted) setPrepareError(reason); }
        finally { if (!controller.signal.aborted) { operation.current = null; setPreparing(false); } }
      }
      function closeDetails() {
        operation.current?.abort(); operation.current = null;
        select(null); setDetail(null); setDetailError(null); setPreparing(false); setPrepareError(null); setPrepared(null); setEditing(false); setSaveError(null); setSaveNotice('');
      }
      function openDetails(id) {
        setReading(true); setDetail(null); setDetailError(null); select(id);
      }
      function imported() {
        setImporting(false); setNotice('imported'); refresh();
      }
      const sortedSystems = [...systems].sort((left, right) => left.name.localeCompare(right.name));
      const visibleItems = systemFilter ? items.filter(item => item.system === systemFilter) : items;
      const selectedSummary = items.find(item => item.id === selected);
      const displayedSystemName = selectedSummary && detail && selectedSummary.system === detail.system ? selectedSummary.systemName : detail?.systemName;
      return h('section', { className: 'cpic-req cpic-req-page' }, h('style', null, css),
        h('div', { className: 'cpic-req-toolbar' }, h('h1', null, t('panel')),
          h('button', { type: 'button', onClick: () => { refresh(); refreshProjects(); }, disabled: preparing }, t('refresh')),
          h('button', { type: 'button', onClick: () => setImporting(value => !value), disabled: preparing }, t('import'))),
        notice ? h('p', { role: 'status' }, t(notice)) : null,
        h(Modal, { open: importing, onClose: () => setImporting(false), title: t('import'), closeLabel: t('close'),
          className: 'cpic-req cpic-req-details-modal cpic-req-import-modal', contentClassName: 'cpic-req-details-content' },
          h(ImportForm, { api, t, systems: sortedSystems, onImported: imported, onCancel: () => setImporting(false), projectsLoading, projectsError, onRetryProjects: refreshProjects })), 
        h('div', { className: 'cpic-req-columns' },
          h('section', { className: 'cpic-req-list', 'aria-label': t('search') },
            h('form', { className: 'cpic-req-search', onSubmit: event => { event.preventDefault(); setSearch(query.trim()); refresh(); } },
              h('input', { type: 'search', value: query, 'aria-label': t('search'), placeholder: t('search'),
                onChange: event => setQuery(event.target.value) }),
              h('select', { value: systemFilter, 'aria-label': t('systemFilter'), onChange: event => setSystemFilter(event.target.value) },
                h('option', { value: '' }, t('allSystems')),
                ...sortedSystems.map(system => h('option', { key: system.id, value: system.id }, system.name))),
              h('button', { type: 'submit' }, t('search'))),
            h(Notice, { error, t, kind: 'queryError' }),
            listing && items.length === 0 ? h('div', { role: 'status', 'aria-label': t('loading') },
              ...[0, 1, 2].map(key => h('div', { className: 'cpic-req-skeleton', key }))) : null,
            !listing && !error && visibleItems.length === 0 ? h('p', { className: 'cpic-req-empty' }, t('empty')) : null,
            h('ul', null, ...visibleItems.map(item => h('li', { key: item.id },
              h('button', { className: 'cpic-req-row', type: 'button', 'aria-haspopup': 'dialog', disabled: preparing,
                onClick: () => openDetails(item.id) },
              h('div', null, item.title), h('div', { className: 'cpic-req-meta' }, item.source, ' / ', item.systemName, ' / ', item.version))))))),
        h(Modal, { open: selected !== null, onClose: closeDetails, title: detail?.title || selectedSummary?.title || t('details'),
          closeLabel: t('closeDetails'), className: 'cpic-req cpic-req-details-modal', contentClassName: 'cpic-req-details-content' },
          h('section', { className: 'cpic-req-detail', 'aria-label': t('markdown'), 'aria-busy': reading || preparing },
            h(Notice, { error: detailError, t, kind: 'detailError' }),
            reading ? h(Spinner, { t }) : detail ? h(React.Fragment, null,
              h('div', { className: 'cpic-req-meta' },
                h('span', null, t('source'), ': ', detail.source),
                h('span', null, t('system'), ': ', displayedSystemName),
                h('span', null, t('version'), ': ', detail.version),
                h('span', null, String(detail.updatedAt))),
              h('button', { type: 'button', disabled: preparing || editing, onClick: prepare }, t('prepare')),
               h('button', { type: 'button', disabled: preparing || saving, onClick: () => { setDraft(detail.markdown); setEditing(true); setSaveError(null); setSaveNotice(''); } }, t('edit')),
              h(Notice, { error: prepareError, t, kind: 'prepareError' }),
              prepared ? h('button', { type: 'button', onClick: () => openPrepared(prepared.sessionId) }, t('prepared')) : null,
               saveNotice ? h('p', { role: 'status' }, t(saveNotice)) : null,
               h(Notice, { error: saveError, t, kind: saveError?.code === 'SOURCE_CONFLICT' ? 'conflictError' : 'saveError' }),
              h('h3', null, t('markdown')), editing ? h(React.Fragment, null,
                 h('div', { className: 'cpic-req-editor-grid' },
                    h('section', { className: 'cpic-req-editor-pane', 'aria-label': t('markdown') }, h(MarkdownEditor, { value: draft, disabled: saving, onChange: setDraft, label: t('markdown') })),
                    h('section', { className: 'cpic-req-editor-pane cpic-req-preview-pane', 'aria-label': t('previewMarkdown') },
                      h('h3', null, t('previewMarkdown')),
                      h(MarkdownText, { text: draft, labels: { code: { copyLabel: t('copy'), copiedLabel: t('copied') }, footnotes: t('footnotes') } }))),
                 h('div', { className: 'cpic-req-editor-actions' },
                   h('button', { className: 'cpic-req-save', type: 'button', disabled: saving || !draft.trim(), onClick: saveMarkdown }, saving ? t('saving') : t('save')),
                   h('button', { type: 'button', disabled: saving, onClick: () => { setEditing(false); setSaveError(null); } }, t('cancelEdit'))))
                 : h(MarkdownText, { text: detail.markdown, labels: { code: { copyLabel: t('copy'), copiedLabel: t('copied') }, footnotes: t('footnotes') } }))
              : detailError ? h('button', { type: 'button', onClick: refresh }, t('refresh')) : null)));
    }
    function RadarPanel({ api, runSessionId, previewSnapshot, useSidebarMounted, t }) {
      const mounted = useSidebarMounted(value => value);
      const [run, setRun] = React.useState(null);
      const [known, setKnown] = React.useState(false);
      const [busy, setBusy] = React.useState(false);
      const [error, setError] = React.useState(null);
      const [previewError, setPreviewError] = React.useState(null);
      const [revision, refresh] = React.useReducer(value => value + 1, 0);
      const operation = React.useRef(null);
      React.useEffect(() => {
        let active = true;
        let timer;
        const controller = new AbortController();
        operation.current = controller;
        async function load() {
          operation.current = controller;
          setBusy(true);
          try {
            const value = await api('getRun', { sessionId: runSessionId }, controller.signal);
            if (!active || controller.signal.aborted) return;
            setRun(value); setKnown(true); setError(null);
            const terminal = value && ['completed', 'completed_with_issues', 'succeeded', 'cancelled', 'result_unverified'].includes(value.status);
            if (!terminal) timer = setTimeout(load, 2500);
          } catch (reason) {
            if (active && !controller.signal.aborted) setError({ ...reason, kind: 'runError' });
          } finally {
            if (active && !controller.signal.aborted) { setBusy(false); operation.current = null; }
          }
        }
        void load();
        return () => { active = false; clearTimeout(timer); controller.abort(); };
      }, [api, runSessionId, revision]);
      function preview(path = run?.snapshot.path) {
        if (!run || mounted !== runSessionId || !path) return;
        try { previewSnapshot(path); setPreviewError(null); }
        catch (reason) { setPreviewError(reason); }
      }
      async function act(action) {
        if (operation.current || !known || !run) return;
        const controller = new AbortController(); operation.current = controller;
        setBusy(true); setError(null); setKnown(false);
        try {
          await api(action, { sessionId: runSessionId }, controller.signal);
          const current = await api('getRun', { sessionId: runSessionId }, controller.signal);
          if (!controller.signal.aborted) { setRun(current); setKnown(true); refresh(); }
        } catch (reason) { if (!controller.signal.aborted) setError({ ...reason, kind: 'actionError' }); }
        finally { if (!controller.signal.aborted) { setBusy(false); operation.current = null; } }
      }
      const statusKeys = {
        prepared: 'statusPrepared', queued: 'statusQueued', running: 'statusRunning',
        completed: 'statusCompleted', succeeded: 'statusSucceeded', failed: 'statusFailed',
        cancelled: 'statusCancelled', cancelling: 'statusCancelling', canceling: 'statusCancelling',
        pending: 'statusPrepared', starting: 'statusStarting', uncertain: 'statusUncertain',
        completed_with_issues: 'statusWithIssues', result_unverified: 'statusUnverified', waiting_input: 'statusWaitingInput',
      };
      const stages = ['cleanup', 'features', 'outline', 'testcases'];
      const stageKeys = { cleanup: 'stageCleanup', features: 'stageFeatures', outline: 'stageOutline', testcases: 'stageTestcases' };
      const stage = run?.stage || (isRecord(run?.stages) ? stages.find(key => run.stages[key]?.status !== 'committed') : undefined);
      const terminal = run && ['completed', 'completed_with_issues', 'succeeded', 'cancelled', 'result_unverified'].includes(run.status);
      const status = run && !terminal && isText(run.execution) ? run.execution : run?.status;
      const statusKey = Object.hasOwn(statusKeys, status) ? statusKeys[status] : 'statusUnknown';
      const artifacts = [];
      if (isRecord(run?.stages)) for (const name of stages) {
        const entry = run.stages[name];
        for (const attempt of entry?.attempts ?? []) {
          if (Number.isSafeInteger(attempt.attempt)) artifacts.push(`${name}.attempt-${attempt.attempt}.json`);
          if (Number.isSafeInteger(attempt.attempt) && attempt.review) artifacts.push(`${name}.review-${attempt.attempt}.json`);
        }
        if (entry?.committed) artifacts.push(`${name}.json`);
      }
      if (run?.stages?.cleanup?.committed) artifacts.push('cleaned.md');
      if (Array.isArray(run?.artifacts)) artifacts.push(...run.artifacts.filter(name => ['testcases.json', 'testcases.md'].includes(name)));
      const cleanRequirements = run?.stages?.cleanup?.committed?.requirements;
      const testcases = run?.stages?.testcases?.committed?.testcases;
      const metrics = [
        ['requirements', Array.isArray(cleanRequirements) ? cleanRequirements.length : null],
        ['features', Array.isArray(run?.stages?.features?.committed?.features) ? run.stages.features.committed.features.length : null],
        ['scenarios', Array.isArray(run?.stages?.outline?.committed?.scenarios) ? run.stages.outline.committed.scenarios.length : null],
        ['cases', Array.isArray(testcases) ? testcases.length : null],
      ];
      const canStart = known && run && ['prepared', 'pending', 'failed'].includes(status);
      const canCancel = known && run && ['prepared', 'pending', 'queued', 'starting', 'running', 'uncertain'].includes(status);
      return h('section', { className: 'cpic-req cpic-req-radar', 'aria-label': t('radar'), 'aria-busy': busy },
        h('style', null, css),
        h('div', { className: 'cpic-req-toolbar' }, h('h2', null, t('radar')), h('button', { type: 'button', disabled: busy, onClick: refresh }, t('refresh'))),
        busy && !run ? h(Spinner, { t }) : null,
        error ? h(Notice, { error, t, kind: error.kind || 'runError' }) : null,
        run ? h(React.Fragment, null,
          h('div', { role: 'status' }, t(statusKey), statusKey === 'statusUnknown' ? ': ' + status : null),
          h('div', { className: 'cpic-req-meta' }, stage ? h('span', null, t('stage'), ': ', t(stageKeys[stage]) || stage) : null, h('span', null, t('version'), ': ', run.snapshot.version)),
          h('div', { className: 'cpic-req-radar-metrics' }, ...metrics.map(([key, value]) => h('div', { className: 'cpic-req-radar-metric', key }, t(key), h('strong', null, value === null ? t('notGenerated') : value)))),
          h('h3', null, t('stages')),
          ...stages.map(name => h('div', { className: 'cpic-req-radar-stage', key: name }, t(stageKeys[name]), ' · ', t(run.stages?.[name]?.status === 'committed' ? 'stageDone' : name === stage ? 'stageCurrent' : 'stagePending'))),
          h('div', { className: 'cpic-req-toolbar' },
            h('button', { type: 'button', disabled: busy || !canStart, onClick: () => act('start') }, t('start')),
            h('button', { type: 'button', disabled: busy || !canCancel, onClick: () => act('cancel') }, t('cancel')),
            h('button', { type: 'button', disabled: mounted !== runSessionId, onClick: () => preview() }, t('preview'))),
          artifacts.length ? h(React.Fragment, null, h('h3', null, t('artifacts')),
            h('div', { className: 'cpic-req-radar-artifacts' }, ...[...new Set(artifacts)].map(name => h('button', {
              key: name, type: 'button', disabled: mounted !== runSessionId, 'aria-label': t('openArtifact') + ': ' + name,
              onClick: () => preview(run.workspacePath.replace(/[/\\]+$/, '') + '/analyses/' + run.id + '/' + name),
            }, name)))) : null,
          Array.isArray(run.stages?.cleanup?.committed?.questions) && run.stages.cleanup.committed.questions.length
            ? h('details', null, h('summary', null, t('questions')), h('ul', null, ...run.stages.cleanup.committed.questions.map((question, index) => h('li', { key: index }, question)))) : null,
        ) : known ? h('p', null, t('noRun')) : null,
        h(Notice, { error: previewError, t, kind: 'previewError' }));
    }
    function RadarDock({ openRadar, t }) {
      return h('section', { className: 'cpic-req cpic-req-dock' }, h('style', null, css),
        h('button', { type: 'button', onClick: openRadar }, t('radar')));
    }
    return {
      inject: ['slots', 'locale', 'layout', 'uiWorkspace', 'sessions', 'conversation', 'sidebarRight', 'sidebarRightTabs'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, dictionaries));
        const t = ctx.locale.bind(NS);
        const lifetime = new AbortController();
        ctx.effect(() => () => lifetime.abort());
        async function api(action, input, signal) {
          let response;
          try {
            response = await fetch('/api/cpic.requirements', { method: 'POST', credentials: 'same-origin',
              headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...input }),
              signal: signal ? AbortSignal.any([signal, lifetime.signal]) : lifetime.signal });
          } catch (cause) { throw { code: 'NETWORK_ERROR', message: t('transportError'), cause }; }
          let result;
          try { result = await response.json(); }
          catch (cause) { throw { code: 'INVALID_RESPONSE', message: t('invalidResponse'), cause }; }
          if (isRecord(result) && result.ok === false && isRecord(result.error)
            && isText(result.error.code) && isText(result.error.message)) throw result.error;
          const valid = action === 'list' ? Array.isArray(result?.value) && result.value.every(isSummary)
            : action === 'projects' ? Array.isArray(result?.value) && result.value.every(isProject)
              : action === 'detail' || action === 'update' || action === 'import' ? isDetail(result?.value)
              : action === 'prepare' ? isPrepared(result?.value)
                : action === 'getRun' ? isRun(result?.value) : true;
          if (!response.ok || !isRecord(result) || result.ok !== true || !valid) {
            throw { code: 'INVALID_RESPONSE', message: t('invalidResponse') };
          }
          return result.value;
        }
        async function prepareSession(id, requestId, signal) {
          const navigation = ctx.layout.beginNavigation();
          const cancellation = AbortSignal.any([signal, lifetime.signal]);
          const prepared = await api('prepare', { id, requestId }, cancellation);
          if (navigation.aborted || cancellation.aborted) return { prepared };
          const reference = ctx.sessions.retain(prepared.sessionId, { source: 'controllerOperation', signal: cancellation });
          try {
            await reference.ready;
            if (navigation.aborted || cancellation.aborted) return { prepared };
            const draft = ctx.conversation.input.requestDraftInitialization(reference.binding, { prompt: prepared.prompt });
            if (draft === 'blocked') throw { code: 'DRAFT_BLOCKED', message: t('draftBlocked') };
            if (!navigation.aborted && !cancellation.aborted) ctx.uiWorkspace.openSession(prepared.sessionId);
            return { prepared, draft };
          } finally { reference.release(); }
        }
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main', key: NS, locale: NS,
          inject: () => ({ api, prepareSession, openPrepared: sessionId => ctx.uiWorkspace.openSession(sessionId) }),
        }, Workbench));
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist', id: NS, order: 20, label: () => t('panel'), locale: NS,
        }, Icon));
        const previewSnapshot = (sessionId, path) => {
          if (ctx.sidebarRight.mounted.getSnapshot() !== sessionId) throw { code: 'SIDEBAR_NOT_MOUNTED' };
          const encode = segment => encodeURIComponent(segment).replace(/%3A/gi, ':');
          const normalized = path.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '');
          ctx.sidebarRight.openResource('dsh-resource://file/session/' + encode(sessionId) + '/' + normalized.split('/').map(encode).join('/'));
        };
        ctx.effect(() => ctx.sidebarRightTabs.register({ id: NS + '.radar', kind: RADAR_KIND, title: () => t('radar') }));
        ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab', key: NS + '.radar', locale: NS,
          inject: sessionId => ({ api, runSessionId: sessionId, previewSnapshot: path => previewSnapshot(sessionId, path), hooks: { sidebarMounted: ctx.sidebarRight.mounted } }),
        }, RadarPanel));
        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock', id: NS, order: 20, locale: NS,
          inject: () => ({ openRadar: () => ctx.sidebarRight.openTab(RADAR_KIND) }),
        }, RadarDock));
      },
    };
  },
});

window.__ModuleLoader__.load({
  id: '@cpic/oa-workbench',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const NS = 'cpic.oa'
    const copy = {
      zh: { panel: 'CPIC-oa', title: 'CPIC-oa 质量控制台', subtitle: '需求追溯、用例评审、人工执行与质量门禁', refresh: '刷新', projects: '项目', plans: '用例计划', defects: '缺陷', runs: '分析运行', create: '新建项目', projectName: '项目名称', import: '导入用例', review: '评审通过', reject: '驳回', execute: '记录执行', defect: '登记缺陷', report: '质量报告', empty: '还没有 QA 项目。创建项目后可导入已完成的案例设计。', noPlans: '暂无用例计划', cases: '条用例', draft: '待评审', approved: '已批准', rejected: '已驳回', pass: '通过', passed: '已通过', failed: '失败', blocked: '阻塞', gatePass: '门禁通过', gateReview: '需要复核', gateBlocked: '门禁阻断', project: '选择项目', run: '选择已完成的案例设计运行', error: '无法读取或更新 CPIC-oa 数据，请刷新重试', loading: '加载中', defectsOpen: '未关闭缺陷', total: '用例总数', executed: '已执行', audit: '审计记录', close: '关闭', source: '来源分析', evidence: '证据说明 / 工作区文件引用' },
      en: { panel: 'CPIC-oa', title: 'CPIC-oa Quality Console', subtitle: 'Traceable requirements, reviewed cases, manual execution and quality gates', refresh: 'Refresh', projects: 'Projects', plans: 'Test plans', defects: 'Defects', runs: 'Analysis runs', create: 'New project', projectName: 'Project name', import: 'Import test cases', review: 'Approve plan', reject: 'Reject', execute: 'Record execution', defect: 'Create defect', report: 'Quality report', empty: 'No QA projects yet. Create a project, then import a completed case-design run.', noPlans: 'No testcase plans', cases: 'cases', draft: 'Needs review', approved: 'Approved', rejected: 'Rejected', pass: 'Pass', passed: 'Passed', failed: 'Failed', blocked: 'Blocked', gatePass: 'Gate passed', gateReview: 'Review required', gateBlocked: 'Gate blocked', project: 'Select project', run: 'Select completed case-design run', error: 'Could not load or update CPIC-oa data. Refresh and try again.', loading: 'Loading', defectsOpen: 'Open defects', total: 'Total cases', executed: 'Executed', audit: 'Audit log', close: 'Close', source: 'Source analysis', evidence: 'Evidence note / workspace file reference' },
    }
    const styles = `.cpicoa{box-sizing:border-box;height:100%;overflow:auto;padding:24px;color:var(--dsw-alias-label-primary);font-size:13px}.cpicoa *{box-sizing:border-box}.cpicoa h1,.cpicoa h2,.cpicoa h3{font-weight:500;margin:0}.cpicoa h1{font-size:22px}.cpicoa h2{font-size:16px}.cpicoa h3{font-size:14px}.cpicoa-head{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:20px}.cpicoa-head h1{margin-right:auto}.cpicoa-sub{color:var(--dsw-alias-label-secondary);width:100%}.cpicoa button,.cpicoa input,.cpicoa select,.cpicoa textarea{font:inherit;color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l3);border-radius:8px;background:var(--dsw-alias-bg-layer-2);padding:8px 10px}.cpicoa button{cursor:pointer}.cpicoa button:hover{background:var(--dsw-alias-interactive-bg-hover)}.cpicoa button:focus-visible,.cpicoa input:focus-visible,.cpicoa select:focus-visible,.cpicoa textarea:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}.cpicoa .primary{background:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-primary)}.cpicoa-grid{display:grid;grid-template-columns:240px minmax(0,1fr);gap:16px}.cpicoa-surface{border:1px solid var(--dsw-alias-border-l3);border-radius:10px;background:var(--dsw-alias-bg-layer-1);padding:16px;min-width:0}.cpicoa-row{padding:10px 0;border-bottom:1px solid var(--dsw-alias-border-l3);display:flex;align-items:center;gap:8px;flex-wrap:wrap}.cpicoa-row:last-child{border-bottom:0}.cpicoa-muted{color:var(--dsw-alias-label-secondary)}.cpicoa-chip{border:1px solid var(--dsw-alias-border-l3);border-radius:999px;padding:2px 8px}.cpicoa-metrics{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}.cpicoa-actions{display:flex;gap:8px;flex-wrap:wrap}.cpicoa-form{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}.cpicoa-case{padding:12px 0;border-top:1px solid var(--dsw-alias-border-l3)}.cpicoa-error{color:var(--dsw-alias-state-error-primary);margin:10px 0}@media(max-width:720px){.cpicoa{padding:16px}.cpicoa-grid{grid-template-columns:1fr}}`

    function Icon() { return h('svg', { viewBox: '0 0 24 24', width: 18, height: 18, 'aria-hidden': true }, h('path', { d: 'M4 5h16v14H4z M8 9h8 M8 12h5 M8 15h8', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' })) }

    function Dashboard({ api, t }) {
      const [data, setData] = React.useState(null)
      const [selected, setSelected] = React.useState('')
      const [error, setError] = React.useState(false)
      const [busy, setBusy] = React.useState(false)
      const [projectName, setProjectName] = React.useState('')
      const [runId, setRunId] = React.useState('')
      const [detailPlan, setDetailPlan] = React.useState('')
      const refresh = React.useCallback(async () => {
        setBusy(true); setError(false)
        try {
          const result = await api({ action: 'qaList' })
          setData(result)
          setSelected(previous => result.projects.some(project => project.id === previous) ? previous : result.projects[0]?.id || '')
        } catch { setError(true) } finally { setBusy(false) }
      }, [api])
      React.useEffect(() => { void refresh() }, [refresh])
      async function mutate(action, values = {}) { setBusy(true); setError(false); try { await api({ action, ...values }); await refresh() } catch { setError(true); setBusy(false) } }
      if (!data) return h('div', { className: 'cpicoa' }, h('style', null, styles), error ? h('p', { className: 'cpicoa-error' }, t('error')) : h('p', { className: 'cpicoa-muted' }, t('loading')), h('button', { onClick: refresh }, t('refresh')))
      const project = data.projects.find(item => item.id === selected)
      const plans = data.plans.filter(plan => plan.projectId === selected)
      const defects = data.defects.filter(defect => defect.projectId === selected)
      const report = project ? { totalCases: plans.reduce((n, plan) => n + plan.cases.length, 0), executedCases: data.executions.filter(execution => plans.some(plan => plan.id === execution.planId)).length, openDefects: defects.filter(defect => !['verified', 'closed'].includes(defect.status)).length, gate: plans.length === 0 || plans.some(plan => plan.status !== 'approved') || defects.some(defect => defect.severity === 'critical' && !['verified', 'closed'].includes(defect.status)) ? 'blocked' : 'review' } : null
      const renderedPlans = plans.length ? plans.map(plan => {
        const caseRows = plan.cases.map(testcase => {
          const resultButtons = ['passed', 'failed', 'blocked'].map(result => h('button', {
            key: result, disabled: busy || plan.status !== 'approved',
            onClick: () => void mutate('qaRecordExecution', { planId: plan.id, entityVersion: plan.version, testcaseId: testcase.id, result }),
          }, t(result) || result))
          const defectButton = h('button', { disabled: busy, onClick: () => {
            const title = window.prompt(t('defect'))
            if (title) void mutate('qaCreateDefect', { projectId: selected, planId: plan.id, testcaseId: testcase.id, title })
          } }, t('defect'))
          return h('div', { className: 'cpicoa-case', key: testcase.id },
            h('strong', null, `${testcase.id} · ${testcase.title}`),
            h('p', { className: 'cpicoa-muted' }, testcase.preconditions.join(' · ')),
            h('div', { className: 'cpicoa-actions' }, ...resultButtons, defectButton))
        })
        return h('article', { className: 'cpicoa-row', key: plan.id },
          h('button', { onClick: () => setDetailPlan(detailPlan === plan.id ? '' : plan.id) }, `${plan.sourceRunId} · ${t(plan.status) || plan.status} · ${plan.cases.length} ${t('cases')}`),
          plan.status === 'draft' || plan.status === 'rejected' ? h('button', { disabled: busy, onClick: () => void mutate('qaReviewPlan', { planId: plan.id, entityVersion: plan.version, decision: 'approve' }) }, t('review')) : null,
          detailPlan === plan.id ? h('div', null, ...caseRows) : null)
      }) : h('p', { className: 'cpicoa-muted' }, t('noPlans'))
      const auditRows = data.audits.filter(audit => audit.projectId === selected).slice(-20).reverse().map(audit => h('div', { className: 'cpicoa-row cpicoa-muted', key: audit.id }, `${audit.action} · ${audit.entityType} · ${new Date(audit.createdAt).toLocaleString()}`))
      const projectContent = project ? h(React.Fragment, null,
        h('h2', null, project.name),
        h('div', { className: 'cpicoa-metrics' },
          h('span', { className: 'cpicoa-chip' }, `${t('total')}: ${report.totalCases}`),
          h('span', { className: 'cpicoa-chip' }, `${t('executed')}: ${report.executedCases}`),
          h('span', { className: 'cpicoa-chip' }, `${t('defectsOpen')}: ${report.openDefects}`),
          h('span', { className: 'cpicoa-chip' }, report.gate === 'pass' ? t('gatePass') : report.gate === 'review' ? t('gateReview') : t('gateBlocked'))),
        h('h2', null, t('plans')), renderedPlans,
        h('h2', null, t('defects')), ...defects.map(defect => h('div', { className: 'cpicoa-row', key: defect.id },
          h('strong', null, defect.title), h('span', { className: 'cpicoa-chip' }, defect.severity),
          h('select', { value: defect.status, onChange: event => void mutate('qaUpdateDefect', { defectId: defect.id, entityVersion: defect.version, status: event.target.value }) },
            ...['open', 'fixed', 'verified', 'closed'].map(status => h('option', { value: status, key: status }, status))))),
        h('h2', null, t('audit')), ...auditRows) : h('p', { className: 'cpicoa-muted' }, t('empty'))
      return h('main', { className: 'cpicoa' }, h('style', null, styles),
        h('header', { className: 'cpicoa-head' }, h('h1', null, t('title')), h('button', { onClick: refresh, disabled: busy }, t('refresh')), h('div', { className: 'cpicoa-sub' }, t('subtitle'))),
        error ? h('p', { role: 'alert', className: 'cpicoa-error' }, t('error')) : null,
        h('div', { className: 'cpicoa-grid' },
          h('section', { className: 'cpicoa-surface' }, h('h2', null, t('projects')),
            data.projects.length ? data.projects.map(item => h('div', { className: 'cpicoa-row', key: item.id }, h('button', { onClick: () => setSelected(item.id), 'aria-pressed': selected === item.id }, item.name))) : h('p', { className: 'cpicoa-muted' }, t('empty')),
            h('form', { className: 'cpicoa-form', onSubmit: event => { event.preventDefault(); if (projectName.trim()) { void mutate('qaCreateProject', { name: projectName }); setProjectName('') } } },
              h('input', { value: projectName, onChange: event => setProjectName(event.target.value), placeholder: t('projectName'), 'aria-label': t('projectName') }),
              h('button', { type: 'submit', disabled: busy || !projectName.trim() }, t('create'))),
            project ? h(React.Fragment, null, h('h3', null, t('runs')),
              h('select', { value: runId, onChange: event => setRunId(event.target.value), 'aria-label': t('run') },
                h('option', { value: '' }, t('run')),
                ...data.runs.filter(run => ['completed', 'completed_with_issues'].includes(run.status)).map(run => h('option', { value: run.runId, key: run.runId }, `${run.workflow || run.displayName || run.runId} · ${run.status}`))),
              h('button', { onClick: () => runId && void mutate('qaImportPlan', { projectId: selected, runId }), disabled: busy || !runId }, t('import'))) : null),
          h('section', { className: 'cpicoa-surface' }, projectContent)))
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, copy))
        const t = ctx.locale.bind(NS)
        const lifetime = new AbortController()
        ctx.effect(() => () => lifetime.abort())
        const api = async payload => {
          let response
          try { response = await fetch('/api/cpic.oa', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: lifetime.signal }) }
          catch (cause) { throw { code: 'NETWORK_ERROR', cause } }
          let result
          try { result = await response.json() } catch (cause) { throw { code: 'INVALID_RESPONSE', cause } }
          if (!response.ok || result?.ok !== true) throw result?.error || { code: 'INVALID_RESPONSE' }
          return result.value
        }
        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: '@cpic/oa-workbench', locale: NS, inject: () => ({ api, t }) }, Dashboard))
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: '@cpic/oa-workbench', order: 18, label: () => ctx.locale.bind(NS)('panel'), locale: NS }, Icon))
      },
    }
  },
})
