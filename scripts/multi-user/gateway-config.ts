/** Gateway deployment settings read from one local JSON file and merged with environment and command-line overrides. */

import { loadJsonConfig, rejectUnknownKeys, requireRecord, requireString } from './json-config.ts'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

/** Current gateway settings format. */
export const GATEWAY_CONFIG_VERSION = 1

/** Default gateway settings file beside `.local/multi-user/tenants.json`. */
export const DEFAULT_GATEWAY_CONFIG_FILE = '.local/multi-user/gateway.json'

/** Environment variable overriding the configured proxy secret. */
export const PROXY_SECRET_ENVIRONMENT_NAME = 'DSH_MULTI_USER_PROXY_SECRET'
/** Environment variable overriding the configured ticket resolver URL. */
export const TICKET_RESOLVER_URL_ENVIRONMENT_NAME = 'DSH_TICKET_RESOLVER_URL'
/** Environment variable overriding the configured ticket resolver secret. */
export const TICKET_RESOLVER_SECRET_ENVIRONMENT_NAME = 'DSH_TICKET_RESOLVER_SECRET'
/** Environment variable overriding the XTEST CPIC API URL. */
export const CPIC_API_URL_ENVIRONMENT_NAME = 'DSH_CPIC_API_URL'
/** Environment variable overriding the XTEST CPIC API secret. */
export const CPIC_API_SECRET_ENVIRONMENT_NAME = 'DSH_CPIC_API_SECRET'
/** Environment variable overriding the configured session Cookie name. */
export const SESSION_COOKIE_NAME_ENVIRONMENT_NAME = 'DSH_GATEWAY_SESSION_COOKIE_NAME'
/** Environment variable overriding the configured session lifetime. */
export const SESSION_TTL_ENVIRONMENT_NAME = 'DSH_GATEWAY_SESSION_TTL_MS'
/** Environment variable supplying the OpenAI-compatible model endpoint's Bearer key. */
export const OPENAI_MODEL_API_KEY_ENVIRONMENT_NAME = 'DSH_MULTI_USER_OPENAI_MODEL_API_KEY'

/** Reclamation interval applied when no source configures one. */
export const DEFAULT_IDLE_TIMEOUT_MS = 15 * 60 * 1000

const MINIMUM_SECRET_BYTES = 32

/** Secrets and inter-process authentication settings of one gateway deployment. */
export interface GatewayConfig {
  /** Settings format version. */
  readonly version: typeof GATEWAY_CONFIG_VERSION
  /** Shared secret the trusted reverse proxy sends in `X-DSH-Proxy-Secret`. */
  readonly proxySecret: string
  /** Internal Xtest2 endpoint that atomically consumes a jump ticket. */
  readonly ticketResolverUrl?: string
  /** Secret sent only from the gateway to that endpoint. */
  readonly ticketResolverSecret?: string
  /** XTEST endpoint root ending in `/api/dsh/internal/cpic`. */
  readonly cpicApiUrl: string
  /** Independently configured secret sent only to XTEST's CPIC API. */
  readonly cpicApiSecret: string
  /** Chat Completions endpoint for the OpenAI-compatible provider. */
  readonly openAiChatCompletionsUrl: string
  /** Model id for the OpenAI-compatible provider. */
  readonly openAiModelId: string
  /** Name of the private gateway session Cookie. */
  readonly sessionCookieName?: string
  /** Session lifetime in milliseconds. */
  readonly sessionTtlMs?: number
  /** Milliseconds without active traffic before the gateway stops a tenant; zero disables reclamation. */
  readonly idleTimeoutMs?: number
  /** Host address for browser-facing traffic. */
  readonly host?: string
  /** Port for browser-facing traffic. */
  readonly port?: number
  /** First port available to newly provisioned tenants. */
  readonly tenantPortMin?: number
  /** Last port available to newly provisioned tenants. */
  readonly tenantPortMax?: number
  /** Host address for the authenticated management listener. */
  readonly adminHost?: string
  /** Port for the authenticated management listener. */
  readonly adminPort?: number
  /** Shared secret for remote management requests. */
  readonly adminSecret?: string
}

