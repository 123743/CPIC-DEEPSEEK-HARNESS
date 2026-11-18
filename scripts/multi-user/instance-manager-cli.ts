/** Interactive control process for locally managed static tenant DSH instances. */

import { createInterface } from 'node:readline/promises'
import { parseArgs } from 'node:util'
import { createLocalDshLauncher, StaticTenantInstanceManager } from './instance-manager.ts'
import { loadStaticTenantConfig } from './tenant-config.ts'

function commandHelp(): string {
  return [
    'Commands:',
    '  list',
    '  start <tenant-id>',
    '  status <tenant-id>',
    '  stop <tenant-id>',
    '  exit',
  ].join('\n')
}

async function main(args: readonly string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    allowPositionals: false,
    strict: true,
    options: {
      config: { type: 'string', default: '.local/multi-user/tenants.json' },
    },
  })
  const config = await loadStaticTenantConfig(values.config)
  const manager = new StaticTenantInstanceManager(config, createLocalDshLauncher())
  const input = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY })
  let stopping: Promise<void> | undefined
  const stopAll = (): Promise<void> => (stopping ??= manager.dispose())
  const onSignal = (): void => { input.close() }
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)

  try {
    process.stdout.write(`Loaded ${config.tenants.length} static tenants.\n${commandHelp()}\n`)
    if (process.stdin.isTTY) process.stdout.write('multi-user> ')
    for await (const line of input) {
      const answer = line.trim()
      if (answer === '') {
        if (process.stdin.isTTY) process.stdout.write('multi-user> ')
        continue
      }
      const [command, tenantId, ...extra] = answer.split(/\s+/u)
      if (extra.length > 0) {
        process.stderr.write('too many command arguments\n')
        if (process.stdin.isTTY) process.stdout.write('multi-user> ')
        continue
      }
      try {
        switch (command) {
          case 'list':
            process.stdout.write(`${JSON.stringify(manager.list(), null, 2)}\n`)
            break
          case 'start': {
            if (tenantId === undefined) throw new Error('start requires a tenant id')
            const result = await manager.ensureInstanceRunning(tenantId)
            process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
            break
          }
          case 'status':
            if (tenantId === undefined) throw new Error('status requires a tenant id')
            process.stdout.write(`${JSON.stringify(manager.status(tenantId), null, 2)}\n`)
            break
          case 'stop':
            if (tenantId === undefined) throw new Error('stop requires a tenant id')
            await manager.stopInstance(tenantId)
            process.stdout.write(`${JSON.stringify(manager.status(tenantId), null, 2)}\n`)
            break
          case 'help':
            process.stdout.write(`${commandHelp()}\n`)
            break
          case 'exit':
          case 'quit':
            return
          default:
            process.stderr.write(`unknown command ${JSON.stringify(command)}\n${commandHelp()}\n`)
        }
      } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
      }
      if (process.stdin.isTTY) process.stdout.write('multi-user> ')
    }
  } finally {
    process.off('SIGINT', onSignal)
    process.off('SIGTERM', onSignal)
    input.close()
    await stopAll()
  }
}

try {
  await main(process.argv.slice(2))
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
