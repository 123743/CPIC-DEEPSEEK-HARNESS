import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http'
import { connect as netConnect, type AddressInfo, type Socket } from 'node:net'
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'
import {
  startStaticTenantGateway,
  type GatewayInstanceManager,
  type StaticTenantGateway,
  type StaticTenantGatewayOptions,
} from './gateway.ts'
import type { TenantInstanceReady } from './instance-manager.ts'
import { loadStaticTenantConfig, provisionStaticTenant, TenantProvisionError, type StaticTenant, type StaticTenantConfig } from './tenant-config.ts'
import { temporaryRoot, removeTemporaryRoots } from './temporary-directory.fixture.ts'

const SECRET = 'gateway-test-secret-at-least-32-bytes-long'

interface Backend {
  readonly port: number
  readonly requests: IncomingMessage[]
  readonly exchanges: IncomingMessage[]
  readonly upgrades: IncomingMessage[]
  finishHeldEvents(): void
  close(): Promise<void>
}

interface ResponseResult {
  readonly status: number
  readonly headers: IncomingMessage['headers']
  readonly body: string
}

const cleanups: (() => Promise<void>)[] = []

afterEach(async () => {
  vi.useRealTimers()
  await Promise.allSettled(cleanups.splice(0).reverse().map(cleanup => cleanup()))
  removeTemporaryRoots()
})

async function backend(name: string): Promise<Backend> {
  const requests: IncomingMessage[] = []
  const exchanges: IncomingMessage[] = []
  const upgrades: IncomingMessage[] = []
  let heldEvents: ServerResponse | undefined
  const sockets = new Set<Socket>()
  const server = createServer((request, response) => {
    if (request.url === `/?token=${name}-token`) {
      exchanges.push(request)
      response.writeHead(303, { location: './', 'set-cookie': [`dsh=${name}-cookie; Path=/; HttpOnly`] })
      response.end()
      return
    }
    requests.push(request)
    if (request.headers.cookie !== `dsh=${name}-cookie`) {
      response.writeHead(401)
      response.end('backend authentication required')
      return
    }
    if (request.url === '/held-events') {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.write(`data: ${name}-held\n\n`)
      heldEvents = response
      response.once('close', () => { if (heldEvents === response) heldEvents = undefined })
      return
    }
    if (request.url === '/events') {
      response.writeHead(200, { 'content-type': 'text/event-stream', 'set-cookie': 'must-not-leak=yes' })
      response.write(`data: ${name}-first\n\n`)
      setTimeout(() => { response.end(`data: ${name}-second\n\n`) }, 20)
      return
    }
    request.setEncoding('utf8')
    let body = ''
    request.on('data', (chunk: string) => { body += chunk })
    request.on('end', () => {
      response.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'must-not-leak=yes' })
      response.end(JSON.stringify({
        name,
        method: request.method,
        url: request.url,
        body,
        host: request.headers.host,
        cookie: request.headers.cookie,
        identity: request.headers['x-auth-request-user'],
        proxySecret: request.headers['x-dsh-proxy-secret'],
      }))
    })
  })
  server.on('upgrade', (request, socket, head) => {
    upgrades.push(request)
    if (request.headers.cookie !== `dsh=${name}-cookie`) {
      socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
      return
    }
    socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: test\r\n\r\n')
    if (head.length > 0) socket.write(head)
    socket.on('data', (chunk) => { socket.write(chunk) })
  })
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.once('close', () => { sockets.delete(socket) })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const port = (server.address() as AddressInfo).port
  const close = async (): Promise<void> => {
    const closed = new Promise<void>((resolve) => { server.close(() => { resolve() }) })
    for (const socket of sockets) socket.destroy()
    await closed
  }
  cleanups.push(close)
  return {
    port,
    requests,
    exchanges,
    upgrades,
    finishHeldEvents() {
      if (heldEvents === undefined) throw new Error('no held SSE response')
      heldEvents.end(`data: ${name}-released\n\n`)
    },
    close,
  }
}

function tenant(name: string, port: number): StaticTenant {
  return {
    tenantId: `tenant-${name}`,
    externalUserId: name,
    port,
    dshHome: `C:\\tenants\\${name}\\home`,
    workspace: `C:\\tenants\\${name}\\workspace`,
  }
}