/** Command-line values that override the environment and the settings file. */
export interface GatewaySettingOverrides {
  /** `--ticket-resolver-url` value, or `undefined` when the flag is absent. */
  readonly ticketResolverUrl?: string | undefined
  /** `--session-cookie-name` value, or `undefined` when the flag is absent. */
  readonly sessionCookieName?: string | undefined
  /** `--session-ttl-ms` value as written on the command line, or `undefined` when the flag is absent. */
  readonly sessionTtlMs?: string | undefined
  /** `--idle-timeout-ms` value as written on the command line, or `undefined` when the flag is absent. */
  readonly idleTimeoutMs?: string | undefined
}

/** Effective settings of one gateway process. */
export interface GatewaySettings {
  /** Shared secret the trusted reverse proxy must send in `X-DSH-Proxy-Secret`. */
  readonly proxySecret: string
  /** Internal ticket resolver endpoint, or `undefined` when jump tickets are disabled. */
  readonly ticketResolverUrl: string | undefined
  /** Secret sent only to the ticket resolver, or `undefined` when jump tickets are disabled. */
  readonly ticketResolverSecret: string | undefined
  /** XTEST endpoint root ending in `/api/dsh/internal/cpic`. */
  readonly cpicApiUrl: string
  /** Secret sent only to XTEST's CPIC API. */
  readonly cpicApiSecret: string
  /** OpenAI-compatible Chat Completions URL. */
  readonly openAiChatCompletionsUrl: string
  /** OpenAI-compatible provider base URL derived from the Chat Completions URL. */
  readonly openAiBaseUrl: string
  /** Model id for the OpenAI-compatible provider. */
  readonly openAiModelId: string
  /** OpenAI-compatible provider Bearer key, when deployment overlay credentials are enabled. */
  readonly openAiModelApiKey: string | undefined
  /** Session Cookie name, or `undefined` for the gateway runtime default. */
  readonly sessionCookieName: string | undefined
  /** Session lifetime in milliseconds, or `undefined` for the gateway runtime default. */
  readonly sessionTtlMs: number | undefined
  /** Reclamation interval in milliseconds; zero disables reclamation. */
  readonly idleTimeoutMs: number
  readonly host: string
  readonly port: number
  readonly tenantPortMin: number
  readonly tenantPortMax: number
  readonly adminHost: string
  readonly adminPort: number
  readonly adminSecret: string | undefined
}

const CONFIG_KEYS = new Set([
  'version', 'proxySecret', 'ticketResolverUrl', 'ticketResolverSecret',
  'cpicApiUrl', 'cpicApiSecret', 'openAiChatCompletionsUrl', 'openAiModelId', 'sessionCookieName', 'sessionTtlMs', 'idleTimeoutMs',
  'host', 'port', 'tenantPortMin', 'tenantPortMax', 'adminHost', 'adminPort', 'adminSecret',
])

function requireSecret(value: unknown, location: string): string {
  const secret = requireString(value, location)
  if (Buffer.byteLength(secret) < MINIMUM_SECRET_BYTES) {
    throw new Error(`${location} must contain at least ${MINIMUM_SECRET_BYTES} UTF-8 bytes`)
  }
  return secret
}

function optionalString(root: Record<string, unknown>, key: string): string | undefined {
  return root[key] === undefined ? undefined : requireString(root[key], `configuration.${key}`)
}

function optionalSecret(root: Record<string, unknown>, key: string): string | undefined {
  return root[key] === undefined ? undefined : requireSecret(root[key], `configuration.${key}`)
}

function configuredPort(root: Record<string, unknown>, key: string, fallback: number): number {
  const value = root[key]
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 65_535) {
    throw new Error(`configuration.${key} must be an integer from 1 through 65535`)
  }
  return value
}

function configuredHost(root: Record<string, unknown>, key: string, fallback: string): string {
  const value = root[key]
  if (value === undefined) return fallback
  const host = requireString(value, `configuration.${key}`).trim()
  if (host === '') throw new Error(`configuration.${key} must be a non-empty string`)
  return host
}

