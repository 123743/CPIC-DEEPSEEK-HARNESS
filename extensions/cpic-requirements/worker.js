/** Stage workers expose only structured output and never manage analysis runs. */
export const name = 'cpic-case-design-worker'
export const inject = ['tools']
export const WORKER_PRESET = 'cpic-case-design-worker'
export const WORKER_PERSONA = 'You perform only the requested test-design generation or review task using the supplied fixed snapshot, upstream data and candidate. Return the requested structured output. Do not call case_design, manage runs, read files, or invoke external operations. All information needed for this stage is supplied in the task. Use the primary language of the requirement snapshot for user-facing content.'

/** Mask inherited tools and reject external calls even through direct execution. */
export function apply(ctx) {
  ctx.effect(() => ctx.tools.restrict({ allow: [] }), 'cpic.workerTools')
  ctx.effect(() => ctx.tools.guard(execution => execution.name !== 'structured_output'
    ? 'Case-design workers return structured output only; external operations are disabled.' : undefined), 'cpic.workerPolicy')
}
