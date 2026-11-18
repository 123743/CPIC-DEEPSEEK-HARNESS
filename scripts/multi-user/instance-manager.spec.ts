import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import {
  StaticTenantInstanceManager,
  TenantInstanceError,
  type TenantProcess,
  type TenantProcessExit,
  type TenantProcessLauncher,
} from './instance-manager.ts'
import type { StaticTenantConfig } from './tenant-config.ts'

interface FakeProcess {
  readonly handle: TenantProcess
  readonly stdout: PassThrough
  readonly stderr: PassThrough
  readonly signals: NodeJS.Signals[]
  exit(exit?: Partial<TenantProcessExit>): void
}

function config(): StaticTenantConfig {
  return {
    version: 1,
    tenants: [
      {
        tenantId: 'tenant-user1',
        externalUserId: 'user1',
        port: 3081,
        dshHome: 'C:\\tenants\\user1\\home',
        workspace: 'C:\\tenants\\user1\\workspace',
      },
      {
        tenantId: 'tenant-user2',
        externalUserId: 'user2',
        port: 3082,
        dshHome: 'C:\\tenants\\user2\\home',
        workspace: 'C:\\tenants\\user2\\workspace',
      },
    ],
  }
}

function fakeProcess(pid = 101, exitOn: readonly NodeJS.Signals[] = []): FakeProcess {
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  const settled = Promise.withResolvers<TenantProcessExit>()
  const signals: NodeJS.Signals[] = []
  let exited = false
  const exit = (value: Partial<TenantProcessExit> = {}): void => {
    if (exited) return
    exited = true
    stdout.end()
    stderr.end()
    settled.resolve({ code: value.code ?? 0, signal: value.signal ?? null, ...(value.error === undefined ? {} : { error: value.error }) })
  }
  return {
    stdout,
    stderr,
    signals,
    exit,
    handle: {
      pid,
      stdout,
      stderr,
      exited: settled.promise,
      kill(signal) {
        signals.push(signal)
        if (exitOn.includes(signal)) exit({ code: null, signal })
        return true
      },
    },
  }
}

function launcherOf(processes: FakeProcess[]): TenantProcessLauncher {
  return vi.fn(async () => {
    const process = processes.shift()
    if (process === undefined) throw new Error('no fake process queued')
    return process.handle
  })
}

function manager(
  launcher: TenantProcessLauncher,
  options: { startupTimeoutMs?: number; shutdownTimeoutMs?: number; forceExitTimeoutMs?: number; logDirectory?: string } = {},
): StaticTenantInstanceManager {
  return new StaticTenantInstanceManager(config(), launcher, {
    startupTimeoutMs: options.startupTimeoutMs ?? 100,
    shutdownTimeoutMs: options.shutdownTimeoutMs ?? 20,
    forceExitTimeoutMs: options.forceExitTimeoutMs ?? 20,
    ...(options.logDirectory === undefined ? {} : { logDirectory: options.logDirectory }),
    now: vi.fn().mockReturnValueOnce(100).mockReturnValue(200),
  })
}

async function startReady(instanceManager: StaticTenantInstanceManager, process: FakeProcess, tenantId = 'tenant-user1'): Promise<string> {
  const started = instanceManager.ensureInstanceRunning(tenantId)
  process.stdout.write('startup line\n')
  process.stdout.write('dsh web: http://127.0.0.1:3081/?token=secret\n')
  return (await started).authenticatedUrl
}

