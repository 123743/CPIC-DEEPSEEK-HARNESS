/** Requirement identity, immutable snapshots, and recoverable Session preparation. */
import { createHash, randomUUID } from 'node:crypto'
import { isAbsolute, join } from 'node:path'
import { AnalysisEngine } from './engine.js'
import { initialExecutionEvents, withExecutionEvents, engineExecutionEvents, completeLegacyExecutionEvents } from './execution-events.js'

export class WorkbenchError extends Error {
  constructor(code, message, options) { super(message, options); this.name = 'WorkbenchError'; this.code = code }
}
export const digest = value => createHash('sha256').update(value).digest('hex')
export const requirementKey = reference => digest(JSON.stringify([reference.source, reference.system, reference.id]))
const workspaceDirectory = (root, requirementId) => join(root, `requirement-${digest(requirementId)}`)
const clone = value => structuredClone(value)
const isRetiredSource = source => source.trim().toLocaleLowerCase() === 'ta4cpic'

/** Owns a single Host's serialized mutations; domain writes are durable before publication. */
export class RequirementWorkbench {
  constructor({ tables, files, workspaces, sessions, config, currentPipeline }) {
    this.tables = tables
    this.files = files
    this.workspaces = workspaces
    this.sessions = sessions
    this.config = config
    // Absent pipeline resolution keeps legacy runs for callers that predate pipeline definitions.
    this.currentPipeline = currentPipeline ?? (() => undefined)
    this.tail = Promise.resolve()
    this.runUpdates = new Map()
    this.engine = new AnalysisEngine({
      maxAttempts: config.maxAttempts,
      store: {
        readRun: async id => clone(this.tables.runs.get(id)?.engine),
        writeRun: async (id, engine) => {
          await this.updateRun(id, record => ({ ...record, engine: clone(engine) }), record => engineExecutionEvents(record.engine, engine))
        },
        writeArtifact: async (id, name, text) => {
          const path = this.artifactPath(id, name)
          await this.files.immutable(path, text, this.tables.runs.get(id).workspacePath)
          return path
        },
        readArtifact: async (id, name) => this.files.read(this.artifactPath(id, name)),
      },
    })
  }
  async importRequirement(input) {
    if (isRetiredSource(input.source)) throw new WorkbenchError('SOURCE_RETIRED', 'The ta4cpic requirement source is retired')
    const markdown = input.markdown.replace(/\r\n?/g, '\n')
    if (!markdown.trim()) throw new WorkbenchError('EMPTY_REQUIREMENT', 'Requirement text cannot be empty')
    if (Buffer.byteLength(markdown) > this.config.maxInputBytes) throw new WorkbenchError('INPUT_TOO_LARGE', 'Requirement text exceeds the configured byte limit')
    const id = `local:${requirementKey(input)}`
    const record = { ...clone(input), markdown, hash: digest(markdown), updatedAt: new Date().toISOString() }
    await this.tables.requirements.put(id, record)
    return { ...clone(record), externalId: record.id, id }
  }
  async purgeRetiredRequirements() {
    const ids = [...this.tables.requirements.entries()].filter(([, record]) => isRetiredSource(record.source)).map(([id]) => id)
    return ids.length ? this.tables.requirements.deleteMany(ids) : 0
  }
  list(query = '') {
    const needle = query.trim().toLocaleLowerCase()
    return [...this.tables.requirements.entries()].filter(([, record]) => !isRetiredSource(record.source)).map(([id, record]) => ({
      id, externalId: record.id, source: record.source, system: record.system,
      systemName: record.p_name ?? record.systemName ?? record.system, title: record.title, version: record.version, updatedAt: record.updatedAt ?? '',
    })).filter(record => !needle || [record.externalId, record.source, record.systemName, record.title, record.version]
      .some(value => value.toLocaleLowerCase().includes(needle)))
  }
  detail(id) {
    const record = this.tables.requirements.get(id)
    if (!record) throw new WorkbenchError('REQUIREMENT_NOT_FOUND', 'Requirement does not exist')
    return { ...clone(record), systemName: record.p_name ?? record.systemName ?? record.system, externalId: record.id, id }
  }
  async updateRequirement(id, markdown, expectedHash) {
    const record = this.tables.requirements.get(id)
    if (!record) throw new WorkbenchError('REQUIREMENT_NOT_FOUND', 'Requirement does not exist')
    if (record.hash !== expectedHash) throw new WorkbenchError('SOURCE_CONFLICT', 'Refresh the requirement before saving')
    if (Buffer.byteLength(markdown) > this.config.maxInputBytes) throw new WorkbenchError('INPUT_TOO_LARGE', 'Requirement text exceeds the configured byte limit')
    const updated = { ...record, markdown, hash: digest(markdown), updatedAt: new Date().toISOString() }
    await this.tables.requirements.put(id, updated)
    return { ...clone(updated), systemName: updated.p_name ?? updated.systemName ?? updated.system, externalId: updated.id, id }
  }
  artifactPath(id, name) {
    if (!/^[a-zA-Z0-9_.-]+$/.test(name) || name.includes('..')) throw new WorkbenchError('ARTIFACT_NAME', 'Invalid artifact name')
    const run = this.tables.runs.get(id)
    if (!run) throw new WorkbenchError('RUN_NOT_FOUND', 'Analysis run does not exist')
    return join(run.workspacePath, 'analyses', id, name)
  }
  enqueue(operation) {
    const task = this.tail.then(operation)
    this.tail = task.then(() => {}, () => {})
    return task
  }
  /** Commit one run mutation with its event history in the same domain write. */
  updateRun(id, update, events = () => []) {
    const previous = this.runUpdates.get(id) ?? Promise.resolve()
    const current = previous.then(async () => {
      const record = this.tables.runs.get(id)
      if (!record) throw new WorkbenchError('RUN_NOT_FOUND', 'Analysis run does not exist')
      const name = record.requirement?.title ?? 'Case design'
      const latest = { ...record, events: completeLegacyExecutionEvents(record, name) }
      const next = withExecutionEvents(update(latest), events(latest))
      await this.tables.runs.put(id, next)
      return clone(next)
    })
    const settled = current.then(() => undefined, () => undefined)
    this.runUpdates.set(id, settled)
    void settled.then(() => { if (this.runUpdates.get(id) === settled) this.runUpdates.delete(id) })
    return current
  }
  /** Repeated request ids retain the same snapshot and Session, including after interruption. */
  prepare({ id, requestId, requirement }) {
    return this.enqueue(async () => {
      let request = this.tables.requests.get(requestId)
      if (request && request.requirementId !== id) throw new WorkbenchError('REQUEST_CONFLICT', 'Request id belongs to another requirement')
      if (!request) {
        const input = requirement ?? this.detail(id)
        request = { requirementId: id, sessionId: randomUUID(), runId: randomUUID(), requirementRef: id, requirement: clone(input), prepared: false }
        await this.tables.requests.put(requestId, request)
      }
      if (request.prepared) return this.preparedValue(request)
      const input = request.requirement ?? requirement ?? this.detail(id)
      if (!isAbsolute(this.config.rootDirectory)) throw new WorkbenchError('ROOT_REQUIRED', 'Configure an absolute workspace root')
      const root = await this.files.stat(this.config.rootDirectory)
      if (!root || root.type !== 'directory') throw new WorkbenchError('ROOT_REQUIRED', 'Workspace root must be an existing accessible directory')
      const path = workspaceDirectory(this.config.rootDirectory, id)
      let link = this.tables.links.get(id)
      if (link && link.path !== path) throw new WorkbenchError('ROOT_CHANGED', 'Workspace root changed; repair the saved association before retrying')
      const marker = join(path, '.cpic-requirement.json')
      const markerText = JSON.stringify({ format: 1, requirementId: id }) + '\n'
      const info = await this.files.stat(path)
      if (info) {
        if (info.type !== 'directory') throw new WorkbenchError('DIRECTORY_CONFLICT', 'Requirement workspace path is not a directory')
        let identity
        try { identity = await this.files.read(marker) }
        catch (cause) { throw new WorkbenchError('DIRECTORY_CONFLICT', 'Workspace identity cannot be read; restore its marker before retrying', { cause }) }
        if (identity !== markerText) throw new WorkbenchError('DIRECTORY_CONFLICT', 'Workspace identity does not match the requirement')
      } else {
        if (link) throw new WorkbenchError('WORKSPACE_MISSING', 'Linked workspace directory is missing; restore it before retrying')
        await this.files.immutable(marker, markerText, this.config.rootDirectory)
      }
      const workspace = await this.workspaces.create(path, `${input.title} - ${input.externalId ?? input.id}`)
      if (link && link.workspaceId !== workspace.id) throw new WorkbenchError('WORKSPACE_REGISTRATION_CHANGED', 'Workspace registration was removed; confirm and repair its association before retrying')
      link = { workspaceId: workspace.id, path }
      await this.tables.links.put(id, link)
      const hash = digest(input.markdown)
      const snapshotId = digest(JSON.stringify([input.version, hash]))
      const snapshotPath = join(path, 'requirements', snapshotId, 'requirement.md')
      await this.files.immutable(snapshotPath, input.markdown, this.config.rootDirectory)
      const created = await this.sessions.create({ sessionId: request.sessionId, workspaceId: workspace.id, agentPreset: 'case-design' })
      if (created.sessionId !== request.sessionId) throw new WorkbenchError('SESSION_IDENTITY', 'Session creation returned an unexpected identity')
      const snapshot = { path: snapshotPath, version: input.version, hash, id: snapshotId, origin: input.source === 'xtest' ? 'body-derived' : 'manual-text' }
      const metadata = { source: input.source, system: input.system, id: input.id, title: input.title, version: input.version }
      if (!this.tables.runs.get(request.runId)) {
        await this.tables.runs.put(request.runId, { id: request.runId, sessionId: request.sessionId, requirementId: id, requirement: metadata, workspaceId: workspace.id, workspacePath: path, snapshot, engine: null, execution: 'pending', createdAt: new Date().toISOString(), events: initialExecutionEvents(input.title, new Date().toISOString()) })
      }
      const record = this.tables.runs.get(request.runId)
      if (!record.engine) await this.engine.start({ id: request.runId, snapshotMarkdown: input.markdown, pipeline: this.currentPipeline() })
      await this.sessions.rename({ sessionId: request.sessionId, title: `${input.title} - ${input.externalId ?? input.id}` })
      request = { ...request, prepared: true, workspaceId: workspace.id, snapshotPath }
      await this.tables.requests.put(requestId, request)
      return this.preparedValue(request)
    })
  }
  preparedValue(request) {
    return { sessionId: request.sessionId, workspaceId: request.workspaceId, snapshotPath: request.snapshotPath, runId: request.runId,
      prompt: '请根据本会话绑定的需求快照进行案例设计。先调用 case_design 的 status 操作读取固定输入和当前阶段，按阶段提交并独立评审，最终生成可追溯的结构化用例和 Markdown。' }
  }
  runForSession(sessionId) { return [...this.tables.runs.entries()].map(([, value]) => value).find(value => value.sessionId === sessionId) }
  viewRun(sessionId) {
    const record = this.runForSession(sessionId)
    if (!record) return null
    const { engine, ...meta } = record
    const terminal = ['completed', 'completed_with_issues', 'cancelled', 'result_unverified'].includes(engine?.status)
    const executionVisible = ['pending', 'starting', 'failed', 'uncertain', 'canceling', 'cancelled', 'waiting_input'].includes(record.execution)
    return { ...meta, ...clone(engine), id: record.id, status: terminal ? engine.status : executionVisible ? record.execution : engine?.status ?? record.execution }
  }
  async recover() {
    for (const [id, record] of this.tables.runs.entries()) {
      if (['running', 'starting', 'canceling'].includes(record.execution)) await this.tables.runs.put(id, { ...record, execution: 'uncertain' })
    }
  }
  async start(sessionId) {
    return this.enqueue(async () => {
      const record = this.runForSession(sessionId)
      if (!record) throw new WorkbenchError('RUN_NOT_FOUND', 'Prepare an analysis session first')
      if (['completed', 'completed_with_issues', 'cancelled', 'result_unverified'].includes(record.engine?.status)) return this.viewRun(sessionId)
      if (record.execution === 'running') return this.viewRun(sessionId)
      if (record.execution === 'starting' || record.execution === 'uncertain') throw new WorkbenchError('OUTCOME_UNCERTAIN', 'Input delivery is unverified; inspect the Session before continuing manually')
      const markdown = await this.files.read(record.snapshot.path)
      if (digest(markdown) !== record.snapshot.hash) throw new WorkbenchError('SNAPSHOT_CHANGED', 'Requirement snapshot changed; restore the original input')
      await this.tables.runs.put(record.id, { ...record, execution: 'starting' })
      try {
        await this.sessions.prompt({ sessionId, requestId: `cpic-${record.id}`, mode: 'queue', content: [{ type: 'text', text: this.preparedValue({}).prompt }] }, new AbortController().signal)
      } catch (error) {
        await this.tables.runs.put(record.id, { ...this.tables.runs.get(record.id), execution: 'uncertain' })
        throw new WorkbenchError('OUTCOME_UNCERTAIN', 'Input delivery is unverified; inspect the Session before continuing manually', { cause: error })
      }
      await this.tables.runs.put(record.id, { ...this.tables.runs.get(record.id), execution: 'running' })
      return this.viewRun(sessionId)
    })
  }
  async cancel(sessionId) {
    const record = this.runForSession(sessionId)
    if (!record) throw new WorkbenchError('RUN_NOT_FOUND', 'Analysis run does not exist')
    await this.tables.runs.put(record.id, { ...record, execution: 'canceling' })
    await this.sessions.cancel({ sessionId })
    return this.viewRun(sessionId)
  }
}
