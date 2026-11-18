import { timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'

/** Runtime values exposed through the private Gateway management API. */
export interface GatewayControlSettings {
  readonly host: string
  readonly port: number
  readonly tenantPortMin: number
  readonly tenantPortMax: number
}

/** Private HTTP listener for authenticated Gateway configuration and listener restarts. */
export interface GatewayAdminOptions {
  readonly host: string
  readonly port: number
  readonly secret: string
  readonly getSettings: () => GatewayControlSettings
  readonly updateSettings: (settings: GatewayControlSettings) => Promise<void>
  readonly restart: () => Promise<void>
}

/** Running private management listener. */
export interface GatewayAdminServer {
  readonly host: string
  readonly port: number
  close(): Promise<void>
}

function matchesSecret(actual: string | undefined, expected: Buffer): boolean {
  if (actual === undefined) return false
  const received = Buffer.from(actual)
  return received.length === expected.length && timingSafeEqual(received, expected)
}

function validPort(value: unknown, name: string, minimum = 1): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > 65_535) {
    throw new TypeError(`${name} must be an integer from ${minimum} through 65535`)
  }
  return value
}

function parseSettingsUpdate(value: unknown, current: GatewayControlSettings): GatewayControlSettings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError('body must be a JSON object')
  const record = value as Record<string, unknown>
  const allowed = new Set(['host', 'port', 'tenantPortMin', 'tenantPortMax'])
  for (const key of Object.keys(record)) if (!allowed.has(key)) throw new TypeError(`unknown field ${JSON.stringify(key)}`)
  const host = record.host === undefined ? current.host
    : typeof record.host === 'string' && record.host.trim() !== '' ? record.host.trim()
      : (() => { throw new TypeError('host must be a non-empty string') })()
  const port = record.port === undefined ? current.port : validPort(record.port, 'port')
  const tenantPortMin = record.tenantPortMin === undefined ? current.tenantPortMin : validPort(record.tenantPortMin, 'tenantPortMin', 1024)
  const tenantPortMax = record.tenantPortMax === undefined ? current.tenantPortMax : validPort(record.tenantPortMax, 'tenantPortMax', 1024)
  if (tenantPortMin > tenantPortMax) throw new TypeError('tenantPortMin must not exceed tenantPortMax')
  return { host, port, tenantPortMin, tenantPortMax }
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request as AsyncIterable<Buffer>) {
    size += chunk.length
    if (size > 8 * 1024) throw new TypeError('request body is too large')
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } catch (error) {
    throw new TypeError('request body must be valid JSON', { cause: error })
  }
}

function respond(response: ServerResponse, status: number, payload: object): void {
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
  })
  response.end(`${JSON.stringify(payload)}\n`)
}

/**
 * Start a separate private HTTP listener for remote Gateway administration.
 * @param options - Management listener, shared secret, and configuration callbacks.
 * @returns the listener address and an asynchronous close operation.
 * @throws when the management secret is shorter than 32 UTF-8 bytes or the listener cannot bind.
 */
export async function startGatewayAdminServer(options: GatewayAdminOptions): Promise<GatewayAdminServer> {
  const secret = Buffer.from(options.secret)
  if (secret.length < 32) throw new TypeError('admin secret must contain at least 32 UTF-8 bytes')
  const server: Server = createServer((request, response) => {
    void (async () => {
      const suppliedSecret = request.headers['x-dsh-gateway-admin-secret']
      if (Array.isArray(suppliedSecret) || !matchesSecret(suppliedSecret, secret)) {
        respond(response, 401, { error: 'management authentication required' })
        return
      }
      const path = new URL(request.url ?? '/', 'http://localhost').pathname
      if (path === '/internal/admin/config' && request.method === 'GET') {
        respond(response, 200, { config: options.getSettings() })
        return
      }
      if (path === '/internal/admin/config' && request.method === 'PUT') {
        const next = parseSettingsUpdate(await readBody(request), options.getSettings())
        await options.updateSettings(next)
        respond(response, 200, { result: true, config: options.getSettings(), listenerRestarted: true })
        return
      }
      if (path === '/internal/admin/restart' && request.method === 'POST') {
        await options.restart()
        respond(response, 200, { result: true, listenerRestarted: true })
        return
      }
      respond(response, 404, { error: 'management route not found' })
    })().catch((error: unknown) => {
      if (response.headersSent) {
        response.destroy(error instanceof Error ? error : new Error(String(error)))
        return
      }
      const status = error instanceof TypeError ? 400 : 503
      respond(response, status, { error: error instanceof Error ? error.message : 'management operation failed' })
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port, options.host, () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address()
  if (address === null || typeof address === 'string') {
    await new Promise<void>(resolve => server.close(() => resolve()))
    throw new Error('management listener did not bind a TCP address')
  }
  return {
    host: options.host,
    port: address.port,
    close: () => new Promise<void>((resolve, reject) => {
      server.close(error => error === undefined ? resolve() : reject(error))
      server.closeAllConnections()
    }),
  }
}
