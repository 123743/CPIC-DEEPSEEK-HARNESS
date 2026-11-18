import { describe, expect, it } from 'vitest'
import { apply } from './cpic-preset.js'

const config = {
  id: 'case-design',
  name: 'Case design',
  description: 'Tenant preset',
  order: 5,
  plugins: [{ id: 'case-design', name: '@cpic/requirements-workbench/mode' }],
}

describe('gateway Agent preset plugin', () => {
  it('waits for preset registration before completing plugin setup', async () => {
    let release!: () => void
    const registered = new Promise<() => Promise<void>>(resolve => { release = () => { resolve(async () => {}) } })
    let effectCompleted = false
    const context = {
      agentPresets: { register: async () => registered },
      effect: async (setup: () => Promise<unknown>) => {
        await setup()
        effectCompleted = true
      },
    }

    const applying = apply(context, config)
    await Promise.resolve()
    expect(effectCompleted).toBe(false)

    release()
    await applying
    expect(effectCompleted).toBe(true)
  })
})
