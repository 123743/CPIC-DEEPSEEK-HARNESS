/** Resolve the case-design worker entry beside this source package for gateway-only deployment. */
import { z } from 'zod'

export const name = 'cpic-gateway-preset'
export const inject = ['agentPresets']
/** One preset row: a plugin entry, or a group entry carrying child rows in its isolated service realm. */
const row = z.union([
  z.object({
    id: z.string(),
    name: z.string(),
    group: z.literal(true),
    isolate: z.record(z.string(), z.union([z.literal(true), z.string()])).optional(),
    config: z.array(z.lazy(() => row)),
  }).strict(),
  z.object({ id: z.string(), name: z.string(), config: z.json().optional() }).strict(),
])

export const Config = z.object({
  id: z.literal('case-design'), name: z.string(), description: z.string(), order: z.number(),
  plugins: z.array(row),
}).strict()

/** Register the gateway preset with an absolute worker module location; the plugin owns its revision. */
export function apply(ctx, input) {
  const config = Config.parse(input)
  const mode = config.plugins.find(entry => entry.id === 'case-design')
  if (mode?.name !== '@cpic/requirements-workbench/mode') throw new Error('Gateway case-design preset must declare the CPICHarness mode entry')
  const plugins = config.plugins.map(entry => entry === mode ? { ...entry, name: new URL('./mode.js', import.meta.url).href } : entry)
  ctx.effect(async () => ctx.agentPresets.register({ ...config, plugins }), 'cpic.gatewayPreset')
}
