/** Same-version offline Vditor distribution served through authenticated tenant routes. */
import { readFile, realpath, stat, readdir } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve, relative, isAbsolute, extname } from 'node:path'

export const EDITOR_VERSION = '3.11.3'
export const EDITOR_PATH = `/api/cpic.assets/vditor/${EDITOR_VERSION}`
const bundledRoot = fileURLToPath(new URL('./static/vditor/', import.meta.url))
const contentTypes = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.wasm': 'application/wasm' }

/**
 * Validate every bundled distribution file before installing owner-authenticated, effect-owned routes.
 * @param ctx - Host context whose Connection registry owns route disposal.
 * @param settings - Optional same-version local distribution and browser resource root.
 * @returns Resolves after validation and registration; rejects incomplete or mismatched distributions.
 */
export async function registerEditorAssets(ctx, settings = {}) {
  const root = await realpath(settings.directory ?? bundledRoot)
  const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
  if (manifest.name !== 'vditor' || manifest.version !== EDITOR_VERSION) throw new Error(`Vditor assets must be version ${EDITOR_VERSION}`)
  const expectedFiles = JSON.parse(await readFile(new URL('./static/vditor/asset-files.json', import.meta.url), 'utf8'))
  for (const name of expectedFiles) {
    if (!(await stat(resolve(root, name))).isFile()) throw new Error(`Vditor asset missing: ${name}`)
  }
  const cdn = settings.baseUrl?.replace(/\/$/, '') ?? EDITOR_PATH
  ctx.effect(() => ctx.connection.fetch.register({ path: '/api/cpic.editor', methods: ['GET'], requestBody: 'buffered', fetch: async () => Response.json({ version: EDITOR_VERSION, cdn }, { headers: { 'cache-control': 'no-store' } }) }), 'cpic.editorMetadataRoute')
  const entries = await readdir(resolve(root, 'dist'), { recursive: true, withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const name = relative(root, resolve(entry.parentPath, entry.name)).replace(/\\/g, '/')
    ctx.effect(() => ctx.connection.fetch.register({ path: `${EDITOR_PATH}/${name}`, methods: ['GET', 'HEAD'], requestBody: 'buffered', fetch: async request => {
      try {
        const target = await realpath(resolve(root, name))
        const local = relative(root, target)
        if (local.startsWith('..') || isAbsolute(local) || !(await stat(target)).isFile()) return new Response(null, { status: 404 })
        return new Response(request.method === 'HEAD' ? null : await readFile(target), { headers: { 'content-type': contentTypes[extname(target)] ?? 'application/octet-stream', 'cache-control': 'private, max-age=3600', 'x-content-type-options': 'nosniff' } })
      } catch (error) {
        if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return new Response(null, { status: 404 })
        ctx.logger.error('cpic: editor asset read failed', error)
        return new Response(null, { status: 500 })
      }
    } }), `cpic.editorAsset:${name}`)
  }
}
