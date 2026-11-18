import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  ManagedSkillEntry,
  ManagedSkillListValue,
  ManagedSkillReadRequest,
  ManagedSkillReadValue,
  ManagedSkillRemoveRequest,
  ManagedSkillSelectRequest,
  ManagedSkillWriteRequest,
} from '@deepseek-ai/dsh-api-session-controller/types'
import { Button, Input, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './SkillManagementPage.module.css'

/** Remote callbacks supplied by the registering plugin. */
export interface SkillManagementPageInjected {
  readonly list: (basePresetId?: string) => Promise<ManagedSkillListValue>
  readonly read: (request: ManagedSkillReadRequest) => Promise<ManagedSkillReadValue>
  readonly write: (request: ManagedSkillWriteRequest) => Promise<unknown>
  readonly remove: (request: ManagedSkillRemoveRequest) => Promise<unknown>
  readonly select: (request: ManagedSkillSelectRequest) => Promise<unknown>
  readonly report: (kind: 'saved' | 'removed' | 'failed' | 'committed') => void
}

/** Plugins console slot props for the manager page. */
export type SkillManagementPageProps = PropsRuntime<'plugins.item'>
  & PropsLocale<'skillManagement'>
  & InjectFace<SkillManagementPageInjected>

type Entry = ManagedSkillEntry

type Editor = {
  readonly source?: Entry['source']
  readonly sourceId?: string
  readonly name: string
  readonly description: string
  readonly content: string
  readonly whenToUse: string
  readonly enabled: boolean
}

function sourceKey(source: Entry['source'], t: SkillManagementPageProps['t']): string {
  if (source === 'user-dsh') return t('sourceUserDsh')
  if (source === 'user-agents') return t('sourceUserAgents')
  return t('sourceCustom')
}

function committedFile(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('details' in error)) return false
  const details: unknown = error.details
  return typeof details === 'object' && details !== null && 'fileCommitted' in details && details.fileCommitted === true
}

