/** Process lifecycle manager for the local static tenant registry. */

import { spawn } from 'node:child_process'
import type { ChildProcessByStdio } from 'node:child_process'
import { access, appendFile, mkdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Readable } from 'node:stream'
import type { StaticTenant, StaticTenantConfig, TenantCapability } from './tenant-config.ts'
import { createTenantCapabilityPluginRegistry, type TenantCapabilityPlugin, type TenantCapabilityPluginRegistry } from './tenant-plugin.ts'

/** Observable lifecycle state of one tenant process. */
export type TenantInstanceState = 'stopped' | 'starting' | 'running' | 'stopping' | 'failed'

/** Process termination reported by the launcher. */
export interface TenantProcessExit {
  readonly code: number | null
  readonly signal: NodeJS.Signals | null
  readonly error?: Error
}

/** Child-process operations owned by the instance manager. */
export interface TenantProcess {
  readonly pid: number | undefined
  readonly stdout: Readable
  readonly stderr: Readable
  readonly exited: Promise<TenantProcessExit>
  /**
   * Deliver a process signal.
   * @param signal - Signal requested by lifecycle policy.
   * @returns whether Node accepted the request for delivery.
   */
  kill(signal: NodeJS.Signals): boolean
}

/** Launcher replaceable by isolated lifecycle tests. */
export type TenantProcessLauncher = (
  tenant: StaticTenant,
  generation: number,
) => Promise<TenantProcess>

/** Read-only state safe to expose to a control-plane caller. */
export interface TenantInstanceSnapshot {
  readonly tenantId: string
  readonly externalUserId: string
  readonly port: number
  readonly state: TenantInstanceState
  readonly generation: number
  readonly pid?: number
  readonly startedAt?: number
  readonly readyAt?: number
  readonly lastError?: string
}

/** Successful ensure result, including the process credential emitted at readiness. */
export interface TenantInstanceReady {
  readonly instance: TenantInstanceSnapshot
  readonly authenticatedUrl: string
}

/** Tunable lifecycle deadlines and diagnostics bounds. */
export interface StaticTenantInstanceManagerOptions {
  readonly startupTimeoutMs?: number
  readonly shutdownTimeoutMs?: number
  readonly forceExitTimeoutMs?: number
  readonly maxDiagnosticChars?: number
  readonly logDirectory?: string
  readonly now?: () => number
}

/** Stable failure categories returned by instance lifecycle operations. */
export class TenantInstanceError extends Error {
  /**
   * @param code - Machine-readable failure category.
   * @param tenantId - Affected static tenant.
   * @param message - Operator-facing diagnostic without process credentials.
   * @param options - Optional causal error.
   */
  constructor(
    readonly code: 'tenant-not-found' | 'start-failed' | 'startup-timeout' | 'stopped-before-ready' | 'stop-failed',
    readonly tenantId: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'TenantInstanceError'
  }
}

interface TenantRuntime {
  readonly tenant: StaticTenant
  state: TenantInstanceState
  generation: number
  child: TenantProcess | undefined
  start: Promise<TenantInstanceReady> | undefined
  stop: Promise<void> | undefined
  authenticatedUrl: string | undefined
  startedAt: number | undefined
  readyAt: number | undefined
  lastError: string | undefined
  diagnostics: string
}

interface ResolvedManagerOptions {
  readonly startupTimeoutMs: number
  readonly shutdownTimeoutMs: number
  readonly forceExitTimeoutMs: number
  readonly maxDiagnosticChars: number
  readonly logDirectory: string
  readonly now: () => number
}

const READY_PREFIX = 'dsh web: '
const DEFAULT_STARTUP_TIMEOUT_MS = 60_000
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 15_000
const DEFAULT_FORCE_EXIT_TIMEOUT_MS = 5_000
const DEFAULT_MAX_DIAGNOSTIC_CHARS = 16_384
const CPIC_API_URL_ENVIRONMENT_NAME = 'CPIC_GATEWAY_CPIC_URL'
const CPIC_API_SECRET_ENVIRONMENT_NAME = 'CPIC_GATEWAY_CPIC_SECRET'
const MODEL_ENVIRONMENT_NAMES = [
  'DSH_MULTI_USER_OPENAI_MODEL_BASE_URL',
  'DSH_MULTI_USER_OPENAI_MODEL_API_KEY',
  'DSH_MULTI_USER_OPENAI_MODEL_ID',
] as const
const SECRET_ENVIRONMENT_NAME = /(?:KEY|SECRET|TOKEN|PASSWORD)/iu
const redactDiagnostic = (text: string): string => text
  .replace(/([?&]token=)[^&\s]+/giu, '$1[redacted]')
  .replace(/((?:password|secret|api[_-]?key|token)\s*[:=]\s*)[^\s,;]+/giu, '$1[redacted]')

