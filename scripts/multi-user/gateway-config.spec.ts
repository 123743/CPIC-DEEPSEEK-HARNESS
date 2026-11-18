import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CPIC_API_SECRET_ENVIRONMENT_NAME,
  CPIC_API_URL_ENVIRONMENT_NAME,
  DEFAULT_IDLE_TIMEOUT_MS,
  OPENAI_MODEL_API_KEY_ENVIRONMENT_NAME,
  PROXY_SECRET_ENVIRONMENT_NAME,
  SESSION_COOKIE_NAME_ENVIRONMENT_NAME,
  SESSION_TTL_ENVIRONMENT_NAME,
  TICKET_RESOLVER_SECRET_ENVIRONMENT_NAME,
  TICKET_RESOLVER_URL_ENVIRONMENT_NAME,
  loadGatewayConfig,
  parseGatewayConfig,
  resolveGatewaySettings,
  saveGatewayConfig,
} from './gateway-config.ts'
import { removeTemporaryRoots, temporaryRoot } from './temporary-directory.fixture.ts'

const SECRET = 'gateway-config-secret-at-least-32-bytes-long'
const OTHER_SECRET = 'another-gateway-secret-at-least-32-bytes'

afterEach(removeTemporaryRoots)

function minimalConfig(): { version: number; proxySecret: string; cpicApiUrl: string; cpicApiSecret: string; openAiChatCompletionsUrl: string; openAiModelId: string; host: string; port: number; tenantPortMin: number; tenantPortMax: number; adminHost: string; adminPort: number } {
  return {
    version: 1,
    proxySecret: SECRET,
    cpicApiUrl: 'http://127.0.0.1:8080/xtest/api/dsh/internal/cpic',
    cpicApiSecret: OTHER_SECRET,
    openAiChatCompletionsUrl: 'http://lf24dmbase-ai-sit.life.cpic.com/v1/chat/completions',
    openAiModelId: 'codewis-7b',
    host: '127.0.0.1',
    port: 3000,
    tenantPortMin: 3081,
    tenantPortMax: 3999,
    adminHost: '127.0.0.1',
    adminPort: 3001,
  }
}