interface FakeManager {
  readonly api: GatewayInstanceManager
  readonly ensure: Mock<(tenantId: string) => Promise<TenantInstanceReady>>
  readonly stop: Mock<(tenantId: string) => Promise<void>>
  readonly dispose: Mock<() => Promise<void>>
}

function manager(config: StaticTenantConfig): FakeManager {
  const byId = new Map(config.tenants.map(item => [item.tenantId, item] as const))
  const ensure = vi.fn(async (tenantId: string): Promise<TenantInstanceReady> => {
    const item = byId.get(tenantId)
    if (item === undefined) throw new Error('unknown fixture tenant')
    return {
      instance: {
        tenantId: item.tenantId,
        externalUserId: item.externalUserId,
        port: item.port,
        state: 'running',
        generation: 1,
        pid: 100 + item.port,
      },
      authenticatedUrl: `http://127.0.0.1:${item.port}/?token=${item.externalUserId}-token`,
    }
  })
  const stop = vi.fn(async (_tenantId: string) => {})
  const dispose = vi.fn(async () => {})
  return {
    api: { ensureInstanceRunning: ensure, stopInstance: stop, dispose },
    ensure,
    stop,
    dispose,
  }
}

async function gatewayFor(
  config: StaticTenantConfig,
  instanceManager: GatewayInstanceManager,
  options: Partial<StaticTenantGatewayOptions> = {},
): Promise<StaticTenantGateway> {
  const gateway = await startStaticTenantGateway(config, instanceManager, {
    host: '127.0.0.1',
    port: 0,
    proxySecret: SECRET,
    ...options,
  })
  cleanups.push(() => gateway.close())
  return gateway
}

function request(
  gateway: StaticTenantGateway,
  path: string,
  headers: Record<string, string> = {},
  method = 'GET',
  body?: string,
): Promise<ResponseResult> {
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest({ host: gateway.host, port: gateway.port, path, method, headers }, (response) => {
      response.setEncoding('utf8')
      let responseBody = ''
      response.on('data', (chunk: string) => { responseBody += chunk })
      response.on('end', () => {
        resolve({ status: response.statusCode ?? 0, headers: response.headers, body: responseBody })
      })
    })
    outgoing.once('error', reject)
    if (body !== undefined) outgoing.write(body)
    outgoing.end()
  })
}

async function ticketResolverResponse(status: number, body: string, contentType: string): Promise<string> {
  const server = createServer((incoming, response) => {
    if (incoming.headers['x-dsh-gateway-secret'] !== SECRET) {
      response.writeHead(401)
      response.end('{}')
      return
    }
    incoming.resume()
    incoming.once('end', () => {
      response.writeHead(status, { 'content-type': contentType })
      response.end(body)
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  cleanups.push(async () => {
    const closed = new Promise<void>((resolve) => { server.close(() => { resolve() }) })
    server.closeAllConnections()
    await closed
  })
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/consume`
}

async function ticketResolver(payload: (ticket: string) => object): Promise<string> {
  const server = createServer((incoming, response) => {
    if (incoming.headers['x-dsh-gateway-secret'] !== SECRET) {
      response.writeHead(401)
      response.end('{}')
      return
    }
    let responseBody = ''
    incoming.setEncoding('utf8')
    incoming.on('data', (chunk: string) => { responseBody += chunk })
    incoming.on('end', () => {
      const parsed = JSON.parse(responseBody) as { ticket: string }
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify(payload(parsed.ticket)))
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  cleanups.push(async () => {
    const closed = new Promise<void>((resolve) => { server.close(() => { resolve() }) })
    server.closeAllConnections()
    await closed
  })
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/consume`
}

function adminRequest(
  gateway: StaticTenantGateway,
  path: string,
  secret: string | undefined,
  method = 'GET',
  body?: string,
): Promise<ResponseResult> {
  if (gateway.adminHost === undefined || gateway.adminPort === undefined) throw new Error('gateway admin listener is disabled')
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest({
      host: gateway.adminHost,
      port: gateway.adminPort,
      path,
      method,
      headers: {
        ...(secret === undefined ? {} : { 'x-dsh-gateway-admin-secret': secret }),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
    }, (response) => {
      response.setEncoding('utf8')
      let responseBody = ''
      response.on('data', (chunk: string) => { responseBody += chunk })
      response.on('end', () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body: responseBody }))
    })
    outgoing.once('error', reject)
    if (body !== undefined) outgoing.write(body)
    outgoing.end()
  })
}

function trusted(user: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    'x-auth-request-user': user,
    'x-dsh-proxy-secret': SECRET,
    ...extra,
  }
}

