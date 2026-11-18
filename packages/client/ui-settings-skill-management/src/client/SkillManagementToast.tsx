import { IconWarningOutlineRegular, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SkillToastSource } from './toast-source.ts'

/** Overlay props for the global Skills operation notice. */
type Props = PropsRuntime<'shell.overlay'>
  & PropsLocale<'skillManagement'>
  & InjectFace<Omit<SkillToastSource, 'report'>>

/** Render the latest completed Skills operation outside the Skills page lifetime. */
export function SkillManagementToast({ useToast, dismiss, t }: Props) {
  const toast = useToast(current => current)
  if (toast === null) return null
  const text = t(toast.kind === 'saved' ? 'saved' : toast.kind === 'removed' ? 'removed'
    : toast.kind === 'committed' ? 'toastCommitted' : 'toastFailed')
  return toast.kind === 'saved' || toast.kind === 'removed'
    ? <Toast key={`skills-${String(toast.seq)}`} text={text} tone="success" onDone={dismiss} />
    : <Toast key={`skills-${String(toast.seq)}`} text={text} icon={<IconWarningOutlineRegular />} onDone={dismiss} />
}
