import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { parseDshArgs } from '../../apps/cli/src/args.ts'
import { createLocalDshLauncher } from './instance-manager.ts'
import type { StaticTenant } from './tenant-config.ts'

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), access: vi.fn(), readFile: vi.fn() }))
vi.mock('node:child_process', async (original) => ({
  ...await original<typeof import('node:child_process')>(), spawn: mocks.spawn,
}))
vi.mock('node:fs/promises', async (original) => ({
  ...await original<typeof import('node:fs/promises')>(), access: mocks.access, readFile: mocks.readFile,
}))
const overlay = fileURLToPath(new URL('./http-doc.overlay.yml', import.meta.url))
const cli = fileURLToPath(new URL('../../apps/cli/lib/bin.js', import.meta.url))
const hostEntry = fileURLToPath(new URL('../../packages/experimental/tool-http-doc/lib/index.js', import.meta.url))
const clientEntry = fileURLToPath(new URL('../../packages/experimental/client-ui-http-doc/lib/index.js', import.meta.url))
const clientBundle = fileURLToPath(new URL('../../packages/experimental/client-ui-http-doc/lib/client.js', import.meta.url))
const requirementsOverlay = fileURLToPath(new URL('./cpic-requirements.overlay.yml', import.meta.url))
const requirementsHelper = fileURLToPath(new URL('./cpic-preset.js', import.meta.url))
const requirementsFiles = [
  'package.json', 'index.js', 'business.js', 'engine.js', 'pipeline.js', 'pipeline.yaml', 'role.js', 'roles.js',
  'roles/clarifier/.dsh/skills/requirement-clarification/SKILL.md',
  'roles/extractor/.dsh/skills/feature-point-extraction/SKILL.md',
  'roles/outline-gen/.dsh/skills/test-outline-writing/SKILL.md',
  'roles/outline-review/.dsh/skills/test-outline-review/SKILL.md',
  'roles/case-gen/.dsh/skills/testcase-writing/SKILL.md',
  'roles/case-review/.dsh/skills/testcase-review/SKILL.md',
  'xtest-http.js', 'methods.js', 'mode.js', 'worker.js', 'execution-events.js', 'traceability.js', 'client.js', 'qa-workbench.js',
]
  .map(file => fileURLToPath(new URL(`../../extensions/cpic-requirements/${file}`, import.meta.url)))
const workflowOverlay = fileURLToPath(new URL('./workflow-panel.overlay.yml', import.meta.url))
const workflowFiles = ['package.json', 'index.js', 'client.js']
  .map(file => fileURLToPath(new URL(`../../extensions/dsh-workflow-panel/${file}`, import.meta.url)))
const skillManagementOverlay = fileURLToPath(new URL('./skill-management.overlay.yml', import.meta.url))
const modelProviderOverlay = fileURLToPath(new URL('./model-provider.overlay.yml', import.meta.url))
const communityOverlays = ['agency-agents', 'agent-teams', 'agent-roles'].map(name =>
  fileURLToPath(new URL(`./${name}.overlay.yml`, import.meta.url)))
