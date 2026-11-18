/** Role worker composition: structured output plus the role's own skill, nothing else. */
import { z } from 'zod'

export const name = 'cpic-case-role'
export const inject = ['tools']

/** Model-visible name of the skill tool this guard re-admits for bound roles. */
export const SKILL_TOOL = 'skill'

export const Config = z.object({
  role: z.string().min(1),
  allowedSkills: z.array(z.string().min(1)).default([]),
}).strict()

/**
 * Mask every inherited tool except the skill tool for a role with a bound
 * skill; the skill tool is a global registration that a role may use by name.
 * The guard is the authorization decision: it denies skill loads outside the
 * allowlist and every call outside structured output, even if a mask were
 * lifted.
 */
export function apply(ctx, input) {
  const config = Config.parse(input)
  const allow = config.allowedSkills.length > 0 ? [SKILL_TOOL] : []
  ctx.effect(() => {
    try {
      return ctx.tools.restrict({ allow })
    } catch (error) {
      // The deployment contract expects a global skill tool registration. When
      // it is absent, mask every global tool instead of failing the role: the
      // pipeline task prompt embeds the bound skill body inline, and the guard
      // below still authorizes only the bound skill by name.
      const message = error instanceof Error ? error.message : String(error)
      if (allow.length === 0 || !message.includes('unknown global tool')) throw error
      return ctx.tools.restrict({ allow: [] })
    }
  }, 'cpic.roleTools')
  ctx.effect(() => ctx.tools.guard(execution => {
    if (execution.name === 'structured_output') return undefined
    if (execution.name !== SKILL_TOOL) return `Role ${config.role} returns structured output only; external operations are disabled.`
    const args = execution.arguments
    const requested = args !== null && typeof args === 'object' ? args.name : undefined
    return config.allowedSkills.includes(requested) ? undefined
      : `Role ${config.role} may load only its bound skill: ${config.allowedSkills.join(', ') || '(none)'}.`
  }), 'cpic.rolePolicy')
}
