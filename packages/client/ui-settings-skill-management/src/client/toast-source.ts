import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'

/** One completed operation outcome held until the overlay displays it. */
export interface SkillToastState {
  readonly kind: 'saved' | 'removed' | 'failed' | 'committed'
  readonly seq: number
}

/** App-wide operation notice source owned by the plugin fiber. */
export interface SkillToastSource {
  readonly hooks: { readonly toast: HostObservable<SkillToastState | null> }
  readonly report: (kind: SkillToastState['kind']) => void
  readonly dismiss: () => void
}

/** Create the toast source shared by the Plugins page and shell overlay.
 * @returns Plugin-owned notices and subscriptions for both UI contributions.
 */
export function createSkillToastSource(): SkillToastSource {
  let state: SkillToastState | null = null
  let sequence = 0
  const listeners = new Set<() => void>()
  const publish = (next: SkillToastState | null): void => {
    state = next
    for (const listener of listeners) listener()
  }
  return {
    hooks: {
      toast: {
        getSnapshot: () => state,
        subscribe(listener) {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
      },
    },
    report: (kind) => { publish({ kind, seq: ++sequence }) },
    dismiss: () => { publish(null) },
  }
}