describe('StaticTenantInstanceManager', () => {
  it('persists tenant output without authenticated URLs or credential values', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-tenant-log-'))
    const process = fakeProcess()
    const instanceManager = manager(launcherOf([process]), { logDirectory: directory })
    try {
      await startReady(instanceManager, process)
      process.stderr.write('startup failed: password=top-secret token=private-value\n')
      const log = join(directory, 'tenant-user1-generation-1.log')
      let contents = ''
      for (let attempt = 0; attempt < 100; attempt++) {
        try { contents = await readFile(log, 'utf8') } catch { contents = '' }
        if (contents.includes('[redacted]')) break
        await new Promise(resolve => setTimeout(resolve, 5))
      }
      expect(contents).toContain('dsh web: [authenticated URL omitted]')
      expect(contents).toContain('password=[redacted]')
      expect(contents).toContain('token=[redacted]')
      expect(contents).not.toContain('top-secret')
      expect(contents).not.toContain('private-value')
      expect(contents).not.toContain('token=secret')
    } finally {
      process.exit()
      await instanceManager.stopInstance('tenant-user1')
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('starts one generation and joins concurrent ensure calls until a fragmented readiness line completes', async () => {
    const process = fakeProcess()
    const launch = launcherOf([process])
    const instanceManager = manager(launch)

    const first = instanceManager.ensureInstanceRunning('tenant-user1')
    const second = instanceManager.ensureInstanceRunning('tenant-user1')
    expect(first).toBe(second)
    process.stdout.write('dsh web: http://127.0.0.1:3081/?token=sec')
    await Promise.resolve()
    expect(instanceManager.status('tenant-user1')).toMatchObject({ state: 'starting', generation: 1, pid: 101 })
    process.stdout.write('ret\r\n')

    await expect(first).resolves.toMatchObject({
      authenticatedUrl: 'http://127.0.0.1:3081/?token=secret',
      instance: { state: 'running', generation: 1, startedAt: 100, readyAt: 200 },
    })
    expect(launch).toHaveBeenCalledTimes(1)
    await expect(instanceManager.ensureInstanceRunning('tenant-user1')).resolves.toMatchObject({ instance: { generation: 1 } })
    expect(launch).toHaveBeenCalledTimes(1)
  })

  it('keeps tenants independent and rejects an unknown tenant with a stable code', async () => {
    const first = fakeProcess(101)
    const second = fakeProcess(102)
    const instanceManager = manager(launcherOf([first, second]))
    await Promise.all([
      startReady(instanceManager, first, 'tenant-user1'),
      startReady(instanceManager, second, 'tenant-user2'),
    ])
    expect(instanceManager.list()).toEqual([
      expect.objectContaining({ tenantId: 'tenant-user1', port: 3081, pid: 101, state: 'running' }),
      expect.objectContaining({ tenantId: 'tenant-user2', port: 3082, pid: 102, state: 'running' }),
    ])
    expect(() => instanceManager.status('missing')).toThrow(expect.objectContaining({ code: 'tenant-not-found' }))
  })

  it('reports launcher failure without publishing a child', async () => {
    const launcher = vi.fn<TenantProcessLauncher>(async () => { throw new Error('spawn denied') })
    const instanceManager = manager(launcher)

    await expect(instanceManager.ensureInstanceRunning('tenant-user1')).rejects.toMatchObject({ code: 'start-failed' })
    const failed = instanceManager.status('tenant-user1')
    expect(failed).toMatchObject({ state: 'failed', generation: 1 })
    expect(failed.lastError).toContain('spawn denied')
  })

  it('fails an early exit with bounded diagnostics and does not expose the authenticated URL', async () => {
    const process = fakeProcess()
    const instanceManager = new StaticTenantInstanceManager(config(), launcherOf([process]), {
      startupTimeoutMs: 100,
      shutdownTimeoutMs: 20,
      forceExitTimeoutMs: 20,
      maxDiagnosticChars: 80,
    })
    const started = instanceManager.ensureInstanceRunning('tenant-user1')
    process.stdout.write('dsh web: http://127.0.0.1:3081/?token=private')
    process.stderr.write('fatal startup detail')
    await new Promise<void>((resolve) => { setImmediate(resolve) })
    process.exit({ code: 2 })

    await expect(started).rejects.toMatchObject({ code: 'stopped-before-ready' })
    const status = instanceManager.status('tenant-user1')
    expect(status.state).toBe('failed')
    expect(status.lastError).toContain('fatal startup detail')
    expect(status.lastError).not.toContain('token=private')
  })

  it('terminates and fails a generation whose readiness deadline expires', async () => {
    const process = fakeProcess(101, ['SIGTERM'])
    const instanceManager = manager(launcherOf([process]), { startupTimeoutMs: 10 })

    await expect(instanceManager.ensureInstanceRunning('tenant-user1')).rejects.toMatchObject({ code: 'startup-timeout' })
    expect(process.signals).toEqual(['SIGTERM'])
    expect(instanceManager.status('tenant-user1')).toMatchObject({ state: 'failed', generation: 1 })
  })

  it('marks an unexpected running-process exit failed and starts a later generation', async () => {
    const first = fakeProcess(101)
    const second = fakeProcess(102)
    const launch = launcherOf([first, second])
    const instanceManager = manager(launch)
    await startReady(instanceManager, first)
    first.exit({ code: 3 })
    await first.handle.exited
    await vi.waitFor(() => { expect(instanceManager.status('tenant-user1').state).toBe('failed') })

    const restarted = instanceManager.ensureInstanceRunning('tenant-user1')
    second.stdout.write('dsh web: http://127.0.0.1:3081/new\n')
    await expect(restarted).resolves.toMatchObject({ instance: { state: 'running', generation: 2, pid: 102 } })
  })

  it('stops gracefully with one SIGTERM and waits for exit', async () => {
    const process = fakeProcess(101, ['SIGTERM'])
    const instanceManager = manager(launcherOf([process]))
    await startReady(instanceManager, process)

    await instanceManager.stopInstance('tenant-user1')
    expect(process.signals).toEqual(['SIGTERM'])
    expect(instanceManager.status('tenant-user1')).toMatchObject({ state: 'stopped', generation: 1 })
  })

  it('escalates a survivor to SIGKILL after the graceful deadline', async () => {
    const process = fakeProcess(101, ['SIGKILL'])
    const instanceManager = manager(launcherOf([process]), { shutdownTimeoutMs: 10 })
    await startReady(instanceManager, process)

    await instanceManager.stopInstance('tenant-user1')
    expect(process.signals).toEqual(['SIGTERM', 'SIGKILL'])
    expect(instanceManager.status('tenant-user1').state).toBe('stopped')
  })

  it('reports a child that survives both stop deadlines', async () => {
    const process = fakeProcess()
    const instanceManager = manager(launcherOf([process]), { shutdownTimeoutMs: 5, forceExitTimeoutMs: 5 })
    await startReady(instanceManager, process)

    await expect(instanceManager.stopInstance('tenant-user1')).rejects.toMatchObject({ code: 'stop-failed' })
    expect(process.signals).toEqual(['SIGTERM', 'SIGKILL'])
    expect(instanceManager.status('tenant-user1')).toMatchObject({ state: 'failed', pid: 101 })
    process.exit({ signal: 'SIGKILL' })
  })

  it('stops a generation while its launcher is still pending and reaches quiescence', async () => {
    const process = fakeProcess(101, ['SIGTERM'])
    const launched = Promise.withResolvers<TenantProcess>()
    const instanceManager = manager(async () => launched.promise)
    const startup = instanceManager.ensureInstanceRunning('tenant-user1')
    const stopping = instanceManager.stopInstance('tenant-user1')
    launched.resolve(process.handle)

    await stopping
    await expect(startup).rejects.toBeInstanceOf(TenantInstanceError)
    expect(process.signals).toEqual(['SIGTERM'])
    expect(instanceManager.status('tenant-user1').state).toBe('stopped')
  })

  it('disposes every running tenant and preserves all stop failures', async () => {
    const first = fakeProcess(101, ['SIGTERM'])
    const second = fakeProcess(102, ['SIGTERM'])
    const instanceManager = manager(launcherOf([first, second]))
    await Promise.all([
      startReady(instanceManager, first, 'tenant-user1'),
      startReady(instanceManager, second, 'tenant-user2'),
    ])

    await instanceManager.dispose()
    expect(first.signals).toEqual(['SIGTERM'])
    expect(second.signals).toEqual(['SIGTERM'])
    expect(instanceManager.list().every(item => item.state === 'stopped')).toBe(true)
  })

  it('rejects non-positive lifecycle options at construction', () => {
    expect(() => new StaticTenantInstanceManager(config(), launcherOf([]), { startupTimeoutMs: 0 })).toThrow('startupTimeoutMs')
  })
})
