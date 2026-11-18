/** Session-scoped request drafts owned by the Slot registry. */
import { defineStore } from '@deepseek-ai/dsh-client-store'

/** One ordered header or query parameter. */
export interface NameValue { name: string; value: string }
/** Editable request fields. */
export interface RequestDraft {
  method: string
  url: string
  headers: NameValue[]
  query: NameValue[]
  body: string
  title: string
}
/** Declare a fresh request draft for each session.
 * @returns the draft handle with its complete mutation API.
 */
export function createRequestDraftStore() {
  return defineStore({
    init: (): RequestDraft => ({ method: 'GET', url: '', headers: [], query: [], body: '', title: '' }),
    actions: {
      field: (draft: RequestDraft, field: 'method' | 'url' | 'body' | 'title', value: string) => { draft[field] = value },
      add: (draft: RequestDraft, kind: 'headers' | 'query') => { draft[kind].push({ name: '', value: '' }) },
      pair: (draft: RequestDraft, kind: 'headers' | 'query', index: number, field: 'name' | 'value', value: string) => {
        const entry = draft[kind][index]
        if (entry !== undefined) entry[field] = value
      },
      remove: (draft: RequestDraft, kind: 'headers' | 'query', index: number) => { draft[kind].splice(index, 1) },
    },
  })
}