function positiveInteger(value: string | undefined, name: string): number | undefined {
  if (value === undefined || value.trim() === '') return undefined
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive safe integer`)
  return parsed
}

function nonNegativeInteger(value: string | undefined, name: string): number | undefined {
  if (value === undefined || value.trim() === '') return undefined
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative safe integer`)
  return parsed
}

function environmentValue(environment: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = environment[name]
  return value === undefined || value.trim() === '' ? undefined : value
}

function validateTicketResolverUrl(value: string, location: string): string {
  let url: URL
  try { url = new URL(value) } catch { throw new Error(`${location} must be a valid HTTP(S) URL`) }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) {
    throw new Error(`${location} must be an HTTP(S) URL without credentials or a fragment`)
  }
  return url.toString()
}

function validateCpicApiUrl(value: string, location: string): string {
  let url: URL
  try { url = new URL(value) } catch { throw new Error(`${location} must be a valid HTTP(S) XTEST CPIC API root`) }
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]' || url.hostname === '::1'
  if (!['http:', 'https:'].includes(url.protocol) || !url.pathname.endsWith('/api/dsh/internal/cpic') || url.search || url.hash || url.username || url.password || (!loopback && url.protocol !== 'https:')) {
    throw new Error(`${location} must be an HTTP(S) XTEST CPIC API root ending in /api/dsh/internal/cpic; non-loopback endpoints require HTTPS`)
  }
  return url.toString().replace(/\/$/u, '')
}

function validateModelEndpoint(value: string, location: string, suffix: string): { url: string; baseUrl: string } {
  let url: URL
  try { url = new URL(value) } catch { throw new Error(`${location} must be a valid HTTP(S) URL`) }
  const pathname = url.pathname.replace(/\/+$/u, '')
  if (!['http:', 'https:'].includes(url.protocol) || !pathname.endsWith(suffix)
    || url.search || url.hash || url.username || url.password) {
    throw new Error(`${location} must be an HTTP(S) URL ending in ${suffix}`)
  }
  const baseUrl = new URL(url)
  const requestSuffix = suffix === '/v1/chat/completions' ? '/chat/completions' : suffix
  baseUrl.pathname = pathname.slice(0, -requestSuffix.length) || '/'
  return { url: url.toString().replace(/\/$/u, ''), baseUrl: baseUrl.toString().replace(/\/$/u, '') }
}

/**
 * Validate parsed JSON as one complete gateway settings object.
 * @param value - parsed JSON value from a trusted configuration file location.
 * @returns normalized gateway settings.
 * @throws when required fields, field values, or the ticket-resolver pairing are invalid.
 */
