/** Pure request editor with a per-session declared draft and opening status. */
import { useEffect, useRef } from 'react'
import { Button, Input, MenuSurface } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { createRequestDraftStore, RequestDraft } from './draft-store.ts'
import type { PanelState } from './controller.ts'
import type { NS } from './locales.ts'
import css from './RequestPanel.module.css'

/** Registration-owned callbacks and private status source. */
export interface RequestPanelInjected {
  sessionId: SessionId
  hooks: { panel: SnapshotStore<PanelState> }
  send(draft: RequestDraft): Promise<void>
  close(): void
}
/** Derived draft, locale and injection shares. */
export type RequestPanelProps = PropsStore<ReturnType<typeof createRequestDraftStore>> & PropsLocale<typeof NS> & InjectFace<RequestPanelInjected>

/** Render a request editor for its owning opening.
 * @param props - framework-bound stores and callbacks.
 * @returns the active panel or no content for another session.
 */
export function RequestPanel({ useStore, actions, usePanel, sessionId, send, close, t }: RequestPanelProps) {
  const draft = useStore(value => value)
  const panel = usePanel(value => value)
  const urlRef = useRef<HTMLInputElement>(null)
  const visible = panel.sessionId === sessionId
  useEffect(() => { if (visible) urlRef.current?.focus() }, [visible])
  if (!visible) return null
  return <MenuSurface className={css.panel}>
    <form aria-label={t('label')} onSubmit={event => { event.preventDefault(); void send(draft) }} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); close() } }}>
      <div className={css.heading}><strong>{t('label')}</strong><Button size="sm" onClick={close}>{t('close')}</Button></div>
      <fieldset disabled={panel.sending} className={css.fields}>
        <label>{t('method')}<select value={draft.method} onChange={event => { actions.field('method', event.target.value) }}>
          {['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].map(method => <option key={method}>{method}</option>)}
        </select></label>
        <label>{t('url')}<Input ref={urlRef} required type="url" value={draft.url} onChange={event => { actions.field('url', event.target.value) }} /></label>
        {(['headers', 'query'] as const).map(kind => <section key={kind} className={css.pairs} aria-label={t(kind)}>
          <div className={css.heading}><strong>{t(kind)}</strong><Button size="sm" onClick={() => { actions.add(kind) }}>{t('add')}</Button></div>
          {draft[kind].map((pair, index) => <div className={css.row} key={index}>
            <Input aria-label={`${t(kind)} ${t('name')} ${index + 1}`} value={pair.name} onChange={event => { actions.pair(kind, index, 'name', event.target.value) }} />
            <Input aria-label={`${t(kind)} ${t('value')} ${index + 1}`} value={pair.value} onChange={event => { actions.pair(kind, index, 'value', event.target.value) }} />
            <Button size="sm" onClick={() => { actions.remove(kind, index) }}>{t('remove')}</Button>
          </div>)}
        </section>)}
        <label>{t('body')}<textarea rows={5} value={draft.body} onChange={event => { actions.field('body', event.target.value) }} /></label>
        <label>{t('title')}<Input value={draft.title} onChange={event => { actions.field('title', event.target.value) }} /></label>
      </fieldset>
      <Button variant="primary" type="submit" disabled={panel.sending}>{panel.sending ? t('sending') : t('send')}</Button>
      {panel.failure !== 'none' && <div role="alert"><strong>{t('error')}</strong><p>{panel.failure === 'unknown' ? t('unknown') : panel.failure === 'body' ? t('invalidBody') : panel.error}</p></div>}
      {panel.markdown.length > 0 && <section aria-label={t('response')}><strong>{t('response')}</strong><pre className={css.response}>{panel.markdown}</pre></section>}
    </form>
  </MenuSurface>
}
