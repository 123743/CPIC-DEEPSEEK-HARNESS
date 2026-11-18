import { createHash } from 'node:crypto'
import { z } from 'zod'
import { WorkbenchError } from './business.js'

const nonblank = z.string().min(1).refine(value => value.trim().length > 0)
const apiConfigSchema = z.object({
  apiUrl: nonblank,
  apiSecret: nonblank,
  userIdentity: nonblank,
  tenantId: nonblank,
  timeoutMs: z.number().int().positive().default(15000),
  maxBytes: z.number().int().positive().default(4194304),
  maxRows: z.number().int().positive().max(100000).default(1000),
}).strict()

const recordTypeSchema = z.enum(['qa_projects', 'qa_plans', 'qa_executions', 'qa_defects', 'qa_audits'])
const recordSchema = z.object({ key: nonblank, value: z.record(z.string(), z.unknown()), hash: nonblank }).strict()
const actionResultSchema = z.object({ result: z.boolean(), msg: z.string().optional(), content: z.unknown().optional() }).passthrough()
const failure = (code, message) => new WorkbenchError(code, message)

function normalizedUrl(value) {
  try {
    const url = new URL(value)
    const loopback = ['127.0.0.1', 'localhost', '::1'].includes(url.hostname)
    if (!['http:', 'https:'].includes(url.protocol) || (url.protocol === 'http:' && !loopback)) throw new Error('protocol')
    return url.toString().replace(/\/$/u, '')
  } catch {
    throw failure('SOURCE_CONFIG', 'The XTEST CPIC API URL must use HTTP or HTTPS')
  }
}

function endpoint(base, path) {
  return `${base}${path}`
}

function errorCode(operation, status) {
  if (status === 401 || status === 403) return operation === 'source' ? 'SOURCE_AUTH' : 'QA_API_AUTH'
  if (status === 404) return operation === 'source' ? 'SOURCE_NOT_FOUND' : 'QA_API_NOT_FOUND'
  if (status === 409) return operation === 'source' ? 'SOURCE_CONFLICT' : 'QA_VERSION_CONFLICT'
  return operation === 'source' ? 'SOURCE_API' : 'QA_API'
}

function isVersionConflict(error) {
  return error instanceof WorkbenchError && error.code === 'QA_VERSION_CONFLICT'
}

function errorMessage(operation, status) {
  if (status === 401 || status === 403) return operation === 'source' ? 'XTEST rejected the trusted CPIC requirement request' : 'XTEST rejected the trusted CPIC QA request'
  if (status === 404) return operation === 'source' ? 'The XTEST requirement was not found' : 'The XTEST CPIC QA record was not found'
  if (status === 409) return operation === 'source' ? 'The XTEST requirement changed; refresh before saving' : 'The CPIC QA record changed on XTEST; refresh before retrying'
  return operation === 'source' ? 'The XTEST requirement service could not complete the request' : 'The XTEST CPIC QA service could not complete the request'
}

function serverMessage(value) {
  if (typeof value !== 'string') return ''
  const message = value.replace(/[\u0000-\u001f\u007f]/gu, ' ').trim()
  return message.length > 240 ? `${message.slice(0, 237)}...` : message
}

function contentError(operation, message) {
  const prefix = operation === 'source' ? 'The XTEST requirement service rejected the request' : 'The XTEST CPIC QA service rejected the request'
  const detail = serverMessage(message)
  return failure(operation === 'source' ? 'SOURCE_API' : 'QA_API', detail ? `${prefix}: ${detail}` : prefix)
}

async function readBoundedBody(response, maxBytes, operation) {
  const tooLarge = () => failure(operation === 'source' ? 'SOURCE_TOO_LARGE' : 'QA_API_TOO_LARGE', operation === 'source' ? 'The XTEST requirement response exceeds the configured byte limit' : 'The XTEST QA response exceeds the configured byte limit')
  const declared = Number(response.headers?.get?.('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => {})
    throw tooLarge()
  }
  if (!response.body?.getReader) {
    const text = await response.text()
    if (Buffer.byteLength(text) > maxBytes) throw tooLarge()
    return text
  }
  const reader = response.body.getReader()
  const chunks = []
  let bytes = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > maxBytes) {
        await reader.cancel()
        throw tooLarge()
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const data = new Uint8Array(bytes)
  let offset = 0
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength }
  return new TextDecoder('utf-8', { fatal: true }).decode(data)
}

