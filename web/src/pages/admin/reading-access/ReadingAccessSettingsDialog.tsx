import { useEffect, useId, useState, type FormEvent } from 'react'
import { LockKeyhole, Settings2 } from 'lucide-react'
import {
  READING_ACCESS_MAX_QUOTA, READING_ACCESS_QUOTAS, READING_ACCESS_SUBJECTS,
  type ReadingAccessOverrides, type ReadingAccessQuotaKey, type ReadingAccessSettings, type ReadingAccessSubject,
} from '@shared/reading-access'
import { adminApi, type ApiError } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Dialog, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ErrorState, InlineError, LoadingState } from '@/components/shared/AsyncStates'
import { ReadingDialog } from '@/components/shared/ReadingDialog'
import { MODE_LABEL, SUBJECT_LABEL, WINDOW_LABEL } from './reading-access-ui'
import styles from './reading-access.module.css'

type Draft = { mode: 'default' | 'observe' | 'enforce'; quotas: Partial<Record<ReadingAccessQuotaKey, string>> }

function makeDraft(settings: ReadingAccessSettings): Draft {
  return {
    mode: settings.overrides.mode ?? 'default',
    quotas: Object.fromEntries(Object.entries(settings.overrides.quotas).map(([key, value]) => [key, String(value)])),
  }
}

export default function ReadingAccessSettingsDialog({ subject, onSave }: { subject: ReadingAccessSubject; onSave: () => void }) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [settings, setSettings] = useState<ReadingAccessSettings | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const [conflict, setConflict] = useState(false)
  const [activeSubject, setActiveSubject] = useState(subject)
  const formId = useId()
  const modeId = useId()

  useEffect(() => {
    if (!open) return
    let active = true
    void adminApi.readingAccess.settings().then(result => {
      if (!active) return
      setSettings(result)
      setDraft(makeDraft(result))
    }).catch((err: Error) => { if (active) setError(err.message || '配置读取失败。') })
    return () => { active = false }
  }, [open, reload])

  function clearForm() {
    setSettings(null)
    setDraft(null)
    setError('')
    setConflict(false)
  }

  function reloadSettings() {
    clearForm()
    setReload(value => value + 1)
  }

  function close() {
    setOpen(false)
    clearForm()
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving || conflict || !settings || !draft) return
    const overrides: ReadingAccessOverrides = { mode: draft.mode === 'default' ? null : draft.mode, quotas: {} }
    for (const key of READING_ACCESS_QUOTAS) {
      const text = draft.quotas[key]?.trim()
      if (!text) continue
      const value = Number(text)
      if (!Number.isSafeInteger(value) || value < 1 || value > READING_ACCESS_MAX_QUOTA) {
        setError('请填写 1–100000 的整数，或留空以恢复默认值。')
        setActiveSubject(key.split(':')[0] as ReadingAccessSubject)
        return
      }
      overrides.quotas[key] = value
    }
    setSaving(true)
    setError('')
    try {
      await adminApi.readingAccess.save({ revision: settings.revision, overrides })
      close()
      onSave()
    } catch (err) {
      setError((err as Error).message || '配置保存失败。')
      setConflict((err as ApiError).status === 409)
    } finally {
      setSaving(false)
    }
  }

  const modeLocked = settings?.managedByEnv.includes('mode')
  const form = settings && draft ? <form id={formId} onSubmit={save} className={styles.settingsForm}>
    {error && <InlineError message={error}>
      {conflict && <Button type="button" variant="outline" onClick={reloadSettings}>重新读取配置</Button>}
    </InlineError>}
    <div className={styles.modeRow}>
      <label htmlFor={modeId}>防护模式</label>
      <Select
        value={modeLocked ? settings.mode : draft.mode}
        disabled={saving || modeLocked}
        onValueChange={(value: Draft['mode']) => setDraft(current => current && { ...current, mode: value })}
      >
        <SelectTrigger id={modeId} aria-describedby={`${modeId}-hint`}><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="default">观察模式（默认）</SelectItem>
          <SelectItem value="observe">{MODE_LABEL.observe}</SelectItem>
          <SelectItem value="enforce">{MODE_LABEL.enforce}</SelectItem>
        </SelectContent>
      </Select>
      <p id={`${modeId}-hint`} className={styles.note}>
        {modeLocked ? '部署环境管理。' : '观察模式记录异常。增强拦截会拒绝长窗口超量请求。'}
      </p>
    </div>
    <Tabs value={activeSubject} onValueChange={value => setActiveSubject(value as ReadingAccessSubject)} className={styles.quotaTabs}>
      <TabsList aria-label="额度对象">
        {READING_ACCESS_SUBJECTS.map(kind => <TabsTrigger key={kind} value={kind} disabled={saving}>{SUBJECT_LABEL[kind]}</TabsTrigger>)}
      </TabsList>
      <TabsContent value={activeSubject}>
        <div className={styles.quotaFields}>
          {([1, 10, 60, 1440] as const).map(window => {
            const key = `${activeSubject}:${window}` as const
            const locked = settings.managedByEnv.includes(key)
            const effective = window === 1 ? settings.minuteLimits[activeSubject] : settings.limits[activeSubject].find(limit => limit.minutes === window)?.chapters
            return <label key={key} className={styles.field}>
              <span>{WINDOW_LABEL[window]} {locked && <LockKeyhole aria-hidden="true" />}</span>
              <Input
                aria-label={`${SUBJECT_LABEL[activeSubject]} ${WINDOW_LABEL[window]}`}
                aria-describedby={locked ? `${formId}-locked` : undefined}
                type="number" inputMode="numeric" min={1} max={READING_ACCESS_MAX_QUOTA} step={1}
                disabled={saving || locked}
                value={locked ? effective : draft.quotas[key] ?? ''}
                placeholder={String(effective ?? '')}
                onChange={event => setDraft({ ...draft, quotas: { ...draft.quotas, [key]: event.target.value } })}
              />
            </label>
          })}
        </div>
      </TabsContent>
    </Tabs>
    <p className={styles.note}>分钟按请求次数，其余按不同章节数。留空使用默认值。
      {settings.managedByEnv.some(key => key.startsWith(`${activeSubject}:`)) && <span id={`${formId}-locked`}> 带锁额度由部署环境管理。</span>}
    </p>
  </form> : error
    ? <ErrorState message={error} onRetry={reloadSettings} />
    : <LoadingState label="正在读取防护配置" />

  return <Dialog open={open} onOpenChange={value => {
    if (saving) return
    if (value) {
      setActiveSubject(subject)
      setOpen(true)
    }
    else close()
  }}>
    <DialogTrigger asChild><Button variant="outline"><Settings2 aria-hidden="true" />防护配置</Button></DialogTrigger>
    <ReadingDialog
      title="防护配置"
      description="保存后立即生效，当前窗口已有计数仍参与限流。"
      bodyLabel="阅读防护配置"
      className={styles.dialog}
      footer={<div className={styles.dialogActions}>
        <Button variant="outline" disabled={saving} onClick={close}>取消</Button>
        <Button type="submit" form={formId} disabled={!draft || saving || conflict}>{saving ? '保存中…' : '保存配置'}</Button>
      </div>}
    >
      {form}
    </ReadingDialog>
  </Dialog>
}
