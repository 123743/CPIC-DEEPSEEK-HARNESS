import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  loadStaticTenantConfig,
  parseStaticTenantConfig,
  provisionStaticTenant,
  validateStaticTenantConfig,
} from './tenant-config.ts'
import { removeTemporaryRoots, temporaryRoot } from './temporary-directory.fixture.ts'

afterEach(removeTemporaryRoots)

function validConfig(): {
  version: number
  tenants: Array<{
    tenantId: string
    externalUserId: string
    port: number
    dshHome: string
    workspace: string
    capabilities?: readonly string[]
    plugins?: readonly string[]
  }>
} {
  const root = temporaryRoot()
  return {
    version: 1,
    tenants: [
      {
        tenantId: 'tenant-user1',
        externalUserId: 'user1',
        port: 3081,
        dshHome: join(root, 'user1', 'home'),
        workspace: join(root, 'user1', 'workspace'),
      },
      {
        tenantId: 'tenant-user2',
        externalUserId: 'user2',
        port: 3082,
        dshHome: join(root, 'user2', 'home'),
        workspace: join(root, 'user2', 'workspace'),
      },
    ],
  }
}

describe('static tenant configuration', () => {
  it('normalizes and returns a valid versioned registry', () => {
    const input = validConfig()
    const parsed = parseStaticTenantConfig(input)

    expect(parsed).toEqual(input)
    expect(parsed.tenants).not.toBe(input.tenants)
  })

  it.each([
    ['a non-object root', [], 'configuration must be an object'],
    ['an unknown root field', { ...validConfig(), extra: true }, 'configuration has unknown field "extra"'],
    ['a different version', { ...validConfig(), version: 2 }, 'configuration.version must be 1'],
    ['an empty tenant list', { version: 1, tenants: [null] }, 'tenants[0] must be an object'],
    ['a non-object tenant', { version: 1, tenants: [null] }, 'tenants[0] must be an object'],
  ])('rejects %s', (_name, input, message) => {
    expect(() => parseStaticTenantConfig(input)).toThrow(message)
  })

  it('rejects missing, unknown, malformed, and oversized tenant fields', () => {
    const missing = validConfig()
    Reflect.deleteProperty(missing.tenants[0]!, 'workspace')
    expect(() => parseStaticTenantConfig(missing)).toThrow('tenants[0].workspace must be a non-empty string')

    const unknown = validConfig()
    Object.assign(unknown.tenants[0]!, { typo: true })
    expect(() => parseStaticTenantConfig(unknown)).toThrow('tenants[0] has unknown field "typo"')

    const malformedId = validConfig()
    malformedId.tenants[0]!.tenantId = 'User 1'
    expect(() => parseStaticTenantConfig(malformedId)).toThrow('tenants[0].tenantId must match')

    const oversizedIdentity = validConfig()
    oversizedIdentity.tenants[0]!.externalUserId = 'x'.repeat(257)
    expect(() => parseStaticTenantConfig(oversizedIdentity)).toThrow('must contain at most 256 characters')
  })

  it.each([1023, 65_536, 3081.5, '3081'])('rejects invalid port %j', (port) => {
    const input = validConfig()
    Object.assign(input.tenants[0] as object, { port })
    expect(() => parseStaticTenantConfig(input)).toThrow('tenants[0].port must be an integer from 1024 through 65535')
  })

  it('accepts registered plugin IDs while preserving omitted defaults', () => {
    const input = validConfig()
    input.tenants[0]!.plugins = ['reports']
    expect(parseStaticTenantConfig(input).tenants[0]!.plugins).toEqual(['reports'])
    expect(parseStaticTenantConfig(validConfig()).tenants[0]!.plugins).toBeUndefined()
  })

  it('rejects malformed or duplicate plugin IDs', () => {
    const malformed = validConfig()
    malformed.tenants[0]!.plugins = ['Reports']
    expect(() => parseStaticTenantConfig(malformed)).toThrow('tenants[0].plugins[0] must be a lowercase plugin ID')
    const duplicate = validConfig()
    duplicate.tenants[0]!.plugins = ['reports', 'reports']
    expect(() => parseStaticTenantConfig(duplicate)).toThrow('tenants[0].plugins must not contain duplicates')
  })

  it('accepts optional capabilities while preserving omitted defaults', () => {
    const input = validConfig()
    input.tenants[0]!.capabilities = ['team', 'ptc', 'apply-patch']
    expect(parseStaticTenantConfig(input).tenants[0]!.capabilities).toEqual(['team', 'ptc', 'apply-patch'])
    expect(parseStaticTenantConfig(validConfig()).tenants[0]!.capabilities).toBeUndefined()
  })

  it.each([
    ['unknown capability', ['unknown']],
    ['duplicate capability', ['team', 'team']],
    ['native Computer Use on a shared host', ['computer-use-native']],
    ['MCP Computer Use on a shared host', ['computer-use-mcp']],
  ])('rejects %s', (_name, capabilities) => {
    const input = validConfig()
    input.tenants[0]!.capabilities = capabilities as never
    expect(() => parseStaticTenantConfig(input)).toThrow('tenants[0].capabilities')
  })

  it('rejects relative and shared home or workspace paths', () => {
    const relative = validConfig()
    relative.tenants[0]!.workspace = 'relative-workspace'
    expect(() => parseStaticTenantConfig(relative)).toThrow('tenants[0].workspace must be an absolute path')

    const same = validConfig()
    same.tenants[0]!.workspace = same.tenants[0]!.dshHome
    expect(() => parseStaticTenantConfig(same)).toThrow('dshHome and tenants[0].workspace must be different directories')
  })

  it.each([
    ['tenantId', 'tenantId'],
    ['externalUserId', 'externalUserId'],
    ['port', 'port'],
    ['dshHome', 'dshHome'],
    ['workspace', 'workspace'],
  ] as const)('rejects duplicate %s values', (field, expected) => {
    const input = validConfig()
    input.tenants[1]![field] = input.tenants[0]![field] as never
    expect(() => parseStaticTenantConfig(input)).toThrow(`tenants[1].${expected} duplicates tenants[0].${expected}`)
  })

  it('rejects a workspace that duplicates another tenant home', () => {
    const input = validConfig()
    input.tenants[1]!.workspace = input.tenants[0]!.dshHome
    expect(() => parseStaticTenantConfig(input)).toThrow('tenants[1].workspace duplicates tenants[0].dshHome')
  })

  it('loads valid JSON and reports invalid JSON and missing files with their paths', async () => {
    const root = temporaryRoot()
    const validFile = join(root, 'valid.json')
    const invalidFile = join(root, 'invalid.json')
    writeFileSync(validFile, JSON.stringify(validConfig()))
    writeFileSync(invalidFile, '{')

    await expect(loadStaticTenantConfig(validFile)).resolves.toMatchObject({ version: 1 })
    await expect(loadStaticTenantConfig(invalidFile)).rejects.toThrow(`static tenant configuration ${JSON.stringify(invalidFile)} is not valid JSON`)
    await expect(loadStaticTenantConfig(join(root, 'missing.json'))).rejects.toThrow('cannot read static tenant configuration')
  })

  it('provisions isolated Web defaults and preserves an existing profile patch', async () => {
    const root = temporaryRoot()
    const file = join(root, 'tenants.json')
    writeFileSync(file, JSON.stringify(validConfig()))
    const first = await provisionStaticTenant(file, 'new-user', undefined, root, 3090, 3099)
    const patch = join(first.tenant.dshHome, 'profiles', 'web', 'cordis.patch.yml')
    expect(readFileSync(patch, 'utf8')).toContain(`defaultWorkspacePath: ${first.tenant.workspace}`)
    expect(readFileSync(patch, 'utf8')).toContain('welcomeNotice: false')
    expect(readFileSync(patch, 'utf8')).toContain("name: '@deepseek-ai/dsh-host-directory-picker-browse'")
    expect(readFileSync(patch, 'utf8')).toContain("name: '@deepseek-ai/dsh-client-ui-directory-picker-browse'")
    expect(readFileSync(patch, 'utf8')).toContain(`root: ${JSON.stringify(first.tenant.workspace.replace(/\\/gu, '/'))}`)
    expect(readFileSync(patch, 'utf8')).toContain('disabled: true')
    writeFileSync(patch, 'custom: true\n')
    await provisionStaticTenant(file, 'new-user', undefined, root, 3090, 3099)
    expect(readFileSync(patch, 'utf8')).toBe('custom: true\n')
  })

  it('adds the file path to structural validation failures', async () => {
    const root = temporaryRoot()
    const file = join(root, 'tenants.json')
    writeFileSync(file, JSON.stringify({ version: 1, tenants: null }))
    await expect(loadStaticTenantConfig(file)).rejects.toThrow(`invalid static tenant configuration ${JSON.stringify(file)}`)
  })

  it('renders a non-secret operator summary for an explicit configuration file', async () => {
    const root = temporaryRoot()
    const file = join(root, 'tenants.json')
    mkdirSync(resolve(root), { recursive: true })
    writeFileSync(file, JSON.stringify(validConfig()))

    const output = JSON.parse(await validateStaticTenantConfig(['--config', file])) as {
      valid: boolean
      tenants: Array<{ tenantId: string; port: number }>
    }
    expect(output.valid).toBe(true)
    expect(output.tenants).toEqual([
      expect.objectContaining({ tenantId: 'tenant-user1', port: 3081 }),
      expect.objectContaining({ tenantId: 'tenant-user2', port: 3082 }),
    ])
  })
})
