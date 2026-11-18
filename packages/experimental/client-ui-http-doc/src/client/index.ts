/** Optional HTTP command menu and request editor registration. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-commands/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { IconApiOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { createRequestDraftStore } from './draft-store.ts'
import { createRequestPanelController } from './controller.ts'
import { RequestPanel, type RequestPanelInjected } from './RequestPanel.tsx'
import { en, zh, NS } from './locales.ts'

/** Services used by the menu, request Remote and session overlay. */
export const inject = ['commandUi', 'slots', 'locale', 'remote', 'remote.commands']
/** Install optional request controls; disposal aborts requests and removes registrations.
 * @param ctx - Client plugin context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { en, zh }))
  const t = ctx.locale.bind(NS)
  const panel = createRequestPanelController((sessionId, line, signal) => ctx.remote.commands.execute(sessionId, line, [], signal))
  ctx.effect(() => panel.dispose)
  const ui = { kind: 'action' as const, run: ({ sessionId }: { sessionId: Parameters<typeof panel.open>[0] }) => { panel.open(sessionId) } }
  ctx.effect(() => ctx.commandUi.register({ name: 'http-request', icon: IconApiOutlineRegular,
    label: () => t('label'), description: () => t('description'), available: () => true, ui }))
  ctx.effect(() => ctx.commandUi.decorate({ name: 'http', available: () => true, ui }))
  const draftStore = createRequestDraftStore()
  ctx.slots.inject('conversation.input.overlay', () => ctx.slots.register({
    name: 'conversation.input.overlay', id: 'http-request-panel', order: 10, locale: NS, store: draftStore,
    inject: (sessionId): RequestPanelInjected => ({ sessionId, hooks: { panel: panel.state },
      send: draft => panel.send(sessionId, draft), close: panel.close }),
  }, RequestPanel))
}
