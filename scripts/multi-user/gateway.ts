/** Trusted-header HTTP, SSE, and WebSocket gateway for static tenant DSH instances. */

import { randomBytes, timingSafeEqual } from 'node:crypto'
import {
  createServer, request as httpRequest, STATUS_CODES,
  type IncomingHttpHeaders, type IncomingMessage, type OutgoingHttpHeaders, type Server, type ServerResponse,
} from 'node:http'
import { request as httpsRequest } from 'node:https'
import { connect as netConnect } from 'node:net'
import type { Duplex } from 'node:stream'
import { startGatewayAdminServer, type GatewayControlSettings, type GatewayAdminServer } from './gateway-admin.ts'
import type { TenantInstanceReady } from './instance-manager.ts'
import { TenantProvisionError, type StaticTenant, type StaticTenantConfig } from './tenant-config.ts'

/** Default header written by the trusted external authenticator. */
export const DEFAULT_IDENTITY_HEADER = 'x-auth-request-user'
/** Default shared-secret header written by the trusted reverse proxy. */
export const DEFAULT_PROXY_SECRET_HEADER = 'x-dsh-proxy-secret'

const HOP_BY_HOP_HEADERS = [
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'proxy-connection', 'te', 'trailer', 'transfer-encoding', 'upgrade',
] as const

/** Minimal lifecycle operations consumed by the gateway. */
export interface GatewayInstanceManager {
  /** Ensure a tenant is ready before the gateway opens an upstream request. */
  ensureInstanceRunning(tenantId: string): Promise<TenantInstanceReady>
  /** Stop one idle tenant and settle after its child exits. */
  stopInstance(tenantId: string): Promise<void>
  /** Stop every process owned by the manager. */
  dispose(): Promise<void>
  /** Register a tenant created while the gateway is running. */
  registerTenant?(tenant: StaticTenant): void
}

/** Listener, identity, and inter-process authentication configuration. */
export interface StaticTenantGatewayOptions {
  readonly host: string
  readonly port: number
  readonly proxySecret: string
  readonly identityHeader?: string
  readonly proxySecretHeader?: string
  /** Milliseconds with no active requests before stopping a tenant; zero disables reclamation. */
  readonly idleTimeoutMs?: number
  /** Internal Xtest2 endpoint that atomically consumes a jump ticket. */
  readonly ticketResolverUrl?: string
  /** Secret sent only from Gateway to the internal ticket resolver. */
  readonly ticketResolverSecret?: string
  readonly sessionCookieName?: string
  readonly sessionTtlMs?: number
  /** Secret required by the internal tenant provisioning endpoint. */
  readonly tenantProvisionSecret?: string
  /** Creates and persists a tenant and registers it with the instance manager before returning. */
  readonly provisionTenant?: (
    externalUserId: string,
    tenantId: string | undefined,
    portRange: { readonly min: number; readonly max: number },
  ) => Promise<{ tenant: StaticTenant; created: boolean }>
  /** Management listener address; the listener starts only when adminSecret is provided. */
  readonly adminHost?: string
  readonly adminPort?: number
  /** At least 32 UTF-8 bytes; authenticates the separate management listener. */
  readonly adminSecret?: string
  /** Initial tenant allocation range. */
  readonly tenantPortMin?: number
  readonly tenantPortMax?: number
  /** Persists changed listener and tenant allocation settings before they become active. */
  readonly persistAdminSettings?: (settings: GatewayControlSettings) => Promise<void>
  /** Receives an idle-stop failure while the gateway remains available. */
  readonly onReclaimError?: (tenantId: string, error: Error) => void
}

/** Running gateway owned by its caller. */
export interface StaticTenantGateway {
  readonly host: string
  readonly port: number
  readonly adminHost: string | undefined
  readonly adminPort: number | undefined
  /** Rebind the browser-facing listener using its current saved settings. */
  restartListener(): Promise<void>
  /** Stop accepting traffic, close every connection, and stop owned tenant instances. */
  close(): Promise<void>
}

interface ResolvedGatewayOptions {
  readonly host: string
  readonly port: number
  readonly proxySecret: Buffer
  readonly identityHeader: string
  readonly proxySecretHeader: string
  readonly idleTimeoutMs: number
  readonly ticketResolverUrl: string | undefined
  readonly ticketResolverSecret: Buffer | undefined
  readonly sessionCookieName: string
  readonly sessionTtlMs: number
  readonly tenantProvisionSecret: Buffer | undefined
  readonly provisionTenant: StaticTenantGatewayOptions['provisionTenant']
  readonly onReclaimError: (tenantId: string, error: Error) => void
}