async function writeTenantDiagnostic(directory: string, tenantId: string, generation: number, stream: 'stdout' | 'stderr', text: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const file = join(directory, `${tenantId}-generation-${generation}.log`)
  await appendFile(file, `[${new Date().toISOString()}] [${stream}] ${redactDiagnostic(text)}\n`, { encoding: 'utf8', mode: 0o600 })
}

function positiveInteger(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 1) throw new TypeError(`${name} must be a positive safe integer`)
  return resolved
}

function diagnosticOf(exit: TenantProcessExit): string {
  if (exit.error !== undefined) return exit.error.message
  if (exit.signal !== null) return `signal ${exit.signal}`
  return `exit code ${String(exit.code)}`
}

function snapshotOf(runtime: TenantRuntime): TenantInstanceSnapshot {
  return {
    tenantId: runtime.tenant.tenantId,
    externalUserId: runtime.tenant.externalUserId,
    port: runtime.tenant.port,
    state: runtime.state,
    generation: runtime.generation,
    ...(runtime.child?.pid === undefined ? {} : { pid: runtime.child.pid }),
    ...(runtime.startedAt === undefined ? {} : { startedAt: runtime.startedAt }),
    ...(runtime.readyAt === undefined ? {} : { readyAt: runtime.readyAt }),
    ...(runtime.lastError === undefined ? {} : { lastError: runtime.lastError }),
  }
}

async function raceDeadline<T>(promise: Promise<T>, timeoutMs: number, timeout: () => Error): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => { timer = setTimeout(() => { reject(timeout()) }, timeoutMs) }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

function scrubbedEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(environment).filter(([name, value]) =>
    value !== undefined && !SECRET_ENVIRONMENT_NAME.test(name) && name !== 'DSH_HOME' && name !== 'DSH_PERMISSION_MODE'))
}

/**
 * Create the repository-built `dsh web` launcher used by the local manager.
 * @param cliFile - Built DSH CLI entry file.
 * @param environment - Ambient environment scrubbed before tenant values are added; when the OpenAI-compatible model settings are supplied, their provider overlay is mounted.
 * @param publicUrl - Optional browser-facing Gateway root advertised by tenant DSH.
 * @param plugins - Additional capability plugins that the tenant registry may select by ID.
 * @returns a launcher that preserves tenant cwd, home, and loopback port and mounts workspace-local Agency, AgentTeams, and Agent Roles.
 * @throws when required deployment artifacts are missing, before creating a tenant process.
 */