describe('gateway settings file', () => {
  it('accepts a file with the required CPIC endpoint settings', () => {
    expect(parseGatewayConfig(minimalConfig())).toEqual(minimalConfig())
  })

  it('keeps every optional field it configures', () => {
    const config = {
      ...minimalConfig(),
      ticketResolverUrl: 'http://127.0.0.1:8080/tickets/consume',
      ticketResolverSecret: OTHER_SECRET,
      sessionCookieName: 'dsh_gateway_session',
      sessionTtlMs: 28_800_000,
      idleTimeoutMs: 900_000,
      adminSecret: OTHER_SECRET,
    }
    expect(parseGatewayConfig(config)).toEqual(config)
  })

  it('rejects a version it cannot read', () => {
    expect(() => parseGatewayConfig({ ...minimalConfig(), version: 2 })).toThrow('configuration.version must be 1')
  })

  it('rejects fields outside the settings schema', () => {
    expect(() => parseGatewayConfig({ ...minimalConfig(), proxysecret: SECRET })).toThrow('configuration has unknown field "proxysecret"')
  })

  it('validates the manually configured model endpoint and id', () => {
    expect(() => parseGatewayConfig({ ...minimalConfig(), openAiChatCompletionsUrl: 'http://model.test/v1/models' }))
      .toThrow('configuration.openAiChatCompletionsUrl must be an HTTP(S) URL ending in /v1/chat/completions')
    expect(() => parseGatewayConfig({ ...minimalConfig(), openAiModelId: '   ' }))
      .toThrow('configuration.openAiModelId must be a non-empty string')
  })

  it('rejects a proxy secret that is missing or below 32 UTF-8 bytes', () => {
    expect(() => parseGatewayConfig({ version: 1 })).toThrow('configuration.proxySecret must be a non-empty string')
    expect(() => parseGatewayConfig({ version: 1, proxySecret: 'REPLACE_WITH_A_RANDOM_SECRET' }))
      .toThrow('configuration.proxySecret must contain at least 32 UTF-8 bytes')
    expect(() => parseGatewayConfig({ version: 1, proxySecret: 'x'.repeat(31) }))
      .toThrow('configuration.proxySecret must contain at least 32 UTF-8 bytes')
  })

  it('accepts HTTP and HTTPS ticket resolver endpoints', () => {
    for (const ticketResolverUrl of [
      'http://127.0.0.1:8080/xtest/api/dsh/internal/jump-tickets/consume',
      'https://xtest.example/xtest/api/dsh/internal/jump-tickets/consume',
    ]) {
      expect(parseGatewayConfig({
        ...minimalConfig(), ticketResolverUrl, ticketResolverSecret: SECRET,
      }).ticketResolverUrl).toBe(ticketResolverUrl)
    }
  })

  it('rejects an invalid ticket resolver endpoint or a missing paired secret', () => {
    expect(() => parseGatewayConfig({ ...minimalConfig(), ticketResolverUrl: 'http://127.0.0.1:8080/tickets/consume' }))
      .toThrow('configuration.ticketResolverUrl and configuration.ticketResolverSecret must be configured together')
    expect(() => parseGatewayConfig({ ...minimalConfig(), ticketResolverSecret: SECRET }))
      .toThrow('configuration.ticketResolverUrl and configuration.ticketResolverSecret must be configured together')
    expect(() => parseGatewayConfig({
      ...minimalConfig(), ticketResolverUrl: 'ftp://xtest.example/tickets/consume', ticketResolverSecret: SECRET,
    })).toThrow('configuration.ticketResolverUrl must be an HTTP(S) URL')
  })

  it('rejects session and reclamation values outside their integer ranges', () => {
    expect(() => parseGatewayConfig({ ...minimalConfig(), sessionTtlMs: 0 }))
      .toThrow('configuration.sessionTtlMs must be a positive safe integer')
    expect(() => parseGatewayConfig({ ...minimalConfig(), sessionTtlMs: 1.5 }))
      .toThrow('configuration.sessionTtlMs must be a positive safe integer')
    expect(() => parseGatewayConfig({ ...minimalConfig(), idleTimeoutMs: -1 }))
      .toThrow('configuration.idleTimeoutMs must be a non-negative safe integer')
    expect(() => parseGatewayConfig({ ...minimalConfig(), idleTimeoutMs: '60000' }))
      .toThrow('configuration.idleTimeoutMs must be a non-negative safe integer')
  })

  it('rejects invalid tenant ranges and conflicting listener ports', () => {
    expect(() => parseGatewayConfig({ ...minimalConfig(), tenantPortMin: 4000, tenantPortMax: 3999 }))
      .toThrow('configuration.tenantPortMin must not exceed configuration.tenantPortMax')
    expect(() => parseGatewayConfig({ ...minimalConfig(), port: 3001, adminPort: 3001 }))
      .toThrow('configuration.adminPort must not conflict with the gateway listener')
    expect(() => parseGatewayConfig({ ...minimalConfig(), adminSecret: 'short' }))
      .toThrow('configuration.adminSecret must contain at least 32 UTF-8 bytes')
  })

  it('reads a settings file from disk', async () => {
    const root = temporaryRoot()
    const file = join(root, 'gateway.json')
    writeFileSync(file, `${JSON.stringify(minimalConfig())}\n`, 'utf8')

    await expect(loadGatewayConfig(file)).resolves.toEqual(minimalConfig())
  })

  it('persists an updated configuration that can be loaded again', async () => {
    const root = temporaryRoot()
    const file = join(root, 'gateway.json')
    const updated = parseGatewayConfig({ ...minimalConfig(), host: '0.0.0.0', port: 3100, tenantPortMin: 4100, tenantPortMax: 4200 })

    await saveGatewayConfig(file, updated)

    await expect(loadGatewayConfig(file)).resolves.toEqual(updated)
  })

  it('reads a settings file saved with a UTF-8 byte-order mark', async () => {
    const root = temporaryRoot()
    const file = join(root, 'gateway.json')
    writeFileSync(file, `\uFEFF${JSON.stringify(minimalConfig())}\n`, 'utf8')

    await expect(loadGatewayConfig(file)).resolves.toEqual(minimalConfig())
  })

  it('reports the resolved path for an unreadable, malformed, or invalid file', async () => {
    const root = temporaryRoot()
    const invalidFile = join(root, 'invalid.json')
    const malformedFile = join(root, 'malformed.json')
    writeFileSync(invalidFile, `${JSON.stringify({ version: 1, proxySecret: 'short' })}\n`, 'utf8')
    writeFileSync(malformedFile, '{\n', 'utf8')

    await expect(loadGatewayConfig(join(root, 'missing.json'))).rejects.toThrow('cannot read gateway configuration')
    await expect(loadGatewayConfig(join(root, 'missing.json'))).rejects.toThrow(JSON.stringify(resolve(root, 'missing.json')))
    await expect(loadGatewayConfig(malformedFile)).rejects.toThrow('is not valid JSON')
    await expect(loadGatewayConfig(invalidFile)).rejects.toThrow('configuration.proxySecret must contain at least 32 UTF-8 bytes')
    await expect(loadGatewayConfig(invalidFile)).rejects.toThrow(`invalid gateway configuration ${JSON.stringify(resolve(invalidFile))}`)
  })
})