interface TenantRoute {
  readonly tenantId: string
  readonly port: number
  readonly generation: number
  readonly authenticatedUrl: string
}

interface GatewaySession {
  readonly externalUserId: string
  readonly expiresAt: number
}

interface TenantActivity {
  active: number
  reclaimable: boolean
  timer: NodeJS.Timeout | undefined
  reclaiming: Promise<void> | undefined
}

function requestCookie(headers: IncomingHttpHeaders, name: string): string | undefined {
  const cookie = oneHeader(headers, 'cookie')
  if (cookie === undefined) return undefined
  for (const part of cookie.split(';')) {
    const separator = part.indexOf('=')
    if (separator < 1) continue
    if (part.slice(0, separator).trim() === name) return decodeURIComponent(part.slice(separator + 1).trim())
  }
  return undefined
}

function newSessionId(): string {
  return randomBytes(32).toString('base64url')
}

class TenantIdleReclaimer {
  private readonly tenants = new Map<string, TenantActivity>()
  private disposed = false

  constructor(
    private readonly timeoutMs: number,
    private readonly stop: (tenantId: string) => Promise<void>,
    private readonly onStopped: (tenantId: string) => void,
    private readonly onError: (tenantId: string, error: Error) => void,
  ) {}

  acquire(tenantId: string): () => void {
    if (this.disposed) throw new GatewayRequestError(503, 'gateway is shutting down')
    const activity = this.tenants.get(tenantId) ?? {
      active: 0,
      reclaimable: false,
      timer: undefined,
      reclaiming: undefined,
    }
    this.tenants.set(tenantId, activity)
    activity.active += 1
    activity.reclaimable = true
    if (activity.timer !== undefined) clearTimeout(activity.timer)
    activity.timer = undefined
    let released = false
    return () => {
      if (released) return
      released = true
      activity.active -= 1
      this.schedule(tenantId, activity)
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true
    for (const activity of this.tenants.values()) {
      if (activity.timer !== undefined) clearTimeout(activity.timer)
      activity.timer = undefined
    }
    await Promise.allSettled([...this.tenants.values()].flatMap(activity =>
      activity.reclaiming === undefined ? [] : [activity.reclaiming]))
  }

  private schedule(tenantId: string, activity: TenantActivity): void {
    if (this.disposed || this.timeoutMs === 0 || activity.active !== 0 || !activity.reclaimable
      || activity.timer !== undefined || activity.reclaiming !== undefined) return
    activity.timer = setTimeout(() => {
      activity.timer = undefined
      if (this.disposed || activity.active !== 0 || !activity.reclaimable) return
      const reclaiming = this.stop(tenantId).then(
        () => {
          activity.reclaimable = false
          this.onStopped(tenantId)
        },
        (error: unknown) => {
          this.onError(tenantId, error instanceof Error ? error : new Error(String(error)))
        },
      ).finally(() => {
        activity.reclaiming = undefined
        this.schedule(tenantId, activity)
      })
      activity.reclaiming = reclaiming
    }, this.timeoutMs)
    activity.timer.unref()
  }
}

class GatewayRequestError extends Error {
  constructor(readonly status: 400 | 401 | 403 | 502 | 503, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'GatewayRequestError'
  }
}

function normalizeHeaderName(value: string | undefined, fallback: string, name: string): string {
  const header = (value ?? fallback).trim().toLowerCase()
  if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/u.test(header)) throw new TypeError(`${name} must be one HTTP header name`)
  return header
}

