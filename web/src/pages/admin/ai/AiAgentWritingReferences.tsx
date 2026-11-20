import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { BookMarked, Plus, X } from 'lucide-react'
import { AGENT_REFERENCE_BUDGET, AGENT_REFERENCE_LIMIT } from '@shared/ai-agent'
import type { AgentWritingReference, AgentWritingReferenceSnapshot } from '@shared/ai-agent'
import { agentApi } from '@/lib/ai-agent-api'
import { getAdminTableRowStaggerDelay } from '@/lib/admin-table-motion'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { MotionDetails } from '@/components/ui/motion'
import FormField from '@/components/shared/FormField'
import { ReadingDialog } from '@/components/shared/ReadingDialog'
import styles from './agent-writing-references.module.css'

export interface WritingReferenceChoice {
  references: AgentWritingReferenceSnapshot[]
  scope: 'turn' | 'session'
}
interface Editor {
  reference?: AgentWritingReference
  title: string
  tags: string
  content: string
  usage: string
}
const failure = (error: unknown) => (error instanceof Error ? error.message : '操作失败，请重试')
const referenceSize = (item: AgentWritingReferenceSnapshot) => item.title.length + item.tags.join(' ').length + item.content.length + item.usage.length

export default function AiAgentWritingReferences({
  value,
  onChange,
  disabled,
}: {
  value: WritingReferenceChoice
  onChange: (value: WritingReferenceChoice) => void
  disabled: boolean
}) {
  const [open, setOpen] = useState(false)
  const [page, setPage] = useState<{ references: AgentWritingReference[]; hasMore: boolean } | null>(null)
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState<Editor | null>(null)
  const [remove, setRemove] = useState<AgentWritingReference | null>(null)
  const request = useRef(0)
  const alive = useRef(true)
  const lock = useRef(false)
  const persistentId = useId()
  const selectionRef = useRef(value)
  const onChangeRef = useRef(onChange)
  useLayoutEffect(() => {
    selectionRef.current = value
    onChangeRef.current = onChange
  }, [value, onChange])
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 250)
    return () => clearTimeout(timer)
  }, [search])
  async function load(more = false) {
    const version = ++request.current
    setLoading(true)
    setError('')
    try {
      const result = await agentApi.writingReferences(query, more ? page?.references.length || 0 : 0)
      if (!alive.current || version !== request.current) return
      setPage((old) =>
        more && old
          ? { ...result, references: [...old.references, ...result.references.filter((item) => !old.references.some((previous) => previous.id === item.id))] }
          : result,
      )
    } catch (error) {
      if (alive.current && version === request.current) setError(failure(error))
    } finally {
      if (alive.current && version === request.current) setLoading(false)
    }
  }
  useEffect(() => {
    let active = true
    if (open)
      queueMicrotask(() => {
        if (active) void load()
      })
    return () => {
      active = false
    }
    // The effect owns the initial/search request; pagination explicitly calls load(true).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, query, refresh])
  function select(item: AgentWritingReferenceSnapshot, checked: boolean) {
    if (disabled || saving) return
    const references = checked ? [...value.references.filter((old) => old.id !== item.id), item] : value.references.filter((old) => old.id !== item.id)
    if (references.length > AGENT_REFERENCE_LIMIT || references.reduce((sum, reference) => sum + referenceSize(reference), 0) > AGENT_REFERENCE_BUDGET) {
      setError(`最多选择 ${AGENT_REFERENCE_LIMIT} 张参考，合计不超过 ${AGENT_REFERENCE_BUDGET.toLocaleString()} 字。`)
      return
    }
    onChange({ ...value, references })
    setError('')
  }
  async function save() {
    if (!draft || lock.current || disabled) return
    lock.current = true
    setSaving(true)
    setError('')
    try {
      const fields = {
        title: draft.title,
        content: draft.content,
        usage: draft.usage,
        tags: draft.tags
          .split(/[,，、]/u)
          .map((item) => item.trim())
          .filter(Boolean),
      }
      const result = draft.reference
        ? await agentApi.editWritingReference(draft.reference.id, fields, draft.reference.revision)
        : await agentApi.createWritingReference(fields)
      if (!alive.current) return
      const current = selectionRef.current
      if (current.references.some((item) => item.id === result.reference.id))
        onChangeRef.current({ ...current, references: current.references.map((item) => (item.id === result.reference.id ? result.reference : item)) })
      setDraft(null)
      setRefresh((old) => old + 1)
    } catch (error) {
      if (alive.current) setError(failure(error))
    } finally {
      lock.current = false
      if (alive.current) setSaving(false)
    }
  }
  async function archive() {
    if (!remove || lock.current || disabled) return
    lock.current = true
    setSaving(true)
    setError('')
    try {
      await agentApi.removeWritingReference(remove.id, remove.revision)
      if (!alive.current) return
      const current = selectionRef.current
      onChangeRef.current({ ...current, references: current.references.filter((item) => item.id !== remove.id) })
      if (draft?.reference?.id === remove.id) setDraft(null)
      setRemove(null)
      setRefresh((old) => old + 1)
    } catch (error) {
      if (alive.current) setError(failure(error))
    } finally {
      lock.current = false
      if (alive.current) setSaving(false)
    }
  }
  const transitioning = loading || search.trim() !== query
  const blocked = disabled || saving
  return (
    <div className={styles.tools}>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!lock.current) {
            setOpen(next)
            if (next) setRefresh((old) => old + 1)
          }
        }}
      >
        <DialogTrigger asChild>
          <Button type="button" variant="ghost" size="sm" className={styles.trigger} disabled={disabled}>
            <BookMarked size={14} aria-hidden="true" />
            写作参考{value.references.length > 0 ? ` · ${value.references.length}` : ''}
          </Button>
        </DialogTrigger>
        <ReadingDialog
          title="写作参考库"
          description="保存自己的情节、氛围和写法素材，可跨作品复用。选择后随下一条消息带入；人物性格与既有事实仍以原书为依据。"
          bodyLabel="写作参考与编辑"
          onEscapeKeyDown={(event) => {
            if (lock.current) event.preventDefault()
          }}
          onInteractOutside={(event) => {
            if (lock.current) event.preventDefault()
          }}
          footer={
            <div className={styles.footer}>
              <span>
                {value.references.length} / {AGENT_REFERENCE_LIMIT} 张 · {value.references.reduce((sum, item) => sum + referenceSize(item), 0).toLocaleString()}{' '}
                / {AGENT_REFERENCE_BUDGET.toLocaleString()} 字
              </span>
              <Button type="button" disabled={saving} onClick={() => setOpen(false)}>
                完成选择
              </Button>
            </div>
          }
        >
          <div className={styles.root}>
            {error && (
              <p role="alert" className={styles.error}>
                {error}
              </p>
            )}
            <section className={styles.selection} aria-label="已选参考">
              <div className={styles.heading}>
                <strong>随下一条消息使用</strong>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={blocked || !value.references.length}
                  onClick={() => onChange({ ...value, references: [] })}
                >
                  清空选择
                </Button>
              </div>
              {value.references.length ? (
                value.references.map((item) => (
                  <div className={styles.selected} key={item.id}>
                    <span>{item.title}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={blocked}
                      aria-label={`移除参考 ${item.title}`}
                      onClick={() => select(item, false)}
                    >
                      <X size={14} aria-hidden="true" />
                    </Button>
                  </div>
                ))
              ) : (
                <p className={styles.muted}>未选择参考，按原书与本轮要求写作。</p>
              )}
              <label className={styles.check} htmlFor={persistentId}>
                <Checkbox
                  id={persistentId}
                  disabled={blocked}
                  checked={value.scope === 'session'}
                  onCheckedChange={(checked) => onChange({ ...value, scope: checked === true ? 'session' : 'turn' })}
                />
                持续用于当前对话
              </label>
              <p className={styles.muted}>
                未勾选时只用于本轮。发送时使用卡片的最新保存版本。选择与范围在下一条消息发送成功后生效；清空并勾选可停止后续轮次使用。
              </p>
            </section>
            <div className={styles.layout}>
              <section className={styles.library} aria-label="参考卡片列表">
                <div className={styles.heading}>
                  <h3>我的参考</h3>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={blocked}
                    onClick={() => {
                      setRemove(null)
                      setDraft({ title: '', tags: '', content: '', usage: '' })
                    }}
                  >
                    <Plus size={14} aria-hidden="true" />
                    新建参考
                  </Button>
                </div>
                <Input
                  aria-label="搜索写作参考"
                  placeholder="搜索名称、标签或正文"
                  maxLength={100}
                  value={search}
                  disabled={saving}
                  onChange={(event) => setSearch(event.target.value)}
                />
                <div className={styles.list} aria-busy={transitioning} data-transitioning={transitioning}>
                  {page?.references.map((item, index) => (
                    <article
                      className={styles.item}
                      key={item.id}
                      style={{ animationDelay: `${getAdminTableRowStaggerDelay(index, page.references.length)}ms` }}
                    >
                      <label className={styles.check}>
                        <Checkbox
                          aria-label={`选择参考 ${item.title}`}
                          disabled={
                            blocked ||
                            transitioning ||
                            (!value.references.some((old) => old.id === item.id) && value.references.length >= AGENT_REFERENCE_LIMIT)
                          }
                          checked={value.references.some((old) => old.id === item.id)}
                          onCheckedChange={(checked) => select(item, checked === true)}
                        />
                        <strong>{item.title}</strong>
                      </label>
                      {!!item.tags.length && <p className={styles.muted}>{item.tags.join(' · ')}</p>}
                      <p className={styles.excerpt}>{item.usage || item.content}</p>
                      <div className={styles.heading}>
                        <Button
                          type="button"
                          variant="link"
                          size="sm"
                          disabled={blocked}
                          onClick={() => {
                            setRemove(null)
                            setDraft({ reference: item, title: item.title, tags: item.tags.join('，'), content: item.content, usage: item.usage })
                          }}
                        >
                          查看与编辑
                        </Button>
                        <Button type="button" variant="ghost" size="sm" disabled={blocked} onClick={() => setRemove(item)}>
                          移除
                        </Button>
                      </div>
                    </article>
                  ))}
                  {!transitioning && page && !page.references.length && (
                    <p className={styles.muted}>{query ? '没有匹配的参考。' : '还没有参考，先新建一张并填写自己的素材。'}</p>
                  )}
                  {transitioning && (
                    <p className={styles.muted} role="status">
                      正在查找参考…
                    </p>
                  )}
                </div>
                {page?.hasMore && (
                  <Button type="button" variant="outline" disabled={transitioning || saving} onClick={() => void load(true)}>
                    加载更多
                  </Button>
                )}
                {error && (
                  <Button type="button" variant="ghost" disabled={loading || saving} onClick={() => setRefresh((old) => old + 1)}>
                    刷新参考列表
                  </Button>
                )}
              </section>
              <section className={styles.editor} aria-label="参考编辑区">
                {remove && (
                  <div className={styles.selection}>
                    <p>移除「{remove.title}」？已提交任务仍保留当时使用的参考。</p>
                    <div className={styles.heading}>
                      <Button type="button" variant="outline" disabled={saving} onClick={() => setRemove(null)}>
                        取消
                      </Button>
                      <Button type="button" variant="destructive" disabled={blocked} onClick={() => void archive()}>
                        确认移除
                      </Button>
                    </div>
                  </div>
                )}
                {draft ? (
                  <form
                    className={styles.form}
                    onSubmit={(event) => {
                      event.preventDefault()
                      void save()
                    }}
                  >
                    <h3>{draft.reference ? '编辑参考' : '新建参考'}</h3>
                    <FormField label="名称">
                      <Input
                        required
                        maxLength={100}
                        disabled={blocked}
                        value={draft.title}
                        onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                      />
                    </FormField>
                    <FormField label="标签" hint="用逗号分隔，最多 12 个，每个不超过 32 字。">
                      <Input maxLength={400} disabled={blocked} value={draft.tags} onChange={(event) => setDraft({ ...draft, tags: event.target.value })} />
                    </FormField>
                    <FormField label="参考正文" hint={`${draft.content.length.toLocaleString()} / 8,000 字；保留换行，自由组织内容。`}>
                      <Textarea
                        required
                        rows={12}
                        maxLength={8000}
                        disabled={blocked}
                        value={draft.content}
                        onChange={(event) => setDraft({ ...draft, content: event.target.value })}
                      />
                    </FormField>
                    <FormField label="使用说明（可选）" hint="写明想借鉴的部分，以及不要带入的内容。">
                      <Textarea
                        rows={3}
                        maxLength={1000}
                        disabled={blocked}
                        value={draft.usage}
                        onChange={(event) => setDraft({ ...draft, usage: event.target.value })}
                      />
                    </FormField>
                    <div className={styles.heading}>
                      <Button type="button" variant="ghost" disabled={saving} onClick={() => setDraft(null)}>
                        取消编辑
                      </Button>
                      <Button type="submit" disabled={blocked || !draft.title.trim() || !draft.content.trim()}>
                        {saving ? '正在保存…' : '保存参考'}
                      </Button>
                    </div>
                  </form>
                ) : (
                  <p className={styles.muted}>新建参考，或选择「查看与编辑」阅读完整内容。保存后再勾选需要的卡片。</p>
                )}
              </section>
            </div>
          </div>
        </ReadingDialog>
      </Dialog>
      {value.references.length > 0 && (
        <span className={styles.summary} title={value.references.map((item) => item.title).join('、')}>
          {value.references.map((item) => item.title).join('、')} · {value.scope === 'session' ? '当前对话' : '仅本轮'}
        </span>
      )}
    </div>
  )
}

export function WritingReferenceHistory({ references }: { references: Array<Pick<AgentWritingReference, 'id' | 'title' | 'revision'>> }) {
  if (!references.length) return null
  return (
    <MotionDetails className={styles.history}>
      <summary>本轮使用了 {references.length} 张写作参考</summary>
      <ul>
        {references.map((item) => (
          <li key={item.id}>
            {item.title} · 版本 {item.revision}
          </li>
        ))}
      </ul>
    </MotionDetails>
  )
}
