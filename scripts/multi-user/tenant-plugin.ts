/** Extension contract for tenant-scoped capability overlays. */

import type { TenantCapability } from './tenant-config.ts'

/** A capability that can be enabled for one isolated tenant process. */
export interface TenantCapabilityPlugin {
  /** Stable registry key used in tenant configuration. */
  readonly id: TenantCapability | (string & {})
  /** Absolute overlay file mounted when the capability is enabled. */
  readonly overlayFile: string
  /** Absolute files required before the overlay can be mounted. */
  readonly artifacts: readonly string[]
  /** Whether the capability is safe to expose through the shared-host launcher. */
  readonly isolation: 'workspace' | 'process' | 'host'
}

/** Registry of tenant capability plugins. */
export type TenantCapabilityPluginRegistry = ReadonlyMap<string, TenantCapabilityPlugin>

/** Create a registry and reject duplicate capability identifiers. */
export function createTenantCapabilityPluginRegistry(
  plugins: readonly TenantCapabilityPlugin[],
): TenantCapabilityPluginRegistry {
  const registry = new Map<string, TenantCapabilityPlugin>()
  for (const plugin of plugins) {
    if (plugin.id.trim() === '') throw new TypeError('tenant capability plugin id must not be blank')
    if (plugin.isolation === 'host') throw new TypeError(`tenant capability ${JSON.stringify(plugin.id)} cannot use host isolation`)
    if (registry.has(plugin.id)) throw new TypeError(`tenant capability ${JSON.stringify(plugin.id)} is registered more than once`)
    registry.set(plugin.id, plugin)
  }
  return registry
}
