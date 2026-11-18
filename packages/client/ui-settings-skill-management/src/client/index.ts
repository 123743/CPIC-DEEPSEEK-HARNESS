import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { SkillManagementPage, type SkillManagementPageInjected } from './SkillManagementPage.tsx'
import { SkillManagementToast } from './SkillManagementToast.tsx'
import { createSkillToastSource } from './toast-source.ts'
import { en, zh, type SkillManagementLocaleKey } from './locales.ts'

export type { SkillManagementPageInjected, SkillManagementPageProps } from './SkillManagementPage.tsx'
export type { SkillManagementLocaleKey } from './locales.ts'

/** Locale namespace owned by this plugin. */
const NS = 'skillManagement'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** User-level Skills management page copy. */
    'skillManagement': SkillManagementLocaleKey
  }
}

/** Services required to register the lazy Plugins console page and provide its Host operations. */
export const inject = ['slots', 'locale', 'remote', 'remote.skillManagement']

/** Register the Skills manager lazily in the Gateway Plugins console.
 * @param ctx - Browser context providing the Plugins slot, locale and generated Remote.
 * @returns No value; the registration is owned by the plugin fiber.
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-skill-management: dictionaries')

  const list: SkillManagementPageInjected['list'] = async (basePresetId) => {
    const result = await ctx.remote.skillManagement.list({ ...(basePresetId === undefined ? {} : { basePresetId }) })
    if (!result.ok) throw result.error
    return result.value
  }
  const read: SkillManagementPageInjected['read'] = async (request) => {
    const result = await ctx.remote.skillManagement.read(request)
    if (!result.ok) throw result.error
    return result.value
  }
  const write: SkillManagementPageInjected['write'] = async (request) => {
    const result = await ctx.remote.skillManagement.write(request)
    if (!result.ok) throw result.error
    return result.value
  }
  const remove: SkillManagementPageInjected['remove'] = async (request) => {
    const result = await ctx.remote.skillManagement.deleteSkill(request)
    if (!result.ok) throw result.error
    return result.value
  }
  const select: SkillManagementPageInjected['select'] = async (request) => {
    const result = await ctx.remote.skillManagement.select(request)
    if (!result.ok) throw result.error
    return result.value
  }
  const toast = createSkillToastSource()
  const injected = (): SkillManagementPageInjected => ({ list, read, write, remove, select, report: toast.report })

  ctx.slots.inject('plugins.item', () => ctx.slots.register({
    name: 'plugins.item',
    id: 'skills',
    order: 10,
    label: () => t('tab'),
    locale: NS,
    inject: injected,
  }, SkillManagementPage))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'skills-operation-toast',
    locale: NS,
    inject: () => ({ hooks: toast.hooks, dismiss: toast.dismiss }),
  }, SkillManagementToast))
  ctx.effect(() => () => { toast.dismiss() }, 'ui-settings-skill-management: toast source')
}

