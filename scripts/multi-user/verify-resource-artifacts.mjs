/** Verify packaged file-provider activation and complete offline editor resources without a server. */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import vm from 'node:vm'
import assert from 'node:assert/strict'

const root = resolve(process.argv[2] ?? '.')
const rows = []
const source = await readFile(resolve(root, 'packages/api/workspace-files/lib/client.js'), 'utf8')
vm.runInNewContext(source, { window: { __ModuleLoader__: { load: row => rows.push(row) } }, AbortController, URL })
const row = rows.find(item => item.id === '@deepseek-ai/dsh-api-workspace-files')
assert.ok(row, 'workspace-files browser module missing')
const plugin = row.factory(name => { assert.equal(name, '@deepseek-ai/cordis'); return {} })
assert.ok(plugin.inject.includes('remote.workspaceFiles'), 'file provider namespace dependency missing')
let provider
const disposers = []
plugin.apply({ remote: {}, resources: { register(value) { provider = value; return () => { provider = undefined } } }, effect(fn) { disposers.push(fn()) } })
assert.equal(provider?.protocol, 'file', 'file resource provider did not register')
for (const dispose of disposers.reverse()) await dispose()
assert.equal(provider, undefined, 'file provider registration did not dispose')
const remotes = await readFile(resolve(root, 'packages/api/remotes/lib/client.js'), 'utf8')
assert.ok(remotes.includes('workspaceFiles/stat') && remotes.includes('workspaceFiles/read') && remotes.includes('workspaceFiles/changes'), 'remotes browser bundle lacks workspaceFiles descriptors')
const web = await readFile(resolve(root, 'packages/bundle/web-app/cordis.patch.yml'), 'utf8')
assert.ok(web.includes("name: '@deepseek-ai/dsh-api-workspace-files'"), 'web composition lacks workspace-files')
const { registerEditorAssets } = await import(pathToFileURL(resolve(root, 'extensions/cpic-requirements/editor-assets.js')).href)
const paths = new Set()
await registerEditorAssets({ connection: { fetch: { register(route) { paths.add(route.path) } } }, logger: console })
const expectedFiles = JSON.parse(await readFile(resolve(root, 'extensions/cpic-requirements/static/vditor/asset-files.json'), 'utf8'))
for (const path of expectedFiles) assert.ok(paths.has(`/api/cpic.assets/vditor/3.11.3/${path}`), `offline editor resource missing: ${path}`)
assert.equal(paths.size, expectedFiles.length + 1, 'offline editor distribution differs from its file manifest')
const skillRows = []
const skillsClient = await readFile(resolve(root, 'packages/client/ui-settings-skill-management/lib/client.js'), 'utf8')
vm.runInNewContext(skillsClient, { window: { __ModuleLoader__: { load: item => skillRows.push(item) } } })
const skillsRow = skillRows.find(item => item.id === '@deepseek-ai/dsh-client-ui-settings-skill-management')
assert.ok(skillsRow, 'Skills manager browser module missing')
const skillsPlugin = skillsRow.factory(() => ({}))
let skillsInjected
const skillRequests = []
skillsPlugin.apply({
  locale: { bind: () => key => key, register: () => () => {} },
  remote: { skillManagement: { list: async request => {
    skillRequests.push(request)
    return { ok: true, value: { entries: [], presets: [], basePresetId: 'standard', enabledForPreset: false } }
  } } },
  slots: {
    inject: (_name, register) => register(),
    register: options => {
      if (options.id === 'skills') skillsInjected = options.inject()
      return () => {}
    },
  },
  effect: fn => { disposers.push(fn()) },
})
assert.ok(skillsInjected, 'Skills manager page callbacks missing')
await skillsInjected.list()
await skillsInjected.list('case-design')
assert.deepEqual(JSON.parse(JSON.stringify(skillRequests)), [{}, { basePresetId: 'case-design' }], 'Skills browser requests differ from the generated Remote request parameter')
for (const dispose of disposers.splice(0).reverse()) await dispose()
console.log(`Resource artifacts verified: file provider activates and disposes; workspaceFiles descriptors present; Skills Remote request arguments present; ${paths.size} offline editor routes.`)
