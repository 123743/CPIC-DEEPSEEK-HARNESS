/** Verify ESM package identity without importing plugins or starting an app. */
import { existsSync, readFileSync, realpathSync, mkdtempSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, resolve, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

function packageDirectory(file) {
  let directory = dirname(file)
  while (!existsSync(directory)) {
    const parent = dirname(directory)
    if (parent === directory) return undefined
    directory = parent
  }
  while (!existsSync(join(directory, 'package.json'))) {
    const parent = dirname(directory)
    if (parent === directory) return undefined
    directory = parent
  }
  return realpathSync(directory)
}

// Node owns conditional exports and URL resolution. The child only resolves URLs;
// it never imports the requested modules. File existence is checked separately.
function resolveEsm(requests) {
  const temporary = mkdtempSync(join(tmpdir(), 'dsh-esm-resolution-'))
  try {
    const output = join(temporary, 'result.json')
    const script = `import {writeFileSync} from 'node:fs'; const requests=JSON.parse(process.argv[1]); writeFileSync(process.argv[2], JSON.stringify(requests.map(([name,parent])=>{try{return {url:import.meta.resolve(name,parent)}}catch(error){return {error:error.code}}})));`
    const child = spawnSync(process.execPath, ['--experimental-import-meta-resolve', '--input-type=module', '--eval', script, JSON.stringify(requests), output], { stdio: 'inherit', windowsHide: true })
    if (child.error) throw child.error
    if (child.status !== 0) throw new Error(`ESM resolution worker exited ${child.status}`)
    return JSON.parse(readFileSync(output, 'utf8'))
  } finally { rmSync(temporary, { recursive: true, force: true }) }
}

/**
 * Check installed package directories, ESM export URLs and built entry existence independently.
 * CLI direct dependencies resolve from the CLI; other peers use their canonical workspace source.
 * @param {string} directory - Independent deployment directory.
 * @returns {{ failures: string[], checked: number }} Resolution evidence, not module-load evidence.
 */
export function verifyHostPeers(directory = dirname(fileURLToPath(import.meta.url))) {
  const peers = JSON.parse(readFileSync(resolve(directory, 'host-peers.json'), 'utf8'))
  const deployment = JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8'))
  const entries = [
    '../../apps/cli/lib/bin.js',
    'node_modules/@delthin/dsh-agent-roles/index.js',
    'node_modules/@michengai/dsh-agency-agents/lib/index.js',
    'node_modules/@michengai/dsh-agency-agents/lib/remote.js',
    'node_modules/@nanmicoder/dsh-agent-teams/lib/index.js',
  ]
  const failures = []
  const consumers = []
  for (const entry of entries) {
    const file = resolve(directory, entry)
    if (!existsSync(file)) failures.push(`${entry.startsWith('node_modules/') ? 'PLUGIN_INSTALL_MISSING' : 'HOST_BUILD_MISSING'}: ${entry}`)
    else consumers.push({ entry, file: realpathSync(file) })
  }
  const requests = []
  const checks = []
  for (const [name, relative] of Object.entries(peers)) {
    const target = resolve(directory, relative)
    const manifest = join(target, 'package.json')
    if (deployment.dependencies?.[name] !== `link:${relative}` || !existsSync(manifest)) {
      failures.push(`HOST_LINK_MISSING: ${name}; restore its canonical workspace link`)
      continue
    }
    const canonical = realpathSync(target)
    const metadata = JSON.parse(readFileSync(manifest, 'utf8'))
    if (metadata.name !== name) failures.push(`HOST_LINK_MISMATCH: ${name} points to ${metadata.name}`)
    const installed = resolve(directory, 'node_modules', name)
    if (!existsSync(join(installed, 'package.json'))) failures.push(`HOST_LINK_MISSING: ${name} installed package`)
    else if (realpathSync(installed) !== canonical) failures.push(`HOST_LINK_MISMATCH: ${name} installed directory differs from ${canonical}`)
    // Self-resolution applies exports conditions exactly; main is only used for packages without exports.
    const expectedIndex = requests.length
    requests.push([metadata.exports ? name : pathToFileURL(resolve(target, metadata.main ?? 'index.js')).href, pathToFileURL(manifest).href])
    for (const consumer of consumers) {
      let anchor = consumer.file
      if (!consumer.entry.startsWith('node_modules/')) {
        const cliManifest = join(dirname(dirname(consumer.file)), 'package.json')
        const cli = JSON.parse(readFileSync(cliManifest, 'utf8'))
        if (!Object.hasOwn(cli.dependencies ?? {}, name)) anchor = manifest
      }
      checks.push({ name, canonical, expectedIndex, index: requests.length, entry: consumer.entry })
      requests.push([name, pathToFileURL(anchor).href])
    }
    checks.push({ name, canonical, expectedIndex, index: expectedIndex, entry: 'canonical workspace source' })
  }
  const results = resolveEsm(requests)
  let checked = 0
  const missingBuilds = new Set()
  for (const check of checks) {
    const actual = results[check.index]
    const expected = results[check.expectedIndex]
    if (actual.error || expected.error) {
      failures.push(`HOST_PEER_UNRESOLVED: ${check.name} from ${check.entry} (${actual.error ?? expected.error})`)
      continue
    }
    const file = fileURLToPath(actual.url)
    const expectedFile = fileURLToPath(expected.url)
    const owner = packageDirectory(file)
    // Missing leaves retain symlink spelling in import.meta.resolve; canonicalize
    // the existing package directory before comparing package-relative export URLs.
    const packageRelative = (path) => {
      let ancestor = dirname(path)
      while (!existsSync(join(ancestor, 'package.json'))) {
        const parent = dirname(ancestor)
        if (parent === ancestor) return path
        ancestor = parent
      }
      return resolve(realpathSync(ancestor), relative(ancestor, path))
    }
    if (owner !== check.canonical || packageRelative(file) !== packageRelative(expectedFile)) {
      failures.push(`HOST_PEER_DUPLICATE: ${check.name} from ${check.entry} resolves to ${actual.url}`)
    } else checked++
    if (!existsSync(expectedFile)) missingBuilds.add(`HOST_BUILD_MISSING: ${check.name} ESM entry at ${expectedFile}; run pnpm run build in the repository`)
  }
  failures.push(...missingBuilds)
  return { failures, checked }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = verifyHostPeers()
  for (const failure of result.failures) console.error(failure)
  console.log(`Host peer ESM URL identity: ${result.checked} canonical resolutions, ${result.failures.length} failures (modules not loaded)`)
  if (result.failures.length) process.exitCode = 1
}
