import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { applyCompatibility } from './apply.mjs'
import { createWorkflowSubagents } from './activation.js'

const installed = resolve(process.argv[2])
const fixture = await mkdtemp(join(installed, '.compat-test-'))
try {
  await cp(join(installed, 'lib'), join(fixture, 'lib'), { recursive: true })
  await writeFile(join(fixture, 'package.json'), await readFile(join(installed, 'package.json')))
  await applyCompatibility(fixture)
  assert.equal((await applyCompatibility(fixture)).patched.length, 0)
  const { DynamicWorkflowEngine, resolveReadOnlyToolFilter } = await import(pathToFileURL(join(fixture, 'lib', 'engine.js')))
  const { WorkflowRunStore } = await import(pathToFileURL(join(fixture, 'lib', 'store.js')))
  const tools = {
    get: name => name === 'read' ? { name } : undefined,
    schemas() { throw new Error('unrelated requirements parameters must be lossless JSON') },
  }
  const parent = { id: 'parent', ctx: { tools }, session: { id: 'session-parent', header: { cwd: fixture }, append() {} } }
  const config = {
    maxAgents: 4, maxConcurrency: 2, maxResultChars: 50000, maxRetainedRuns: 100,
    readOnlyAllowedTools: ['read'], readOnlyToolFilter: { deny: [] }, defaultProvider: 'spawn',
    modelTiers: { fast: {}, balanced: {}, deep: {} }, approvalMode: 'never',
    scriptSyncTimeoutMs: 10000, scriptWallTimeoutMs: 30000,
    availableTools: [], availableMcp: [], availableSkills: [], pluginVersion: '0.1.2', dshVersion: 'local',
  }
  let sequence = 0
  function engine(subagents, taskParent = parent) {
    const store = new WorkflowRunStore(join(fixture, `runs-${++sequence}`))
    const instance = new DynamicWorkflowEngine({ config, subagents, store })
    return { instance, store, taskParent }
  }
  const descriptor = { capabilities: { toolFilter: true } }
  const input = run => ({ parent, module: { manifest: { name: 'concurrent-child-probe', phases: ['children'], readOnly: true, maxAgents: 2, maxConcurrency: 2 }, execution: 'trusted-local', run }, source: 'inline', requireApproval: false })

  await test('read-only policy queries allowed tools without serializing unrelated tool schemas', () => {
    assert.deepEqual(resolveReadOnlyToolFilter(parent, ['read', 'run_code', 'write']), { allow: ['read'] })
  })
  await test('two managed activations overlap and publish two children through the restricted script', async () => {
    let active = 0
    let peak = 0
    let disposed = 0
    const children = new Map()
    let release
    const barrier = new Promise(resolve => { release = resolve })
    const ctx = {
      subagents: {
        getProvider: () => descriptor,
        async startActivation(spec) {
          assert.equal(spec.delivery, 'caller')
          assert.equal(spec.request.parent, parent)
          assert.equal(spec.signal.aborted, false)
          assert.deepEqual(spec.request.toolFilter, { allow: ['read'] })
          active++
          peak = Math.max(peak, active)
          const childId = `child-${active}`
          children.set(childId, { session: { events: [] } })
          if (active === 2) release()
          return {
            childId,
            result: barrier.then(() => ({ stopReason: 'completed', output: [{ type: 'text', text: spec.request.prompt[0].text }] })),
            async dispose() { disposed++; active-- },
          }
        },
      },
      get: () => ({ withInitiator: (agent, fn) => fn(), get: id => children.get(id) }),
      logger: { error() { assert.fail('unexpected cancellation error') } },
    }
    const { instance, store } = engine(createWorkflowSubagents(ctx))
    const request = input()
    request.module.source = 'async function run(wf,args){return await wf.phase("children",async()=>await wf.parallel([async()=>await wf.runAgent({name:"A",prompt:"CHILD_A_OK",readOnly:true}),async()=>await wf.runAgent({name:"B",prompt:"CHILD_B_OK",readOnly:true})],{concurrency:2}))}'
    const snapshot = await (await instance.start(request)).done
    assert.equal(snapshot.status, 'completed', snapshot.error)
    assert.equal(snapshot.sessionId, parent.session.id)
    assert.equal(store.get(snapshot.runId).sessionId, parent.session.id)
    assert.equal(snapshot.totalSpawned, 2)
    assert.equal(snapshot.activeAgents, 0)
    assert.equal(snapshot.cost.peakConcurrency, 2)
    assert.equal(snapshot.process.progress.finishedAgents, 2)
    assert.equal(snapshot.process.graph.version, 1)
    assert.equal(snapshot.process.graph.nodes.find(node => node.kind === 'workflow').id, `workflow:${snapshot.runId}`)
    assert.equal(snapshot.process.graph.edges.filter(edge => edge.type === 'evidence-reference').length, 0)
    assert.equal(snapshot.process.graph.edges.filter(edge => edge.type === 'contains').length > 0, true)
    assert.deepEqual(snapshot.result.map(result => result.finalText), ['CHILD_A_OK', 'CHILD_B_OK'])
    assert.equal(peak, 2)
    assert.equal(disposed, 2)
    assert.equal(store.getEvents(snapshot.runId).filter(event => event.type === 'agent-started').length, 2)
  })
  await test('process graph records task evidence references and phase membership', async () => {
    let childSequence = 0
    const ctx = {
      subagents: {
        getProvider: () => descriptor,
        async startActivation() {
          const childId = `graph-child-${++childSequence}`
          return {
            childId,
            result: Promise.resolve({ stopReason: 'completed', output: [{ type: 'text', text: 'done' }] }),
            async dispose() {},
          }
        },
      },
      get: () => ({ withInitiator: (_agent, fn) => fn(), get: () => undefined }),
      logger: { error() { assert.fail('unexpected child cancellation error') } },
    }
    const { instance } = engine(createWorkflowSubagents(ctx))
    const request = input()
    request.module.source = 'async function run(wf,args){return await wf.phase("review",async()=>{const first=await wf.runAgent({name:"A",prompt:"A",readOnly:true});return await wf.runAgent({name:"B",prompt:"B",readOnly:true,evidenceRefs:[`task_id:${first.taskId}`]})})}'
    const snapshot = await (await instance.start(request)).done
    const graph = snapshot.process.graph
    const first = graph.nodes.find(node => node.title === 'A')
    const second = graph.nodes.find(node => node.title === 'B')
    assert.ok(first)
    assert.ok(second)
    const reviewPhase = graph.nodes.find(node => node.kind === 'phase' && node.title === 'review')
    assert.ok(reviewPhase)
    assert.ok(graph.edges.some(edge => edge.type === 'phase-membership' && edge.source === reviewPhase.id && edge.target === first.id))
    assert.ok(graph.edges.some(edge => edge.type === 'evidence-reference' && edge.source === first.id && edge.target === second.id))
  })
  await test('pre-task exceptions survive a script catch and cannot become completed with zero members', async () => {
    const broken = { ...parent, ctx: { tools: { get() { throw new Error('policy unavailable') } } } }
    const { instance, store } = engine({ getProvider: () => descriptor })
    const request = input(async wf => { try { await wf.runAgent({ name: 'A', prompt: 'x', readOnly: true }) } catch {} return { ok: false } })
    request.parent = broken
    const snapshot = await (await instance.start(request)).done
    assert.equal(snapshot.status, 'failed')
    assert.match(snapshot.error, /policy unavailable/)
    assert.equal(snapshot.totalSpawned, 0)
    assert.equal(snapshot.outcome.status, 'failed')
    assert.equal(store.getEvents(snapshot.runId).find(event => event.type === 'agent-start-failed').data.error, 'policy unavailable')
  })
  await test('child startup failure returned as null cannot become workflow success', async () => {
    const { instance } = engine({ getProvider: () => descriptor, async start() { throw new Error('child startup rejected') } })
    const snapshot = await (await instance.start(input(async wf => { try { return await wf.runAgent({ name: 'A', prompt: 'x' }) } catch { return null } })) ).done
    assert.equal(snapshot.status, 'failed')
    assert.match(snapshot.error, /child startup rejected/)
  })
  await test('an established child returning an error marks the workflow failed even when runAgent returns null', async () => {
    let disposals = 0
    const { instance } = engine({
      getProvider: () => descriptor,
      async start() {
        let disposed = false
        return { id: 'child', result: Promise.resolve({ stopReason: 'error', output: [] }), async dispose() { if (!disposed) { disposed = true; disposals++ } } }
      },
    })
    const snapshot = await (await instance.start(input(async wf => ({ child: await wf.runAgent({ name: 'A', prompt: 'x' }) })))).done
    assert.equal(snapshot.status, 'failed')
    assert.equal(snapshot.totalSpawned, 1)
    assert.equal(snapshot.process.progress.failedAgents, 1)
    assert.equal(snapshot.outcome.errors[0].name, 'A')
    assert.equal(disposals, 1)
  })
  await test('cancellation disposes the exact activation once', async () => {
    const controller = new AbortController()
    let disposals = 0
    const adapter = createWorkflowSubagents({
      subagents: { getProvider: () => descriptor, async startActivation() { return { childId: 'child', result: Promise.resolve({}), async dispose() { disposals++ } } } },
      get: () => ({ withInitiator: (agent, fn) => fn(), get() {} }), logger: { error() {} },
    })
    const run = await adapter.start('spawn', { label: 'A', parent, prompt: [], signal: controller.signal })
    controller.abort()
    await run.dispose()
    assert.equal(disposals, 1)
  })
} finally {
  assert.equal(resolve(fixture).startsWith(installed + '\\') || resolve(fixture).startsWith(installed + '/'), true)
  await rm(fixture, { recursive: true, force: true })
}
