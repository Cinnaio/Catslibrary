import { useEffect, useRef, useState } from 'react'
import { BookOpen, Download } from 'lucide-react'
import { KEEPSAKE_MAX_CLOSING, KEEPSAKE_MAX_MOMENTS, type KeepsakeContext, type KeepsakeInput, type KeepsakePage, type ReadingKeepsake } from '@shared/reading-keepsakes'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'
import { ReadingDialog, ReadingDialogEditor } from '@/components/shared/ReadingDialog'
import { useConfirm } from '../feedback'
import { getToken, url, type ApiError } from '../../lib/api'
import { getStorageScope } from '../../lib/storage'
import { keepsakesApi, keepsakeDate, keepsakeText } from '../../lib/reading-keepsakes'
import styles from './ReadingKeepsakes.module.css'

export default function ReadingKeepsakes({ novelId, mode, onClose }: { novelId: string; mode: string; onClose: () => void }) {
  const [context, setContext] = useState<KeepsakeContext | null>(null)
  const [items, setItems] = useState<ReadingKeepsake[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [selected, setSelected] = useState<ReadingKeepsake | null>(null)
  const [draft, setDraft] = useState(false)
  const [previewAt, setPreviewAt] = useState(Date.now)
  const [closing, setClosing] = useState('')
  const [ids, setIds] = useState<string[]>([])
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [locked, setLocked] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  const [coverFailed, setCoverFailed] = useState(false)
  const pending = useRef<KeepsakeInput | null>(null)
  const lifetime = useRef({ active: false })
  const inFlight = useRef(false)
  const opener = useRef(typeof document === 'undefined' ? null : document.activeElement)
  const { confirm } = useConfirm()

  function guard() {
    const life = lifetime.current, token = getToken(), scope = getStorageScope()
    return () => life.active && token === getToken() && scope === getStorageScope()
  }
  function fail(cause: unknown) {
    const status = (cause as ApiError).status
    if ([401, 403, 404].includes(status ?? 0)) {
      setContext(null); setItems([]); setSelected(null); setUnavailable(true); setClosing(''); setIds([]); pending.current = null
    }
    setError((cause as Error).message || '暂时无法打开这一页，请稍后重试。')
  }
  function applyContext(next: KeepsakeContext, page: KeepsakePage, makeDraft = false) {
    setContext(next); setItems(page.items); setCursor(page.nextCursor)
    setSelected(makeDraft ? null : page.items[0] ?? null); setDraft(makeDraft || !page.items.length)
    setIds([]); setClosing(''); pending.current = null; setLocked(false); setUnavailable(false); setPreviewAt(Date.now())
  }
  async function load(makeDraft = false) {
    if (inFlight.current) return
    inFlight.current = true
    const current = guard()
    setBusy(true); setError('')
    try {
      const [next, page] = await Promise.all([keepsakesApi.context(novelId, mode), keepsakesApi.list(novelId, mode)])
      if (!current()) return
      applyContext(next, page, makeDraft)
    } catch (cause) { if (current()) fail(cause) }
    finally { if (current()) { setBusy(false); inFlight.current = false } }
  }
  useEffect(() => {
    const life = { active: true }
    lifetime.current = life
    inFlight.current = true
    const current = guard()
    void Promise.all([keepsakesApi.context(novelId, mode), keepsakesApi.list(novelId, mode)])
      .then(([next, page]) => { if (current()) applyContext(next, page) })
      .catch(cause => { if (current()) fail(cause) })
      .finally(() => { if (current()) { setBusy(false); inFlight.current = false } })
    return () => { life.active = false }
    // Parent keys this panel by account, content mode, and book.
  }, [novelId, mode])

  async function save() {
    if (inFlight.current || !context) return
    const input = pending.current ?? { id: crypto.randomUUID(), previousId: context.latestId, momentIds: ids, closing }
    pending.current = input
    inFlight.current = true
    const current = guard()
    setBusy(true); setLocked(true); setError('')
    try {
      const { item } = await keepsakesApi.save(novelId, mode, input)
      if (!current()) return
      setItems(old => [item, ...old.filter(i => i.id !== item.id)]); setSelected(item); setDraft(false)
      pending.current = null; setLocked(false)
    } catch (cause) {
      if (!current()) return
      fail(cause)
      // Keep the exact payload after an ambiguous failure. Repeating it must not save another card.
    } finally { if (current()) { setBusy(false); inFlight.current = false } }
  }
  async function more() {
    if (inFlight.current || !cursor) return
    inFlight.current = true
    const current = guard()
    setBusy(true); setError('')
    try {
      const page = await keepsakesApi.list(novelId, mode, cursor)
      if (!current()) return
      setItems(old => [...old, ...page.items.filter(i => !old.some(o => o.id === i.id))]); setCursor(page.nextCursor)
    } catch (cause) { if (current()) fail(cause) }
    finally { if (current()) { setBusy(false); inFlight.current = false } }
  }
  async function remove() {
    if (!selected || inFlight.current) return
    const current = guard(), item = selected
    const accepted = await confirm({ title: '删除这张藏书票', message: '仅删除这张留念页，原来的想法仍会保留。删除后无法恢复。', okText: '删除' })
    if (!accepted || !current() || inFlight.current) return
    inFlight.current = true; setBusy(true); setError('')
    try {
      await keepsakesApi.remove(novelId, mode, item.id)
      if (!current()) return
      const remaining = items.filter(i => i.id !== item.id)
      setItems(remaining); setSelected(remaining[0] ?? null)
      inFlight.current = false
      if (!remaining.length) await load()
    } catch (cause) { if (current()) fail(cause) }
    finally { if (current()) { setBusy(false); inFlight.current = false } }
  }
  function download(item: ReadingKeepsake) {
    const blob = new Blob([keepsakeText(item)], { type: 'text/plain;charset=utf-8' })
    const href = URL.createObjectURL(blob), link = document.createElement('a')
    link.href = href; link.download = `${item.title.replace(/[\\/:*?"<>|]/g, '_')}-合上书以后.txt`
    link.click(); setTimeout(() => URL.revokeObjectURL(href), 1000)
  }
  const preview: ReadingKeepsake | null = draft && context ? { id: 'draft', novelId, ...context.novel,
    startedAt: context.startedAt, savedAt: previewAt, closing: closing.trim(), moments: ids.flatMap(id => context.candidates.filter(c => c.id === id)) } : selected

  return <Dialog open onOpenChange={open => { if (!open) onClose() }}>
    <ReadingDialog title="合上书以后" description="为这次阅读，留一页余温。只有你能看到，日后还可以再留一张。" bodyLabel="我的藏书票"
      onCloseAutoFocus={event => { event.preventDefault(); if (opener.current instanceof HTMLElement && opener.current.isConnected) opener.current.focus() }}
      footer={draft && context && !unavailable ? <div className={styles.actions}>
        <Button onClick={() => void save()} disabled={busy || (!closing.trim() && !ids.length)}>{busy ? '正在保存…' : locked ? '重试保存同一页' : '保存这页余温'}</Button>
        {items.length > 0 && <Button variant="ghost" disabled={busy || locked} onClick={() => { setDraft(false); setSelected(items[0]!) }}>返回已存藏书票</Button>}
      </div> : undefined}>
      {busy && <p className={styles.note} role="status"><Spinner size="sm" aria-hidden="true" /> 正在整理这一页…</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      {locked && !busy && <p className={styles.note}>重试会使用同一次保存。也可以关闭后重新打开，确认这张藏书票是否已存好。</p>}
      {!context && !busy && !unavailable && <Button variant="secondary" onClick={() => void load()}>重新打开</Button>}
      {!draft && context && !unavailable && <div className={styles.actions}>
        <Button variant="secondary" disabled={busy} onClick={() => void load(true)}>再留一页</Button>
        {selected && <Button variant="ghost" disabled={busy} onClick={() => download(selected)}><Download size={15} aria-hidden="true" />导出文字</Button>}
      </div>}
      {preview && !unavailable && <article className={styles.card} aria-label={draft ? '藏书票预览' : '已保存的藏书票'}>
        <span className={styles.eyebrow}>{draft ? '待留存 · 藏书票预览' : '我的藏书票'}</span>
        <div className={styles.book}>
          {preview.coverUrl && !coverFailed ? <img className={styles.cover} src={url(`/cover/${encodeURIComponent(novelId)}?cover=5&size=256`)} alt="" onError={() => setCoverFailed(true)} /> : <div className={styles.coverPlaceholder}><BookOpen size={28} aria-hidden="true" /></div>}
          <div><h3>{preview.title}</h3>{preview.author && <p className={styles.note}>{preview.author}</p>}</div>
        </div>
        <p className={styles.date}>{preview.startedAt ? `阅读记录起于 ${keepsakeDate(preview.startedAt)} · ` : ''}{draft ? '准备留于' : '留于'} {keepsakeDate(preview.savedAt)}</p>
        {preview.moments.map(m => <section key={m.id} className={styles.moment}>
          {m.selectedText && <blockquote>{m.selectedText}</blockquote>}
          <p className={styles.note}>—— {m.chapterTitle}</p>
          <p className={styles.thought}>{m.thoughtText}</p>
        </section>)}
        {preview.closing && <section className={styles.ending}><p className={styles.eyebrow}>这本书留给我的是……</p><p>{preview.closing}</p></section>}
        {!preview.moments.length && !preview.closing && <p className={styles.blank}>故事暂时停在这里。把还留在心里的那一句，写在下面。</p>}
      </article>}
      {draft && context && !unavailable && <div className={styles.editor}>
        <label htmlFor="keepsake-closing" className={styles.label}>这本书留给我的是……</label>
        <ReadingDialogEditor id="keepsake-closing" value={closing} onChange={event => setClosing(event.target.value)} maxLength={KEEPSAKE_MAX_CLOSING} rows={3} disabled={busy || locked} placeholder="比如：原来有些告别，也是另一种陪伴。" />
        <p className={styles.note}>{closing.length} / {KEEPSAKE_MAX_CLOSING} · 写一句话，或从下面选择想法，就可以留存。</p>
        <fieldset disabled={busy || locked} className={styles.choices}>
          <legend>带走几句，也带走当时的自己 <span className={styles.note}>{ids.length} / {KEEPSAKE_MAX_MOMENTS}</span></legend>
          <p className={styles.note}>从你在这本书里留下的想法中，选至多三则，原来划选的句子会一同留存。</p>
          {!context.candidates.length && <p className={styles.note}>还没有留下想法，写下此刻的感受也很好。</p>}
          {context.candidatesLimited && <p className={styles.note}>这里列出最近的 50 则想法。</p>}
          {context.candidates.map((m, i) => <label key={m.id} className={styles.choice} style={{ animationDelay: `${Math.min(i, 6) * 35}ms` }}>
            <input type="checkbox" checked={ids.includes(m.id)} disabled={!ids.includes(m.id) && ids.length >= KEEPSAKE_MAX_MOMENTS}
              onChange={e => setIds(old => e.target.checked ? [...old, m.id] : old.filter(id => id !== m.id))} />
            <span>{m.selectedText && <q>{m.selectedText}</q>}<span className={styles.choiceThought}>{m.thoughtText}</span><small>{m.chapterTitle}</small></span>
          </label>)}
        </fieldset>
        <p className={styles.note}>日期采用北京时间。有阅读记录时才显示起点；再次留页时，从上一张之后的记录算起。保存的文字不会随原想法修改。</p>
      </div>}
      {!draft && items.length > 0 && !unavailable && <section className={styles.history} aria-label="以前留下的余温">
        <p className={styles.label}>以前留下的余温</p>
        {items.map((item, index) => <button key={item.id} type="button" aria-pressed={selected?.id === item.id} disabled={busy}
          className={styles.historyRow} style={{ animationDelay: `${Math.min(index, 6) * 35}ms` }} onClick={() => setSelected(item)}>
          <span>{keepsakeDate(item.savedAt)}</span><span>{item.closing || item.moments[0]?.thoughtText || '留一页余温'}</span>
        </button>)}
        {cursor && <Button variant="ghost" disabled={busy} onClick={() => void more()}>查看更早的藏书票</Button>}
        {selected && <Button variant="ghost" disabled={busy} onClick={() => void remove()}>删除当前藏书票</Button>}
      </section>}
    </ReadingDialog>
  </Dialog>
}