export function parseGatewayConfig(value: unknown): GatewayConfig {
  const root = requireRecord(value, 'configuration')
  rejectUnknownKeys(root, CONFIG_KEYS, 'configuration')
  if (root.version !== GATEWAY_CONFIG_VERSION) throw new Error(`configuration.version must be ${GATEWAY_CONFIG_VERSION}`)
  const proxySecret = requireSecret(root.proxySecret, 'configuration.proxySecret')
  const ticketResolverUrl = optionalString(root, 'ticketResolverUrl')
  const ticketResolverSecret = optionalSecret(root, 'ticketResolverSecret')
  const cpicApiUrl = requireString(root.cpicApiUrl, 'configuration.cpicApiUrl')
  const cpicApiSecret = requireSecret(root.cpicApiSecret, 'configuration.cpicApiSecret')
  const openAiChatCompletionsUrl = requireString(root.openAiChatCompletionsUrl, 'configuration.openAiChatCompletionsUrl')
  const openAiModelId = requireString(root.openAiModelId, 'configuration.openAiModelId').trim()
  if (openAiModelId === '') throw new Error('configuration.openAiModelId must be a non-empty string')
  let ticketResolver: { ticketResolverUrl: string; ticketResolverSecret: string } | undefined
  if (ticketResolverUrl !== undefined && ticketResolverSecret !== undefined) {
    ticketResolver = {
      ticketResolverUrl: validateTicketResolverUrl(ticketResolverUrl, 'configuration.ticketResolverUrl'),
      ticketResolverSecret,
    }
  } else if (ticketResolverUrl !== undefined || ticketResolverSecret !== undefined) {
    throw new Error('configuration.ticketResolverUrl and configuration.ticketResolverSecret must be configured together')
  }
  const sessionCookieName = optionalString(root, 'sessionCookieName')
  const sessionTtlMs = root.sessionTtlMs
  if (sessionTtlMs !== undefined && (typeof sessionTtlMs !== 'number' || !Number.isSafeInteger(sessionTtlMs) || sessionTtlMs <= 0)) {
    throw new Error('configuration.sessionTtlMs must be a positive safe integer')
  }
  const idleTimeoutMs = root.idleTimeoutMs
  if (idleTimeoutMs !== undefined && (typeof idleTimeoutMs !== 'number' || !Number.isSafeInteger(idleTimeoutMs) || idleTimeoutMs < 0)) {
    throw new Error('configuration.idleTimeoutMs must be a non-negative safe integer')
  }
  const host = configuredHost(root, 'host', '127.0.0.1')
  const port = configuredPort(root, 'port', 3000)
  const tenantPortMin = configuredPort(root, 'tenantPortMin', 3081)
  const tenantPortMax = configuredPort(root, 'tenantPortMax', 3999)
  if (tenantPortMin < 1024 || tenantPortMax < 1024) throw new Error('configuration tenant ports must be at least 1024')
  if (tenantPortMin > tenantPortMax) throw new Error('configuration.tenantPortMin must not exceed configuration.tenantPortMax')
  const adminHost = configuredHost(root, 'adminHost', '127.0.0.1')
  const adminPort = configuredPort(root, 'adminPort', 3001)
  if (port === adminPort && host === adminHost) throw new Error('configuration.adminPort must not conflict with the gateway listener')
  const adminSecret = optionalSecret(root, 'adminSecret')
  const normalizedCpicApiUrl = validateCpicApiUrl(cpicApiUrl, 'configuration.cpicApiUrl')
  const openAiEndpoint = validateModelEndpoint(openAiChatCompletionsUrl, 'configuration.openAiChatCompletionsUrl', '/v1/chat/completions')
  return {
    version: GATEWAY_CONFIG_VERSION,
    proxySecret,
    cpicApiUrl: normalizedCpicApiUrl,
    cpicApiSecret,
    openAiChatCompletionsUrl: openAiEndpoint.url,
    openAiModelId,
    ...(ticketResolver === undefined ? {} : ticketResolver),
    ...(sessionCookieName === undefined ? {} : { sessionCookieName }),
    ...(sessionTtlMs === undefined ? {} : { sessionTtlMs }),
    ...(idleTimeoutMs === undefined ? {} : { idleTimeoutMs }),
    host,
    port,
    tenantPortMin,
    tenantPortMax,
    adminHost,
    adminPort,
    ...(adminSecret === undefined ? {} : { adminSecret }),
  }
}

/**
 * Read and validate one UTF-8 gateway settings file.
 * @param file - absolute or current-directory-relative JSON file path.
 * @returns validated and normalized gateway settings.
 * @throws with the file path when reading, JSON parsing, or validation fails.
 */
export async function loadGatewayConfig(file: string): Promise<GatewayConfig> {
  return loadJsonConfig(file, 'gateway configuration', parseGatewayConfig)
}