function resolveOptions(options: StaticTenantGatewayOptions): ResolvedGatewayOptions {
  if (options.host.trim() === '') throw new TypeError('host must be a non-empty string')
  if (!Number.isSafeInteger(options.port) || options.port < 0 || options.port > 65_535) {
    throw new TypeError('port must be an integer from 0 through 65535')
  }
  if (Buffer.byteLength(options.proxySecret) < 32) throw new TypeError('proxySecret must contain at least 32 UTF-8 bytes')
  const identityHeader = normalizeHeaderName(options.identityHeader, DEFAULT_IDENTITY_HEADER, 'identityHeader')
  const proxySecretHeader = normalizeHeaderName(options.proxySecretHeader, DEFAULT_PROXY_SECRET_HEADER, 'proxySecretHeader')
  if (identityHeader === proxySecretHeader) throw new TypeError('identityHeader and proxySecretHeader must differ')
  const idleTimeoutMs = options.idleTimeoutMs ?? 0
  if (!Number.isSafeInteger(idleTimeoutMs) || idleTimeoutMs < 0) {
    throw new TypeError('idleTimeoutMs must be a non-negative safe integer')
  }
  const ticketResolverUrl = options.ticketResolverUrl?.trim() || undefined
  const ticketResolverSecret = options.ticketResolverSecret === undefined
    ? undefined
    : Buffer.from(options.ticketResolverSecret)
  if ((ticketResolverUrl === undefined) !== (ticketResolverSecret === undefined)) {
    throw new TypeError('ticketResolverUrl and ticketResolverSecret must be configured together')
  }
  if (ticketResolverUrl !== undefined) {
    let resolver: URL
    try { resolver = new URL(ticketResolverUrl) } catch { throw new TypeError('ticketResolverUrl must be a valid HTTP(S) URL') }
    if (!['http:', 'https:'].includes(resolver.protocol) || resolver.username || resolver.password || resolver.hash) {
      throw new TypeError('ticketResolverUrl must be an HTTP(S) URL without credentials or a fragment')
    }
    if (ticketResolverSecret === undefined || ticketResolverSecret.length < 32) {
      throw new TypeError('ticketResolverSecret must contain at least 32 UTF-8 bytes')
    }
  }
  const sessionCookieName = options.sessionCookieName?.trim() || 'dsh_gateway_session'
  if (!/^[A-Za-z0-9_-]+$/u.test(sessionCookieName)) throw new TypeError('sessionCookieName must be a simple cookie name')
  const sessionTtlMs = options.sessionTtlMs ?? 8 * 60 * 60 * 1000
  if (!Number.isSafeInteger(sessionTtlMs) || sessionTtlMs <= 0) throw new TypeError('sessionTtlMs must be a positive safe integer')
  const tenantProvisionSecret = options.tenantProvisionSecret === undefined
    ? undefined
    : Buffer.from(options.tenantProvisionSecret)
  if ((tenantProvisionSecret === undefined) !== (options.provisionTenant === undefined)) {
    throw new TypeError('tenantProvisionSecret and provisionTenant must be configured together')
  }
  if (tenantProvisionSecret !== undefined && tenantProvisionSecret.length < 32) {
    throw new TypeError('tenantProvisionSecret must contain at least 32 UTF-8 bytes')
  }
  return {
    host: options.host,
    port: options.port,
    proxySecret: Buffer.from(options.proxySecret),
    identityHeader,
    proxySecretHeader,
    idleTimeoutMs,
    ticketResolverUrl,
    ticketResolverSecret,
    sessionCookieName,
    sessionTtlMs,
    tenantProvisionSecret,
    provisionTenant: options.provisionTenant,
    onReclaimError: options.onReclaimError ?? ((tenantId, error) => {
      process.stderr.write(`multi-user gateway: failed to reclaim ${JSON.stringify(tenantId)}: ${error.message}\n`)
    }),
  }
}

function oneHeader(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name]
  if (Array.isArray(value)) throw new GatewayRequestError(400, `request header ${JSON.stringify(name)} must occur once`)
  return value
}

function secretMatches(actual: string | undefined, expected: Buffer): boolean {
  if (actual === undefined) return false
  const received = Buffer.from(actual)
  return received.length === expected.length && timingSafeEqual(received, expected)
}

function validAuthority(value: string | undefined): value is string {
  if (value === undefined || value.length > 255 || /[\s/@\\]/u.test(value)) return false
  try {
    const parsed = new URL(`http://${value}/`)
    return parsed.host === value.toLowerCase() && parsed.pathname === '/'
  } catch {
    return false
  }
}

function responseHeaders(headers: IncomingHttpHeaders): OutgoingHttpHeaders {
  const copy = { ...headers }
  for (const name of HOP_BY_HOP_HEADERS) Reflect.deleteProperty(copy, name)
  Reflect.deleteProperty(copy, 'set-cookie')
  return copy
}

