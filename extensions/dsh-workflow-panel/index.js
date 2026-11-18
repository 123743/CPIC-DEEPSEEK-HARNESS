/** Dashboard Host plugin for community workflow inspection, CPIC checkpoint retries and pipeline configuration. */
import { readFile, readdir, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { z } from 'zod'

/** Stable Cordis plugin name. */
export const name = 'dsh-workflow-panel'

/** Services required before providing the panel route. */
export const inject = ['connection']

/** Run store location plus read bounds for list and event responses. */
export const Config = z.object({
  rootDirectory: z.string().min(1),
  maxEvents: z.number().int().positive().default(500),
  maxRuns: z.number().int().positive().default(200),
}).strict()

/** Run directory names accepted from the route; separators and traversal are rejected. */
const RUN_ID = /^[a-zA-Z0-9._-]+$/u
/** Largest artifact file the panel reads in one request. */
const MAX_ARTIFACT_BYTES = 1024 * 1024
/** Pipeline node roles accepted from a run or configuration snapshot. */
const PIPELINE_NODE_KINDS = ['generate', 'review']
/** Pipeline node execution states accepted from a run snapshot. */
const PIPELINE_NODE_STATUSES = ['completed', 'running', 'blocked', 'pending', 'uncertain']

const isPlainRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)

/**
 * Reads a complete pipeline definition snapshot from one run snapshot.
 * A missing or incomplete record returns undefined so the detail falls back to the legacy stage display.
 * @param snapshot - Run snapshot as stored or returned by the CPIC service.
 * @returns {object | undefined} The pipeline record when every displayed field is present and well-typed.
 */
const readPipeline = (snapshot) => {
  const pipeline = isPlainRecord(snapshot) ? snapshot.pipeline : undefined
  if (!isPlainRecord(pipeline) || pipeline.version !== 2 || !Array.isArray(pipeline.nodes) || pipeline.nodes.length === 0) return undefined
  for (const node of pipeline.nodes) {
    if (!isPlainRecord(node) || typeof node.id !== 'string' || typeof node.stage !== 'string'
      || !PIPELINE_NODE_KINDS.includes(node.kind) || !isPlainRecord(node.actor) || !isPlainRecord(node.judge)
      || !PIPELINE_NODE_STATUSES.includes(node.status) || !Number.isSafeInteger(node.attempts) || node.attempts < 0
      || !Array.isArray(node.checks) || !Array.isArray(node.artifactNames) || !node.artifactNames.every(name => typeof name === 'string')) return undefined
    for (const check of node.checks) {
      if (!isPlainRecord(check) || typeof check.passed !== 'boolean' || !Array.isArray(check.issues)) return undefined
    }
  }
  return pipeline
}

/**
 * Keeps the pipeline on a detail only when it is complete; incomplete records drop it so the
 * client renders the legacy stage display, and legacy details keep their exact recorded shape.
 * @param detail - Panel detail with a snapshot, and optionally events and manifest.
 * @returns The same detail, or a copy whose snapshot carries no incomplete pipeline.
 */
const withPipelineDetail = (detail) => {
  const snapshot = isPlainRecord(detail) ? detail.snapshot : undefined
  if (!isPlainRecord(snapshot) || !Object.hasOwn(snapshot, 'pipeline') || readPipeline(snapshot) !== undefined) return detail
  const legacy = { ...snapshot }
  delete legacy.pipeline
  return { ...detail, snapshot: legacy }
}

/** Structured panel failure mapped to the route error envelope. */
class PanelError extends Error {
  /**
   * @param code - Stable machine-readable failure category.
   * @param message - Operator-facing report of the rejected request or unreadable store.
   * @param cause - Optional underlying CPIC failure retained for diagnostics.
   */
  constructor(code, message, cause) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'PanelError'
    this.code = code
  }
}

/**
 * Maps a structured CPIC failure onto the panel error envelope, preserving its code and message.
 * @param error - Failure thrown by a CPIC service call.
 * @returns {Error} A PanelError for structured failures, otherwise the original error.
 */
const toPanelError = (error) => {
  if (error instanceof PanelError) return error
  if (error !== null && typeof error === 'object'
    && typeof error.code === 'string' && typeof error.message === 'string') {
    return new PanelError(error.code, error.message, error)
  }
  return error
}

