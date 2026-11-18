/** Adapt community Workflow's run handles to managed DSH activations. */
export function createWorkflowSubagents(ctx) {
  const subagents = ctx.subagents
  const agents = ctx.get('agents')
  if (typeof subagents.startActivation !== 'function' || !agents) {
    throw new Error('Workflow requires managed subagent activations and the live Agent registry')
  }
  return {
    getProvider: name => subagents.getProvider(name),
    async start(provider, input) {
      const { label, signal, ...request } = input
      const activation = await agents.withInitiator(request.parent, () => subagents.startActivation({
        provider, label, signal, request, delivery: 'caller',
      }))
      let disposal
      const dispose = () => {
        signal.removeEventListener('abort', onAbort)
        return disposal ??= activation.dispose()
      }
      const onAbort = () => { void dispose().catch(error => ctx.logger.error('Workflow child cancellation failed', error)) }
      signal.addEventListener('abort', onAbort, { once: true })
      if (signal.aborted) onAbort()
      return {
        id: activation.childId,
        get localAgent() { return agents.get(activation.childId) },
        result: activation.result,
        dispose,
      }
    },
  }
}