/** Server-to-server XTEST CPIC adapter with bounded JSON responses and trusted identity headers. */
export class XtestHttpClient {
  constructor(input, { fetch = globalThis.fetch } = {}) {
    const parsed = apiConfigSchema.safeParse(input)
    if (!parsed.success || typeof fetch !== 'function') throw failure('SOURCE_CONFIG', 'Configure the XTEST CPIC API URL, secret, trusted identity and tenant')
    this.config = { ...parsed.data, apiUrl: normalizedUrl(parsed.data.apiUrl) }
    this.fetch = fetch
  }

  async request(path, body, operation, signal, method = 'POST') {
    const controller = new AbortController()
    const abort = () => controller.abort(signal?.reason)
    if (signal?.aborted) abort()
    else signal?.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs)
    try {
      let response
      try {
        response = await this.fetch(endpoint(this.config.apiUrl, path), {
          method,
          headers: {
            accept: 'application/json',
            ...(method === 'GET' || method === 'HEAD' ? {} : { 'content-type': 'application/json' }),
            'x-dsh-gateway-secret': this.config.apiSecret,
            'x-dsh-external-user': this.config.userIdentity,
            'x-dsh-tenant-id': this.config.tenantId,
          },
          ...(['GET', 'HEAD'].includes(method) ? {} : { body: JSON.stringify(body) }),
          signal: controller.signal,
        })
      } catch (error) {
        if (signal?.aborted) throw failure(operation === 'source' ? 'SOURCE_CANCELLED' : 'QA_API_CANCELLED', operation === 'source' ? 'The XTEST requirement request was cancelled' : 'The XTEST QA request was cancelled')
        if (controller.signal.aborted) throw failure(operation === 'source' ? 'SOURCE_TIMEOUT' : 'QA_API_TIMEOUT', operation === 'source' ? 'The XTEST requirement request timed out' : 'The XTEST QA request timed out')
        throw failure(operation === 'source' ? 'SOURCE_API' : 'QA_API', operation === 'source' ? 'The XTEST requirement service could not be reached' : 'The XTEST CPIC QA service could not be reached')
      }
      let parsed
      try {
        const text = await readBoundedBody(response, this.config.maxBytes, operation)
        parsed = actionResultSchema.parse(JSON.parse(text))
      } catch (error) {
        if (error instanceof WorkbenchError) throw error
        throw failure(operation === 'source' ? 'SOURCE_FORMAT' : 'QA_API_FORMAT', operation === 'source' ? 'The XTEST requirement response was invalid' : 'The XTEST QA response was invalid')
      }
      if (!response.ok) {
        const code = errorCode(operation, response.status)
        const message = serverMessage(parsed.msg)
        throw failure(code, message ? `${errorMessage(operation, response.status)}: ${message}` : errorMessage(operation, response.status))
      }
      if (!parsed.result) throw contentError(operation, parsed.msg)
      return parsed.content
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
    }
  }
}

function dateText(value) {
  if (value == null || value === '') return ''
  const date = value instanceof Date ? value : new Date(/(?:Z|[+-]\d\d:\d\d)$/iu.test(value) ? value : String(value).replace(' ', 'T') + 'Z')
  if (!Number.isFinite(date.getTime())) throw failure('SOURCE_FORMAT', 'The XTEST requirement returned an invalid timestamp')
  return date.toISOString()
}

function summary(value) {
  const parsed = z.object({
    id: nonblank, externalId: nonblank, source: z.literal('xtest'), system: nonblank,
    p_sid: nonblank.optional(), p_name: nonblank.optional(),
    systemName: nonblank.optional(), projectName: nonblank.optional(), title: nonblank, version: z.string(), updatedAt: z.string().optional(),
  }).strict().safeParse(value)
  if (!parsed.success) throw failure('SOURCE_FORMAT', 'The XTEST requirement returned invalid summary fields')
  const { projectName, ...data } = parsed.data
  return { ...data, systemName: data.p_name ?? data.systemName ?? projectName ?? data.system, ...(data.updatedAt === undefined ? {} : { updatedAt: dateText(data.updatedAt) }) }
}