const communityFiles = [
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
  '@delthin/dsh-agent-roles/store.js',
  '@delthin/dsh-agent-roles/skills.js',
  '@delthin/dsh-agent-roles/fallback.js',
].map(relative => fileURLToPath(new URL(`./node_modules/${relative}`, import.meta.url)))
const nativeTeamFiles = [
  '../../packages/team/agent-team/lib/index.js',
  '../../packages/team/tool-agent-team/lib/index.js',
  '../../packages/client/ui-agent-team/lib/index.js',
].map(relative => fileURLToPath(new URL(relative, import.meta.url)))
const modelApiEnvironment = {
  DSH_MULTI_USER_OPENAI_MODEL_BASE_URL: 'http://lf24dmbase-ai-sit.life.cpic.com/v1',
  DSH_MULTI_USER_OPENAI_MODEL_API_KEY: 'openai-secret',
  DSH_MULTI_USER_OPENAI_MODEL_ID: 'codewis-7b',
}
const skillManagementHostEntry = fileURLToPath(new URL('../../packages/client/ui-settings-skill-management/lib/index.js', import.meta.url))
const agentPresetRegistryArtifact = fileURLToPath(new URL('../../packages/preset/agent-preset-registry/lib/index.js', import.meta.url))
const ptcPresetOverlay = fileURLToPath(new URL('./ptc.overlay.yml', import.meta.url))
const ptcArtifacts = [
  '../../packages/core/tool-executor-ptc/lib/index.js',
  '../../packages/fs/tool-fs/lib/index.js',
].map(relative => fileURLToPath(new URL(relative, import.meta.url)))
const capabilityOverlays = {
  team: fileURLToPath(new URL('./team.overlay.yml', import.meta.url)),
  ptc: fileURLToPath(new URL('./ptc.overlay.yml', import.meta.url)),
  'apply-patch': fileURLToPath(new URL('./apply-patch.overlay.yml', import.meta.url)),
} as const
const children: FakeChild[] = []
class FakeChild extends EventEmitter {
  readonly pid = 101
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  readonly kill = vi.fn(() => true)
}
function tenant(id: string, port: number, capabilities?: StaticTenant['capabilities']): StaticTenant {
  return { tenantId: id, externalUserId: id, port,
    dshHome: fileURLToPath(new URL(`./fixture-${id}/home`, import.meta.url)),
    workspace: fileURLToPath(new URL(`./fixture-${id}/workspace`, import.meta.url)),
    ...(capabilities === undefined ? {} : { capabilities }) }
}
function launcher(environment: NodeJS.ProcessEnv = {}, publicUrl?: string) {
  return createLocalDshLauncher(cli, environment, publicUrl)
}
beforeEach(() => {
  mocks.access.mockReset().mockResolvedValue(undefined)
  mocks.readFile.mockReset().mockResolvedValue('definition(id)')
  mocks.spawn.mockReset().mockImplementation(() => {
    const child = new FakeChild(); children.push(child); return child
  })
})
afterEach(() => {
  for (const child of children.splice(0)) {
    child.stdout.end(); child.stderr.end(); child.emit('exit', 0, null)
  }
})
describe('local tenant HTTP deployment overlay', () => {
  it('mounts HTTP for existing and later tenants while preserving isolation and scrubbing secrets', async () => {
    const launch = launcher({ PATH: 'fixture-path', DSH_HOME: 'must-not-leak', ...modelApiEnvironment,
      DSH_PERMISSION_MODE: 'danger-full-access', DEEPSEEK_API_KEY: 'must-not-leak', CPIC_GATEWAY_USER: 'wrong-user', DSH_CPIC_API_URL: 'https://xtest.internal/xtest/api/dsh/internal/cpic', DSH_CPIC_API_SECRET: 'private-cpic-secret' }, 'http://127.0.0.1:3000')
    const tenants = [tenant('existing', 3081), tenant('added', 3082)]
    for (const [index, value] of tenants.entries()) await launch(value, index + 1)
    for (const [index, value] of tenants.entries()) {
      expect(mocks.spawn).toHaveBeenNthCalledWith(index + 1, process.execPath, [
        cli, '--profile', 'web', '--patch', overlay, '--patch', requirementsOverlay, '--patch', workflowOverlay,
        '--patch', skillManagementOverlay, ...communityOverlays.flatMap(value => ['--patch', value]), '--patch', modelProviderOverlay,
        '--host', '127.0.0.1', '--port', String(value.port),
        '--public-url', 'http://127.0.0.1:3000', '--trusted-host', '127.0.0.1:3000', '--no-open',
      ], { cwd: value.workspace, env: { PATH: 'fixture-path', DSH_HOME: value.dshHome,
        DSH_AGENTS_HOME: value.dshHome, DSH_PERMISSION_MODE: 'workspace-write', DSH_INSTANCE_GENERATION: String(index + 1), CPIC_GATEWAY_CPIC_URL: 'https://xtest.internal/xtest/api/dsh/internal/cpic', CPIC_GATEWAY_CPIC_SECRET: 'private-cpic-secret', CPIC_GATEWAY_USER: value.externalUserId, CPIC_GATEWAY_TENANT_ID: value.tenantId, ...modelApiEnvironment },
      stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    }
    for (const artifact of [
      overlay, hostEntry, clientEntry, clientBundle, requirementsOverlay, requirementsHelper, ...requirementsFiles,
      workflowOverlay, ...workflowFiles, skillManagementOverlay, skillManagementHostEntry,
      ...communityOverlays, ...communityFiles, modelProviderOverlay,
    ]) expect(mocks.access).toHaveBeenCalledWith(artifact)
  })
  it('loads community plugins by default without model credentials or optional capabilities', async () => {
    await launcher()(tenant('defaults', 3081), 1)
    const args: string[] = mocks.spawn.mock.calls[0]?.[1] ?? []
    for (const overlay of communityOverlays) expect(args.filter(value => value === overlay)).toHaveLength(1)
    expect(args).not.toContain(capabilityOverlays.team)
    expect(args).not.toContain(modelProviderOverlay)
  })
  it.each([...communityOverlays, ...communityFiles])('rejects a missing community plugin artifact before spawning: %s', async (missing) => {
    mocks.access.mockImplementation(async (path: string) => { if (path === missing) throw new Error('fixture missing artifact') })
    await expect(launcher()(tenant('missing-community', 3081), 1)).rejects.toThrow('tenant community plugin deployment artifact is unavailable')
    expect(mocks.spawn).not.toHaveBeenCalled()
  })
  it('anchors community Host and Remote entries beside the deployment and keeps team state workspace-relative', () => {
    const rows = communityOverlays.flatMap(overlay => loadOverlayPatches('test', overlay).flatMap(patch => patch.insert ?? []))
    expect(rows).toEqual([
      { id: 'agency-agents-remote', name: pathToFileURL(communityFiles[2]!).href },
      { id: 'agency-agents', name: pathToFileURL(communityFiles[1]!).href },
      { id: 'agent-teams', name: pathToFileURL(communityFiles[5]!).href, config: { stateDir: '.agent-teams', memberProvider: 'spawn' } },
      { id: 'agent-roles', name: pathToFileURL(communityFiles[8]!).href, config: {} },
    ])
  })
  it('enables existing native Team rows without inserting duplicate services', () => {
    const roles = loadOverlayPatches('test', communityOverlays[2]!)
    expect(roles[0]).toEqual({ id: 'agent-team', config: { defaultEnabled: true } })
    expect(loadOverlayPatches('test', capabilityOverlays.team)).toEqual([roles[0]])
    expect(roles.flatMap(patch => patch.insert ?? []).map(row => row.id)).toEqual(['agent-roles'])
  })
  it.each(nativeTeamFiles)('reports a missing current native Team build without suggesting plugin installation: %s', async missing => {
    mocks.access.mockImplementation(async (path: string) => { if (path === missing) throw new Error('fixture missing build') })
    await expect(launcher()(tenant('missing-team-build', 3081), 1)).rejects.toThrow('native Team build artifact is unavailable')
    expect(mocks.spawn).not.toHaveBeenCalled()
  })
  it('never checks removed experimental Team entries or the unscoped Roles package', async () => {
    await launcher()(tenant('current-entries', 3081), 1)
    const checked = mocks.access.mock.calls.map(([path]) => String(path).replaceAll('\\', '/'))
    expect(checked.some(path => /packages\/experimental\/(?:agent-team|tool-agent-team|client-ui-agent-team)\//u.test(path))).toBe(false)
    expect(checked.some(path => path.includes('/node_modules/dsh-agent-roles/'))).toBe(false)
    for (const artifact of nativeTeamFiles) expect(mocks.access).toHaveBeenCalledWith(artifact)
  })
  it('admits the authority of a remote browser-facing Gateway URL', async () => {
    await launcher(modelApiEnvironment, 'http://29.149.65.178:3000')(tenant('remote', 3081), 1)
    expect(mocks.spawn.mock.calls[0]?.[1]).toEqual(expect.arrayContaining([
      '--public-url', 'http://29.149.65.178:3000', '--trusted-host', '29.149.65.178:3000',
    ]))
  })
  it('adds only explicitly selected capability overlays', async () => {
    const selected = tenant('capabilities', 3081, ['team', 'ptc', 'apply-patch'])
    await launcher(modelApiEnvironment)(selected, 1)
    expect(mocks.spawn.mock.calls[0]?.[1]).toEqual([
      cli, '--profile', 'web', '--patch', overlay, '--patch', requirementsOverlay, '--patch', workflowOverlay,
      '--patch', skillManagementOverlay, ...communityOverlays.flatMap(value => ['--patch', value]), '--patch', modelProviderOverlay, '--patch', capabilityOverlays.ptc,
      '--patch', capabilityOverlays['apply-patch'], '--host', '127.0.0.1', '--port', '3081', '--no-open',
    ])
  })

  it('injects the server-only XTEST CPIC API settings and never injects the legacy database variable', async () => {
    await launcher({ ...modelApiEnvironment, DSH_CPIC_API_URL: 'https://xtest.internal/xtest/api/dsh/internal/cpic', DSH_CPIC_API_SECRET: 'private-cpic-secret' })(tenant('cpic', 3081), 1)
    expect(mocks.spawn.mock.calls[0]?.[2]).toMatchObject({ env: {
      CPIC_GATEWAY_CPIC_URL: 'https://xtest.internal/xtest/api/dsh/internal/cpic',
      CPIC_GATEWAY_CPIC_SECRET: 'private-cpic-secret',
      CPIC_GATEWAY_USER: 'cpic',
      CPIC_GATEWAY_TENANT_ID: 'cpic',
    } })
    expect(mocks.spawn.mock.calls[0]?.[2].env.CPIC_REQUIREMENTS_DATABASE_CONFIG).toBeUndefined()
  })
  it('produces arguments accepted by the real CLI parser as the web profile', async () => {
    await launcher(modelApiEnvironment)(tenant('parser', 3081), 1)
    const args: string[] = mocks.spawn.mock.calls[0]?.[1] ?? []
    const exit = vi.spyOn(process, 'exit').mockImplementation(code => { throw new Error(`CLI exited: ${String(code)}`) })
    try {
      expect(parseDshArgs(args.slice(1), 'test')).toEqual({
        mode: 'profile', profile: 'web', fromDefaultProfile: undefined, patches: [overlay, requirementsOverlay, workflowOverlay, skillManagementOverlay, ...communityOverlays, modelProviderOverlay],
        args: ['--host', '127.0.0.1', '--port', '3081', '--no-open'],
      })
      expect(exit).not.toHaveBeenCalled()
    } finally { exit.mockRestore() }
  })
  it('rejects partially configured model providers before spawning', () => {
    expect(() => launcher({ DSH_MULTI_USER_OPENAI_MODEL_ID: 'codewis-7b' }))
      .toThrow('tenant model provider configuration is incomplete')
    expect(mocks.spawn).not.toHaveBeenCalled()
  })
  it('preflights the model provider overlay only when deployment credentials enable it', async () => {
    mocks.access.mockImplementation(async (path: string) => { if (path === modelProviderOverlay) throw new Error('fixture missing artifact') })
    await expect(launcher()(tenant('settings-managed', 3081), 1)).resolves.toBeDefined()
    await expect(launcher(modelApiEnvironment)(tenant('deployment-managed', 3082), 1))
      .rejects.toThrow('model provider deployment overlay is unavailable')
  })
  it.each([overlay, hostEntry, clientEntry, clientBundle])('rejects a missing HTTP artifact before spawning: %s', async (missing) => {
    mocks.access.mockImplementation(async (path: string) => { if (path === missing) throw new Error('fixture missing artifact') })
    await expect(launcher()(tenant('existing', 3081), 1)).rejects.toThrow('HTTP request deployment artifact is unavailable')
    expect(mocks.spawn).not.toHaveBeenCalled()
  })
  it.each([requirementsOverlay, requirementsHelper, ...requirementsFiles])('rejects a missing requirements artifact before spawning: %s', async (missing) => {
    mocks.access.mockImplementation(async (path: string) => { if (path === missing) throw new Error('fixture missing artifact') })
    await expect(launcher()(tenant('existing', 3081), 1)).rejects.toThrow('CPICHarness requirements deployment artifact is unavailable')
    expect(mocks.spawn).not.toHaveBeenCalled()
  })
  it.each([skillManagementOverlay, skillManagementHostEntry])('rejects a missing Skills artifact before spawning: %s', async (missing) => {
    mocks.access.mockImplementation(async (path: string) => { if (path === missing) throw new Error('fixture missing artifact') })
    await expect(launcher()(tenant('existing', 3081), 1)).rejects.toThrow('Skills management deployment artifact is unavailable')
    expect(mocks.spawn).not.toHaveBeenCalled()
  })
  it('rejects an incompatible Agent preset registry before spawning', async () => {
    mocks.readFile.mockResolvedValue('legacy registry')
    await expect(launcher()(tenant('registry-mismatch', 3081), 1)).rejects.toThrow('Agent preset registry deployment artifact is incompatible')
    expect(mocks.readFile).toHaveBeenCalledWith(agentPresetRegistryArtifact, 'utf8')
    expect(mocks.spawn).not.toHaveBeenCalled()
  })
  it.each([workflowOverlay, ...workflowFiles])('rejects a missing workflow panel artifact before spawning: %s', async (missing) => {
    mocks.access.mockImplementation(async (path: string) => { if (path === missing) throw new Error('fixture missing artifact') })
    await expect(launcher()(tenant('existing', 3081), 1)).rejects.toThrow('workflow panel deployment artifact is unavailable')
    expect(mocks.spawn).not.toHaveBeenCalled()
  })
  it('uses the assigned tenant cwd for first-use workspace initialization instead of system Documents', () => {
    const patches = loadOverlayPatches('test', requirementsOverlay)
    expect(patches.find(patch => patch.id === 'workspace-controller')).toEqual({
      id: 'workspace-controller', name: '@deepseek-ai/dsh-api-workspace-controller',
      config: { defaultWorkspacePath: { __jsExpr: 'process.cwd()' } },
    })
  })
  it('anchors requirement modules beside the source overlay and fixes the tenant workspace as root', () => {
    const rows = loadOverlayPatches('test', requirementsOverlay).flatMap(patch => patch.insert ?? [])
    expect(rows.map(row => row.name)).toEqual([
      '@deepseek-ai/dsh-subagent-spawn-in-process',
      pathToFileURL(requirementsFiles[1]!).href,
      pathToFileURL(requirementsHelper).href,
    ])
    expect(rows[1]?.config).toMatchObject({ rootDirectory: { __jsExpr: 'process.cwd()' }, subagentProvider: 'cpic-case-design' })
    expect(rows[0]?.config).toEqual({ providerName: 'cpic-case-design' })
    expect(rows[2]?.config).toMatchObject({ id: 'case-design' })
    const caseDesignPlugins = (rows[2]?.config as { plugins?: { id?: string; name?: string; group?: boolean; isolate?: object; config?: unknown }[] }).plugins ?? []
    expect(caseDesignPlugins.map(plugin => plugin.name)).toEqual(expect.arrayContaining([
      '@cpic/requirements-workbench/mode',
      '@deepseek-ai/dsh-command-goal',
      '@deepseek-ai/dsh-tool-goal',
      'cordis:group',
    ]))
    const planning = caseDesignPlugins.find(plugin => plugin.id === 'planning')
    expect(planning?.config).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'plan-mode', name: '@deepseek-ai/dsh-plan-mode' }),
    ]))
    const compaction = caseDesignPlugins.find(plugin => plugin.id === 'compaction')
    expect(compaction).toMatchObject({ group: true, isolate: { compaction: true, toolResultPruner: true } })
    expect(compaction?.config).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'compaction-basic', name: '@deepseek-ai/dsh-compaction-basic' }),
      expect.objectContaining({ id: 'command-compact', name: '@deepseek-ai/dsh-command-compact' }),
      expect.objectContaining({ id: 'tool-result-pruner', name: '@deepseek-ai/dsh-compaction-tool-result-pruner', config: { thresholdChars: 8192, headChars: 4096, tailChars: 1024 } }),
    ]))
  })
  it('rejects a missing PTC provider artifact before spawning', async () => {
    mocks.access.mockImplementation(async (path: string) => { if (path === ptcArtifacts[0]) throw new Error('fixture missing artifact') })
    await expect(launcher()(tenant('ptc-missing', 3081, ['ptc']), 1)).rejects.toThrow('tenant capability "ptc" deployment artifact is unavailable')
    expect(mocks.spawn).not.toHaveBeenCalled()
  })

  it('preflights the selected PTC overlay and both required providers', async () => {
    await launcher()(tenant('ptc', 3081, ['ptc']), 1)
    expect(mocks.access).toHaveBeenCalledWith(ptcPresetOverlay)
    for (const artifact of ptcArtifacts) expect(mocks.access).toHaveBeenCalledWith(artifact)
  })

  it('rejects shared-host Computer Use overlays from the capability registry', () => {
    expect(capabilityOverlays).not.toHaveProperty('computer-use-native')
    expect(capabilityOverlays).not.toHaveProperty('computer-use-mcp')
  })

  it('anchors plugin paths to the gateway overlay instead of a tenant working directory', () => {
    const rows = loadOverlayPatches('test', overlay).flatMap(patch => patch.insert ?? [])
    expect(rows.map(row => row.name)).toEqual([pathToFileURL(hostEntry).href, pathToFileURL(clientEntry).href])
    expect(rows[0]?.config).toEqual({ requestTimeoutMs: 30_000, maxBodyChars: 200_000 })
  })
  it('configures the deployment model route without changing the default model', () => {
    const patches = loadOverlayPatches('test', modelProviderOverlay)
    expect(patches).toEqual([
      { id: 'llm-pi-ai', config: { providers: {
        'cpic-openai': {
          displayName: 'CPIC OpenAI-compatible', apiKeyEnv: 'DSH_MULTI_USER_OPENAI_MODEL_API_KEY',
          api: 'openai-completions', baseURL: { __jsExpr: 'process.env.DSH_MULTI_USER_OPENAI_MODEL_BASE_URL' },
          models: [{ id: { __jsExpr: 'process.env.DSH_MULTI_USER_OPENAI_MODEL_ID' }, name: 'CPIC OpenAI-compatible model', contextWindow: 32768, maxTokens: 2000 }],
        },
      } } },
    ])
  })
  it('targets the web bundle Skills Host row without replacing its resolved source', () => {
    const [patch] = loadOverlayPatches('test', skillManagementOverlay)
    expect(patch).toEqual({ id: 'ui-settings-skill-management' })
    expect(patch).not.toHaveProperty('name')
  })
})
