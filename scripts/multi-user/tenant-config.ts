/** Load and validate the static tenant registry used by the local multi-user instance manager. */

import { mkdir, rename, writeFile } from 'node:fs/promises'
import { isAbsolute, normalize, resolve, dirname, join } from 'node:path'
import { parseArgs } from 'node:util'
import { loadJsonConfig, rejectUnknownKeys, requireRecord, requireString } from './json-config.ts'

/** Current static tenant configuration format. */
export const STATIC_TENANT_CONFIG_VERSION = 1

/** Optional capabilities enabled for one tenant process. */
export type TenantCapability = 'team' | 'ptc' | 'apply-patch'

const TENANT_CAPABILITIES: readonly TenantCapability[] = ['team', 'ptc', 'apply-patch']

/** One external identity's fixed DSH process resources. */
export interface StaticTenant {
  /** Stable internal identity used in logs and lifecycle state. */
  readonly tenantId: string
  /** Trusted identity value supplied by the external authenticator. */
  readonly externalUserId: string
  /** Fixed loopback port assigned to this tenant. */
  readonly port: number
  /** Absolute Harness home used for all tenant-owned DSH state. */
  readonly dshHome: string
  /** Absolute default process working directory for this tenant. */
  readonly workspace: string
  /** Explicitly enabled built-in DSH capabilities. */
  readonly capabilities?: readonly TenantCapability[]
  /** Explicitly enabled registered tenant capability plugin IDs. */
  readonly plugins?: readonly string[]
}

/** Versioned static tenant registry. */
export interface StaticTenantConfig {
  readonly version: typeof STATIC_TENANT_CONFIG_VERSION
  readonly tenants: readonly StaticTenant[]
}

const ROOT_KEYS = new Set(['version', 'tenants'])
const TENANT_KEYS = new Set(['tenantId', 'externalUserId', 'port', 'dshHome', 'workspace', 'capabilities', 'plugins'])
const TENANT_ID = /^[a-z0-9][a-z0-9-]{0,62}$/u
const CAPABILITY_SET = new Set<TenantCapability>(TENANT_CAPABILITIES)

function requireAbsolutePath(value: unknown, location: string): string {
  const path = requireString(value, location)
  if (!isAbsolute(path)) throw new Error(`${location} must be an absolute path`)
  return normalize(path)
}

function requirePort(value: unknown, location: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1024 || value > 65_535) {
    throw new Error(`${location} must be an integer from 1024 through 65535`)
  }
  return value
}

function requirePluginIds(value: unknown, location: string): readonly string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new Error(`${location} must be an array`)
  const plugins = value.map((item, index) => {
    if (typeof item !== 'string' || !/^[a-z0-9][a-z0-9-]{0,62}$/u.test(item)) {
      throw new Error(`${location}[${index}] must be a lowercase plugin ID`)
    }
    return item
  })
  if (new Set(plugins).size !== plugins.length) throw new Error(`${location} must not contain duplicates`)
  return plugins
}

function requireCapabilities(value: unknown, location: string): readonly TenantCapability[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new Error(`${location} must be an array`)
  const capabilities = value.map((item, index) => {
    if (typeof item !== 'string' || !CAPABILITY_SET.has(item as TenantCapability)) {
      throw new Error(`${location}[${index}] must be one of ${TENANT_CAPABILITIES.join(', ')}`)
    }
    return item as TenantCapability
  })
  if (new Set(capabilities).size !== capabilities.length) throw new Error(`${location} must not contain duplicates`)
  return capabilities
}

function pathIdentity(path: string): string {
  const normalized = normalize(path)
  return process.platform === 'win32' ? normalized.toLocaleLowerCase('en-US') : normalized
}

function requireUnique<T>(seen: Map<T, string>, value: T, location: string): void {
  const previous = seen.get(value)
  if (previous !== undefined) throw new Error(`${location} duplicates ${previous}`)
  seen.set(value, location)
}