function detail(value, projectId, jobId) {
  const parsed = z.object({
    id: nonblank.optional(), jobId: nonblank.optional(), projectId: nonblank.optional(), system: nonblank.optional(),
    p_sid: nonblank.optional(), p_name: nonblank.optional(),
    systemName: nonblank.optional(), projectName: nonblank.optional(),
    title: z.string().nullish(), requirementNo: z.string().nullish(), version: z.string().nullish(), requirementVersion: z.string().nullish(),
    requirement: z.string().nullish(), markdown: z.string().nullish(), content: z.string().nullish(),
    createdAt: z.union([z.string(), z.date()]).nullish(), updatedAt: z.union([z.string(), z.date()]).nullish(),
  }).passthrough().safeParse(value)
  if (!parsed.success) throw failure('SOURCE_FORMAT', 'The XTEST requirement returned invalid detail fields')
  const row = parsed.data
  const actualProject = row.projectId ?? row.system ?? projectId
  const actualJob = row.jobId ?? row.id ?? jobId
  if (actualProject !== projectId || actualJob !== jobId) throw failure('SOURCE_FORMAT', 'The XTEST requirement returned an unexpected identity')
  const markdown = row.markdown ?? row.requirement ?? row.content
  if (typeof markdown !== 'string' || !markdown.trim()) throw failure('SOURCE_EMPTY', 'The requirement has no text to analyze')
  const hash = createHash('sha256').update(markdown).digest('hex')
  return {
    source: 'xtest', system: projectId, systemName: row.p_name ?? row.systemName ?? row.projectName ?? projectId, id: jobId,
    title: row.title || row.requirementNo || jobId, version: row.version || row.requirementVersion || '',
    markdown, hash, updatedAt: dateText(row.updatedAt || row.createdAt),
  }
}

function project(value) {
  const parsed = z.object({ p_sid: nonblank, p_name: nonblank }).strict().safeParse(value)
  if (!parsed.success) throw failure('SOURCE_FORMAT', 'The XTEST project list returned invalid project fields')
  return parsed.data
}

/** XTEST requirement source using server-side project authorization. */
export class XtestRequirementSource {
  constructor(client) { this.client = client }

  /**
   * Reads assigned project IDs and names without deriving access from requirements.
   * @param {AbortSignal} [signal] Cancels the server request.
   * @returns {Promise<Array<{p_sid: string, p_name: string}>>} Authorized projects, including an empty list; rejects malformed or oversized responses and request failures.
   */
  async listProjects(signal) {
    const content = await this.client.request('/projects/list', {}, 'source', signal)
    if (!Array.isArray(content)) throw failure('SOURCE_FORMAT', 'The XTEST project list was invalid')
    if (content.length > this.client.config.maxRows) throw failure('SOURCE_LIMIT', 'The project list exceeds the configured row limit')
    const result = content.map(project)
    if (Buffer.byteLength(JSON.stringify(result)) > this.client.config.maxBytes) throw failure('SOURCE_TOO_LARGE', 'The project list exceeds the configured byte limit')
    return result
  }

  async list(query = '', signal) {
    const content = await this.client.request('/requirements/list', { query }, 'source', signal)
    if (!Array.isArray(content)) throw failure('SOURCE_FORMAT', 'The XTEST requirement list was invalid')
    if (content.length > this.client.config.maxRows) throw failure('SOURCE_LIMIT', 'The requirement list exceeds the configured row limit')
    const result = content.map(summary)
    if (Buffer.byteLength(JSON.stringify(result)) > this.client.config.maxBytes) throw failure('SOURCE_TOO_LARGE', 'The requirement list exceeds the configured byte limit')
    return result
  }

  parseIdentity(id) {
    const parts = String(id).split('/')
    if (parts.length !== 2) throw failure('SOURCE_CONFIG', 'Provide a valid project and requirement identity')
    try { return parts.map(decodeURIComponent) } catch { throw failure('SOURCE_CONFIG', 'Provide a valid project and requirement identity') }
  }

  async detail(id, signal) {
    const [projectId, jobId] = this.parseIdentity(id)
    const content = await this.client.request('/requirements/detail', { projectId, jobId }, 'source', signal)
    return detail(content, projectId, jobId)
  }