function requestHeaders(
  source: IncomingHttpHeaders,
  authority: string,
  cookie: string,
  options: ResolvedGatewayOptions,
): OutgoingHttpHeaders {
  const copy = { ...source }
  for (const name of HOP_BY_HOP_HEADERS) Reflect.deleteProperty(copy, name)
  for (const name of [options.identityHeader, options.proxySecretHeader, 'cookie']) Reflect.deleteProperty(copy, name)
  copy.host = authority
  copy.cookie = cookie
  return copy
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const buffer of request as AsyncIterable<Buffer>) {
    size += buffer.length
    if (size > 16 * 1024) throw new GatewayRequestError(400, 'request body is too large')
    chunks.push(buffer)
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error('body must be an object')
    }
    return value as Record<string, unknown>
  } catch (error) {
    throw new GatewayRequestError(400, 'request body must be valid JSON', { cause: error })
  }
}

function writeError(response: ServerResponse, error: unknown): void {
  if (response.headersSent) {
    response.destroy(error instanceof Error ? error : new Error(String(error)))
    return
  }
  const failure = error instanceof GatewayRequestError
    ? error
    : new GatewayRequestError(502, 'tenant upstream request failed', { cause: error })
  response.writeHead(failure.status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
  })
  response.end(`${JSON.stringify({ error: failure.message })}\n`)
}

function writeUpgradeError(socket: Duplex, status: number, message: string): void {
  if (socket.destroyed) return
  const body = `${JSON.stringify({ error: message })}\n`
  socket.end([
    `HTTP/1.1 ${status} ${STATUS_CODES[status] ?? 'Gateway Error'}`,
    'Connection: close',
    'Cache-Control: no-store',
    'Content-Type: application/json; charset=utf-8',
    `Content-Length: ${Buffer.byteLength(body)}`,
    '', body,
  ].join('\r\n'))
}

/**
 * Start one trusted-header gateway over an existing static tenant instance manager.
 * @param config - Validated static tenant registry used to resolve external identities.
 * @param manager - Owner of tenant DSH process lifecycles.
 * @param options - Listener and trusted-upstream authentication configuration.
 * @returns the listening gateway; callers must await `close()` for quiescent shutdown.
 */