const requestSchema = z.object({
  action: z.enum(['list', 'detail', 'artifact', 'retry', 'traceability', 'getPipelineConfig', 'updatePipelineConfig']),
  runId: z.string().optional(),
  name: z.string().min(1).optional(),
  nodes: z.array(z.any()).optional(),
}).strict()

/** Register run inspection and CPIC checkpoint retry on the shared-channel route. */
export async function apply(ctx, input) {
  const config = Config.parse(input)
  const directRoot = resolve(config.rootDirectory, '.dsh', 'workflow-runs')
  // Sessions run with cwd inside a project partition below the workspace root, so the
  // community plugin writes <partition>/.dsh/workflow-runs; the direct root stays first.
  const runRoots = async () => {
    const roots = [{ path: directRoot, workspacePath: config.rootDirectory }]
    let entries
    try {
      entries = await readdir(config.rootDirectory, { withFileTypes: true })
    } catch (error) {
      if (error.code === 'ENOENT') return roots
      throw error
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const workspacePath = join(config.rootDirectory, entry.name)
        roots.push({ path: join(workspacePath, '.dsh', 'workflow-runs'), workspacePath })
      }
    }
    return roots
  }
  const workspaceMetadata = (workspacePath, workspaceRegistry) => {
    const normalized = value => process.platform === 'win32' ? resolve(value).toLocaleLowerCase('en-US') : resolve(value)
    const workspace = workspaceRegistry?.list().find(item => normalized(item.path) === normalized(workspacePath))
    return workspace ? { workspaceId: workspace.id, workspaceName: workspace.title } : {}
  }
  const checkRunId = (runId) => {
    if (runId === undefined || !RUN_ID.test(runId) || runId === '.' || runId === '..') {
      throw new PanelError('INVALID_INPUT', 'runId must name one run directory: letters, digits, dot, underscore or hyphen only')
    }
    return runId
  }
  const runDirectory = async (runId) => {
    for (const root of await runRoots()) {
      const dir = join(root.path, runId)
      try {
        if ((await stat(dir)).isDirectory()) return { dir, workspacePath: root.workspacePath }
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
    }
    throw new PanelError('NOT_FOUND', `run ${JSON.stringify(runId)} is not present in any workflow run store below ${JSON.stringify(config.rootDirectory)}`)
  }
  const requireRunId = (runId) => {
    if (runId === undefined) throw new PanelError('INVALID_INPUT', 'this action requires the runId of one stored run')
    return runId
  }
  const requireName = (name) => {
    if (name === undefined) throw new PanelError('INVALID_INPUT', 'the artifact action requires the artifact name')
    return name
  }
  const readJson = (path) => readFile(path, 'utf8').then(JSON.parse)
  const readSnapshot = async (dir, runId) => {
    try {
      return await readJson(join(dir, 'run.json'))
    } catch (error) {
      if (error.code === 'ENOENT' || error instanceof SyntaxError) {
        throw new PanelError('NOT_FOUND', `run ${JSON.stringify(runId)} has no readable run.json; the run may still be starting or its store may be corrupt`)
      }
      throw error
    }
  }
  const summarize = (runId, snapshot, workspace = {}) => ({
    runId,
    workflow: snapshot.workflow,
    displayName: snapshot.displayName,
    source: snapshot.source,
    workspaceId: snapshot.workspaceId ?? workspace.workspaceId,
    workspaceName: snapshot.workspaceName ?? workspace.workspaceName,
    sessionId: snapshot.sessionId,
    execution: snapshot.execution,
    status: snapshot.status,
    startedAt: snapshot.startedAt,
    endedAt: snapshot.endedAt,
    phase: snapshot.phase,
    totalSpawned: snapshot.totalSpawned,
    activeAgents: snapshot.activeAgents,
    resultSummary: snapshot.resultSummary,
    error: snapshot.error,
    artifactCount: snapshot.artifacts?.length ?? 0,
    ...(snapshot.cost === undefined ? {} : { cost: snapshot.cost }),
    ...(snapshot.process?.counts === undefined ? {} : { counts: snapshot.process.counts }),
    ...(snapshot.process?.progress === undefined ? {} : { progress: snapshot.process.progress }),
  })
  // A line that is not valid JSON is skipped so the remaining events still render.
  const parseJson = (text) => {
    try { return JSON.parse(text) } catch { return undefined }
  }
  const readEvents = async (dir) => {
    let text
    try { text = await readFile(join(dir, 'events.jsonl'), 'utf8') } catch (error) {
      if (error.code === 'ENOENT') return []
      throw error
    }
    return text.split(/\r?\n/u).filter(line => line.trim() !== '').map(parseJson).filter(event => event !== undefined)
  }
  // A terminal event can be committed before the final snapshot write.
  const reconcileSnapshot = (snapshot, events) => {
    if (!['running', 'paused', 'starting', 'canceling'].includes(snapshot.status)) return snapshot
    const statuses = { 'workflow-stopped': 'stopped', 'workflow-failed': 'failed', 'workflow-completed': 'completed' }
    const terminal = events.findLast(event => Object.hasOwn(statuses, event?.type))
    if (!terminal) return snapshot
    return { ...snapshot, status: statuses[terminal.type], activeAgents: 0 }
  }
  const findEngine = (dynamicWorkflows, workspacePath) => {
    if (dynamicWorkflows === undefined || !(dynamicWorkflows.engines instanceof Map)) return undefined
    const normalize = value => process.platform === 'win32' ? resolve(value).toLocaleLowerCase('en-US') : resolve(value)
    const target = normalize(workspacePath)
    return [...dynamicWorkflows.engines.entries()].find(([path]) => normalize(path) === target)?.[1]
  }
  // A live engine is authoritative; an unavailable owner or unreadable runtime state stays explicit.
  const processStartedAt = Date.now() - process.uptime() * 1000
  const predatesProcess = snapshot => {
    const startedAt = typeof snapshot.startedAt === 'number' ? snapshot.startedAt : Date.parse(snapshot.startedAt)
    return Number.isFinite(startedAt) && startedAt <= processStartedAt
  }
  const interrupted = snapshot => ({ ...snapshot, status: 'interrupted', activeAgents: 0 })
  const reconcileRuntime = (snapshot, dynamicWorkflows, workspacePath) => {
    if (!['running', 'paused', 'starting', 'canceling'].includes(snapshot.status)) return snapshot
    if (dynamicWorkflows === undefined) return { ...snapshot, status: 'uncertain' }
    if (!(dynamicWorkflows.engines instanceof Map)) return { ...snapshot, status: 'uncertain' }
    const engine = findEngine(dynamicWorkflows, workspacePath)
    if (engine === undefined) return predatesProcess(snapshot) ? interrupted(snapshot) : { ...snapshot, status: 'uncertain' }
    try {
      const current = engine.get(snapshot.runId)
      if (current && engine.isActive(snapshot.runId)) return { ...snapshot, ...current }
      if (current && ['completed', 'failed', 'denied', 'stopped'].includes(current.status)) return { ...snapshot, ...current, activeAgents: 0 }
      return predatesProcess(snapshot) ? interrupted(snapshot) : { ...snapshot, status: 'uncertain' }
    } catch {
      return { ...snapshot, status: 'uncertain' }
    }
  }
  const reconcile = (snapshot, events, dynamicWorkflows, workspacePath) =>
    reconcileRuntime(reconcileSnapshot(snapshot, events), dynamicWorkflows, workspacePath)
  const listRuns = async (cpicRequirements, workspaceRegistry, dynamicWorkflows) => {
    const runs = []
    const seen = new Set()
    for (const root of await runRoots()) {
      let entries
      try {
        entries = await readdir(root.path, { withFileTypes: true })
      } catch (error) {
        if (error.code === 'ENOENT') continue
        throw error
      }
      for (const entry of entries) {
        if (!entry.isDirectory() || seen.has(entry.name)) continue
        let snapshot
        // A directory without a parseable run.json is skipped, never fatal to the list.
        try { snapshot = await readJson(join(root.path, entry.name, 'run.json')) } catch { continue }
        const events = await readEvents(join(root.path, entry.name))
        snapshot = reconcile(snapshot, events, dynamicWorkflows, root.workspacePath)
        seen.add(entry.name)
        runs.push(summarize(entry.name, snapshot, workspaceMetadata(root.workspacePath, workspaceRegistry)))
      }
    }
    if (cpicRequirements?.listPanelRuns) {
      for (const run of cpicRequirements.listPanelRuns()) {
        if (seen.has(run.runId)) continue
        seen.add(run.runId)
        const workspace = run.workspaceId ? workspaceRegistry?.get(run.workspaceId) : undefined
        runs.push({ ...run, workspaceName: run.workspaceName ?? workspace?.title })
      }
    }
    const timestamp = value => typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : Number.NaN
    runs.sort((left, right) => {
      const leftTime = timestamp(left.startedAt)
      const rightTime = timestamp(right.startedAt)
      if (!Number.isFinite(leftTime)) return Number.isFinite(rightTime) ? 1 : 0
      if (!Number.isFinite(rightTime)) return -1
      return rightTime - leftTime
    })
    const visible = runs.slice(0, config.maxRuns)
    const sessionQuery = ctx.get('sessionQuery')
    if (!sessionQuery) return visible
    const ids = [...new Set(visible.map(run => run.sessionId).filter(Boolean))]
    if (ids.length === 0) return visible
    const names = new Map()
    for (const result of await sessionQuery.readTitleSnapshots(ids)) {
      if (result.status === 'rejected') {
        ctx.logger.warn('dsh-workflow-panel: session title unavailable', result.sessionId, result.reason)
        continue
      }
      const title = result.value.title?.title
      if (typeof title === 'string' && title.trim()) names.set(result.sessionId, title)
    }
    return visible.map(run => ({ ...run, sessionName: names.get(run.sessionId) }))
  }
  const detailRun = async (runId, cpicRequirements, dynamicWorkflows) => {
    if (runId.startsWith('case-design-')) {
      const detail = await cpicRequirements?.getPanelRun?.(runId)
      if (detail) return withPipelineDetail(detail)
      throw new PanelError('NOT_FOUND', `case-design run ${JSON.stringify(runId)} is not available`)
    }
    const location = await runDirectory(checkRunId(runId))
    const recordedSnapshot = await readSnapshot(location.dir, runId)
    const events = await readEvents(location.dir)
    const snapshot = reconcile(recordedSnapshot, events, dynamicWorkflows, location.workspacePath)
    // The manifest is optional panel metadata; absence or corruption stays non-fatal.
    let manifest
    try { manifest = await readJson(join(location.dir, 'manifest.json')) } catch { manifest = undefined }
    return withPipelineDetail({ snapshot, events: events.slice(-config.maxEvents), manifest })
  }
  const retryRun = async (runId, cpicRequirements, signal) => {
    if (!runId.startsWith('case-design-')) throw new PanelError('RETRY_NOT_ALLOWED', 'Only recoverable case-design runs can be retried')
    try {
      const detail = await cpicRequirements?.retryPanelRun?.(runId, signal)
      if (!detail) throw new PanelError('RETRY_NOT_ALLOWED', 'This case-design run cannot be retried')
      return detail
    } catch (error) {
      throw toPanelError(error)
    }
  }
  const pipelineConfigUnavailable = () => new PanelError('PIPELINE_CONFIG_NOT_AVAILABLE', 'The mounted CPIC requirements service does not expose pipeline configuration')
  const getPipelineConfig = async (cpicRequirements) => {
    if (typeof cpicRequirements?.getPipelineConfig !== 'function') throw pipelineConfigUnavailable()
    try { return await cpicRequirements.getPipelineConfig() } catch (error) { throw toPanelError(error) }
  }
  const updatePipelineConfig = async (cpicRequirements, nodes) => {
    if (typeof cpicRequirements?.updatePipelineConfig !== 'function') throw pipelineConfigUnavailable()
    if (nodes === undefined) throw new PanelError('INVALID_INPUT', 'the updatePipelineConfig action requires the pipeline nodes')
    try { return await cpicRequirements.updatePipelineConfig({ nodes }) } catch (error) { throw toPanelError(error) }
  }
  const readArtifact = async (runId, name, cpicRequirements) => {
    if (runId.startsWith('case-design-')) {
      const artifact = await cpicRequirements?.getPanelArtifact?.(runId, name)
      if (!artifact || typeof artifact.text !== 'string') throw new PanelError('NOT_FOUND', 'case-design artifact not found')
      if (Buffer.byteLength(artifact.text) > MAX_ARTIFACT_BYTES) throw new PanelError('FILE_TOO_LARGE', `artifact ${JSON.stringify(name)} exceeds the ${String(MAX_ARTIFACT_BYTES)}-byte read limit`)
      try { return { name, content: JSON.parse(artifact.text) } }
      catch { throw new PanelError('INVALID_ARTIFACT', `case-design artifact ${JSON.stringify(name)} is not valid JSON`) }
    }
    const { dir } = await runDirectory(checkRunId(runId))
    const snapshot = await readSnapshot(dir, runId)
    const entry = snapshot.artifacts?.find(item => item?.name === name)
    if (entry === undefined || typeof entry.path !== 'string') throw new PanelError('NOT_FOUND', 'artifact not found')
    const target = resolve(dir, entry.path)
    const containment = relative(dir, target)
    if (containment === '' || containment.startsWith('..') || isAbsolute(containment)) throw new PanelError('NOT_FOUND', 'artifact path resolves outside its run directory')
    let size
    try { size = (await stat(target)).size } catch (error) {
      if (error.code === 'ENOENT') throw new PanelError('NOT_FOUND', 'artifact not found')
      throw error
    }
    if (size > MAX_ARTIFACT_BYTES) throw new PanelError('FILE_TOO_LARGE', `artifact ${JSON.stringify(name)} exceeds the ${String(MAX_ARTIFACT_BYTES)}-byte read limit; inspect the run directory directly`)
    return { name, content: JSON.parse(await readFile(target, 'utf8')) }
  }
  const operate = async (raw, signal) => {
    const parsed = requestSchema.safeParse(raw)
    if (!parsed.success) {
      throw new PanelError('INVALID_INPUT', parsed.error.issues.map(issue => `${issue.path.join('.') || 'body'}: ${issue.message}`).join('; '))
    }
    // Optional services may be mounted after this route becomes available.
    const cpicRequirements = ctx.get('cpicRequirements')
    const workspaceRegistry = ctx.get('workspaceRegistry')
    const dynamicWorkflows = ctx.get('dynamicWorkflows')
    switch (parsed.data.action) {
      case 'list': return listRuns(cpicRequirements, workspaceRegistry, dynamicWorkflows)
      case 'detail': return detailRun(requireRunId(parsed.data.runId), cpicRequirements, dynamicWorkflows)
      case 'retry': return retryRun(checkRunId(requireRunId(parsed.data.runId)), cpicRequirements, signal)
      case 'traceability': {
        const runId = checkRunId(requireRunId(parsed.data.runId))
        if (!runId.startsWith('case-design-') || !cpicRequirements?.analyzePanelTraceability) {
          throw new PanelError('TRACEABILITY_NOT_AVAILABLE', 'Traceability is available only for case-design runs')
        }
        try {
          return await cpicRequirements.analyzePanelTraceability(runId, signal)
        } catch (error) {
          throw toPanelError(error)
        }
      }
      case 'getPipelineConfig': return getPipelineConfig(cpicRequirements)
      case 'updatePipelineConfig': return updatePipelineConfig(cpicRequirements, parsed.data.nodes)
      case 'artifact': return readArtifact(requireRunId(parsed.data.runId), requireName(parsed.data.name), cpicRequirements)
    }
  }
  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/dsh-workflow-panel',
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      try {
        const value = await operate(JSON.parse(await request.text()), request.signal)
        return Response.json({ ok: true, value }, { headers: { 'cache-control': 'no-store' } })
      } catch (error) {
        ctx.logger.warn('dsh-workflow-panel: operation failed', error)
        const known = error instanceof PanelError
        return Response.json({ ok: false, error: { code: known ? error.code : 'OPERATION_FAILED', message: known ? error.message : 'Operation failed; retry after checking the workflow run directory and its permissions' } }, { status: 400, headers: { 'cache-control': 'no-store' } })
      }
    },
  }), 'dsh-workflow-panel: route')
}