/** Render the Gateway Plugins Skills manager from its generated Remote callbacks. */
export function SkillManagementPage(props: SkillManagementPageProps) {
  const { list, read, write, remove, select, report, t, view } = props
  const [catalog, setCatalog] = useState<ManagedSkillListValue | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [needsApply, setNeedsApply] = useState(false)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [notice, setNotice] = useState<{ kind: 'error'; text: string } | null>(null)
  const mounted = useRef(false)
  const requestSequence = useRef(0)
  const presetId = useRef<string | undefined>(undefined)
  presetId.current = catalog?.basePresetId

  const reload = useCallback(async () => {
    const sequence = ++requestSequence.current
    if (mounted.current) { setLoading(true); setLoadFailed(false) }
    try {
      const next = await list(catalog?.basePresetId)
      if (mounted.current && sequence === requestSequence.current) setCatalog(next)
    } catch (error: unknown) {
      void error
      if (mounted.current && sequence === requestSequence.current) setLoadFailed(true)
    } finally {
      if (mounted.current && sequence === requestSequence.current) setLoading(false)
    }
  }, [catalog?.basePresetId, list])

  useEffect(() => {
    mounted.current = true
    if (view === 'page') void reload()
    return () => { mounted.current = false; requestSequence.current++ }
  }, [reload, view])

  const openEditor = async (entry?: Entry) => {
    setNotice(null)
    if (entry === undefined) {
      setEditor({ name: '', description: '', content: '', whenToUse: '', enabled: true })
      return
    }
    setBusy(true)
    try {
      const value = await read({ name: entry.name, source: entry.source, sourceId: entry.sourceId, basePresetId: catalog!.basePresetId })
      if (!mounted.current) return
      setEditor({
        source: value.source,
        sourceId: value.sourceId,
        name: value.name,
        description: value.description,
        content: value.content,
        whenToUse: value.whenToUse ?? '',
        enabled: value.enabled,
      })
    } catch (error: unknown) {
      void error
      if (mounted.current) setNotice({ kind: 'error', text: t('operationFailed') })
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  const submit = async () => {
    if (editor === null) return
    setBusy(true)
    setNotice(null)
    try {
      await write({
        name: editor.name.trim(),
        description: editor.description.trim(),
        content: editor.content,
        enabled: editor.enabled,
        basePresetId: catalog!.basePresetId,
        ...(editor.whenToUse.trim() === '' ? {} : { whenToUse: editor.whenToUse.trim() }),
        ...(editor.source !== undefined && editor.source !== 'user-dsh' && editor.sourceId !== undefined ? { sourceId: editor.sourceId } : {}),
      })
      if (mounted.current) setEditor(null)
      report('saved')
      await reload()
    } catch (error: unknown) {
      if (committedFile(error)) {
        await reload()
        if (mounted.current) setNeedsApply(true)
        report('committed')
      } else report('failed')
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  const toggleEnabled = async (entry: Entry) => {
    setBusy(true)
    setNotice(null)
    try {
      const current = await read({ name: entry.name, source: entry.source, sourceId: entry.sourceId, basePresetId: catalog!.basePresetId })
      await write({
        name: current.name,
        description: current.description,
        content: current.content,
        enabled: current.enabled,
        presetEnabled: !entry.enabled,
        basePresetId: catalog!.basePresetId,
        ...(current.whenToUse === undefined ? {} : { whenToUse: current.whenToUse }),
        ...(entry.source === 'user-dsh' ? {} : { sourceId: entry.sourceId }),
      })
      report('saved')
      await reload()
    } catch (error: unknown) {
      if (committedFile(error)) {
        await reload()
        if (mounted.current) setNeedsApply(true)
        report('committed')
      } else report('failed')
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  const removeOverride = async (entry: Entry) => {
    if (!window.confirm(t('removeConfirm'))) return
    setBusy(true)
    setNotice(null)
    try {
      await remove({ name: entry.name, basePresetId: catalog!.basePresetId })
      report('removed')
      await reload()
    } catch (error: unknown) {
      if (committedFile(error)) {
        await reload()
        if (mounted.current) setNeedsApply(true)
        report('committed')
      } else report('failed')
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  const selectManaged = async (selected: boolean) => {
    if (catalog === null) return
    setBusy(true)
    setNotice(null)
    try {
      await select({ selected, basePresetId: catalog.basePresetId })
      if (mounted.current) setNeedsApply(false)
      report('saved')
      await reload()
    } catch (error: unknown) {
      void error
      report('failed')
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  const choosePreset = async (basePresetId: string) => {
    setBusy(true)
    try {
      const current = catalog
      if (current === null) return
      const next = await list(basePresetId)
      if (mounted.current) setCatalog(next)
    } catch (error: unknown) {
      report('failed')
    } finally { if (mounted.current) setBusy(false) }
  }

  if (view === 'summary') return <>{t('summary')}</>
  if (loading && catalog === null) return <section className={css.page}><div className={css.skeleton} aria-hidden="true" /></section>
  if (loadFailed && catalog === null) return (
    <section className={css.page}>
      <p className={css.error} role="alert">{t('loadError')}</p>
      <Button variant="outline" size="sm" onClick={() => { void reload() }}>{t('retry')}</Button>
    </section>
  )
  if (catalog === null) return null

  const userEntries = catalog.entries.filter(entry => entry.source === 'user-dsh')
  const globalEntries = catalog.entries.filter(entry => entry.source !== 'user-dsh' && !entry.overridden)
  const presetOptions = catalog.presets ?? [{ id: catalog.basePresetId }]
  return (
    <section className={css.page} aria-busy={busy}>
      <header className={css.header}>
        <div><h2>{t('title')}</h2><p>{t('subtitle')}</p><p className={css.hint}>{t('futureOnly')}</p></div>
        <Button variant="primary" size="sm" disabled={busy} onClick={() => { void openEditor() }}>{t('add')}</Button>
      </header>
      <div className={css.preset}>
        <label className={css.presetSelect}>{t('agentPreset')}
          <select value={catalog.basePresetId} disabled={busy} onChange={(event) => { void choosePreset(event.currentTarget.value) }}>
            {presetOptions.map(preset => <option key={preset.id} value={preset.id}>{preset.name ?? preset.id}</option>)}
          </select>
        </label>
        <Switch checked={catalog.enabledForPreset} disabled={busy}
          label={t('selectManaged')} onChange={(next) => { void selectManaged(next) }} />
      </div>
      {needsApply ? <div className={css.preset}><p className={css.hint}>{t('applyHint')}</p><Button variant="outline" size="sm" disabled={busy} onClick={() => { void selectManaged(true) }}>{t('apply')}</Button></div> : null}
      {notice?.kind === 'error' ? <p className={css.error} role="alert">{notice.text}</p> : null}
      {editor !== null ? (
        <form className={css.editor} onSubmit={(event) => { event.preventDefault(); void submit() }}>
          <h3>{t(editor.source === undefined ? 'createTitle' : 'editTitle')}</h3>
          {editor.source !== undefined && editor.source !== 'user-dsh' ? <p className={css.hint}>{t('readOnly')}</p> : null}
          <label>{t('name')}<Input required minLength={1} maxLength={64} pattern="[a-z0-9]+(-[a-z0-9]+)*" disabled={busy || editor.sourceId !== undefined} value={editor.name} onChange={(event) => { setEditor({ ...editor, name: event.currentTarget.value }) }} /></label>
          <label>{t('description')}<Input required maxLength={500} value={editor.description} disabled={busy} onChange={(event) => { setEditor({ ...editor, description: event.currentTarget.value }) }} /></label>
          <label>{t('whenToUse')}<Input value={editor.whenToUse} maxLength={1000} disabled={busy} onChange={(event) => { setEditor({ ...editor, whenToUse: event.currentTarget.value }) }} /></label>
          <label>{t('content')}<textarea required rows={12} value={editor.content} disabled={busy} onChange={(event) => { setEditor({ ...editor, content: event.currentTarget.value }) }} /></label>
          <div className={css.formToggle}><span>{t('enabled')}</span><Switch checked={editor.enabled} label={t('enabled')} disabled={busy} onChange={(enabled) => { setEditor({ ...editor, enabled }) }} /></div>
          <div className={css.actions}>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => { setEditor(null) }}>{t('cancel')}</Button>
            <Button variant="primary" size="sm" disabled={busy || editor.name.trim() === '' || editor.description.trim() === ''} type="submit">{t('save')}</Button>
          </div>
        </form>
      ) : null}
      <SkillGroup title={t('userHeading')} entries={userEntries} t={t} busy={busy} onEdit={(entry) => { void openEditor(entry) }} onToggle={(entry) => { void toggleEnabled(entry) }} onRemove={(entry) => { void removeOverride(entry) }} />
      <SkillGroup title={t('globalHeading')} entries={globalEntries} t={t} busy={busy} onEdit={(entry) => { void openEditor(entry) }} onToggle={(entry) => { void toggleEnabled(entry) }} onRemove={(entry) => { void removeOverride(entry) }} />
    </section>
  )
}

function SkillGroup({ title, entries, t, busy, onEdit, onToggle, onRemove }: {
  readonly title: string
  readonly entries: readonly Entry[]
  readonly t: SkillManagementPageProps['t']
  readonly busy: boolean
  readonly onEdit: (entry: Entry) => void
  readonly onToggle: (entry: Entry) => void
  readonly onRemove: (entry: Entry) => void
}) {
  return (
    <section className={css.group}>
      <h3>{title}</h3>
      {entries.length === 0 ? <p className={css.empty}>{t('empty')}</p> : (
        <ul className={css.list}>{entries.map(entry => (
          <li key={`${entry.source}:${entry.sourceId}:${entry.name}`} className={css.row}>
            <div className={css.meta}>
              <strong>{entry.name}</strong><span>{entry.description}</span>
              <small>{sourceKey(entry.source, t)} · {entry.sourceId}{entry.overridden ? ` · ${t('overridden')}` : ''}</small>
            </div>
            <div className={css.rowActions}>
              <Switch checked={entry.enabled} label={`${t('enabled')}: ${entry.name}`} disabled={busy} onChange={() => { onToggle(entry) }} />
              <Button variant="outline" size="sm" disabled={busy} onClick={() => { onEdit(entry) }}>{t('edit')}</Button>
              {entry.source === 'user-dsh' ? <Button variant="ghost" size="sm" disabled={busy} onClick={() => { onRemove(entry) }}>{t('remove')}</Button> : null}
            </div>
          </li>
        ))}</ul>
      )}
    </section>
  )
}