function upgrade(gateway: StaticTenantGateway, user: string): Promise<{ response: string; socket: Socket }> {
  return new Promise((resolve, reject) => {
    const socket = netConnect(gateway.port, gateway.host)
    socket.once('error', reject)
    socket.once('connect', () => {
      socket.write([
        'GET /socket HTTP/1.1',
        `Host: ${gateway.host}:${gateway.port}`,
        'Connection: Upgrade',
        'Upgrade: test',
        `X-Auth-Request-User: ${user}`,
        `X-DSH-Proxy-Secret: ${SECRET}`,
        'Cookie: external=session',
        '', '',
      ].join('\r\n'))
    })
    let response = ''
    const onData = (chunk: Buffer): void => {
      response += chunk.toString()
      if (!response.includes('\r\n\r\n')) return
      socket.off('data', onData)
      resolve({ response, socket })
    }
    socket.on('data', onData)
  })
}

describe('startStaticTenantGateway', () => {
  it('persists a missing tenant after ticket validation and routes the new session', async () => {
    const upstream = await backend('new-user')
    const root = temporaryRoot()
    const file = join(root, 'tenants.json')
    const config = { version: 1, tenants: [] } as const
    writeFileSync(file, JSON.stringify(config))
    const assigned = tenant('new-user', upstream.port)
    const instanceManager = manager({ version: 1, tenants: [assigned] })
    const provision = vi.fn(async (user: string, tenantId: string | undefined) =>
      provisionStaticTenant(file, user, tenantId, root, upstream.port, upstream.port))
    const resolverUrl = await ticketResolver(() => ({
      result: true, content: { externalUserId: 'new-user', tenantId: assigned.tenantId, accessPath: '/new-user' },
    }))
    const gateway = await gatewayFor(config, instanceManager.api, {
      ticketResolverUrl: resolverUrl, ticketResolverSecret: SECRET, tenantProvisionSecret: SECRET, provisionTenant: provision,
    })

    const entry = await request(gateway, '/entry?ticket=valid')
    expect(entry.status).toBe(303)
    expect(entry.headers.location).toBe('/')
    expect(provision).toHaveBeenCalledWith('new-user', assigned.tenantId, { min: 3081, max: 3999 })
    const persisted = await loadStaticTenantConfig(file)
    expect(persisted.tenants).toHaveLength(1)
    expect(persisted.tenants[0]).toMatchObject({ externalUserId: 'new-user', tenantId: assigned.tenantId, port: upstream.port })
    expect(existsSync(persisted.tenants[0]!.workspace)).toBe(true)
    const cookie = entry.headers['set-cookie']![0]!.split(';')[0]!
    await expect(request(gateway, '/', { cookie })).resolves.toMatchObject({ status: 200 })
    await request(gateway, '/entry?ticket=second-valid')
    expect(provision).toHaveBeenCalledOnce()
  })

  it('serializes ticket recovery and the provisioning endpoint without losing either user', async () => {
    const root = temporaryRoot()
    const file = join(root, 'tenants.json')
    const config = { version: 1, tenants: [] } as const
    writeFileSync(file, JSON.stringify(config))
    const started = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    cleanups.push(async () => { release.resolve(undefined) })
    let calls = 0
    const provision = vi.fn(async (user: string, tenantId: string | undefined) => {
      if (++calls === 1) {
        started.resolve(undefined)
        await release.promise
      }
      return provisionStaticTenant(file, user, tenantId, root, 40000, 40010)
    })
    const resolverUrl = await ticketResolver(() => ({ result: true, content: { externalUserId: 'user1' } }))
    const gateway = await gatewayFor(config, manager(config).api, {
      ticketResolverUrl: resolverUrl, ticketResolverSecret: SECRET, tenantProvisionSecret: SECRET, provisionTenant: provision,
    })
    const entry = request(gateway, '/entry?ticket=valid')
    await started.promise
    const provisioned = request(gateway, '/internal/tenants/provision', {
      'x-dsh-tenant-provision-secret': SECRET, 'content-type': 'application/json',
    }, 'POST', JSON.stringify({ externalUserId: 'user2' }))
    release.resolve(undefined)
    expect((await entry).status).toBe(303)
    expect((await provisioned).status).toBe(200)
    const saved = await loadStaticTenantConfig(file)
    expect(saved.tenants.map(item => item.externalUserId)).toEqual(['user1', 'user2'])
    expect(new Set(saved.tenants.map(item => item.port)).size).toBe(2)
  })

  it.each([
    { result: false, msg: '跳转票据无效、已过期或已使用' },
    { result: true, content: { externalUserId: '', accessPath: '/' } },
    { result: true, content: { externalUserId: 'new-user', accessPath: '//outside.example' } },
  ])('does not write tenant configuration for a rejected ticket response: %j', async (payload) => {
    const root = temporaryRoot()
    const file = join(root, 'tenants.json')
    const config = { version: 1, tenants: [] } as const
    const original = `${JSON.stringify(config)}\n`
    writeFileSync(file, original)
    const provision = vi.fn(async (user: string, tenantId: string | undefined) =>
      provisionStaticTenant(file, user, tenantId, root, 40000, 40010))
    const resolverUrl = await ticketResolver(() => payload)
    const gateway = await gatewayFor(config, manager(config).api, {
      ticketResolverUrl: resolverUrl, ticketResolverSecret: SECRET, tenantProvisionSecret: SECRET, provisionTenant: provision,
    })
    const result = await request(gateway, '/entry?ticket=rejected')
    expect(result.status).toBe(payload.result ? 502 : 401)
    expect(result.headers['set-cookie']).toBeUndefined()
    expect(provision).not.toHaveBeenCalled()
    expect(readFileSync(file, 'utf8')).toBe(original)
  })

  it('reports a non-JSON ticket resolver failure by HTTP status', async () => {
    const config = { version: 1, tenants: [] } as const
    const resolverUrl = await ticketResolverResponse(502, '<html>upstream unavailable</html>', 'text/html')
    const gateway = await gatewayFor(config, manager(config).api, {
      ticketResolverUrl: resolverUrl, ticketResolverSecret: SECRET,
    })

    const result = await request(gateway, '/entry?ticket=valid')
    expect(result.status).toBe(502)
    expect(result.body).toContain('XTEST 票据验证接口返回 HTTP 502')
    expect(result.body).not.toContain('无效 JSON')
    expect(result.headers['set-cookie']).toBeUndefined()
  })

  it('explains missing provisioning configuration without issuing a session', async () => {
    const config = { version: 1, tenants: [] } as const
    const resolverUrl = await ticketResolver(() => ({ result: true, content: { externalUserId: 'new-user' } }))
    const gateway = await gatewayFor(config, manager(config).api, {
      ticketResolverUrl: resolverUrl, ticketResolverSecret: SECRET,
    })
    const result = await request(gateway, '/entry?ticket=valid')
    expect(result.status).toBe(503)
    expect(result.body).toContain('Gateway 未启用自动创建')
    expect(result.headers['set-cookie']).toBeUndefined()
  })

  it('explains port exhaustion and allows another entry after the provisioning failure', async () => {
    const config = { version: 1, tenants: [] } as const
    const provision = vi.fn<NonNullable<StaticTenantGatewayOptions['provisionTenant']>>()
      .mockRejectedValueOnce(new TenantProvisionError('no-available-port', 'no free tenant port is available'))
      .mockResolvedValueOnce({ tenant: tenant('new-user', 40000), created: true })
    const resolverUrl = await ticketResolver(() => ({ result: true, content: { externalUserId: 'new-user' } }))
    const gateway = await gatewayFor(config, manager(config).api, {
      ticketResolverUrl: resolverUrl, ticketResolverSecret: SECRET, tenantProvisionSecret: SECRET, provisionTenant: provision,
    })
    const result = await request(gateway, '/entry?ticket=valid')
    expect(result.status).toBe(503)
    expect(result.body).toContain('租户端口已全部分配')
    expect(result.headers['set-cookie']).toBeUndefined()
    expect((await request(gateway, '/entry?ticket=new-valid')).status).toBe(303)
    expect(provision).toHaveBeenCalledTimes(2)
  })

  it.each([
    { error: new TenantProvisionError('invalid-external-user', 'invalid'), reason: '用户标识不能用作租户目录名' },
    { error: new TenantProvisionError('invalid-tenant-id', 'invalid'), reason: '租户编号格式无效' },
    { error: new TenantProvisionError('tenant-id-in-use', 'conflict'), reason: '租户编号已分配给其他用户' },
    { error: Object.assign(new Error('private-path'), { code: 'EACCES' }), reason: '写入权限' },
    { error: Object.assign(new Error('private-path'), { code: 'ENOSPC' }), reason: '磁盘空间不足' },
  ])('reports a specific provisioning cause: $reason', async ({ error, reason }) => {
    const config = { version: 1, tenants: [] } as const
    const provision = vi.fn<NonNullable<StaticTenantGatewayOptions['provisionTenant']>>().mockRejectedValue(error)
    const resolverUrl = await ticketResolver(() => ({ result: true, content: { externalUserId: 'new-user' } }))
    const gateway = await gatewayFor(config, manager(config).api, {
      ticketResolverUrl: resolverUrl, ticketResolverSecret: SECRET, tenantProvisionSecret: SECRET, provisionTenant: provision,
    })
    const result = await request(gateway, '/entry?ticket=valid')
    expect(result.status).toBe(503)
    expect(result.body).toContain(reason)
    expect(result.body).not.toContain('private-path')
    expect(result.headers['set-cookie']).toBeUndefined()
  })

  it('waits for tenant registration before disposing the instance manager', async () => {
    const config = { version: 1, tenants: [] } as const
    const started = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    cleanups.push(async () => { release.resolve(undefined) })
    const provision = vi.fn(async () => {
      started.resolve(undefined)
      await release.promise
      return { tenant: tenant('new-user', 40000), created: true }
    })
    const resolverUrl = await ticketResolver(() => ({ result: true, content: { externalUserId: 'new-user' } }))
    const instanceManager = manager(config)
    const gateway = await gatewayFor(config, instanceManager.api, {
      ticketResolverUrl: resolverUrl, ticketResolverSecret: SECRET, tenantProvisionSecret: SECRET, provisionTenant: provision,
    })
    const entry = request(gateway, '/entry?ticket=valid').catch(() => undefined)
    await started.promise
    const closing = gateway.close()
    expect(instanceManager.dispose).not.toHaveBeenCalled()
    release.resolve(undefined)
    await closing
    await entry
    expect(instanceManager.dispose).toHaveBeenCalledOnce()
  })

  it('rejects untrusted and unassigned requests before starting an instance', async () => {
    const upstream = await backend('user1')
    const config = { version: 1, tenants: [tenant('user1', upstream.port)] } as const
    const instanceManager = manager(config)
    const gateway = await gatewayFor(config, instanceManager.api)

    await expect(request(gateway, '/')).resolves.toMatchObject({ status: 401 })
    await expect(request(gateway, '/', { 'x-auth-request-user': 'user1', 'x-dsh-proxy-secret': 'wrong' }))
      .resolves.toMatchObject({ status: 401 })
    await expect(request(gateway, '/', trusted('missing'))).resolves.toMatchObject({ status: 403 })
    expect(instanceManager.ensure).not.toHaveBeenCalled()
  })

  it('isolates tenant routing and keeps both authentication layers out of the opposite side', async () => {
    const user1 = await backend('user1')
    const user2 = await backend('user2')
    const config = { version: 1, tenants: [tenant('user1', user1.port), tenant('user2', user2.port)] } as const
    const instanceManager = manager(config)
    const gateway = await gatewayFor(config, instanceManager.api)
    const authority = `${gateway.host}:${gateway.port}`

    const [first, second] = await Promise.all([
      request(gateway, '/api?tenant=one', trusted('user1', { cookie: 'external=user1' }), 'POST', 'sk-12345678901234567890'),
      request(gateway, '/api?tenant=two', trusted('user2', { cookie: 'external=user2' }), 'POST', 'second-body'),
    ])
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(JSON.parse(first.body)).toEqual({
      name: 'user1', method: 'POST', url: '/api?tenant=one', body: 'sk-12345678901234567890', host: authority,
      cookie: 'dsh=user1-cookie',
    })
    expect(JSON.parse(second.body)).toEqual({
      name: 'user2', method: 'POST', url: '/api?tenant=two', body: 'second-body', host: authority,
      cookie: 'dsh=user2-cookie',
    })
    expect(first.headers['set-cookie']).toBeUndefined()
    expect(second.headers['set-cookie']).toBeUndefined()
    expect(user1.exchanges).toHaveLength(1)
    expect(user2.exchanges).toHaveLength(1)
  })

  it('coalesces the private cookie exchange and streams SSE chunks without buffering', async () => {
    const upstream = await backend('user1')
    const config = { version: 1, tenants: [tenant('user1', upstream.port)] } as const
    const instanceManager = manager(config)
    const gateway = await gatewayFor(config, instanceManager.api)

    const warmed = await Promise.all([
      request(gateway, '/warm-one', trusted('user1')),
      request(gateway, '/warm-two', trusted('user1')),
    ])
    expect(warmed.map(result => result.status)).toEqual([200, 200])
    expect(upstream.exchanges).toHaveLength(1)

    const firstChunk = Promise.withResolvers<string>()
    const complete = new Promise<string>((resolve, reject) => {
      const outgoing = httpRequest({
        host: gateway.host,
        port: gateway.port,
        path: '/events',
        headers: trusted('user1'),
      }, (response) => {
        response.setEncoding('utf8')
        let body = ''
        response.on('data', (chunk: string) => {
          body += chunk
          firstChunk.resolve(chunk)
        })
        response.on('end', () => { resolve(body) })
      })
      outgoing.once('error', reject)
      outgoing.end()
    })
    await expect(firstChunk.promise).resolves.toBe('data: user1-first\n\n')
    await expect(complete).resolves.toBe('data: user1-first\n\ndata: user1-second\n\n')
    expect(upstream.exchanges).toHaveLength(1)
  })

  it('authenticates an upgrade privately and tunnels bytes in both directions', async () => {
    const upstream = await backend('user1')
    const config = { version: 1, tenants: [tenant('user1', upstream.port)] } as const
    const instanceManager = manager(config)
    const gateway = await gatewayFor(config, instanceManager.api)

    const upgraded = await upgrade(gateway, 'user1')
    expect(upgraded.response).toContain('101 Switching Protocols')
    expect(upstream.upgrades).toHaveLength(1)
    expect(upstream.upgrades[0]!.headers).toMatchObject({ cookie: 'dsh=user1-cookie' })
    expect(upstream.upgrades[0]!.headers['x-auth-request-user']).toBeUndefined()
    expect(upstream.upgrades[0]!.headers['x-dsh-proxy-secret']).toBeUndefined()
    const echoed = Promise.withResolvers<string>()
    upgraded.socket.once('data', (chunk) => { echoed.resolve(chunk.toString()) })
    upgraded.socket.write('tunnel-payload')
    await expect(echoed.promise).resolves.toBe('tunnel-payload')
    upgraded.socket.destroy()
  })

  it('closes connections and disposes the process manager exactly once', async () => {
    const upstream = await backend('user1')
    const config = { version: 1, tenants: [tenant('user1', upstream.port)] } as const
    const instanceManager = manager(config)
    const gateway = await gatewayFor(config, instanceManager.api)

    await Promise.all([gateway.close(), gateway.close()])
    expect(instanceManager.dispose).toHaveBeenCalledTimes(1)
    await expect(request(gateway, '/', trusted('user1'))).rejects.toBeInstanceOf(Error)
  })

  it('keeps a tenant alive for an active SSE stream and starts idleness after it closes', async () => {
    const upstream = await backend('user1')
    const config = { version: 1, tenants: [tenant('user1', upstream.port)] } as const
    const instanceManager = manager(config)
    const gateway = await gatewayFor(config, instanceManager.api, { idleTimeoutMs: 100 })
    vi.useFakeTimers()

    const firstChunk = Promise.withResolvers<undefined>()
    const complete = new Promise<void>((resolve, reject) => {
      const outgoing = httpRequest({
        host: gateway.host,
        port: gateway.port,
        path: '/held-events',
        headers: trusted('user1'),
      }, (response) => {
        response.once('data', () => { firstChunk.resolve(undefined) })
        response.once('end', resolve)
        response.resume()
      })
      outgoing.once('error', reject)
      outgoing.end()
    })
    await firstChunk.promise
    await vi.advanceTimersByTimeAsync(200)
    expect(instanceManager.stop).not.toHaveBeenCalled()

    upstream.finishHeldEvents()
    await complete
    await vi.advanceTimersByTimeAsync(100)
    expect(instanceManager.stop).toHaveBeenCalledWith('tenant-user1')
  })

  it('keeps a tenant alive for an upgraded connection and reclaims it after disconnect', async () => {
    const upstream = await backend('user1')
    const config = { version: 1, tenants: [tenant('user1', upstream.port)] } as const
    const instanceManager = manager(config)
    const gateway = await gatewayFor(config, instanceManager.api, { idleTimeoutMs: 20 })
    vi.useFakeTimers()

    const upgraded = await upgrade(gateway, 'user1')
    await vi.advanceTimersByTimeAsync(40)
    expect(instanceManager.stop).not.toHaveBeenCalled()

    vi.useRealTimers()
    upgraded.socket.destroy()
    await vi.waitFor(() => {
      expect(instanceManager.stop).toHaveBeenCalledWith('tenant-user1')
    }, { timeout: 1_000, interval: 10 })
  })

  it('reclaims an HTTP tenant after the configured idle interval and exchanges a fresh Cookie later', async () => {
    const upstream = await backend('user1')
    const config = { version: 1, tenants: [tenant('user1', upstream.port)] } as const
    const instanceManager = manager(config)
    const errors: Error[] = []
    const gateway = await gatewayFor(config, instanceManager.api, {
      idleTimeoutMs: 100,
      onReclaimError: (_tenantId, error) => { errors.push(error) },
    })
    vi.useFakeTimers()

    await expect(request(gateway, '/first', trusted('user1'))).resolves.toMatchObject({ status: 200 })
    await vi.advanceTimersByTimeAsync(99)
    expect(instanceManager.stop).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(instanceManager.stop).toHaveBeenCalledOnce()
    expect(instanceManager.stop).toHaveBeenCalledWith('tenant-user1')

    await expect(request(gateway, '/second', trusted('user1'))).resolves.toMatchObject({ status: 200 })
    expect(upstream.exchanges).toHaveLength(2)
    expect(errors).toEqual([])
  })

  it('reports a reclaim failure and retries after one more complete idle interval', async () => {
    const upstream = await backend('user1')
    const config = { version: 1, tenants: [tenant('user1', upstream.port)] } as const
    const instanceManager = manager(config)
    instanceManager.stop.mockRejectedValueOnce(new Error('stop failed'))
    const errors: [string, string][] = []
    const gateway = await gatewayFor(config, instanceManager.api, {
      idleTimeoutMs: 50,
      onReclaimError: (tenantId, error) => { errors.push([tenantId, error.message]) },
    })
    vi.useFakeTimers()

    await request(gateway, '/', trusted('user1'))
    await vi.advanceTimersByTimeAsync(50)
    expect(errors).toEqual([['tenant-user1', 'stop failed']])
    expect(instanceManager.stop).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(50)
    expect(instanceManager.stop).toHaveBeenCalledTimes(2)
  })

  it('waits for an in-flight reclaim before completing gateway shutdown', async () => {
    const upstream = await backend('user1')
    const config = { version: 1, tenants: [tenant('user1', upstream.port)] } as const
    const instanceManager = manager(config)
    const stopped = Promise.withResolvers<undefined>()
    instanceManager.stop.mockImplementation(async () => stopped.promise)
    const gateway = await gatewayFor(config, instanceManager.api, { idleTimeoutMs: 50 })
    vi.useFakeTimers()

    await request(gateway, '/', trusted('user1'))
    await vi.advanceTimersByTimeAsync(50)
    expect(instanceManager.stop).toHaveBeenCalledOnce()
    const closing = gateway.close()
    let closed = false
    void closing.then(() => { closed = true })
    await Promise.resolve()
    expect(closed).toBe(false)

    stopped.resolve(undefined)
    await closing
    expect(instanceManager.dispose).toHaveBeenCalledOnce()
  })

  it('updates listener and tenant allocation settings through the authenticated admin listener', async () => {
    const upstream = await backend('user1')
    const config = { version: 1, tenants: [tenant('user1', upstream.port)] } as const
    const instanceManager = manager(config)
    const persist = vi.fn(async (_settings: { readonly host: string; readonly port: number; readonly tenantPortMin: number; readonly tenantPortMax: number }) => {})
    const gateway = await gatewayFor(config, instanceManager.api, {
      adminHost: '127.0.0.1',
      adminPort: 0,
      adminSecret: SECRET,
      persistAdminSettings: persist,
    })

    await expect(adminRequest(gateway, '/internal/admin/config', undefined)).resolves.toMatchObject({ status: 401 })
    const initial = await adminRequest(gateway, '/internal/admin/config', SECRET)
    expect(initial.status).toBe(200)
    expect(JSON.parse(initial.body)).toMatchObject({
      config: { host: '127.0.0.1', port: gateway.port, tenantPortMin: 3081, tenantPortMax: 3999 },
    })

    const invalid = await adminRequest(gateway, '/internal/admin/config', SECRET, 'PUT', JSON.stringify({ tenantPortMin: 45000, tenantPortMax: 44000 }))
    expect(invalid.status).toBe(400)
    expect(persist).not.toHaveBeenCalled()

    const updated = await adminRequest(gateway, '/internal/admin/config', SECRET, 'PUT', JSON.stringify({
      tenantPortMin: 41000, tenantPortMax: 41100,
    }))
    expect(updated.status).toBe(200)
    expect(JSON.parse(updated.body)).toMatchObject({
      result: true,
      listenerRestarted: true,
      config: { host: '127.0.0.1', port: gateway.port, tenantPortMin: 41000, tenantPortMax: 41100 },
    })
    expect(persist).toHaveBeenCalledOnce()
    await expect(request(gateway, '/', trusted('user1'))).resolves.toMatchObject({ status: 200 })

    await expect(adminRequest(gateway, '/internal/admin/restart', SECRET, 'POST')).resolves.toMatchObject({ status: 200 })
    await expect(request(gateway, '/', trusted('user1'))).resolves.toMatchObject({ status: 200 })
  })

  it('rejects short secrets and colliding identity headers before listening', async () => {
    const config = { version: 1, tenants: [tenant('user1', 12345)] } as const
    const instanceManager = manager(config)
    await expect(startStaticTenantGateway(config, instanceManager.api, {
      host: '127.0.0.1', port: 0, proxySecret: 'short',
    })).rejects.toThrow('at least 32')
    await expect(startStaticTenantGateway(config, instanceManager.api, {
      host: '127.0.0.1', port: 0, proxySecret: SECRET,
      identityHeader: 'x-user', proxySecretHeader: 'X-User',
    })).rejects.toThrow('must differ')
    await expect(startStaticTenantGateway(config, instanceManager.api, {
      host: '127.0.0.1', port: 0, proxySecret: SECRET, idleTimeoutMs: -1,
    })).rejects.toThrow('idleTimeoutMs')
    await expect(startStaticTenantGateway(config, instanceManager.api, {
      host: '127.0.0.1', port: 0, proxySecret: SECRET,
      ticketResolverUrl: 'ftp://xtest.example/tickets/consume', ticketResolverSecret: SECRET,
    })).rejects.toThrow('ticketResolverUrl must be an HTTP(S) URL')
    expect(instanceManager.dispose).not.toHaveBeenCalled()
  })
})