describe('gateway settings resolution', () => {
  const modelCredentials = {
    [OPENAI_MODEL_API_KEY_ENVIRONMENT_NAME]: 'openai-key',
  } satisfies NodeJS.ProcessEnv

  it('keeps deployment model credentials optional and resolves configured values', () => {
    expect(resolveGatewaySettings(parseGatewayConfig(minimalConfig()), {})).toMatchObject({
      openAiModelApiKey: undefined,
    })
    expect(resolveGatewaySettings(parseGatewayConfig(minimalConfig()), modelCredentials)).toEqual({
      proxySecret: SECRET,
      cpicApiUrl: minimalConfig().cpicApiUrl,
      cpicApiSecret: minimalConfig().cpicApiSecret,
      openAiChatCompletionsUrl: 'http://lf24dmbase-ai-sit.life.cpic.com/v1/chat/completions',
      openAiBaseUrl: 'http://lf24dmbase-ai-sit.life.cpic.com/v1',
      openAiModelId: 'codewis-7b',
      openAiModelApiKey: 'openai-key',
      ticketResolverUrl: undefined,
      ticketResolverSecret: undefined,
      sessionCookieName: undefined,
      sessionTtlMs: undefined,
      idleTimeoutMs: DEFAULT_IDLE_TIMEOUT_MS,
      host: '127.0.0.1',
      port: 3000,
      tenantPortMin: 3081,
      tenantPortMax: 3999,
      adminHost: '127.0.0.1',
      adminPort: 3001,
      adminSecret: undefined,
    })
  })

  it('lets the environment override the settings file', () => {
    const config = parseGatewayConfig({
      ...minimalConfig(),
      ticketResolverUrl: 'http://127.0.0.1:8080/tickets/consume',
      ticketResolverSecret: SECRET,
      sessionCookieName: 'from-file',
      sessionTtlMs: 1000,
    })
    const settings = resolveGatewaySettings(config, {
      [PROXY_SECRET_ENVIRONMENT_NAME]: OTHER_SECRET,
      [TICKET_RESOLVER_URL_ENVIRONMENT_NAME]: 'https://xtest.example/xtest/api/dsh/internal/jump-tickets/consume',
      [TICKET_RESOLVER_SECRET_ENVIRONMENT_NAME]: OTHER_SECRET,
      [SESSION_COOKIE_NAME_ENVIRONMENT_NAME]: 'from-environment',
      [SESSION_TTL_ENVIRONMENT_NAME]: '2000',
      [CPIC_API_URL_ENVIRONMENT_NAME]: 'https://xtest.example.test/xtest/api/dsh/internal/cpic',
      ...modelCredentials,
    })

    expect(settings).toEqual({
      proxySecret: OTHER_SECRET,
      cpicApiUrl: 'https://xtest.example.test/xtest/api/dsh/internal/cpic',
      cpicApiSecret: OTHER_SECRET,
      openAiChatCompletionsUrl: 'http://lf24dmbase-ai-sit.life.cpic.com/v1/chat/completions',
      openAiBaseUrl: 'http://lf24dmbase-ai-sit.life.cpic.com/v1',
      openAiModelId: 'codewis-7b',
      openAiModelApiKey: 'openai-key',
      ticketResolverUrl: 'https://xtest.example/xtest/api/dsh/internal/jump-tickets/consume',
      ticketResolverSecret: OTHER_SECRET,
      sessionCookieName: 'from-environment',
      sessionTtlMs: 2000,
      idleTimeoutMs: DEFAULT_IDLE_TIMEOUT_MS,
      host: '127.0.0.1',
      port: 3000,
      tenantPortMin: 3081,
      tenantPortMax: 3999,
      adminHost: '127.0.0.1',
      adminPort: 3001,
      adminSecret: undefined,
    })
  })

  it('lets a command-line override win over the environment', () => {
    const settings = resolveGatewaySettings(parseGatewayConfig(minimalConfig()), {
      ...modelCredentials,
      [TICKET_RESOLVER_URL_ENVIRONMENT_NAME]: 'http://127.0.0.1:8080/from-environment',
      [TICKET_RESOLVER_SECRET_ENVIRONMENT_NAME]: SECRET,
      [SESSION_TTL_ENVIRONMENT_NAME]: '2000',
    }, {
      ticketResolverUrl: 'http://127.0.0.1:8080/from-flag',
      sessionTtlMs: '3000',
      idleTimeoutMs: '0',
    })

    expect(settings.ticketResolverUrl).toBe('http://127.0.0.1:8080/from-flag')
    expect(settings.sessionTtlMs).toBe(3000)
    expect(settings.idleTimeoutMs).toBe(0)
  })

  it('treats blank override and environment values as absent', () => {
    const config = parseGatewayConfig({
      ...minimalConfig(),
      ticketResolverUrl: 'http://127.0.0.1:8080/tickets/consume',
      ticketResolverSecret: SECRET,
      sessionCookieName: 'from-file',
      sessionTtlMs: 1000,
    })
    const settings = resolveGatewaySettings(config, {
      ...modelCredentials,
      [PROXY_SECRET_ENVIRONMENT_NAME]: '   ',
      [SESSION_COOKIE_NAME_ENVIRONMENT_NAME]: '',
      [SESSION_TTL_ENVIRONMENT_NAME]: '  ',
    }, { sessionCookieName: '', sessionTtlMs: '   ' })

    expect(settings.proxySecret).toBe(SECRET)
    expect(settings.sessionCookieName).toBe('from-file')
    expect(settings.sessionTtlMs).toBe(1000)
  })

  it('pairs a command-line ticket resolver URL with the settings file secret', () => {
    const config = parseGatewayConfig({ ...minimalConfig(), ticketResolverUrl: 'http://127.0.0.1:8080/tickets/consume', ticketResolverSecret: SECRET })
    const settings = resolveGatewaySettings(config, modelCredentials, { ticketResolverUrl: 'http://127.0.0.1:9090/tickets/consume' })

    expect(settings.ticketResolverUrl).toBe('http://127.0.0.1:9090/tickets/consume')
    expect(settings.ticketResolverSecret).toBe(SECRET)
  })

  it('rejects an insecure remote CPIC URL from the environment', () => {
    expect(() => resolveGatewaySettings(parseGatewayConfig(minimalConfig()), {
      ...modelCredentials,
      [CPIC_API_URL_ENVIRONMENT_NAME]: 'http://xtest.example.test/xtest/api/dsh/internal/cpic',
    })).toThrow(`${CPIC_API_URL_ENVIRONMENT_NAME} must be an HTTP(S) XTEST CPIC API root ending in /api/dsh/internal/cpic; non-loopback endpoints require HTTPS`)
  })

  it('rejects a CPIC environment URL outside the API endpoint', () => {
    expect(() => resolveGatewaySettings(parseGatewayConfig(minimalConfig()), {
      ...modelCredentials,
      [CPIC_API_URL_ENVIRONMENT_NAME]: 'https://xtest.example.test/api/cpic',
    })).toThrow(`${CPIC_API_URL_ENVIRONMENT_NAME} must be an HTTP(S) XTEST CPIC API root ending in /api/dsh/internal/cpic; non-loopback endpoints require HTTPS`)
  })

  it('rejects a proxy secret from the environment below 32 UTF-8 bytes', () => {
    expect(() => resolveGatewaySettings(parseGatewayConfig(minimalConfig()), { [PROXY_SECRET_ENVIRONMENT_NAME]: 'short' }))
      .toThrow(`${PROXY_SECRET_ENVIRONMENT_NAME} must contain at least 32 UTF-8 bytes`)
  })

  it('rejects a ticket resolver URL whose secret no source provides', () => {
    expect(() => resolveGatewaySettings(parseGatewayConfig(minimalConfig()), {}, { ticketResolverUrl: 'http://127.0.0.1:8080/tickets/consume' }))
      .toThrow(`the ticket resolver URL and secret must be configured together: set ${TICKET_RESOLVER_URL_ENVIRONMENT_NAME} and ${TICKET_RESOLVER_SECRET_ENVIRONMENT_NAME}`)
  })

  it('rejects a session or reclamation override that is not an integer in range', () => {
    expect(() => resolveGatewaySettings(parseGatewayConfig(minimalConfig()), {}, { sessionTtlMs: '0' }))
      .toThrow('--session-ttl-ms must be a positive safe integer')
    expect(() => resolveGatewaySettings(parseGatewayConfig(minimalConfig()), { ...modelCredentials, [SESSION_TTL_ENVIRONMENT_NAME]: 'later' }))
      .toThrow(`${SESSION_TTL_ENVIRONMENT_NAME} must be a positive safe integer`)
    expect(() => resolveGatewaySettings(parseGatewayConfig(minimalConfig()), {}, { idleTimeoutMs: '-1' }))
      .toThrow('--idle-timeout-ms must be a non-negative safe integer')
  })
})
