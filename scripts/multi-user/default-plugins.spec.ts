import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = (name: string): string => readFileSync(new URL(name, import.meta.url), 'utf8')

describe('default plugin deployment entries', () => {
  it('keeps Windows preflight on current native Team and scoped Roles entries', () => {
    const preflight = source('./start-web.ps1')
    for (const path of [
      'packages/team/agent-team/lib/index.js',
      'packages/team/tool-agent-team/lib/index.js',
      'packages/client/ui-agent-team/lib/index.js',
      'scripts/multi-user/node_modules/@delthin/dsh-agent-roles/index.js',
      'scripts/multi-user/node_modules/@delthin/dsh-agent-roles/fallback.js',
    ]) expect(preflight).toContain(`'${path}'`)
    expect(preflight).not.toMatch(/packages\/experimental\/(?:agent-team|tool-agent-team|client-ui-agent-team)\//u)
    expect(preflight).not.toContain('node_modules/dsh-agent-roles/')
    expect(preflight).toContain('--frozen-lockfile --ignore-scripts --config.auto-install-peers=false')
    expect(preflight).toContain('run pnpm run build')
  })
  it('pins migrated Roles and links shared Host peers without experimental overrides', () => {
    expect(JSON.parse(source('./package.json')).dependencies).toEqual({
      '@delthin/dsh-agent-roles': '0.6.1',
      '@michengai/dsh-agency-agents': '1.2.34',
      '@nanmicoder/dsh-agent-teams': '0.1.30',
      ...Object.fromEntries(Object.entries(JSON.parse(source('./host-peers.json'))).map(([name, path]) => [name, `link:${path}`])),
    })
    expect(source('./pnpm-workspace.yaml')).not.toContain('overrides:')
    expect(source('./pnpm-lock.yaml')).not.toContain('experimental-agent-team')
  })
})
