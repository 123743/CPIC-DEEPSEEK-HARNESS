import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { verifyHostPeers } from './verify-host-peers.mjs'

function fixture(t, { built = true, wrongLink = false, split = false, duplicate = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-host-peers-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const directory = join(root, 'scripts/multi-user')
  function write(relative, text) {
    const file = join(root, relative)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, typeof text === 'string' ? text : JSON.stringify(text))
  }
  function link(from, to) {
    mkdirSync(dirname(join(root, from)), { recursive: true })
    symlinkSync(join(root, to), join(root, from), process.platform === 'win32' ? 'junction' : 'dir')
  }
  const metadata = { name: '@fixture/host', type: 'module', exports: { '.': { import: split ? './other/esm.js' : './lib/esm.js', require: './lib/cjs.cjs' } } }
  write('host/package.json', metadata)
  write('host/lib/cjs.cjs', '')
  if (built) write('host/lib/esm.js', '')
  write('other/package.json', metadata)
  if (built) write('other/lib/esm.js', '')
  write('scripts/multi-user/host-peers.json', { '@fixture/host': '../../host' })
  write('scripts/multi-user/package.json', { dependencies: { '@fixture/host': 'link:../../host' } })
  write('apps/cli/package.json', { dependencies: {} })
  write('apps/cli/lib/bin.js', '')
  for (const [name, entries] of Object.entries({ '@delthin/dsh-agent-roles': ['index.js'], '@michengai/dsh-agency-agents': ['lib/index.js', 'lib/remote.js'], '@nanmicoder/dsh-agent-teams': ['lib/index.js'] })) {
    write(`scripts/multi-user/node_modules/${name}/package.json`, { name })
    for (const entry of entries) write(`scripts/multi-user/node_modules/${name}/${entry}`, '')
  }
  link('scripts/multi-user/node_modules/@fixture/host', wrongLink ? 'other' : 'host')
  if (duplicate) link('scripts/multi-user/node_modules/@delthin/dsh-agent-roles/node_modules/@fixture/host', 'other')
  return { root, directory, write }
}

test('accepts shared canonical ESM identity and anchors non-direct CLI peers to workspace source', t => {
  const { directory } = fixture(t)
  const result = verifyHostPeers(directory)
  assert.deepEqual(result.failures, [])
  assert.equal(result.checked, 6)
})

test('rejects a duplicate plugin instance even when deployment links are canonical', t => {
  const { directory } = fixture(t, { duplicate: true })
  assert.ok(verifyHostPeers(directory).failures.some(value => value.startsWith('HOST_PEER_DUPLICATE:')))
})

test('reports incorrect installed link independently of missing build', t => {
  const { directory } = fixture(t, { wrongLink: true, built: false })
  const { failures } = verifyHostPeers(directory)
  assert.ok(failures.some(value => value.startsWith('HOST_LINK_MISMATCH:')))
  assert.ok(failures.some(value => value.startsWith('HOST_BUILD_MISSING:')))
})

test('checks ESM import entry even when require entry exists', t => {
  const { directory } = fixture(t, { split: true })
  const { failures } = verifyHostPeers(directory)
  assert.ok(failures.some(value => value.startsWith('HOST_BUILD_MISSING:') && value.includes('esm.js')))
})

test('checks direct CLI dependencies rather than accepting a private CLI instance', t => {
  const { directory, write, root } = fixture(t)
  write('apps/cli/package.json', { dependencies: { '@fixture/host': '*' } })
  const destination = join(root, 'apps/cli/node_modules/@fixture/host')
  mkdirSync(dirname(destination), { recursive: true })
  symlinkSync(join(root, 'other'), destination, process.platform === 'win32' ? 'junction' : 'dir')
  assert.ok(verifyHostPeers(directory).failures.some(value => value.startsWith('HOST_PEER_DUPLICATE:') && value.includes('apps/cli')))
})
