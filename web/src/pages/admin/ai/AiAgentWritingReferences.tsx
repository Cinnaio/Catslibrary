import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { ArrowLeft, BookMarked, Check, ChevronRight, FileText, Pencil, Plus, Search, Trash2, X } from 'lucide-react'
import { AGENT_REFERENCE_BUDGET, AGENT_REFERENCE_LIMIT } from '@shared/ai-agent'
import type { AgentWritingReference, AgentWritingReferenceSnapshot } from '@shared/ai-agent'
import { agentApi } from '@/lib/ai-agent-api'
import { getAdminTableRowStaggerDelay } from '@/lib/admin-table-motion'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
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
  const [activeId, setActiveId] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const detailHeading = useRef<HTMLHeadingElement>(null)
  const libraryHeading = useRef<HTMLHeadingElement>(null)
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
      setActiveId(result.reference.id)
      setPage((old) =>
        old
          ? {
              ...old,
              references: old.references.some((item) => item.id === result.reference.id)
                ? old.references.map((item) => (item.id === result.reference.id ? result.reference : item))
                : query
                  ? old.references
                  : [result.reference, ...old.references],
            }
          : old,
      )
      setDraft(null)
      requestAnimationFrame(() => detailHeading.current?.focus({ preventScroll: true }))
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
      setPage((old) => (old ? { ...old, references: old.references.filter((item) => item.id !== remove.id) } : old))
      returnToLibrary()
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
  const preview = page?.references.find((item) => item.id === activeId) || page?.references[0]
  const selectedSize = value.references.reduce((sum, item) => sum + referenceSize(item), 0)
  const previewSelected = !!preview && value.references.some((item) => item.id === preview.id)
  function showDetail() {
    setDetailOpen(true)
    requestAnimationFrame(() => detailHeading.current?.focus({ preventScroll: true }))
  }
  function returnToLibrary() {
    setDetailOpen(false)
    requestAnimationFrame(() => libraryHeading.current?.focus({ preventScroll: true }))
  }
  function edit(reference?: AgentWritingReference) {
    setRemove(null)
    setDraft(
      reference
        ? { reference, title: reference.title, tags: reference.tags.join('，'), content: reference.content, usage: reference.usage }
        : { title: '', tags: '', content: '', usage: '' },
    )
    showDetail()
  }
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
          className={styles.dialog}
          title="写作参考库"
          description="收藏情节、氛围与写法，选好后带入创作对话。"
          bodyLabel="写作参考与编辑"
          onEscapeKeyDown={(event) => {
            if (lock.current) event.preventDefault()
          }}
          onInteractOutside={(event) => {
            if (lock.current) event.preventDefault()
          }}
          footer={
            <div className={styles.footer}>
              <section className={styles.selection} aria-label="已选参考">
                <div className={styles.selectionLabel}>
                  <strong>已选参考</strong>
                  <span>
                    {value.references.length} / {AGENT_REFERENCE_LIMIT}
                  </span>
                </div>
                <div className={styles.selectedList}>
                  {value.references.length ? (
                    value.references.map((item) => (
                      <Button
                        key={item.id}
                        type="button"
                        variant="secondary"
                        size="sm"
                        className={styles.selected}
                        disabled={blocked}
                        aria-label={`移除参考 ${item.title}`}
                        onClick={() => select(item, false)}
                      >
                        <span>{item.title}</span>
                        <X size={12} aria-hidden="true" />
                      </Button>
                    ))
                  ) : (
                    <p className={styles.muted}>未选择参考，按原书与本轮要求写作。</p>
                  )}
                </div>
                {value.references.length > 0 && (
                  <Button type="button" variant="ghost" size="sm" disabled={blocked} onClick={() => onChange({ ...value, references: [] })}>
                    清空选择
                  </Button>
                )}
              </section>
              <div className={styles.footerActions}>
                <div className={styles.scope}>
                  <label className={styles.check} htmlFor={persistentId}>
                    <Checkbox
                      id={persistentId}
                      disabled={blocked}
                      checked={value.scope === 'session'}
                      onCheckedChange={(checked) => onChange({ ...value, scope: checked === true ? 'session' : 'turn' })}
                    />
                    持续用于当前对话
                  </label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button type="button" variant="ghost" size="sm">
                        使用规则
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent side="top" align="start" className={styles.rules}>
                      <strong>参考如何带入对话</strong>
                      <p>未勾选持续使用时，仅用于下一条消息；发送时带入最新保存版本。</p>
                      <p>选择与范围在消息发送成功后生效。清空并勾选持续使用，可停止后续轮次带入。</p>
                      <p>人物性格与既有事实仍以原书为依据。</p>
                    </PopoverContent>
                  </Popover>
                </div>
                <div className={styles.confirm}>
                  <span className={styles.budget}>
                    {selectedSize.toLocaleString()} / {AGENT_REFERENCE_BUDGET.toLocaleString()} 字
                  </span>
                  <Button type="button" disabled={saving} onClick={() => setOpen(false)}>
                    完成选择
                  </Button>
                </div>
              </div>
            </div>
          }
        >
          <div className={styles.root}>
            {error && (
              <p role="alert" className={styles.error}>
                {error}
              </p>
            )}
            <div className={styles.layout} data-detail-open={detailOpen}>
              <section className={styles.library} aria-label="参考卡片列表">
                <div className={styles.heading}>
                  <h3 ref={libraryHeading} tabIndex={-1}>
                    我的参考
                  </h3>
                  <Button type="button" size="sm" variant="outline" disabled={blocked} onClick={() => edit()}>
                    <Plus size={14} aria-hidden="true" />
                    新建参考
                  </Button>
                </div>
                <div className={styles.search}>
                  <Search size={16} aria-hidden="true" />
                  <Input
                    aria-label="搜索写作参考"
                    placeholder="搜索名称、标签或正文"
                    maxLength={100}
                    value={search}
                    disabled={saving}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </div>
                <div className={styles.list} aria-busy={transitioning} data-transitioning={transitioning}>
                  {page?.references.map((item, index) => (
                    <article
                      className={styles.item}
                      key={`${query}:${item.id}`}
                      data-active={!draft && item.id === preview?.id}
                      data-selected={value.references.some((old) => old.id === item.id)}
                      style={{ animationDelay: `${getAdminTableRowStaggerDelay(index, page.references.length)}ms` }}
                    >
                      <label className={styles.rowCheck}>
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
                      </label>
                      <Button
                        type="button"
                        variant="ghost"
                        className={styles.previewButton}
                        aria-label={`查看参考 ${item.title}`}
                        aria-current={!draft && item.id === preview?.id ? 'true' : undefined}
                        disabled={blocked || transitioning}
                        onClick={() => {
                          setActiveId(item.id)
                          setRemove(null)
                          setDraft(null)
                          showDetail()
                        }}
                      >
                        <span className={styles.rowTitle}>
                          {item.title}
                          <ChevronRight size={14} aria-hidden="true" />
                        </span>
                        {!!item.tags.length && <span className={styles.rowTags}>{item.tags.join(' · ')}</span>}
                        <span className={styles.excerpt}>{item.usage || item.content}</span>
                      </Button>
                    </article>
                  ))}
                  {!transitioning && page && !page.references.length && (
                    <div className={styles.listEmpty}>
                      <Search size={22} aria-hidden="true" />
                      <p>{query ? '没有匹配的参考' : '把灵感收进参考库'}</p>
                      <span>{query ? '试试其他名称、标签或正文关键词。' : '新建一张卡片，保存想复用的写法。'}</span>
                    </div>
                  )}
                  {transitioning && (
                    <p className={styles.loading} role="status">
                      正在查找参考…
                    </p>
                  )}
                </div>
                {page?.hasMore && (
                  <Button type="button" variant="ghost" disabled={transitioning || saving} onClick={() => void load(true)}>
                    加载更多
                  </Button>
                )}
                {error && (
                  <Button type="button" variant="ghost" disabled={loading || saving} onClick={() => setRefresh((old) => old + 1)}>
                    刷新参考列表
                  </Button>
                )}
              </section>
              <section className={styles.detail} aria-label="参考编辑区">
                <Button type="button" variant="ghost" size="sm" className={styles.back} disabled={saving} onClick={returnToLibrary}>
                  <ArrowLeft size={15} aria-hidden="true" />
                  返回列表
                </Button>
                <div className={styles.detailScroll}>
                  {remove ? (
                    <div className={styles.removePrompt}>
                      <span className={styles.eyebrow}>移除参考</span>
                      <h3 ref={detailHeading} tabIndex={-1}>
                        移除「{remove.title}」？
                      </h3>
                      <p className={styles.muted}>参考将从你的库中移除，已提交任务仍保留当时使用的版本。</p>
                      <div className={styles.editorActions}>
                        <Button type="button" variant="ghost" disabled={saving} onClick={() => setRemove(null)}>
                          取消
                        </Button>
                        <Button type="button" variant="destructive" disabled={blocked} onClick={() => void archive()}>
                          确认移除
                        </Button>
                      </div>
                    </div>
                  ) : draft ? (
                    <form
                      className={styles.form}
                      onSubmit={(event) => {
                        event.preventDefault()
                        void save()
                      }}
                    >
                      <div className={styles.detailTitle}>
                        <span className={styles.eyebrow}>{draft.reference ? '整理素材' : '收藏新灵感'}</span>
                        <h3 ref={detailHeading} tabIndex={-1}>
                          {draft.reference ? '编辑参考' : '新建参考'}
                        </h3>
                        <p className={styles.muted}>保存后可跨作品使用，再勾选带入对话。</p>
                      </div>
                      <FormField label="名称">
                        <Input
                          required
                          maxLength={100}
                          disabled={blocked}
                          placeholder="给这份素材起个名字"
                          value={draft.title}
                          onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                        />
                      </FormField>
                      <FormField label="标签" hint="用逗号分隔，最多 12 个，每个不超过 32 字。">
                        <Input
                          maxLength={400}
                          disabled={blocked}
                          placeholder="如：氛围，叙事节奏"
                          value={draft.tags}
                          onChange={(event) => setDraft({ ...draft, tags: event.target.value })}
                        />
                      </FormField>
                      <FormField label="参考正文" hint={`${draft.content.length.toLocaleString()} / 8,000 字；保留换行，自由组织内容。`}>
                        <Textarea
                          required
                          rows={10}
                          maxLength={8000}
                          disabled={blocked}
                          placeholder="写下想收藏的片段、场景或表达方式…"
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
                      <div className={styles.editorActions}>
                        <Button type="button" variant="ghost" disabled={saving} onClick={() => setDraft(null)}>
                          取消编辑
                        </Button>
                        <Button type="submit" disabled={blocked || !draft.title.trim() || !draft.content.trim()}>
                          {saving ? '正在保存…' : '保存参考'}
                        </Button>
                      </div>
                    </form>
                  ) : preview ? (
                    <article className={styles.preview}>
                      <div className={styles.previewToolbar}>
                        <span className={styles.eyebrow}>
                          <FileText size={14} aria-hidden="true" />
                          参考内容
                        </span>
                        <div className={styles.previewActions}>
                          <Button type="button" variant="ghost" size="sm" disabled={blocked || transitioning} onClick={() => edit(preview)}>
                            <Pencil size={14} aria-hidden="true" />
                            查看与编辑
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            disabled={blocked || transitioning}
                            aria-label="移除"
                            onClick={() => {
                              setRemove(preview)
                              showDetail()
                            }}
                          >
                            <Trash2 size={15} aria-hidden="true" />
                          </Button>
                        </div>
                      </div>
                      <div className={styles.detailTitle}>
                        <h3 ref={detailHeading} tabIndex={-1}>
                          {preview.title}
                        </h3>
                        <div className={styles.metadata}>
                          <span>{preview.content.length.toLocaleString()} 字</span>
                          {!!preview.tags.length && (
                            <div className={styles.tags}>
                              {preview.tags.map((tag) => (
                                <span key={tag}>{tag}</span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                      {preview.usage && (
                        <div className={styles.usage}>
                          <strong>借鉴方式</strong>
                          <p>{preview.usage}</p>
                        </div>
                      )}
                      <div className={styles.prose}>{preview.content}</div>
                      <Button
                        type="button"
                        variant={previewSelected ? 'secondary' : 'outline'}
                        className={styles.addSelection}
                        disabled={blocked || transitioning || (!previewSelected && value.references.length >= AGENT_REFERENCE_LIMIT)}
                        onClick={() => select(preview, !previewSelected)}
                      >
                        {previewSelected ? <Check size={16} aria-hidden="true" /> : <Plus size={16} aria-hidden="true" />}
                        {previewSelected ? '已选入本次参考 · 取消选择' : '选入本次参考'}
                      </Button>
                    </article>
                  ) : (
                    <div className={styles.detailEmpty}>
                      <BookMarked size={30} strokeWidth={1.25} aria-hidden="true" />
                      <h3>为下一次创作，留一份灵感</h3>
                      <p>
                        {transitioning
                          ? '正在读取你的参考素材…'
                          : query
                            ? '换个关键词，找找想用的素材。'
                            : '情节的转折、氛围的铺陈、喜欢的叙事节奏，都可以在这里收藏与复用。'}
                      </p>
                      {!query && !transitioning && (
                        <Button type="button" variant="outline" disabled={blocked} onClick={() => edit()}>
                          <Plus size={15} aria-hidden="true" />
                          新建第一张参考
                        </Button>
                      )}
                    </div>
                  )}
                </div>
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