function parseTenant(value: unknown, index: number): StaticTenant {
  const location = `tenants[${index}]`
  const record = requireRecord(value, location)
  rejectUnknownKeys(record, TENANT_KEYS, location)
  const tenantId = requireString(record.tenantId, `${location}.tenantId`)
  if (!TENANT_ID.test(tenantId)) {
    throw new Error(`${location}.tenantId must match ${String(TENANT_ID)}`)
  }
  const externalUserId = requireString(record.externalUserId, `${location}.externalUserId`)
  if (externalUserId.length > 256) throw new Error(`${location}.externalUserId must contain at most 256 characters`)
  const dshHome = requireAbsolutePath(record.dshHome, `${location}.dshHome`)
  const workspace = requireAbsolutePath(record.workspace, `${location}.workspace`)
  const capabilities = requireCapabilities(record.capabilities, `${location}.capabilities`)
  const plugins = requirePluginIds(record.plugins, `${location}.plugins`)
  if (pathIdentity(dshHome) === pathIdentity(workspace)) {
    throw new Error(`${location}.dshHome and ${location}.workspace must be different directories`)
  }
  return {
    tenantId,
    externalUserId,
    port: requirePort(record.port, `${location}.port`),
    dshHome,
    workspace,
    ...(capabilities === undefined ? {} : { capabilities }),
    ...(plugins === undefined ? {} : { plugins }),
  }
}

/**
 * Validate parsed JSON as one complete static tenant registry.
 * @param value - Parsed JSON value from a trusted configuration file location.
 * @returns normalized tenant configuration.
 * @throws when required fields, field values, or cross-tenant uniqueness rules are invalid.
 */
export function parseStaticTenantConfig(value: unknown): StaticTenantConfig {
  const root = requireRecord(value, 'configuration')
  rejectUnknownKeys(root, ROOT_KEYS, 'configuration')
  if (root.version !== STATIC_TENANT_CONFIG_VERSION) {
    throw new Error(`configuration.version must be ${STATIC_TENANT_CONFIG_VERSION}`)
  }
  if (!Array.isArray(root.tenants)) {
    throw new Error('configuration.tenants must be an array')
  }

  const tenants = root.tenants.map(parseTenant)
  const tenantIds = new Map<string, string>()
  const externalUserIds = new Map<string, string>()
  const ports = new Map<number, string>()
  const paths = new Map<string, string>()
  for (const [index, tenant] of tenants.entries()) {
    const location = `tenants[${index}]`
    requireUnique(tenantIds, tenant.tenantId, `${location}.tenantId`)
    requireUnique(externalUserIds, tenant.externalUserId, `${location}.externalUserId`)
    requireUnique(ports, tenant.port, `${location}.port`)
    requireUnique(paths, pathIdentity(tenant.dshHome), `${location}.dshHome`)
    requireUnique(paths, pathIdentity(tenant.workspace), `${location}.workspace`)
  }
  return { version: STATIC_TENANT_CONFIG_VERSION, tenants }
}

/**
 * Read and validate a UTF-8 static tenant configuration file.
 * @param file - Absolute or current-directory-relative JSON file path.
 * @returns validated and normalized tenant configuration.
 * @throws with the file path when reading, JSON parsing, or validation fails.
 */
export async function loadStaticTenantConfig(file: string): Promise<StaticTenantConfig> {
  return loadJsonConfig(file, 'static tenant configuration', parseStaticTenantConfig)
}

/**
 * Validate the configured registry and render its non-secret routing fields.
 * @param args - Command-line arguments containing an optional `--config` path.
 * @returns JSON summary suitable for operator inspection.
 */
export async function validateStaticTenantConfig(args: readonly string[]): Promise<string> {
  const { values } = parseArgs({
    args,
    allowPositionals: false,
    strict: true,
    options: {
      config: { type: 'string', default: '.local/multi-user/tenants.json' },
    },
  })
  const config = await loadStaticTenantConfig(values.config)
  return `${JSON.stringify({
    valid: true,
    version: config.version,
    tenants: config.tenants.map(tenant => ({
      tenantId: tenant.tenantId,
      externalUserId: tenant.externalUserId,
      port: tenant.port,
      dshHome: tenant.dshHome,
      workspace: tenant.workspace,
      ...(tenant.capabilities === undefined ? {} : { capabilities: tenant.capabilities }),
      ...(tenant.plugins === undefined ? {} : { plugins: tenant.plugins }),
    })),
  }, null, 2)}\n`
}

const SAFE_DIRECTORY_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u

export interface ProvisionedTenant {
  readonly tenant: StaticTenant
  readonly created: boolean
}

