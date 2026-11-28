import { useDeferredValue, useEffect, useRef, useState } from 'react'
import { STUDIO_DEFINITIONS, STUDIO_KINDS, studioBlank, type StudioCard, type StudioCardInput, type StudioKind, type StudioState, type StudioVersion } from '@shared/ai-writing-studio'
import { agentApi } from '@/lib/ai-agent-api'
import { Button } from '@/components/ui/button'
import { Dialog, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { MotionDetails } from '@/components/ui/motion'
import { ReadingDialog } from '@/components/shared/ReadingDialog'
import FormField from '@/components/shared/FormField'
import styles from './agent-writing-studio.module.css'

interface Props { sessionId: string; disabled: boolean; onChanged: () => void; onDiscuss: (prompt: string) => void }
interface Editor { input: StudioCardInput; original?: StudioCard }
const status = (card: StudioCard) => card.status === 'proposed' ? '待采纳' : card.locked ? '已锁定' : '已保存'
function CardText({ card }: { card: StudioCardInput }) {
  return <dl className={styles.fields}>{STUDIO_DEFINITIONS[card.kind].fields.filter(f => card.values[f.key]).map(field =>
    <div key={field.key}><dt>{field.label}</dt><dd>{card.values[field.key]}</dd></div>)}</dl>
}
export default function AiAgentWritingStudio({ sessionId, disabled, onChanged, onDiscuss }: Props) {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<StudioState>({ cards: [], contextOmitted: [] })
  const [kind, setKind] = useState<StudioKind>('scene')
  const [query, setQuery] = useState('')
  const search = useDeferredValue(query)
  const [selectedId, setSelectedId] = useState('')
  const [editor, setEditor] = useState<Editor | null>(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [instruction, setInstruction] = useState('')
  const [versions, setVersions] = useState<StudioVersion[] | null>(null)
  const [assembly, setAssembly] = useState<{ title: string; scenes: StudioCard[] } | null>(null)
  const alive = useRef(true), locked = useRef(false), readRequest = useRef(0)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  async function refresh() {
    const request = ++readRequest.current
    setLoading(true)
    try {
      const next = await agentApi.writingStudio(sessionId)
      if (alive.current && request === readRequest.current) { setState(next); setLoaded(true) }
    } catch (e) { if (alive.current && request === readRequest.current) setError(e instanceof Error ? e.message : '读取失败，请重试') }
    finally { if (alive.current && request === readRequest.current) setLoading(false) }
  }
  async function perform(work: () => Promise<void>) {
    if (locked.current || disabled) return
    locked.current = true; setBusy(true); setError(''); setNotice('')
    try { await work(); if (alive.current) { await refresh(); onChanged() } }
    catch (e) { if (alive.current) setError(e instanceof Error ? e.message : '操作失败，编辑内容已保留') }
    finally { locked.current = false; if (alive.current) setBusy(false) }
  }
  const visible = state.cards.filter(c => c.kind === kind && (!search.trim() || (c.title + Object.values(c.values).join(' ')).toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())))
  const current = visible.find(c => c.id === selectedId) || visible[0]
  const original = current?.replaces ? state.cards.find(c => c.id === current.replaces?.id) : undefined
  const blocked = busy || disabled || loading || !loaded
  const definition = STUDIO_DEFINITIONS[kind]
  const scenes = state.cards.filter(c => c.kind === 'scene' && c.status === 'active')
  const valid = !!editor && !!editor.input.title.trim() && STUDIO_DEFINITIONS[editor.input.kind].fields.every(f =>
    (editor.input.values[f.key] || '').length <= f.limit && (!f.required || !!editor.input.values[f.key]?.trim()))
  function switchKind(value: StudioKind) { setKind(value); setQuery(''); setSelectedId(''); setVersions(null); setAssembly(null); setNotice('') }
  function edit(card?: StudioCard) {
    setEditor({ input: card ? { ...card, values: { ...card.values }, evidence: [...card.evidence] } : { ...studioBlank(kind), position: kind === 'scene' ? Math.min(9999, Math.max(-1, ...scenes.map(c => c.position)) + 1) : 0 }, original: card })
    setVersions(null); setAssembly(null)
  }
  function prepare(extra = '') {
    const prompt = `【写作工坊 · ${definition.label}】\n${definition.prompt}\n${current ? `本次针对《${current.title}》（cardId=${current.id}，revision=${current.revision}）。\n` : ''}${instruction.trim()}${extra}`
    onDiscuss(prompt); setOpen(false)
  }
  return <Dialog open={open} onOpenChange={next => { if (!busy && !editor) { setOpen(next); if (next) void refresh() } }}>
    <DialogTrigger asChild><Button type="button" variant="ghost" size="sm">写作工坊</Button></DialogTrigger>
    {open && <ReadingDialog title="写作工坊" description="把一场戏写细，让人物和写法逐渐成形。助手的建议经采纳后才参与后续写作。"
      footer={<div className={styles.actions}><Button variant="ghost" disabled={busy || !!editor} onClick={() => setOpen(false)}>关闭</Button>
        <Button variant="ghost" disabled={busy || loading} onClick={() => void refresh()}>刷新资料</Button>
        {loading && <span role="status">正在读取…</span>}</div>}>
      <div className={styles.root}>
        <nav className={styles.tabs} aria-label="写作工坊分类">{STUDIO_KINDS.map(value => <Button key={value} variant={kind === value ? 'secondary' : 'ghost'} aria-pressed={kind === value} disabled={!!editor || busy} onClick={() => switchKind(value)}>{STUDIO_DEFINITIONS[value].label}</Button>)}</nav>
        <p className={styles.muted}>{definition.description}</p>
        {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
        {!!state.contextOmitted.length && <p className={styles.muted}>以下资料暂未带入写作：{state.contextOmitted.join('、')}。可重新核对来源或移除不再使用的资料。</p>}
        {editor ? <section className={styles.editor} aria-label="编辑写作资料">
          <FormField label="标题"><Input value={editor.input.title} maxLength={160} disabled={blocked} onChange={e => setEditor({ ...editor, input: { ...editor.input, title: e.target.value } })} /></FormField>
          {editor.input.kind === 'preference' && <FormField label="使用范围"><Select value={editor.input.scope} disabled={blocked || !!editor.original?.replaces} onValueChange={value => setEditor({ ...editor, input: { ...editor.input, scope: value as 'book' | 'personal' } })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="book">仅本书</SelectItem><SelectItem value="personal">我的所有作品</SelectItem></SelectContent></Select></FormField>}
          {editor.input.kind === 'scene' && <FormField label="场景顺序"><Input type="number" min={0} max={9999} disabled={blocked} value={editor.input.position} onChange={e => setEditor({ ...editor, input: { ...editor.input, position: Number(e.target.value) } })} /></FormField>}
          {STUDIO_DEFINITIONS[editor.input.kind].fields.map(field => <FormField key={field.key} label={field.label + (field.required ? '（必填）' : '')}>
            {field.options ? <Select disabled={blocked} value={editor.input.values[field.key] || ''} onValueChange={value => setEditor({ ...editor, input: { ...editor.input, values: { ...editor.input.values, [field.key]: value } } })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{field.options.map(option => <SelectItem key={option} value={option}>{option}</SelectItem>)}</SelectContent></Select>
              : <Textarea disabled={blocked} rows={field.key === 'prose' ? 12 : field.limit > 800 ? 4 : 2} maxLength={field.limit} value={editor.input.values[field.key] || ''} onChange={e => setEditor({ ...editor, input: { ...editor.input, values: { ...editor.input.values, [field.key]: e.target.value } } })} />}
          </FormField>)}
          {editor.original?.stale && <p role="status">来源已变化。请先保留手写内容，再让助手重新核对；旧建议不能直接采纳。</p>}
          <div className={styles.actions}><Button variant="ghost" disabled={busy} onClick={() => setEditor(null)}>放弃编辑</Button>
            <Button disabled={blocked || !valid} onClick={() => void perform(async () => { const result = await agentApi.saveWritingCard(sessionId, editor.input, editor.original); if (alive.current) { setSelectedId(result.card.id); setEditor(null); setNotice(result.card.status === 'proposed' ? '已保存建议，核对后可采纳。' : '已保存写作资料。') } })}>保存</Button></div>
        </section> : assembly ? <section className={styles.editor} aria-label="合成草稿预览">
          <FormField label="章节标题"><Input value={assembly.title} maxLength={160} disabled={blocked} onChange={e => setAssembly({ ...assembly, title: e.target.value })} /></FormField>
          <p>勾选的场景按当前顺序合成，正文之间保留空行。可先检查场景衔接，再到产出区审阅草稿。</p>
          {scenes.map(scene => <label key={scene.id} className={styles.choice}><Checkbox disabled={blocked} checked={assembly.scenes.some(c => c.id === scene.id)} onCheckedChange={checked => setAssembly({ ...assembly, scenes: checked ? scenes.filter(c => c.id === scene.id || assembly.scenes.some(a => a.id === c.id)) : assembly.scenes.filter(c => c.id !== scene.id) })} /><span>{scene.title}{scene.values.prose ? '' : ' · 尚无正文'}</span></label>)}
          <div className={styles.prose}>{assembly.scenes.map(c => c.values.prose).join('\n\n')}</div>
          <div className={styles.actions}><Button variant="ghost" disabled={busy} onClick={() => setAssembly(null)}>返回</Button>
            <Button disabled={blocked || !assembly.title.trim() || !assembly.scenes.length || assembly.scenes.some(c => !c.values.prose?.trim())} onClick={() => void perform(async () => { await agentApi.assembleScenes(sessionId, assembly.title, assembly.scenes.map(c => ({ id: c.id, revision: c.revision }))); if (alive.current) { setAssembly(null); setNotice('草稿已合成，请在「产出与采纳」中查看。') } })}>确认合成草稿</Button></div>
        </section> : <>
          <div className={styles.actions}><Input aria-label="搜索写作资料" placeholder="搜索当前分类" value={query} onChange={e => setQuery(e.target.value)} />
            {kind !== 'reading' && <Button variant="outline" disabled={blocked} onClick={() => edit()}>手动添加</Button>}
            {kind === 'scene' && scenes.length > 0 && <Button variant="outline" disabled={blocked} onClick={() => setAssembly({ title: '', scenes: [...scenes] })}>合成章节</Button>}</div>
          <div className={styles.workspace} aria-busy={loading || query !== search}>
            <ul className={styles.list} aria-label={definition.label}>{visible.map((card, index) => <li key={card.id} style={{ animationDelay: `${Math.min(index * 24, 240)}ms` }}><Button variant="ghost" className={styles.row} aria-pressed={current?.id === card.id} onClick={() => { setSelectedId(card.id); setVersions(null) }} disabled={busy}><span>{card.title}</span><small>{status(card)}{card.stale ? ' · 来源已变化' : ''}</small></Button></li>)}</ul>
            <section className={styles.detail} aria-label="写作资料详情">{current ? <>
              <div><h3>{current.title}</h3><p className={styles.muted}>{status(current)} · 第 {current.revision} 版 · {current.scope === 'personal' ? '个人资料' : current.scope === 'book' ? '本书资料' : '本次对话'}</p></div>
              {current.stale && <p role="status">引用的正文或版本已变化，请重新核对。这项资料暂不用于后续写作。</p>}
              {original && <MotionDetails><summary>对照当前保存的版本</summary><CardText card={original} /></MotionDetails>}
              <CardText card={current} />
              {current.evidence.length > 0 && <MotionDetails><summary>查看来源引文（{current.evidence.length}）</summary><div className={styles.evidence}>{current.evidence.map((source, i) => <blockquote key={i}>{source.beforeQuote && <p>修改前：{source.beforeQuote}</p>}<p>{source.kind === 'edit' ? '采纳后：' : ''}{source.quote}</p><small>{source.kind === 'edit' ? '已采纳的改稿对照' : source.kind === 'chapter' ? '正式章节原文' : source.kind === 'scene' ? '场景正文' : '草稿原文'}</small></blockquote>)}</div></MotionDetails>}
              <div className={styles.actions}>
                {current.status === 'proposed' && <Button disabled={blocked || !!current.stale} onClick={() => void perform(async () => { const result = await agentApi.changeWritingCard(sessionId, current, 'accept'); if (alive.current) { setSelectedId(result.card.id); setNotice('已采纳。') } })}>采纳这项建议</Button>}
                <Button variant="outline" disabled={blocked || current.locked} onClick={() => edit(current)}>编辑</Button>
                {current.kind === 'scene' && current.status === 'active' && <Button variant="outline" disabled={blocked} onClick={() => void perform(async () => { await agentApi.changeWritingCard(sessionId, current, current.locked ? 'unlock' : 'lock') })}>{current.locked ? '解锁场景' : '锁定场景'}</Button>}
                <Button variant="ghost" disabled={blocked} onClick={() => void perform(async () => { const result = await agentApi.writingCardVersions(sessionId, current.id); if (alive.current) setVersions(result.versions) })}>历史版本</Button>
                <Button variant="ghost" disabled={blocked || current.locked} onClick={() => void perform(async () => { await agentApi.changeWritingCard(sessionId, current, 'archive'); if (alive.current) { setVersions(null); setNotice('已移除这项资料。') } })}>{current.status === 'proposed' ? '不采纳' : '移除'}</Button>
              </div>
              {versions && <section className={styles.history} aria-label="最近二十个版本">{versions.map(version => <MotionDetails key={version.revision}><summary>第 {version.revision} 版{version.revision === current.revision ? ' · 当前版本' : ''}</summary><CardText card={version.card} />{version.revision !== current.revision && version.card.status !== 'archived' && <Button variant="outline" disabled={blocked || current.locked} onClick={() => void perform(async () => { await agentApi.changeWritingCard(sessionId, current, 'restore', version.revision); if (alive.current) { setVersions(null); setNotice('已恢复所选内容，并保存为新版本。') } })}>恢复这一版内容</Button>}</MotionDetails>)}</section>}
            </> : <p className={styles.muted}>{loaded ? query ? '没有匹配的资料。' : '还没有这类资料。可以填写要求，让助手查阅并整理建议。' : '正在读取写作资料…'}</p>}</section>
          </div>
          <section className={styles.editor} aria-label="准备创作要求">
            <FormField label="这次想怎么写" hint="带到对话后可继续补充，发送时才会调用模型。"><Textarea rows={3} maxLength={3000} value={instruction} disabled={blocked} placeholder={kind === 'reading' ? '例如：试读最新草稿，关注紧张感中断和结尾期待。也可指定章节或场景。' : kind === 'preference' ? '例如：从最近已经采纳的改稿中，整理情绪表达和段落节奏偏好。' : '例如：只完善第二场争执的转折，结尾保持未和解。'} onChange={e => setInstruction(e.target.value)} /></FormField>
            <div className={styles.actions}><Button variant="outline" disabled={blocked} onClick={() => prepare()}>带到对话中整理</Button>
              {current?.kind === 'scene' && !current.locked && current.status === 'active' && <Button disabled={blocked} onClick={() => prepare('\n请明确开始写这一场正文，保留其他场景。将完整场景正文放入 values.prose，并作为替换该场景的待采纳建议。')}>请助手写这一场</Button>}
              {kind === 'scene' && scenes.some(c => !!c.values.prose) && <Button variant="ghost" disabled={blocked} onClick={() => { onDiscuss('请读取写作工坊中已保存的场景及正文，按场景顺序模拟试读，检查视角、时间、情绪与动作衔接。逐项保存 reading 建议，引用实际场景原句，暂不改写正文。'); setOpen(false) }}>检查场景衔接</Button>}
              {current?.kind === 'voice' && <Button variant="ghost" disabled={blocked || !!current.stale} onClick={() => prepare('\n请进一步检查我指定草稿中这个人物的台词：对照原文说话档案，逐项保存 reading 意见，引用待改句与原对白，给出两种可选说法；不要直接覆盖草稿。')}>检查草稿人物口吻</Button>}
              {current?.kind === 'reading' && <Button variant="ghost" disabled={blocked || !!current.stale} onClick={() => prepare('\n请结合这项试读建议和来源，使用现有改写工具给出局部修改方案，保留其他内容，等待我采纳。')}>讨论如何修改</Button>}
            </div>
          </section>
        </>}
      </div>
    </ReadingDialog>}
  </Dialog>
}