/** Persist one validated gateway settings object with an atomic file replacement. */
export async function saveGatewayConfig(file: string, value: GatewayConfig): Promise<void> {
  const config = parseGatewayConfig(value)
  const absoluteFile = resolve(file)
  const temporaryFile = `${absoluteFile}.${process.pid}.tmp`
  await mkdir(dirname(absoluteFile), { recursive: true })
  await writeFile(temporaryFile, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
  await rename(temporaryFile, absoluteFile)
}

/**
 * Merge gateway settings with environment variables and command-line overrides.
 * A source closer to the gateway process wins: command-line override, then environment
 * variable, then settings file. Blank override and environment values count as absent.
 * @param config - validated gateway settings file contents.
 * @param environment - process environment carrying the override variables.
 * @param overrides - command-line values in their raw written form.
 * @returns the effective settings of one gateway process.
 * @throws when the resolved proxy secret is too short, an override or environment
 * timeout is not an integer in range, or the ticket resolver URL and secret do not pair.
 */
export function resolveGatewaySettings(
  config: GatewayConfig,
  environment: NodeJS.ProcessEnv,
  overrides: GatewaySettingOverrides = {},
): GatewaySettings {
  const proxySecret = environmentValue(environment, PROXY_SECRET_ENVIRONMENT_NAME) ?? config.proxySecret
  if (Buffer.byteLength(proxySecret) < MINIMUM_SECRET_BYTES) {
    throw new Error(`${PROXY_SECRET_ENVIRONMENT_NAME} must contain at least ${MINIMUM_SECRET_BYTES} UTF-8 bytes`)
  }
  const ticketResolverUrl = overrides.ticketResolverUrl?.trim()
    || environmentValue(environment, TICKET_RESOLVER_URL_ENVIRONMENT_NAME)
    || config.ticketResolverUrl
  const ticketResolverSecret = environmentValue(environment, TICKET_RESOLVER_SECRET_ENVIRONMENT_NAME) ?? config.ticketResolverSecret
  if ((ticketResolverUrl === undefined) !== (ticketResolverSecret === undefined)) {
    throw new Error(
      `the ticket resolver URL and secret must be configured together: set ${TICKET_RESOLVER_URL_ENVIRONMENT_NAME} and ${TICKET_RESOLVER_SECRET_ENVIRONMENT_NAME}, `
      + 'or ticketResolverUrl and ticketResolverSecret in the gateway configuration',
    )
  }
  const normalizedTicketResolverUrl = ticketResolverUrl === undefined
    ? undefined
    : validateTicketResolverUrl(ticketResolverUrl, TICKET_RESOLVER_URL_ENVIRONMENT_NAME)
  const sessionCookieName = overrides.sessionCookieName?.trim()
    || environmentValue(environment, SESSION_COOKIE_NAME_ENVIRONMENT_NAME)
    || config.sessionCookieName
  const sessionTtlMs = positiveInteger(overrides.sessionTtlMs, '--session-ttl-ms')
    ?? positiveInteger(environment[SESSION_TTL_ENVIRONMENT_NAME], SESSION_TTL_ENVIRONMENT_NAME)
    ?? config.sessionTtlMs
  const idleTimeoutMs = nonNegativeInteger(overrides.idleTimeoutMs, '--idle-timeout-ms')
    ?? config.idleTimeoutMs
    ?? DEFAULT_IDLE_TIMEOUT_MS
  const cpicApiUrl = validateCpicApiUrl(
    environmentValue(environment, CPIC_API_URL_ENVIRONMENT_NAME) ?? config.cpicApiUrl,
    CPIC_API_URL_ENVIRONMENT_NAME,
  )
  const cpicApiSecret = environmentValue(environment, CPIC_API_SECRET_ENVIRONMENT_NAME) ?? config.cpicApiSecret
  const openAiModelApiKey = environmentValue(environment, OPENAI_MODEL_API_KEY_ENVIRONMENT_NAME)
  return {
    proxySecret,
    ticketResolverUrl: normalizedTicketResolverUrl,
    ticketResolverSecret,
    sessionCookieName,
    sessionTtlMs,
    idleTimeoutMs,
    cpicApiUrl,
    cpicApiSecret,
    openAiChatCompletionsUrl: config.openAiChatCompletionsUrl,
    openAiBaseUrl: validateModelEndpoint(config.openAiChatCompletionsUrl, 'configuration.openAiChatCompletionsUrl', '/v1/chat/completions').baseUrl,
    openAiModelId: config.openAiModelId,
    openAiModelApiKey,
    host: config.host ?? '127.0.0.1',
    port: config.port ?? 3000,
    tenantPortMin: config.tenantPortMin ?? 3081,
    tenantPortMax: config.tenantPortMax ?? 3999,
    adminHost: config.adminHost ?? '127.0.0.1',
    adminPort: config.adminPort ?? 3001,
    adminSecret: config.adminSecret,
  }
}
