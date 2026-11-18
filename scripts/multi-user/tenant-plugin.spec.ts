import { describe, expect, it } from 'vitest'
import { createTenantCapabilityPluginRegistry } from './tenant-plugin.ts'

describe('tenant capability plugin registry', () => {
  const plugin = { id: 'reports', overlayFile: '/tmp/reports.yml', artifacts: ['/tmp/reports.js'], isolation: 'process' as const }

  it('registers unique non-host capabilities', () => {
    const registry = createTenantCapabilityPluginRegistry([plugin])
    expect(registry.get('reports')).toBe(plugin)
  })

  it.each([
    ['blank id', { ...plugin, id: ' ' }, 'must not be blank'],
    ['host isolation', { ...plugin, isolation: 'host' as const }, 'cannot use host isolation'],
    ['duplicate id', [plugin, plugin], 'registered more than once'],
  ])('rejects %s', (_name, value, message) => {
    expect(() => createTenantCapabilityPluginRegistry(Array.isArray(value) ? value : [value])).toThrow(message)
  })
})
