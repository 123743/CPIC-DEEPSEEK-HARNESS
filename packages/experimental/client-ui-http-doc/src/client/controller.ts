/** Request lifecycle scoped to one panel opening; stale completions stay silent. */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { CommandExecution } from '@deepseek-ai/dsh-commands/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { RequestDraft } from './draft-store.ts'

/** Visible state shared by menu actions and overlay instances. */
export interface PanelState {
  sessionId: SessionId | null
  sending: boolean
  markdown: string
  error: string
  failure: 'none' | 'unknown' | 'body' | 'remote'
}
/** Remote operation with an invocation-owned abort signal. */
export type ExecuteRequest = (sessionId: SessionId, line: string, signal: AbortSignal) => Promise<RemoteResult<CommandExecution | undefined>>

/** Create the private opening controller.
 * @param execute - command Remote adapter.
 * @returns panel state and opening, cancellation, submission and disposal operations.
 */
export function createRequestPanelController(execute: ExecuteRequest) {
  const state = createSnapshotStore<PanelState>({ sessionId: null, sending: false, markdown: '', error: '', failure: 'none' })
  let opening: AbortController | undefined
  const active = new Set<Promise<void>>()
  let disposed = false
  const close = () => {
    opening?.abort()
    opening = undefined
    state.set({ sessionId: null, sending: false, markdown: '', error: '', failure: 'none' })
  }
  const open = (sessionId: SessionId) => {
    if (disposed) return
    close()
    opening = new AbortController()
    state.set({ sessionId, sending: false, markdown: '', error: '', failure: 'none' })
  }
  const send = (sessionId: SessionId, draft: RequestDraft): Promise<void> => {
    const owner = opening
    if (owner === undefined || owner.signal.aborted || state.getSnapshot().sessionId !== sessionId || state.getSnapshot().sending) return Promise.resolve()
    let body: unknown = draft.body
    if (draft.body.trim().startsWith('{') || draft.body.trim().startsWith('[')) {
      try { body = JSON.parse(draft.body) }
      catch (_error) {
        // A malformed JSON draft stays editable; no command is sent.
        state.update(value => { value.failure = 'body'; value.error = '' })
        return Promise.resolve()
      }
    }
    const line = `/http ${JSON.stringify({ method: draft.method, url: draft.url,
      headers: draft.headers.filter(pair => pair.name.length > 0 || pair.value.length > 0),
      query: draft.query.filter(pair => pair.name.length > 0 || pair.value.length > 0),
      ...draft.body.length === 0 ? {} : { body }, ...draft.title.length === 0 ? {} : { title: draft.title },
    })}`
    state.update(value => { value.sending = true; value.error = ''; value.failure = 'none'; value.markdown = '' })
    const work = (async () => {
      try {
        const response = await execute(sessionId, line, owner.signal)
        if (opening !== owner || owner.signal.aborted) return
        state.update(value => {
          if (!response.ok) { value.failure = 'remote'; value.error = response.error.message; return }
          if (response.value === undefined) { value.failure = 'unknown'; return }
          const result = response.value.result
          if (result.kind === 'error') { value.failure = 'remote'; value.error = result.text }
          else value.markdown = result.text ?? ''
        })
      } catch (error) {
        if (opening !== owner || owner.signal.aborted) return
        state.update(value => { value.failure = 'remote'; value.error = error instanceof Error ? error.message : String(error) })
      } finally {
        if (opening === owner && !owner.signal.aborted) state.update(value => { value.sending = false })
      }
    })()
    active.add(work)
    void work.then(() => { active.delete(work) })
    return work
  }
  return { state, open, close, send, dispose: async () => { disposed = true; close(); await Promise.all(active) } }
}