const TENANT_WEB_PATCH = (tenant: StaticTenant): string => `# Tenant defaults provisioned for one isolated user.
- id: ui-settings-models
  config:
    welcomeNotice: false
- id: workspace-controller
  config:
    defaultWorkspacePath: ${tenant.workspace}
- id: directory-picker
  disabled: true
- insert:
    - id: directory-picker-browse
      name: '@deepseek-ai/dsh-host-directory-picker-browse'
      config:
        root: ${JSON.stringify(tenant.workspace.replace(/\\/gu, '/'))}
    - id: ui-directory-picker-browse
      name: '@deepseek-ai/dsh-client-ui-directory-picker-browse'
`

/**
 * Add the multi-user Web defaults without replacing an operator's existing patch.
 * @param tenant - Provisioned tenant paths.
 */
async function ensureTenantWebPatch(tenant: StaticTenant): Promise<void> {
  const path = join(tenant.dshHome, 'profiles', 'web', 'cordis.patch.yml')
  await mkdir(dirname(path), { recursive: true })
  try {
    await writeFile(path, TENANT_WEB_PATCH(tenant), { encoding: 'utf8', flag: 'wx' })
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST') return
    throw error
  }
}


/** Expected provisioning failure that the gateway can explain without exposing filesystem paths. */
export class TenantProvisionError extends Error {
  constructor(
    readonly code: 'invalid-external-user' | 'invalid-tenant-id' | 'tenant-id-in-use' | 'no-available-port',
    message: string,
  ) {
    super(message)
    this.name = 'TenantProvisionError'
  }
}

/** 创建或返回一个用户租户，并将结果持久化到静态租户配置。 */
export async function provisionStaticTenant(
  file: string,
  externalUserId: string,
  requestedTenantId: string | undefined,
  tenantRoot: string,
  portMin: number,
  portMax: number,
): Promise<ProvisionedTenant> {
  if (!SAFE_DIRECTORY_NAME.test(externalUserId)) {
    throw new TenantProvisionError('invalid-external-user', 'externalUserId must be a safe directory name')
  }
  if (!Number.isSafeInteger(portMin) || !Number.isSafeInteger(portMax) || portMin < 1024 || portMax > 65535 || portMin > portMax) {
    throw new Error('tenant port range is invalid')
  }
  const absoluteFile = resolve(file)
  const current = await loadStaticTenantConfig(absoluteFile)
  const existing = current.tenants.find(item => item.externalUserId === externalUserId)
  if (existing !== undefined) {
    await mkdir(existing.dshHome, { recursive: true })
    await mkdir(existing.workspace, { recursive: true })
    await ensureTenantWebPatch(existing)
    return { tenant: existing, created: false }
  }
  const tenantId = requestedTenantId?.trim() || `tenant-${externalUserId.toLowerCase()}`
  if (!TENANT_ID.test(tenantId)) throw new TenantProvisionError('invalid-tenant-id', 'tenantId is invalid')
  if (current.tenants.some(item => item.tenantId === tenantId)) throw new TenantProvisionError('tenant-id-in-use', 'tenantId is already assigned')
  const usedPorts = new Set(current.tenants.map(item => item.port))
  let port: number | undefined
  for (let candidate = portMin; candidate <= portMax; candidate += 1) {
    if (!usedPorts.has(candidate)) {
      port = candidate
      break
    }
  }
  if (port === undefined) throw new TenantProvisionError('no-available-port', 'no free tenant port is available')
  const root = resolve(tenantRoot)
  const userRoot = join(root, externalUserId)
  const tenant: StaticTenant = {
    tenantId,
    externalUserId,
    port,
    dshHome: normalize(join(userRoot, 'home')),
    workspace: normalize(join(userRoot, 'workspace')),
  }
  await mkdir(tenant.dshHome, { recursive: true })
  await mkdir(tenant.workspace, { recursive: true })
  await ensureTenantWebPatch(tenant)
  const next = parseStaticTenantConfig({ version: STATIC_TENANT_CONFIG_VERSION, tenants: [...current.tenants, tenant] })
  const temporaryFile = `${absoluteFile}.${process.pid}.tmp`
  await mkdir(dirname(absoluteFile), { recursive: true })
  await writeFile(temporaryFile, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  await rename(temporaryFile, absoluteFile)
  return { tenant, created: true }
}

if (import.meta.main) {
  try {
    process.stdout.write(await validateStaticTenantConfig(process.argv.slice(2)))
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