  async update(id, markdown, expectedHash, signal) {
    if (typeof markdown !== 'string' || !markdown.trim()) throw failure('SOURCE_EMPTY', 'The requirement must contain Markdown text')
    if (typeof expectedHash !== 'string' || !expectedHash) throw failure('SOURCE_CONFLICT', 'Refresh the requirement before saving')
    const [projectId, jobId] = this.parseIdentity(id)
    const content = await this.client.request('/requirements/detail', { projectId, jobId, markdown, expectedHash }, 'source', signal, 'PUT')
    return detail(content, projectId, jobId)
  }
}

/** Tenant-scoped QA table adapter backed by XTEST with optimistic hashes. */
export class XtestQaRepository {
  constructor(client) {
    this.client = client
    this.state = Object.fromEntries(recordTypeSchema.options.map(type => [type, new Map()]))
    this.hashes = Object.fromEntries(recordTypeSchema.options.map(type => [type, new Map()]))
    this.tables = Object.fromEntries(recordTypeSchema.options.map(type => [type, this.table(type)]))
    this.ready = this.initialize()
  }

  async initialize() {
    await Promise.all(recordTypeSchema.options.map(type => this.refresh(type)))
  }

  async refresh(type) {
    const content = await this.client.request('/qa/list', { type }, 'qa')
    if (!Array.isArray(content)) throw failure('QA_API_FORMAT', 'The XTEST QA list was invalid')
    if (content.length > this.client.config.maxRows) throw failure('QA_API_LIMIT', 'The XTEST QA list exceeds the configured row limit')
    const records = content.map(raw => {
      const parsed = recordSchema.safeParse(raw)
      if (!parsed.success) throw failure('QA_API_FORMAT', 'The XTEST QA list contained an invalid record')
      return parsed.data
    })
    const serialized = JSON.stringify(records)
    if (Buffer.byteLength(serialized) > this.client.config.maxBytes) throw failure('QA_API_TOO_LARGE', 'The XTEST QA list exceeds the configured byte limit')
    const values = new Map(records.map(record => [record.key, record.value]))
    const hashes = new Map(records.map(record => [record.key, record.hash]))
    this.state[type].clear()
    this.hashes[type].clear()
    for (const [key, value] of values) this.state[type].set(key, value)
    for (const [key, hash] of hashes) this.hashes[type].set(key, hash)
  }

  async reconcileConflict(type, error) {
    if (!isVersionConflict(error)) throw error
    try {
      await this.refresh(type)
    } catch {
      throw failure('QA_API_UNCERTAIN', 'XTEST rejected a conditional write and the latest record state could not be loaded')
    }
    throw error
  }

  table(type) {
    recordTypeSchema.parse(type)
    const state = this.state[type]
    const hashes = this.hashes[type]
    return {
      get: key => state.get(key),
      entries: () => [...state.entries()],
      put: async (key, value) => {
        const existingHash = hashes.get(key)
        if (type === 'qa_audits' && existingHash !== undefined) throw failure('QA_VERSION_CONFLICT', 'Audit records are append-only')
        const body = { value, ...(existingHash === undefined ? {} : { expectedHash: existingHash }) }
        let content
        try {
          content = await this.client.request(`/qa/records/${type}/${encodeURIComponent(key)}`, body, 'qa', undefined, 'PUT')
        } catch (error) {
          await this.reconcileConflict(type, error)
        }
        const record = recordSchema.safeParse(content)
        if (!record.success || record.data.key !== key) throw failure('QA_API_FORMAT', 'The XTEST QA write response was invalid')
        state.set(key, record.data.value)
        hashes.set(key, record.data.hash)
      },
      delete: async key => {
        if (type === 'qa_audits') throw failure('QA_API', 'Audit records are append-only')
        const expectedHash = hashes.get(key)
        if (expectedHash === undefined) return
        let content
        try {
          content = await this.client.request(`/qa/records/${type}/${encodeURIComponent(key)}`, { expectedHash }, 'qa', undefined, 'DELETE')
        } catch (error) {
          await this.reconcileConflict(type, error)
        }
        if (content !== undefined && content !== null) {
          const record = recordSchema.safeParse(content)
          if (!record.success || record.data.key !== key) throw failure('QA_API_FORMAT', 'The XTEST QA delete response was invalid')
        }
        state.delete(key)
        hashes.delete(key)
      },
    }
  }
}

export { apiConfigSchema, recordTypeSchema }
