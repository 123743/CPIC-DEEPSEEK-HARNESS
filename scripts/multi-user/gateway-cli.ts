/** Local trusted-header gateway process for static tenant DSH instances. */

import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import {
  DEFAULT_GATEWAY_CONFIG_FILE,
  loadGatewayConfig,
  resolveGatewaySettings,
  saveGatewayConfig,
} from './gateway-config.ts'
import { startStaticTenantGateway } from './gateway.ts'
import { createLocalDshLauncher, StaticTenantInstanceManager } from './instance-manager.ts'
import { loadStaticTenantConfig, provisionStaticTenant } from './tenant-config.ts'

const DEFAULT_TENANT_ROOT = process.platform === 'win32'
  ? 'D:\\DSH\\runtime\\tenants'
  : `${homedir()}/dsh-runtime/tenants`
const TENANT_ROOT_ENVIRONMENT_NAME = 'DSH_MULTI_USER_TENANT_ROOT'
const GATEWAY_PUBLIC_URL_ENVIRONMENT_NAME = 'DSH_GATEWAY_PUBLIC_URL'
const OPENAI_MODEL_BASE_URL_ENVIRONMENT_NAME = 'DSH_MULTI_USER_OPENAI_MODEL_BASE_URL'
const OPENAI_MODEL_API_KEY_ENVIRONMENT_NAME = 'DSH_MULTI_USER_OPENAI_MODEL_API_KEY'
const OPENAI_MODEL_ID_ENVIRONMENT_NAME = 'DSH_MULTI_USER_OPENAI_MODEL_ID'

async function main(args: readonly string[], environment: NodeJS.ProcessEnv = process.env): Promise<void> {
  const { values } = parseArgs({
    args,
    allowPositionals: false,
    strict: true,
    options: {
      config: { type: 'string', default: '.local/multi-user/tenants.json' },
      'gateway-config': { type: 'string', default: DEFAULT_GATEWAY_CONFIG_FILE },
      'idle-timeout-ms': { type: 'string' },
      'ticket-resolver-url': { type: 'string' },
      'session-cookie-name': { type: 'string' },
      'session-ttl-ms': { type: 'string' },
    },
  })
  const gatewayConfigFile = values['gateway-config']
  const gatewayConfig = await loadGatewayConfig(gatewayConfigFile)
  const settings = resolveGatewaySettings(gatewayConfig, environment, {
    ticketResolverUrl: values['ticket-resolver-url'],
    sessionCookieName: values['session-cookie-name'],
    sessionTtlMs: values['session-ttl-ms'],
    idleTimeoutMs: values['idle-timeout-ms'],
  })
  const tenantRoot = environment[TENANT_ROOT_ENVIRONMENT_NAME] ?? DEFAULT_TENANT_ROOT
  const gatewayPublicUrl = environment[GATEWAY_PUBLIC_URL_ENVIRONMENT_NAME] ?? 'http://127.0.0.1:3000'
  const config = await loadStaticTenantConfig(values.config)
  const manager = new StaticTenantInstanceManager(
    config,
    createLocalDshLauncher(undefined, {
      ...environment,
      DSH_CPIC_API_URL: settings.cpicApiUrl,
      DSH_CPIC_API_SECRET: settings.cpicApiSecret,
      ...(settings.openAiModelApiKey === undefined ? {} : {
        [OPENAI_MODEL_BASE_URL_ENVIRONMENT_NAME]: settings.openAiBaseUrl,
        [OPENAI_MODEL_API_KEY_ENVIRONMENT_NAME]: settings.openAiModelApiKey,
        [OPENAI_MODEL_ID_ENVIRONMENT_NAME]: settings.openAiModelId,
      }),
    }, gatewayPublicUrl),
    { logDirectory: join(homedir(), '.dsh', 'multi-user-tenant-logs') },
  )
  const registeredTenants = new Set(config.tenants.map(tenant => tenant.tenantId))
  const gateway = await startStaticTenantGateway(config, manager, {
    host: settings.host,
    port: settings.port,
    proxySecret: settings.proxySecret,
    tenantPortMin: settings.tenantPortMin,
    tenantPortMax: settings.tenantPortMax,
    idleTimeoutMs: settings.idleTimeoutMs,
    ...(settings.adminSecret === undefined ? {} : {
      adminHost: settings.adminHost,
      adminPort: settings.adminPort,
      adminSecret: settings.adminSecret,
      persistAdminSettings: async updated => {
        await saveGatewayConfig(gatewayConfigFile, { ...gatewayConfig, ...updated })
      },
    }),
    ...(settings.ticketResolverUrl === undefined ? {} : { ticketResolverUrl: settings.ticketResolverUrl }),
    ...(settings.ticketResolverSecret === undefined ? {} : { ticketResolverSecret: settings.ticketResolverSecret }),
    ...(settings.sessionCookieName === undefined ? {} : { sessionCookieName: settings.sessionCookieName }),
    ...(settings.sessionTtlMs === undefined ? {} : { sessionTtlMs: settings.sessionTtlMs }),
    ...(settings.ticketResolverSecret === undefined ? {} : {
      tenantProvisionSecret: settings.ticketResolverSecret,
      provisionTenant: async (externalUserId: string, tenantId: string | undefined, portRange: { readonly min: number; readonly max: number }) => {
        const provisioned = await provisionStaticTenant(
          values.config,
          externalUserId,
          tenantId,
          tenantRoot,
          portRange.min,
          portRange.max,
        )
        if (!registeredTenants.has(provisioned.tenant.tenantId)) {
          manager.registerTenant(provisioned.tenant)
          registeredTenants.add(provisioned.tenant.tenantId)
        }
        return provisioned
      },
    }),
    onReclaimError(tenantId, error) {
      process.stderr.write(`multi-user gateway: failed to reclaim ${JSON.stringify(tenantId)}: ${error.message}\n`)
    },
  })
  const shutdown = Promise.withResolvers<void>()
  const onSignal = (): void => { shutdown.resolve() }
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)
  try {
    process.stdout.write(`multi-user gateway: http://${gateway.host}:${gateway.port}\n`)
    if (gateway.adminHost !== undefined && gateway.adminPort !== undefined) {
      process.stdout.write(`multi-user gateway admin: http://${gateway.adminHost}:${gateway.adminPort}\n`)
    }
    await shutdown.promise
  } finally {
    process.off('SIGINT', onSignal)
    process.off('SIGTERM', onSignal)
    await gateway.close()
  }
}

try {
  await main(process.argv.slice(2))
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