export async function startStaticTenantGateway(
  config: StaticTenantConfig,
  manager: GatewayInstanceManager,
  options: StaticTenantGatewayOptions,
): Promise<StaticTenantGateway> {
  const resolved = resolveOptions(options)
  let currentSettings: GatewayControlSettings = {
    host: resolved.host,
    port: resolved.port,
    tenantPortMin: options.tenantPortMin ?? 3081,
    tenantPortMax: options.tenantPortMax ?? 3999,
  }
  if (!Number.isSafeInteger(currentSettings.tenantPortMin) || !Number.isSafeInteger(currentSettings.tenantPortMax)
    || currentSettings.tenantPortMin < 1024 || currentSettings.tenantPortMax > 65_535
    || currentSettings.tenantPortMin > currentSettings.tenantPortMax) {
    throw new TypeError('tenant port range must be integers from 1024 through 65535 in ascending order')
  }
  if ((options.adminSecret === undefined) !== (options.persistAdminSettings === undefined)) {
    throw new TypeError('adminSecret and persistAdminSettings must be configured together')
  }
  const tenants = new Map(config.tenants.map(tenant => [tenant.externalUserId, tenant] as const))
  const cookieCache = new Map<string, Promise<string>>()
  const sessions = new Map<string, GatewaySession>()
  const reclaimer = new TenantIdleReclaimer(
    resolved.idleTimeoutMs,
    tenantId => manager.stopInstance(tenantId),
    (tenantId) => {
      const prefix = `${tenantId}\0`
      for (const key of cookieCache.keys()) if (key.startsWith(prefix)) cookieCache.delete(key)
    },
    resolved.onReclaimError,
  )
  const sockets = new Set<Duplex>()
  let server: Server
  let adminServer: GatewayAdminServer | undefined
  let activeHost = resolved.host
  let activePort = resolved.port
  let listenerOperation: Promise<void> = Promise.resolve()
  let closing: Promise<void> | undefined
  let provisioning: Promise<void> = Promise.resolve()
  const assertOpen = (): void => {
    if (closing !== undefined) throw new GatewayRequestError(503, 'gateway is shutting down')
  }

  const provisionTenant = (externalUserId: string, tenantId: string | undefined) => {
    const operation = provisioning.then(async () => {
      assertOpen()
      if (resolved.provisionTenant === undefined) {
        throw new GatewayRequestError(503, '用户尚未分配 DSH 租户，且 Gateway 未启用自动创建；请联系管理员配置租户创建接口')
      }
      try {
        const result = await resolved.provisionTenant(externalUserId, tenantId, {
          min: currentSettings.tenantPortMin,
          max: currentSettings.tenantPortMax,
        })
        tenants.set(result.tenant.externalUserId, result.tenant)
        return result
      } catch (error) {
        const reasons = {
          'invalid-external-user': 'XTEST 用户标识不能用作租户目录名，请管理员修正用户绑定',
          'invalid-tenant-id': 'XTEST 绑定的租户编号格式无效，请管理员修正租户编号',
          'tenant-id-in-use': 'XTEST 绑定的租户编号已分配给其他用户，请管理员修正绑定冲突',
          'no-available-port': '租户端口已全部分配，请管理员扩充端口范围或清理无用租户',
        } as const
        const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
        const reason = error instanceof TenantProvisionError ? reasons[error.code]
          : code === 'EACCES' || code === 'EPERM' ? 'Gateway 没有租户配置或目录的写入权限，请管理员检查权限'
            : code === 'ENOSPC' ? '租户所在磁盘空间不足，请管理员释放磁盘空间'
              : '租户配置读取、保存或实例注册发生内部错误，请管理员检查 Gateway 日志及租户配置'
        console.error('multi-user gateway: tenant provisioning failed', error)
        throw new GatewayRequestError(503, `DSH 租户创建或注册失败：${reason}；处理后请从 XTEST 重新进入`, { cause: error })
      }
    })
    // Each request reports its own failure; subsequent provisioning still runs.
    provisioning = operation.then(() => {}, () => {})
    return operation
  }

  const track = (socket: Duplex): void => {
    sockets.add(socket)
    socket.once('close', () => { sockets.delete(socket) })
    if (closing !== undefined) socket.destroy()
  }

  const consumeTicket = (ticket: string): Promise<{ externalUserId: string; tenantId: string | undefined; accessPath: string }> => {
    const resolverUrl = resolved.ticketResolverUrl
    const resolverSecret = resolved.ticketResolverSecret
    if (resolverUrl === undefined || resolverSecret === undefined) {
      return Promise.reject(new GatewayRequestError(503, 'DSH 票据入口未配置 XTEST 验证接口或内部密钥；请联系管理员配置 Gateway 的 ticketResolverUrl 和 ticketResolverSecret'))
    }
    const resolver = new URL(resolverUrl)
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({ ticket })
      const requestResolver = resolver.protocol === 'https:' ? httpsRequest : httpRequest
      const upstream = requestResolver({
        host: resolver.hostname,
        port: resolver.port ? Number(resolver.port) : resolver.protocol === 'https:' ? 443 : 80,
        method: 'POST',
        path: `${resolver.pathname}${resolver.search}`,
        headers: {
          host: resolver.host,
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
          'x-dsh-gateway-secret': resolverSecret.toString('utf8'),
        },
        agent: false,
      }, (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.once('end', () => {
          if (response.statusCode !== 200) {
            reject(new GatewayRequestError(502, `XTEST 票据验证接口返回 HTTP ${response.statusCode ?? '未知'}；请联系管理员检查接口地址、内部密钥与 XTEST 服务状态`))
            return
          }
          try {
            const payload: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
            if (typeof payload !== 'object' || payload === null || !('result' in payload)) {
              reject(new GatewayRequestError(502, 'XTEST 票据验证接口响应缺少 result 字段；请联系管理员检查接口响应'))
              return
            }
            if (payload.result !== true) {
              const message = 'msg' in payload && typeof payload.msg === 'string' && payload.msg.trim() !== ''
                ? payload.msg : 'XTEST 未接受此跳转票据'
              reject(new GatewayRequestError(401, `${message}；请从 XTEST 重新点击进入 DSH`))
              return
            }
            const content = 'content' in payload ? payload.content : undefined
            if (typeof content !== 'object' || content === null
              || !('externalUserId' in content) || typeof content.externalUserId !== 'string' || content.externalUserId.trim() === '') {
              reject(new GatewayRequestError(502, 'XTEST 票据验证接口未返回有效用户标识；请联系管理员检查接口响应'))
              return
            }
            const tenantId = 'tenantId' in content ? content.tenantId : undefined
            const accessPath = 'accessPath' in content ? content.accessPath : undefined
            if ((tenantId !== undefined && (typeof tenantId !== 'string' || tenantId.trim() === ''))
              || (accessPath !== undefined && typeof accessPath !== 'string')) {
              reject(new GatewayRequestError(502, 'XTEST 票据验证接口返回的租户编号或访问路径无效；请联系管理员检查接口响应'))
              return
            }
            resolve({ externalUserId: content.externalUserId.trim(), tenantId: tenantId?.trim(), accessPath: accessPath ?? '/' })
          } catch (error) {
            reject(new GatewayRequestError(502, 'XTEST 票据验证接口返回无效 JSON；请联系管理员检查接口响应', { cause: error }))
          }
        })
      })
      upstream.once('error', (error) => {
        reject(new GatewayRequestError(502, '无法连接 XTEST 票据验证服务；请联系管理员检查 XTEST 服务与票据接口地址，再重新进入', { cause: error }))
      })
      upstream.end(body)
    })
  }

  const identify = (request: IncomingMessage): { externalUserId: string; authority: string } => {
    const authority = oneHeader(request.headers, 'host')
    if (!validAuthority(authority)) throw new GatewayRequestError(400, 'request Host header is invalid')
    const sessionId = requestCookie(request.headers, resolved.sessionCookieName)
    if (sessionId !== undefined) {
      const session = sessions.get(sessionId)
      if (session !== undefined) {
        if (session.expiresAt > Date.now() && tenants.has(session.externalUserId)) {
          return { externalUserId: session.externalUserId, authority }
        }
        sessions.delete(sessionId)
      }
    }
    if (!secretMatches(oneHeader(request.headers, resolved.proxySecretHeader), resolved.proxySecret)) {
      throw new GatewayRequestError(401, 'trusted proxy authentication required')
    }
    const externalUserId = oneHeader(request.headers, resolved.identityHeader)?.trim()
    if (externalUserId === undefined || externalUserId === '') {
      throw new GatewayRequestError(401, 'authenticated external user required')
    }
    if (!tenants.has(externalUserId)) throw new GatewayRequestError(403, 'external user is not assigned a tenant')
    return { externalUserId, authority }
  }

  const route = async (externalUserId: string): Promise<TenantRoute> => {
    const tenant = tenants.get(externalUserId)
    if (tenant === undefined) throw new GatewayRequestError(403, 'external user is not assigned a tenant')
    try {
      const ready = await manager.ensureInstanceRunning(tenant.tenantId)
      return {
        tenantId: tenant.tenantId,
        port: tenant.port,
        generation: ready.instance.generation,
        authenticatedUrl: ready.authenticatedUrl,
      }
    } catch (error) {
      throw new GatewayRequestError(503, 'assigned tenant instance is unavailable', { cause: error })
    }
  }

  const exchangeCookie = (tenant: TenantRoute, authority: string): Promise<string> => {
    const key = `${tenant.tenantId}\0${tenant.generation}\0${authority}`
    const existing = cookieCache.get(key)
    if (existing !== undefined) return existing
    const exchange = new Promise<string>((resolve, reject) => {
      const authenticated = new URL(tenant.authenticatedUrl)
      const upstream = httpRequest({
        host: '127.0.0.1',
        port: tenant.port,
        method: 'GET',
        path: `${authenticated.pathname}${authenticated.search}`,
        headers: { host: authority },
        agent: false,
      }, (response) => {
        response.resume()
        response.once('end', () => {
          const setCookie = response.headers['set-cookie']?.[0]
          const separator = setCookie?.indexOf(';') ?? -1
          if (response.statusCode !== 303 || setCookie === undefined || separator < 1) {
            reject(new GatewayRequestError(502, 'tenant authentication exchange failed'))
            return
          }
          resolve(setCookie.slice(0, separator))
        })
      })
      upstream.once('error', (error) => { reject(new GatewayRequestError(502, 'tenant authentication exchange failed', { cause: error })) })
      upstream.end()
    })
    cookieCache.set(key, exchange)
    void exchange.catch(() => { if (cookieCache.get(key) === exchange) cookieCache.delete(key) })
    return exchange
  }

  server = createServer((request, response) => {
    void (async () => {
      assertOpen()
      const authority = oneHeader(request.headers, 'host')
      if (!validAuthority(authority)) throw new GatewayRequestError(400, 'request Host header is invalid')
      const requestUrl = new URL(request.url ?? '/', `http://${authority}`)
      if (requestUrl.pathname === '/internal/tenants/provision') {
        if (request.method !== 'POST') throw new GatewayRequestError(400, 'tenant provisioning only accepts POST')
        if (resolved.tenantProvisionSecret === undefined || resolved.provisionTenant === undefined) {
          throw new GatewayRequestError(503, 'tenant provisioning is not configured')
        }
        if (!secretMatches(oneHeader(request.headers, 'x-dsh-tenant-provision-secret'), resolved.tenantProvisionSecret)) {
          throw new GatewayRequestError(401, 'tenant provisioning authentication required')
        }
        const body = await readJsonBody(request)
        const externalUserId = typeof body.externalUserId === 'string' ? body.externalUserId.trim() : ''
        const tenantId = typeof body.tenantId === 'string' ? body.tenantId.trim() || undefined : undefined
        if (externalUserId === '') throw new GatewayRequestError(400, 'externalUserId is required')
        const provisioned = await provisionTenant(externalUserId, tenantId)
        const tenant = provisioned.tenant
        response.writeHead(200, {
          'cache-control': 'no-store',
          'content-type': 'application/json; charset=utf-8',
        })
        response.end(`${JSON.stringify({
          result: true,
          msg: 'tenant provisioned',
          content: {
            created: provisioned.created,
            tenantId: tenant.tenantId,
            externalUserId: tenant.externalUserId,
            dshPort: tenant.port,
            workspacePath: tenant.workspace,
            dshHomePath: tenant.dshHome,
            accessPath: `/${tenant.externalUserId}`,
          },
        })}\n`)
        return
      }
      if (requestUrl.pathname === '/entry' && requestUrl.searchParams.has('ticket')) {
        if (request.method !== 'GET') throw new GatewayRequestError(400, 'ticket entry only accepts GET')
        const ticket = requestUrl.searchParams.get('ticket')?.trim()
        if (ticket === undefined || ticket === '') throw new GatewayRequestError(400, 'jump ticket is required')
        const resolvedTicket = await consumeTicket(ticket)
        const requestedAccessPath = resolvedTicket.accessPath.trim() || '/'
        const legacyAccessPath = `/${resolvedTicket.externalUserId}`
        const accessPath = requestedAccessPath === legacyAccessPath ? '/' : requestedAccessPath
        if (!accessPath.startsWith('/') || accessPath.startsWith('//')) {
          throw new GatewayRequestError(502, 'XTEST 票据返回的访问路径无效；请联系管理员修正 DSH 绑定的访问路径')
        }
        if (!tenants.has(resolvedTicket.externalUserId)) {
          await provisionTenant(resolvedTicket.externalUserId, resolvedTicket.tenantId)
        }
        assertOpen()
        const sessionId = newSessionId()
        sessions.set(sessionId, {
          externalUserId: resolvedTicket.externalUserId,
          expiresAt: Date.now() + resolved.sessionTtlMs,
        })
        response.writeHead(303, {
          'cache-control': 'no-store',
          'location': accessPath,
          'set-cookie': `${resolved.sessionCookieName}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax`,
        })
        response.end()
        return
      }
      const identity = identify(request)
      const assigned = tenants.get(identity.externalUserId)
      if (assigned === undefined) throw new GatewayRequestError(403, 'external user is not assigned a tenant')
      const release = reclaimer.acquire(assigned.tenantId)
      response.once('close', release)
      const tenant = await route(identity.externalUserId)
      const cookie = await exchangeCookie(tenant, identity.authority)
      if (request.destroyed) return
      const upstream = httpRequest({
        host: '127.0.0.1',
        port: tenant.port,
        method: request.method,
        path: request.url ?? '/',
        headers: requestHeaders(request.headers, identity.authority, cookie, resolved),
        agent: false,
      }, (result) => {
        response.writeHead(result.statusCode ?? 502, responseHeaders(result.headers))
        result.pipe(response)
      })
      upstream.on('socket', track)
      upstream.once('error', (error) => { writeError(response, error) })
      response.once('close', () => { upstream.destroy() })
      request.pipe(upstream)
    })().catch((error: unknown) => { writeError(response, error) })
  })

  server.on('upgrade', (request, socket, head) => {
    void (async () => {
      assertOpen()
      const identity = identify(request)
      const assigned = tenants.get(identity.externalUserId)
      if (assigned === undefined) throw new GatewayRequestError(403, 'external user is not assigned a tenant')
      const release = reclaimer.acquire(assigned.tenantId)
      socket.once('end', release)
      socket.once('close', release)
      const tenant = await route(identity.externalUserId)
      const cookie = await exchangeCookie(tenant, identity.authority)
      if (socket.destroyed) return
      const upstream = netConnect(tenant.port, '127.0.0.1')
      track(upstream)
      upstream.once('connect', () => {
        upstream.write(`${request.method ?? 'GET'} ${request.url ?? '/'} HTTP/1.1\r\n`)
        for (let index = 0; index < request.rawHeaders.length; index += 2) {
          const name = request.rawHeaders[index]
          const value = request.rawHeaders[index + 1]
          if (name === undefined || value === undefined) continue
          const normalized = name.toLowerCase()
          if ([resolved.identityHeader, resolved.proxySecretHeader, 'cookie'].includes(normalized)) continue
          upstream.write(`${name}: ${value}\r\n`)
        }
        upstream.write(`Cookie: ${cookie}\r\n\r\n`)
        if (head.length > 0) upstream.write(head)
        socket.pipe(upstream).pipe(socket)
      })
      upstream.once('error', () => { socket.destroy() })
      socket.once('error', () => { upstream.destroy() })
      socket.once('end', () => { upstream.destroy() })
      upstream.once('close', () => { socket.destroy() })
      socket.once('close', () => { upstream.destroy() })
    })().catch((error: unknown) => {
      const failure = error instanceof GatewayRequestError ? error : new GatewayRequestError(502, 'tenant upstream upgrade failed')
      writeUpgradeError(socket, failure.status, failure.message)
    })
  })
  server.on('connection', track)

  const listenAt = (host: string, port: number): Promise<number> => new Promise((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off('listening', onListening)
      reject(error)
    }
    const onListening = (): void => {
      server.off('error', onError)
      const address = server.address()
      if (address === null || typeof address === 'string') {
        reject(new Error('gateway listener did not bind a TCP address'))
        return
      }
      resolve(address.port)
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, host)
  })

  const unlisten = async (): Promise<void> => {
    const closed = new Promise<void>(resolve => { server.close(() => resolve()) })
    server.closeAllConnections()
    for (const socket of sockets) socket.destroy()
    await closed
  }

  const rebind = async (next: GatewayControlSettings): Promise<void> => {
    const previous = { ...currentSettings }
    await unlisten()
    try {
      activePort = await listenAt(next.host, next.port)
      activeHost = next.host
    } catch (error) {
      try {
        activePort = await listenAt(previous.host, previous.port)
        activeHost = previous.host
      } catch (restoreError) {
        throw new AggregateError([error, restoreError], 'gateway listener failed to bind and restore its previous address')
      }
      throw error
    }
  }

  const restartListener = (): Promise<void> => {
    const operation = listenerOperation.then(async () => {
      if (closing !== undefined) throw new GatewayRequestError(503, 'gateway is shutting down')
      await rebind(currentSettings)
    })
    listenerOperation = operation.then(() => {}, () => {})
    return operation
  }

  try {
    activePort = await listenAt(resolved.host, resolved.port)
    if (currentSettings.port === 0) currentSettings = { ...currentSettings, port: activePort }
    if (options.adminSecret !== undefined) {
      const adminHost = options.adminHost ?? '127.0.0.1'
      const adminPort = options.adminPort ?? 3001
      if (adminHost === activeHost && adminPort === activePort) {
        throw new TypeError('management listener must not conflict with the gateway listener')
      }
      adminServer = await startGatewayAdminServer({
        host: adminHost,
        port: adminPort,
        secret: options.adminSecret,
        getSettings: () => currentSettings,
        async updateSettings(next) {
          if (closing !== undefined) throw new GatewayRequestError(503, 'gateway is shutting down')
          if (next.host === adminHost && next.port === adminPort) throw new TypeError('gateway listener must not conflict with the management listener')
          const operation = listenerOperation.then(async () => {
            const previous = currentSettings
            await options.persistAdminSettings?.(next)
            try {
              await rebind(next)
              currentSettings = next
            } catch (error) {
              await options.persistAdminSettings?.(previous)
              throw error
            }
          })
          listenerOperation = operation.then(() => {}, () => {})
          await operation
        },
        restart: restartListener,
      })
    }
  } catch (error) {
    await adminServer?.close()
    if (server.listening) await unlisten()
    await reclaimer.dispose()
    await manager.dispose()
    throw error
  }
  return {
    get host() { return activeHost },
    get port() { return activePort },
    get adminHost() { return adminServer?.host },
    get adminPort() { return adminServer?.port },
    restartListener,
    close() {
      closing ??= (async () => {
        await adminServer?.close()
        const reclamationStopped = reclaimer.dispose()
        if (server.listening) await unlisten()
        await reclamationStopped
        await provisioning
        await manager.dispose()
      })()
      return closing
    },
  }
}