export function createLocalDshLauncher(
  cliFile = fileURLToPath(new URL('../../apps/cli/lib/bin.js', import.meta.url)),
  environment: NodeJS.ProcessEnv = process.env,
  publicUrl?: string,
  plugins: readonly TenantCapabilityPlugin[] = [],
): TenantProcessLauncher {
  const publicAuthority = publicUrl === undefined ? undefined : new URL(publicUrl).host
  const overlayFile = fileURLToPath(new URL('./http-doc.overlay.yml', import.meta.url))
  const requirementsOverlayFile = fileURLToPath(new URL('./cpic-requirements.overlay.yml', import.meta.url))
  const workflowPanelOverlayFile = fileURLToPath(new URL('./workflow-panel.overlay.yml', import.meta.url))
  const skillManagementOverlayFile = fileURLToPath(new URL('./skill-management.overlay.yml', import.meta.url))
  const modelProviderOverlayFile = fileURLToPath(new URL('./model-provider.overlay.yml', import.meta.url))
  const communityOverlays = ['agency-agents', 'agent-teams', 'agent-roles'].map(name =>
    fileURLToPath(new URL(`./${name}.overlay.yml`, import.meta.url)))
  const communityArtifacts = [
    ...communityOverlays,
    ...[
      '@michengai/dsh-agency-agents/package.json',
      '@michengai/dsh-agency-agents/lib/index.js',
      '@michengai/dsh-agency-agents/lib/remote.js',
      '@michengai/dsh-agency-agents/lib/client.js',
      '@nanmicoder/dsh-agent-teams/package.json',
      '@nanmicoder/dsh-agent-teams/lib/index.js',
      '@nanmicoder/dsh-agent-teams/lib/client.js',
      '@delthin/dsh-agent-roles/package.json',
      '@delthin/dsh-agent-roles/index.js',
      '@delthin/dsh-agent-roles/client.js',
      '@delthin/dsh-agent-roles/runtime.js',
      '@delthin/dsh-agent-roles/fallback.js',
      '@delthin/dsh-agent-roles/store.js',
      '@delthin/dsh-agent-roles/skills.js',
    ].map(relative => fileURLToPath(new URL(`./node_modules/${relative}`, import.meta.url))),
  ]
  const nativeTeamArtifacts = [
    '../../packages/team/agent-team/lib/index.js',
    '../../packages/team/tool-agent-team/lib/index.js',
    '../../packages/client/ui-agent-team/lib/index.js',
  ].map(relative => fileURLToPath(new URL(relative, import.meta.url)))
  const capabilityOverlays: Record<TenantCapability, string> = {
    team: fileURLToPath(new URL('./team.overlay.yml', import.meta.url)),
    ptc: fileURLToPath(new URL('./ptc.overlay.yml', import.meta.url)),
    'apply-patch': fileURLToPath(new URL('./apply-patch.overlay.yml', import.meta.url)),
  }
  const capabilityArtifacts: Record<TenantCapability, readonly string[]> = {
    team: ['../../packages/team/agent-team/lib/index.js', '../../packages/team/tool-agent-team/lib/index.js'],
    ptc: ['../../packages/core/tool-executor-ptc/lib/index.js', '../../packages/fs/tool-fs/lib/index.js'],
    'apply-patch': ['../../packages/fs/tool-fs/lib/index.js'],
  }
  const httpArtifacts = [
    './http-doc.overlay.yml',
    '../../packages/experimental/tool-http-doc/lib/index.js',
    '../../packages/experimental/client-ui-http-doc/lib/index.js',
    '../../packages/experimental/client-ui-http-doc/lib/client.js',
  ].map(relative => fileURLToPath(new URL(relative, import.meta.url)))
  const requirementsArtifacts = [
    './cpic-requirements.overlay.yml',
    '../../extensions/cpic-requirements/package.json',
    '../../extensions/cpic-requirements/index.js',
    '../../extensions/cpic-requirements/business.js',
    '../../extensions/cpic-requirements/engine.js',
    '../../extensions/cpic-requirements/pipeline.js',
    '../../extensions/cpic-requirements/pipeline.yaml',
    '../../extensions/cpic-requirements/role.js',
    '../../extensions/cpic-requirements/roles.js',
    '../../extensions/cpic-requirements/roles/clarifier/.dsh/skills/requirement-clarification/SKILL.md',
    '../../extensions/cpic-requirements/roles/extractor/.dsh/skills/feature-point-extraction/SKILL.md',
    '../../extensions/cpic-requirements/roles/outline-gen/.dsh/skills/test-outline-writing/SKILL.md',
    '../../extensions/cpic-requirements/roles/outline-review/.dsh/skills/test-outline-review/SKILL.md',
    '../../extensions/cpic-requirements/roles/case-gen/.dsh/skills/testcase-writing/SKILL.md',
    '../../extensions/cpic-requirements/roles/case-review/.dsh/skills/testcase-review/SKILL.md',
    '../../extensions/cpic-requirements/xtest-http.js',
    '../../extensions/cpic-requirements/methods.js',
    '../../extensions/cpic-requirements/mode.js',
    '../../extensions/cpic-requirements/worker.js',
    '../../extensions/cpic-requirements/execution-events.js',
    '../../extensions/cpic-requirements/traceability.js',
    './cpic-preset.js',
    '../../extensions/cpic-requirements/client.js',
    '../../extensions/cpic-requirements/qa-workbench.js',
  ].map(relative => fileURLToPath(new URL(relative, import.meta.url)))
  const workflowPanelArtifacts = [
    './workflow-panel.overlay.yml',
    '../../extensions/dsh-workflow-panel/package.json',
    '../../extensions/dsh-workflow-panel/index.js',
    '../../extensions/dsh-workflow-panel/client.js',
  ].map(relative => fileURLToPath(new URL(relative, import.meta.url)))
  const skillManagementArtifacts = [
    './skill-management.overlay.yml',
    '../../packages/client/ui-settings-skill-management/lib/index.js',
  ].map(relative => fileURLToPath(new URL(relative, import.meta.url)))
  const agentPresetRegistryArtifact = fileURLToPath(new URL('../../packages/preset/agent-preset-registry/lib/index.js', import.meta.url))
  const resolvedCapabilityArtifacts: Record<TenantCapability, readonly string[]> = {
    team: capabilityArtifacts.team.map(relative => fileURLToPath(new URL(relative, import.meta.url))),
    ptc: capabilityArtifacts.ptc.map(relative => fileURLToPath(new URL(relative, import.meta.url))),
    'apply-patch': capabilityArtifacts['apply-patch'].map(relative => fileURLToPath(new URL(relative, import.meta.url))),
  }
  const capabilityPlugins: TenantCapabilityPluginRegistry = createTenantCapabilityPluginRegistry([
    { id: 'team', overlayFile: capabilityOverlays.team, artifacts: resolvedCapabilityArtifacts.team, isolation: 'process' },
    { id: 'ptc', overlayFile: capabilityOverlays.ptc, artifacts: resolvedCapabilityArtifacts.ptc, isolation: 'process' },
    { id: 'apply-patch', overlayFile: capabilityOverlays['apply-patch'], artifacts: resolvedCapabilityArtifacts['apply-patch'], isolation: 'workspace' },
    ...plugins,
  ])
  const baseEnvironment = scrubbedEnvironment(environment)
  const modelSettings = MODEL_ENVIRONMENT_NAMES.map(name => [name, environment[name]] as const)
  const configuredModelSettings = modelSettings.filter((entry): entry is readonly [typeof MODEL_ENVIRONMENT_NAMES[number], string] => entry[1] !== undefined)
  if (configuredModelSettings.length !== 0 && configuredModelSettings.length !== MODEL_ENVIRONMENT_NAMES.length) {
    const missing = modelSettings.filter(([, value]) => value === undefined).map(([name]) => name)
    throw new Error(`tenant model provider configuration is incomplete; set ${missing.join(', ')}`)
  }
  const modelEnvironment = Object.fromEntries(configuredModelSettings)
  const modelProviderEnabled = configuredModelSettings.length === MODEL_ENVIRONMENT_NAMES.length
  delete baseEnvironment[CPIC_API_URL_ENVIRONMENT_NAME]
  delete baseEnvironment[CPIC_API_SECRET_ENVIRONMENT_NAME]
  delete baseEnvironment.DSH_CPIC_API_URL
  delete baseEnvironment.DSH_CPIC_API_SECRET
  return async (tenant, generation) => {
    try {
      await access(cliFile)
    } catch (error) {
      throw new Error(`built DSH CLI is unavailable at ${JSON.stringify(cliFile)}; run pnpm run build first`, { cause: error })
    }
    for (const artifact of nativeTeamArtifacts) {
      try {
        await access(artifact)
      } catch (error) {
        throw new Error(`native Team build artifact is unavailable at ${JSON.stringify(artifact)}; run pnpm run build before startup`, { cause: error })
      }
    }
    for (const artifact of communityArtifacts) {
      try {
        await access(artifact)
      } catch (error) {
        throw new Error(`tenant community plugin deployment artifact is unavailable at ${JSON.stringify(artifact)}; run pnpm --dir scripts/multi-user install --frozen-lockfile --ignore-scripts --config.auto-install-peers=false before startup`, { cause: error })
      }
    }
    if (modelProviderEnabled) {
      try {
        await access(modelProviderOverlayFile)
      } catch (error) {
        throw new Error(`model provider deployment overlay is unavailable at ${JSON.stringify(modelProviderOverlayFile)}; restore the repository file before startup`, { cause: error })
      }
    }
    for (const artifact of httpArtifacts) {
      try {
        await access(artifact)
      } catch (error) {
        throw new Error(`HTTP request deployment artifact is unavailable at ${JSON.stringify(artifact)}; build both optional HTTP packages first`, { cause: error })
      }
    }
    for (const artifact of requirementsArtifacts) {
      try {
        await access(artifact)
      } catch (error) {
        throw new Error(`CPICHarness requirements deployment artifact is unavailable at ${JSON.stringify(artifact)}; restore the source extension before startup`, { cause: error })
      }
    }
    for (const artifact of workflowPanelArtifacts) {
      try {
        await access(artifact)
      } catch (error) {
        throw new Error(`workflow panel deployment artifact is unavailable at ${JSON.stringify(artifact)}; restore the source extension before startup`, { cause: error })
      }
    }
    for (const artifact of skillManagementArtifacts) {
      try {
        await access(artifact)
      } catch (error) {
        throw new Error(`Skills management deployment artifact is unavailable at ${JSON.stringify(artifact)}; build the Skills client package before startup`, { cause: error })
      }
    }
    try {
      const registrySource = await readFile(agentPresetRegistryArtifact, 'utf8')
      if (!/definition\(id\)/u.test(registrySource)) {
        throw new Error('Agent preset registry does not expose definition(id)')
      }
    } catch (error) {
      throw new Error(`Agent preset registry deployment artifact is incompatible at ${JSON.stringify(agentPresetRegistryArtifact)}; rebuild Host libraries before startup`, { cause: error })
    }
    const capabilityIds = [...(tenant.capabilities ?? []), ...(tenant.plugins ?? [])]
    if (new Set(capabilityIds).size !== capabilityIds.length) {
      throw new Error(`tenant ${JSON.stringify(tenant.tenantId)} enables the same capability more than once`)
    }
    const enabledPlugins = capabilityIds
      .map(id => capabilityPlugins.get(id) ?? (() => { throw new Error(`tenant capability plugin ${JSON.stringify(id)} is not registered`) })())
      .filter(plugin => plugin.id !== 'team')
    for (const plugin of enabledPlugins) {
      try {
        await access(plugin.overlayFile)
        for (const artifact of plugin.artifacts) await access(artifact)
      } catch (error) {
        throw new Error(`tenant capability plugin ${JSON.stringify(plugin.id)} deployment artifact is unavailable at ${JSON.stringify(plugin.overlayFile)}; build or install its declared provider first`, { cause: error })
      }
    }
    const child = spawn(process.execPath, [
      cliFile,
      '--profile', 'web',
      '--patch', overlayFile,
      '--patch', requirementsOverlayFile,
      '--patch', workflowPanelOverlayFile,
      '--patch', skillManagementOverlayFile,
      ...communityOverlays.flatMap(overlay => ['--patch', overlay]),
      ...(modelProviderEnabled ? ['--patch', modelProviderOverlayFile] : []),
      ...enabledPlugins.flatMap(plugin => ['--patch', plugin.overlayFile]),
      '--host', '127.0.0.1',
      '--port', String(tenant.port),
      ...(publicUrl === undefined || publicAuthority === undefined ? [] : [
        '--public-url', publicUrl,
        '--trusted-host', publicAuthority,
      ]),
      '--no-open',
    ], {
      cwd: tenant.workspace,
      env: {
        ...baseEnvironment,
        DSH_HOME: tenant.dshHome,
        DSH_AGENTS_HOME: tenant.dshHome,
        DSH_PERMISSION_MODE: 'workspace-write',
        DSH_INSTANCE_GENERATION: String(generation),
        ...modelEnvironment,
        ...(environment.DSH_CPIC_API_URL === undefined ? {} : { [CPIC_API_URL_ENVIRONMENT_NAME]: environment.DSH_CPIC_API_URL }),
        ...(environment.DSH_CPIC_API_SECRET === undefined ? {} : { [CPIC_API_SECRET_ENVIRONMENT_NAME]: environment.DSH_CPIC_API_SECRET }),
        CPIC_GATEWAY_USER: tenant.externalUserId,
        CPIC_GATEWAY_TENANT_ID: tenant.tenantId,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    return processHandle(child)
  }
}

function processHandle(child: ChildProcessByStdio<null, Readable, Readable>): TenantProcess {
  const exited = new Promise<TenantProcessExit>((resolve) => {
    let settled = false
    const settle = (exit: TenantProcessExit): void => {
      if (settled) return
      settled = true
      resolve(exit)
    }
    child.once('error', (error) => { settle({ code: null, signal: null, error }) })
    child.once('exit', (code, signal) => { settle({ code, signal }) })
  })
  return {
    pid: child.pid,
    stdout: child.stdout,
    stderr: child.stderr,
    exited,
    kill: signal => child.kill(signal),
  }
}

/** Owns all child processes launched from one immutable static tenant registry. */
export class StaticTenantInstanceManager {
  private readonly runtimes = new Map<string, TenantRuntime>()
  private readonly options: ResolvedManagerOptions

  /**
   * @param config - Validated static tenant registry.
   * @param launcher - Process launcher; production use normally supplies {@link createLocalDshLauncher}.
   * @param options - Lifecycle deadlines, diagnostics bound, and clock.
   */
  constructor(
    config: StaticTenantConfig,
    private readonly launcher: TenantProcessLauncher,
    options: StaticTenantInstanceManagerOptions = {},
  ) {
    this.options = {
      startupTimeoutMs: positiveInteger(options.startupTimeoutMs, DEFAULT_STARTUP_TIMEOUT_MS, 'startupTimeoutMs'),
      shutdownTimeoutMs: positiveInteger(options.shutdownTimeoutMs, DEFAULT_SHUTDOWN_TIMEOUT_MS, 'shutdownTimeoutMs'),
      forceExitTimeoutMs: positiveInteger(options.forceExitTimeoutMs, DEFAULT_FORCE_EXIT_TIMEOUT_MS, 'forceExitTimeoutMs'),
      maxDiagnosticChars: positiveInteger(options.maxDiagnosticChars, DEFAULT_MAX_DIAGNOSTIC_CHARS, 'maxDiagnosticChars'),
      logDirectory: resolve(options.logDirectory ?? join(homedir(), '.dsh', 'multi-user-tenant-logs')),
      now: options.now ?? Date.now,
    }
    for (const tenant of config.tenants) {
      this.runtimes.set(tenant.tenantId, {
        tenant,
        state: 'stopped',
        generation: 0,
        child: undefined,
        start: undefined,
        stop: undefined,
        authenticatedUrl: undefined,
        startedAt: undefined,
        readyAt: undefined,
        lastError: undefined,
        diagnostics: '',
      })
    }
  }

  /** 灏嗗垰鍐欏叆 tenants.json 鐨勬柊绉熸埛娉ㄥ唽鍒板綋鍓嶈繘绋嬨€?*/
  registerTenant(tenant: StaticTenant): void {
    if (this.runtimes.has(tenant.tenantId)) throw new Error(`tenant ${JSON.stringify(tenant.tenantId)} is already registered`)
    if ([...this.runtimes.values()].some(runtime => runtime.tenant.externalUserId === tenant.externalUserId)) {
      throw new Error(`external user ${JSON.stringify(tenant.externalUserId)} is already registered`)
    }
    this.runtimes.set(tenant.tenantId, {
      tenant,
      state: 'stopped',
      generation: 0,
      child: undefined,
      start: undefined,
      stop: undefined,
      authenticatedUrl: undefined,
      startedAt: undefined,
      readyAt: undefined,
      lastError: undefined,
      diagnostics: '',
    })
  }

  /**
   * Return every tenant in static configuration order.
   * @returns fresh snapshots that cannot mutate manager state.
   */
  list(): TenantInstanceSnapshot[] {
    return [...this.runtimes.values()].map(snapshotOf)
  }

  /**
   * Return one tenant's current state.
   * @param tenantId - Stable internal tenant identity.
   * @returns a fresh snapshot.
   * @throws `tenant-not-found` when the static registry has no such tenant.
   */
  status(tenantId: string): TenantInstanceSnapshot {
    return snapshotOf(this.requireRuntime(tenantId))
  }

  /**
   * Start one tenant or join its existing startup.
   * @param tenantId - Stable internal tenant identity.
   * @returns running state and the authenticated URL emitted at readiness.
   * @throws a typed failure after a failed startup child reaches exit.
   */
  ensureInstanceRunning(tenantId: string): Promise<TenantInstanceReady> {
    const runtime = this.requireRuntime(tenantId)
    switch (runtime.state) {
      case 'running':
        return Promise.resolve({ instance: snapshotOf(runtime), authenticatedUrl: runtime.authenticatedUrl as string })
      case 'starting':
        return runtime.start as Promise<TenantInstanceReady>
      case 'stopping':
        return (runtime.stop as Promise<void>).then(() => this.ensureInstanceRunning(tenantId))
      case 'stopped':
      case 'failed': {
        const starting = this.start(runtime)
        runtime.start = starting
        return starting
      }
      default:
        runtime.state satisfies never
        throw new Error(`unsupported tenant instance state ${String(runtime.state)}`)
    }
  }

  /**
   * Stop one tenant and wait until its child exits.
   * @param tenantId - Stable internal tenant identity.
   * @returns after graceful exit or bounded forceful termination.
   * @throws `stop-failed` when the child remains live after both deadlines.
   */
  stopInstance(tenantId: string): Promise<void> {
    const runtime = this.requireRuntime(tenantId)
    if (runtime.state === 'stopped') return Promise.resolve()
    if (runtime.state === 'stopping') return runtime.stop as Promise<void>
    if (runtime.state === 'starting') {
      const startup = runtime.start as Promise<TenantInstanceReady>
      const child = runtime.child
      runtime.state = 'stopping'
      child?.kill('SIGTERM')
      const stopping = startup.then(
        () => this.stopRunning(runtime),
        () => { this.markStopped(runtime) },
      ).finally(() => {
        if (runtime.stop === stopping) runtime.stop = undefined
      })
      runtime.stop = stopping
      return stopping
    }
    if (runtime.child === undefined) {
      this.markStopped(runtime)
      return Promise.resolve()
    }
    const stopping = this.stopRunning(runtime).finally(() => {
      if (runtime.stop === stopping) runtime.stop = undefined
    })
    runtime.stop = stopping
    return stopping
  }

  /** Stop every configured tenant and settle only after every stop attempt finishes. */
  async dispose(): Promise<void> {
    const results = await Promise.allSettled([...this.runtimes.keys()].map(id => this.stopInstance(id)))
    const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (failures.length > 0) throw new AggregateError(failures, 'one or more tenant instances failed to stop')
  }

  private requireRuntime(tenantId: string): TenantRuntime {
    const runtime = this.runtimes.get(tenantId)
    if (runtime === undefined) {
      throw new TenantInstanceError('tenant-not-found', tenantId, `static tenant ${JSON.stringify(tenantId)} is not configured`)
    }
    return runtime
  }

  private isStarting(runtime: TenantRuntime, generation: number): boolean {
    return runtime.generation === generation && runtime.state === 'starting'
  }

  private async start(runtime: TenantRuntime): Promise<TenantInstanceReady> {
    runtime.generation += 1
    const generation = runtime.generation
    runtime.state = 'starting'
    runtime.startedAt = this.options.now()
    runtime.readyAt = undefined
    runtime.authenticatedUrl = undefined
    runtime.lastError = undefined
    runtime.diagnostics = ''

    let child: TenantProcess
    try {
      child = await this.launcher(runtime.tenant, generation)
    } catch (error) {
      const failure = new TenantInstanceError(
        'start-failed', runtime.tenant.tenantId,
        `failed to launch tenant ${JSON.stringify(runtime.tenant.tenantId)}: ${String(error)}`,
        { cause: error },
      )
      this.fail(runtime, generation, failure)
      throw failure
    }
    if (!this.isStarting(runtime, generation)) {
      child.kill('SIGTERM')
      await child.exited
      throw new TenantInstanceError('stopped-before-ready', runtime.tenant.tenantId, `tenant ${JSON.stringify(runtime.tenant.tenantId)} startup was superseded`)
    }
    runtime.child = child
    const ready = Promise.withResolvers<string>()
    let stdout = ''
    const consume = (stream: 'stdout' | 'stderr', chunk: Buffer | string): void => {
      const text = chunk.toString()
      if (stream === 'stderr') {
        void writeTenantDiagnostic(this.options.logDirectory, runtime.tenant.tenantId, generation, stream, text).catch(error => {
          this.appendDiagnostic(runtime, `tenant log write failed: ${error instanceof Error ? error.message : String(error)}\n`)
        })
        this.appendDiagnostic(runtime, text)
        return
      }
      if (runtime.generation !== generation || runtime.state !== 'starting') return
      stdout += text
      if (stdout.length > this.options.maxDiagnosticChars) stdout = stdout.slice(-this.options.maxDiagnosticChars)
      for (;;) {
        const end = stdout.indexOf('\n')
        if (end < 0) break
        const line = stdout.slice(0, end).replace(/\r$/u, '')
        stdout = stdout.slice(end + 1)
        const safeLine = line.startsWith(READY_PREFIX) ? 'dsh web: [authenticated URL omitted]' : line
        void writeTenantDiagnostic(this.options.logDirectory, runtime.tenant.tenantId, generation, 'stdout', safeLine).catch(error => {
          this.appendDiagnostic(runtime, `tenant log write failed: ${error instanceof Error ? error.message : String(error)}\n`)
        })
        if (line.startsWith(READY_PREFIX)) ready.resolve(line.slice(READY_PREFIX.length))
        this.appendDiagnostic(runtime, `${safeLine}\n`)
      }
    }
    child.stdout.on('data', (chunk: Buffer | string) => { consume('stdout', chunk) })
    child.stderr.on('data', (chunk: Buffer | string) => { consume('stderr', chunk) })
    void child.exited.then((exit) => { this.observeExit(runtime, generation, exit) })

    try {
      const authenticatedUrl = await raceDeadline(
        Promise.race([
          ready.promise,
          child.exited.then((exit) => {
            throw new TenantInstanceError(
              'stopped-before-ready', runtime.tenant.tenantId,
              `tenant ${JSON.stringify(runtime.tenant.tenantId)} exited before readiness (${diagnosticOf(exit)})${this.diagnosticSuffix(runtime)}`,
              exit.error === undefined ? undefined : { cause: exit.error },
            )
          }),
        ]),
        this.options.startupTimeoutMs,
        () => new TenantInstanceError(
          'startup-timeout', runtime.tenant.tenantId,
          `tenant ${JSON.stringify(runtime.tenant.tenantId)} did not become ready within ${this.options.startupTimeoutMs}ms${this.diagnosticSuffix(runtime)}`,
        ),
      )
      if (!this.isStarting(runtime, generation)) {
        throw new TenantInstanceError('stopped-before-ready', runtime.tenant.tenantId, `tenant ${JSON.stringify(runtime.tenant.tenantId)} stopped during startup`)
      }
      runtime.state = 'running'
      runtime.readyAt = this.options.now()
      runtime.authenticatedUrl = authenticatedUrl
      return { instance: snapshotOf(runtime), authenticatedUrl }
    } catch (error) {
      const failure = error instanceof TenantInstanceError
        ? error
        : new TenantInstanceError('start-failed', runtime.tenant.tenantId, `tenant ${JSON.stringify(runtime.tenant.tenantId)} startup failed: ${String(error)}`, { cause: error })
      if (runtime.generation === generation && runtime.child === child) {
        await this.terminateAfterFailure(runtime, child)
        this.fail(runtime, generation, failure)
      }
      throw failure
    } finally {
      if (runtime.generation === generation) runtime.start = undefined
    }
  }

  private async stopRunning(runtime: TenantRuntime): Promise<void> {
    const generation = runtime.generation
    const child = runtime.child as TenantProcess
    runtime.state = 'stopping'
    child.kill('SIGTERM')
    try {
      await raceDeadline(child.exited, this.options.shutdownTimeoutMs, () => new Error('graceful shutdown timed out'))
    } catch {
      child.kill('SIGKILL')
      try {
        await raceDeadline(child.exited, this.options.forceExitTimeoutMs, () => new Error('forced shutdown timed out'))
      } catch (error) {
        const failure = new TenantInstanceError(
          'stop-failed', runtime.tenant.tenantId,
          `tenant ${JSON.stringify(runtime.tenant.tenantId)} did not exit after SIGTERM and SIGKILL`,
          { cause: error },
        )
        this.fail(runtime, generation, failure, false)
        throw failure
      }
    }
    if (runtime.generation === generation) this.markStopped(runtime)
  }

  private markStopped(runtime: TenantRuntime): void {
    runtime.state = 'stopped'
    runtime.child = undefined
    runtime.authenticatedUrl = undefined
    runtime.startedAt = undefined
    runtime.readyAt = undefined
    runtime.lastError = undefined
  }

  private async terminateAfterFailure(runtime: TenantRuntime, child: TenantProcess): Promise<void> {
    child.kill('SIGTERM')
    try {
      await raceDeadline(child.exited, this.options.shutdownTimeoutMs, () => new Error('startup cleanup timed out'))
    } catch {
      child.kill('SIGKILL')
      await raceDeadline(child.exited, this.options.forceExitTimeoutMs, () =>
        new TenantInstanceError('stop-failed', runtime.tenant.tenantId, `tenant ${JSON.stringify(runtime.tenant.tenantId)} survived startup cleanup`))
    }
  }

  private observeExit(runtime: TenantRuntime, generation: number, exit: TenantProcessExit): void {
    if (runtime.generation !== generation || runtime.state !== 'running') return
    const failure = new TenantInstanceError(
      'start-failed', runtime.tenant.tenantId,
      `tenant ${JSON.stringify(runtime.tenant.tenantId)} exited unexpectedly (${diagnosticOf(exit)})${this.diagnosticSuffix(runtime)}`,
      exit.error === undefined ? undefined : { cause: exit.error },
    )
    this.fail(runtime, generation, failure)
  }

  private fail(runtime: TenantRuntime, generation: number, failure: Error, clearChild = true): void {
    if (runtime.generation !== generation) return
    runtime.state = 'failed'
    if (clearChild) runtime.child = undefined
    runtime.authenticatedUrl = undefined
    runtime.readyAt = undefined
    runtime.lastError = failure.message
  }

  private appendDiagnostic(runtime: TenantRuntime, text: string): void {
    runtime.diagnostics = `${runtime.diagnostics}${text}`.slice(-this.options.maxDiagnosticChars)
  }

  private diagnosticSuffix(runtime: TenantRuntime): string {
    const diagnostic = runtime.diagnostics.trim()
    return diagnostic === '' ? '' : `; recent output: ${diagnostic}`
  }
}
