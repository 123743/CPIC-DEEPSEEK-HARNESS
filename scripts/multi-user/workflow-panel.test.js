/** Regression coverage for the workflow panel mounted by tenant launch overlays. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'

const require = createRequire(new URL('../../packages/client/ui-conversation/package.json', import.meta.url))
const React = require('react')
const { JSDOM } = require('jsdom')
const source = readFileSync(new URL('../../extensions/dsh-workflow-panel/client.js', import.meta.url), 'utf8')
const runs = ['tenant-run-1', 'case-design-2'].map(runId => ({ runId, workflow: runId, status: 'running' }))
const graph = { version: 1, nodes: [
  { id: 'workflow', title: 'Tenant workflow', kind: 'workflow', status: 'running' },
  { id: 'stage', title: 'Review stage', kind: 'phase', status: 'completed' },
], edges: [{ id: 'contains', source: 'workflow', target: 'stage', type: 'contains' }] }

async function panel(t, respond, operation) {
  const dom = new JSDOM('<main></main>', { url: 'http://localhost/' })
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true }
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  t.after(() => {
    dom.window.close()
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  })
  let definition, main, dictionary
  const cleanup = [], calls = []
  vm.runInNewContext(source, {
    window: { __ModuleLoader__: { load(value) { definition = value } } }, AbortController, AbortSignal,
    ResizeObserver: class { observe() {} disconnect() {} },
    fetch: async (_url, request) => {
      const input = JSON.parse(request.body)
      calls.push({ ...input, signal: request.signal })
      const value = await respond(input, request)
      return { ok: value.ok !== false, json: async () => value }
    },
  })
  const plugin = definition.factory(() => React)
  const ctx = {
    effect(fn) { const dispose = fn(); if (typeof dispose === 'function') cleanup.push(dispose) },
    locale: { register(_ns, values) { dictionary = values.zh }, bind() { return key => dictionary[key] } },
    slots: { inject(_name, fn) { fn() }, register(options, component) { if (options.name === 'main') main = { options, component } } },
  }
  plugin.apply(ctx)
  const { createRoot } = require('react-dom/client')
  const root = createRoot(dom.window.document.querySelector('main'))
  try {
    await React.act(async () => root.render(React.createElement(main.component, { ...main.options.inject(), t: ctx.locale.bind() })))
    await operation({ document: dom.window.document, calls, click: async button => React.act(async () => button.click()),
      type: async (input, value) => React.act(async () => {
        const proto = input.tagName === 'TEXTAREA' ? dom.window.HTMLTextAreaElement : dom.window.HTMLInputElement
        Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(input, value)
        input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
      }) })
  } finally {
    await React.act(async () => root.unmount())
    for (const dispose of cleanup.reverse()) dispose()
  }
}
const success = value => ({ ok: true, value })
const details = runId => ({ snapshot: { runId, process: { graph } }, events: [] })
const findButton = (document, label) => [...document.querySelectorAll('button')].find(button => button.textContent === label)

test('tenant list displays session names while keeping separate sessions with the same name', async t => {
  const rows = runs.map((run, index) => ({ ...run, sessionId: `tenant-session-${index}`, sessionName: '需求评审' }))
  await panel(t, async () => success(rows), async ({ document }) => {
    assert.deepEqual([...document.querySelectorAll('h2')].map(heading => heading.textContent), ['会话: 需求评审', '会话: 需求评审'])
    assert.equal(document.querySelectorAll('button.wf-panel-row').length, 2)
    assert.doesNotMatch(document.querySelector('main').textContent, /tenant-session-/)
  })
})

test('tenant list lazily previews multiple run graphs and refreshes them without navigation', async t => {
  await panel(t, async input => success(input.action === 'list' ? runs : details(input.runId)), async ({ document, calls, click }) => {
    assert.equal(calls.length, 1)
    const controls = [...document.querySelectorAll('button')].filter(button => button.textContent === '查看运行图')
    const rows = [...document.querySelectorAll('button.wf-panel-row')]
    for (const [index, control] of controls.entries()) {
      assert.equal(control.parentElement, rows[index].parentElement)
      assert.equal(rows[index].nextElementSibling, control)
    }
    await click(controls[0]); await click(controls[1])
    assert.equal(document.querySelectorAll('.wf-run-graph-node').length, 4)
    assert.equal(document.querySelectorAll('button.wf-panel-row').length, 2)
    assert.equal(controls[0].getAttribute('aria-expanded'), 'true')
    const markers = [...document.querySelectorAll('marker')].map(marker => marker.id)
    assert.equal(new Set(markers).size, 2)
    for (const edge of document.querySelectorAll('.wf-run-graph-edge')) assert.ok(markers.some(id => edge.getAttribute('marker-end') === `url(#${id})`))
    await click(findButton(document, '刷新'))
    assert.equal(calls.filter(call => call.action === 'detail').length, 4)
    await click(controls[0])
    assert.equal(controls[0].getAttribute('aria-expanded'), 'false')
    assert.equal(document.querySelectorAll('.wf-run-graph-node').length, 2)
    await click(document.querySelector('button.wf-panel-row'))
    assert.equal(document.querySelectorAll('button.wf-panel-row').length, 0)
  })
})

test('failed previews keep list rows visible and retry before rendering legacy or empty records', async t => {
  let requests = 0
  await panel(t, async input => {
    if (input.action === 'list') return success(runs)
    if (++requests === 1) return { ok: false, error: { code: 'STORE_READ', message: 'Unavailable' } }
    return success({ snapshot: { runId: input.runId, process: requests === 2
      ? { items: [{ kind: 'step', title: 'Legacy review', status: 'completed' }] } : {} }, events: [] })
  }, async ({ document, click }) => {
    await click(findButton(document, '查看运行图'))
    assert.match(document.querySelector('[role=alert]').textContent, /无法加载运行图/)
    assert.equal(document.querySelectorAll('button.wf-panel-row').length, 2)
    await click(findButton(document, '重试'))
    assert.match(document.querySelector('.wf-panel-graph-preview-content').textContent, /Legacy review/)
    await click(findButton(document, '查看运行图'))
    assert.match(document.body.textContent, /尚未记录运行图/)
  })
})

test('refresh failures retain the previously loaded graph beside a retry action', async t => {
  let reads = 0
  await panel(t, async input => {
    if (input.action === 'list') return success(runs)
    return ++reads === 2 ? { ok: false, error: { code: 'STORE_READ', message: 'Unavailable' } } : success(details(input.runId))
  }, async ({ document, click }) => {
    await click(findButton(document, '查看运行图'))
    const canvas = document.querySelector('.wf-run-graph-canvas')
    await click(findButton(document, '刷新'))
    assert.match(document.querySelector('[role=alert]').textContent, /无法加载运行图/)
    assert.equal(document.querySelector('.wf-run-graph-canvas'), canvas)
    await click(findButton(document, '重试'))
    assert.equal(document.querySelector('[role=alert]'), null)
    assert.equal(document.querySelectorAll('.wf-run-graph-node').length, 2)
  })
})

test('leaving the list aborts pending previews without changing the selected detail', async t => {
  const pending = Promise.withResolvers()
  let reads = 0
  await panel(t, async input => input.action === 'list' ? success(runs)
    : ++reads === 1 ? pending.promise : success(details(input.runId)), async ({ document, calls, click }) => {
    await click(findButton(document, '查看运行图'))
    const request = calls.find(call => call.action === 'detail')
    await click(document.querySelectorAll('button.wf-panel-row')[1])
    assert.equal(request.signal.aborted, true)
    const heading = document.querySelector('h1.wf-panel-detail-title')
    assert.ok(heading)
    await React.act(async () => pending.resolve(success(details(runs[0].runId))))
    assert.equal(document.querySelector('h1.wf-panel-detail-title'), heading)
    assert.equal(document.querySelectorAll('.wf-run-graph-node').length, 2)
  })
})

test('collapsing a pending preview aborts its request and ignores late results', async t => {
  const pending = Promise.withResolvers()
  await panel(t, async input => input.action === 'list' ? success(runs) : pending.promise, async ({ document, calls, click }) => {
    await click(findButton(document, '查看运行图'))
    const request = calls.find(call => call.action === 'detail')
    assert.equal(request.signal.aborted, false)
    await click(findButton(document, '收起运行图'))
    assert.equal(request.signal.aborted, true)
    await React.act(async () => pending.resolve(success(details(runs[0].runId))))
    assert.equal(document.querySelectorAll('.wf-run-graph-node').length, 0)
  })
})

test('tenant panel edits the pipeline configuration and keeps edits after a failed save', async t => {
  let saves = 0
  const config = { version: 2, nodes: [
    { id: 'clarify', stage: 'cleanup', kind: 'generate', actor: { role: 'requirement-clarifier', skill: 'requirement-clarification', workspace: 'clarifier' }, judge: { role: 'judge-clarify', rule: 'Rule one' } },
    { id: 'case-review', stage: 'testcases', kind: 'review', actor: { role: 'case-reviewer', skill: 'case-review', workspace: 'cases' }, judge: { role: 'judge-case-review', rule: 'Rule two' } },
  ] }
  await panel(t, async input => {
    if (input.action === 'getPipelineConfig') return success(config)
    if (input.action === 'updatePipelineConfig') {
      saves++
      return saves === 1 ? { ok: false, error: { code: 'INVALID_PIPELINE', message: 'judge.rule must not be empty' } }
        : success({ version: 2, nodes: input.nodes })
    }
    return success(input.action === 'list' ? runs : details(input.runId))
  }, async ({ document, click, type }) => {
    await click(findButton(document, '查看流水线配置'))
    const section = document.querySelector('[aria-label="流水线配置"]')
    assert.deepEqual([...section.querySelectorAll('.wf-pipeline-node-title')].map(item => item.textContent), ['需求澄清', '用例评审'])
    assert.match(section.textContent, /requirement-clarifier/)
    assert.match(section.textContent, /Rule two/)
    await click(section.querySelector('.wf-pipeline-config-head'))
    const roleField = () => [...section.querySelectorAll('.wf-pipeline-config-field')].find(item => item.querySelector('span').textContent === '角色').querySelector('input')
    await type(roleField(), '资深澄清员')
    await click(findButton(document, '保存'))
    assert.match(document.querySelector('[role=alert]').textContent, /无法保存流水线配置/)
    assert.equal(roleField().value, '资深澄清员')
    await click(findButton(document, '保存'))
    assert.equal(document.querySelector('[role=alert]'), null)
    assert.match(document.querySelector('[aria-label="流水线配置"]').textContent, /资深澄清员/)
  })
})

test('tenant run rows and details label blocked pipeline runs', async t => {
  const row = { ...runs[1], status: 'blocked', resultSummary: '1/4 stages · outline-gen blocked: judge rejected outline' }
  const nodes = [
    { id: 'outline-gen', stage: 'outline', kind: 'generate', actor: { role: 'outline-author', skill: 'outline-design', workspace: 'outline' }, judge: { role: 'judge-outline', rule: 'Rule' },
      status: 'blocked', attempts: 1, checks: [{ node: 'outline-gen', passed: false, issues: ['S1 has no expected result'], actorRole: 'outline-author', judgeRole: 'judge-outline', skill: 'outline-design', judgeSkill: 'outline-review' }],
      blockedReason: 'Outline review rejected scenario S1', output: { passed: false, issues: [] }, artifactNames: [] },
    { id: 'case-review', stage: 'testcases', kind: 'review', actor: { role: 'case-reviewer', skill: 'case-review', workspace: 'cases' }, judge: { role: 'judge-case-review', rule: 'Rule' },
      status: 'pending', attempts: 0, checks: [], blockedReason: null, output: {}, artifactNames: [] },
  ]
  await panel(t, async input => input.action === 'list' ? success([row])
    : success({ snapshot: { ...details(row.runId).snapshot, status: 'blocked', resultSummary: row.resultSummary, pipeline: { version: 2, nodes } }, events: [] }),
  async ({ document, click }) => {
    const runRow = document.querySelector('li button.wf-panel-row')
    assert.equal(runRow.querySelector('.wf-chip').textContent, '已阻塞')
    assert.match(runRow.textContent, /judge rejected outline/)
    await click(runRow)
    assert.match(document.querySelector('.wf-panel-toolbar').textContent, /已阻塞/)
    assert.equal([...document.querySelectorAll('.wf-panel-toolbar button')].some(button => button.textContent === '重试'), false)
    const section = document.querySelector('[aria-label="流水线进度"]')
    assert.match(section.textContent, /阻塞原因: Outline review rejected scenario S1/)
    assert.match(section.textContent, /评审结论: 不通过/)
    assert.match(section.textContent, /S1 has no expected result/)
    await click(section.querySelector('.wf-pipeline-node-head'))
    assert.match(section.textContent, /核验记录/)
  })
})
