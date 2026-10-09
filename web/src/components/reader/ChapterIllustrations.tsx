import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Dialog } from 'radix-ui'
import { ImagePlus, X } from 'lucide-react'
import { type ChapterIllustration, resolveIllustrationAnchor } from '@shared/chapter-illustrations'
import { hashParagraphText } from '@shared/thought-anchor'
import { illustrationsApi } from '../../lib/api'
import { makeIllustrationAnchor } from '../../lib/chapter-illustrations'
import { formatContent, excerptText } from '../../lib/reader-utils'
import '../../styles/chapter-illustrations.css'

interface Props {
  chapterId: string
  content: string
  bodyRef: RefObject<HTMLDivElement | null>
  canManage: boolean
  managing: boolean
  onExit: () => void
  visible?: boolean
  shortcut?: { paragraphIndex: number; nonce: number } | null
}

export function IllustrationPicture({ item }: { item: ChapterIllustration }) {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState({ key: '', src: '', error: false })
  const key = `${item.chapterId}:${item.id}:${item.assetId}:${attempt}`
  const { src, error } = state.key === key ? state : { src: '', error: false }
  const container = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const controller = new AbortController()
    let objectUrl = ''
    const load = () => {
      void illustrationsApi
        .imageBlob(item.chapterId, item.id, controller.signal)
        .then((blob) => {
          if (controller.signal.aborted) return
          objectUrl = URL.createObjectURL(blob)
          setState({ key, src: objectUrl, error: false })
        })
        .catch(() => {
          if (!controller.signal.aborted) setState({ key, src: '', error: true })
        })
    }
    // Reserve dimensions immediately; only fetch images approaching the viewport.
    let observer: IntersectionObserver | undefined
    if (typeof IntersectionObserver !== 'undefined' && container.current) {
      observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            observer?.disconnect()
            load()
          }
        },
        { rootMargin: '600px' },
      )
      observer.observe(container.current)
    } else load()
    return () => {
      observer?.disconnect()
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [key, item.chapterId, item.id])
  return (
    <div ref={container} className={`chapter-illustration-picture chapter-illustration-picture--${item.size}`}>
      <div className="chapter-illustration-frame" style={{ aspectRatio: `${item.width} / ${item.height}` }}>
        {src ? (
          <Dialog.Root>
            <Dialog.Trigger asChild>
              <button type="button" aria-label="放大查看章节插图" className="chapter-illustration-trigger">
                <img
                  src={src}
                  alt={item.caption || '章节插图'}
                  width={item.width}
                  height={item.height}
                  onError={() => setState({ key, src: '', error: true })}
                />
              </button>
            </Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Overlay className="illustration-overlay" />
              <Dialog.Content className="illustration-lightbox" aria-describedby={undefined}>
                <Dialog.Title className="sr-only">章节插图大图</Dialog.Title>
                <Dialog.Close asChild>
                  <button className="illustration-close" type="button" aria-label="关闭图片预览">
                    <X size={22} />
                  </button>
                </Dialog.Close>
                <img src={src} alt={item.caption || '章节插图'} />
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        ) : error ? (
          <button type="button" onClick={() => setAttempt((value) => value + 1)}>
            图片加载失败，点击重试
          </button>
        ) : (
          <span role="status">正在加载插图…</span>
        )}
      </div>
      {item.caption && <figcaption>{item.caption}</figcaption>}
    </div>
  )
}

interface Editor {
  item: ChapterIllustration | null
  index: number
}
export default function ChapterIllustrations({ chapterId, content, bodyRef, canManage, managing, onExit, visible = true, shortcut }: Props) {
  const [data, setData] = useState<{ items: ChapterIllustration[]; revision: string; hash: string } | null>(null)
  const [loadError, setLoadError] = useState('')
  const [reload, setReload] = useState(0)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [moving, setMoving] = useState<ChapterIllustration | null>(null)
  const [file, setFile] = useState<File>()
  const [caption, setCaption] = useState('')
  const [size, setSize] = useState<'medium' | 'full'>('medium')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [hosts, setHosts] = useState<{ element: HTMLDivElement; index: number }[]>([])
  const [undo, setUndo] = useState<{ before: ChapterIllustration | null; after: ChapterIllustration } | null>(null)
  const paragraphs = useMemo(() => {
    const root = document.createElement('div')
    root.innerHTML = formatContent(content)
    return Array.from(root.querySelectorAll<HTMLElement>('p'))
  }, [content])
  const editable = canManage && managing
  const fresh = !!data && data.hash === hashParagraphText(content)
  const positions = useMemo(
    () =>
      new Map(
        (data?.items || []).map((item) => [
          item.id,
          resolveIllustrationAnchor(
            item.anchor,
            paragraphs.map((p) => p.textContent || ''),
            item.chapterRevision === data?.revision,
          ),
        ]),
      ),
    [data, paragraphs],
  )
  const pending = (data?.items || []).filter((item) => positions.get(item.id) === null)
  useEffect(() => {
    const controller = new AbortController()
    void illustrationsApi
      .list(chapterId, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setData({ items: value.illustrations, revision: value.chapterRevision, hash: value.contentHash })
      })
      .catch((err) => {
        if (!controller.signal.aborted) setLoadError((err as Error).message)
      })
    return () => controller.abort()
  }, [chapterId, reload])
  useEffect(() => {
    if (!editable) {
      // The mode is controlled by external reader/admin toolbars; close their editor when it exits.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setEditor(null)
      setMoving(null)
    }
  }, [editable])
  useEffect(() => {
    if (!undo) return
    const timer = setTimeout(() => setUndo(null), 12_000)
    return () => clearTimeout(timer)
  }, [undo])
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : ''), [file])
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview)
    },
    [preview],
  )

  function open(index: number, item: ChapterIllustration | null = null) {
    if (busyRef.current || !fresh) return
    setEditor({ index, item })
    setCaption(item?.caption || '')
    setSize(item?.size || 'medium')
    setFile(undefined)
    setError('')
  }
  const shortcutHandled = useRef<number | null>(null)
  useEffect(() => {
    if (shortcut && editable && fresh && shortcutHandled.current !== shortcut.nonce) {
      shortcutHandled.current = shortcut.nonce
      open(shortcut.paragraphIndex)
    }
    // open uses the current editor state, but is triggered only by a new shortcut.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shortcut, editable, fresh])

  // Keep illustration and control nodes outside <p>, preserving existing paragraph indexes.
  const scrollAnchor = useRef<{ element: HTMLElement; top: number } | null>(null)
  useLayoutEffect(() => {
    const body = bodyRef.current
    if (!body || !data || !fresh || (!visible && !editable)) {
      setHosts([])
      return
    }
    const nodes = Array.from(body.querySelectorAll<HTMLElement>('p'))
    if (!scrollAnchor.current) {
      const element = nodes.find((node) => node.getBoundingClientRect().bottom > 0)
      scrollAnchor.current = element ? { element, top: element.getBoundingClientRect().top } : null
    }
    const indexes = new Set<number>(editable ? [-1, ...nodes.map((_, index) => index), nodes.length] : [])
    for (const index of positions.values()) if (index !== null) indexes.add(index)
    const mounts = [...indexes]
      .sort((a, b) => a - b)
      .map((index) => {
        const element = document.createElement('div')
        element.className = 'chapter-illustration-slot'
        if (index === -1) body.prepend(element)
        else if (index === nodes.length) body.append(element)
        else nodes[index]?.after(element)
        return { element, index }
      })
    setHosts(mounts)
    return () => {
      const element = nodes.find((node) => node.getBoundingClientRect().bottom > 0)
      scrollAnchor.current = element ? { element, top: element.getBoundingClientRect().top } : null
      mounts.forEach((mount) => mount.element.remove())
    }
  }, [bodyRef, content, data, fresh, visible, editable, positions])
  useLayoutEffect(() => {
    const saved = scrollAnchor.current
    if (saved?.element.isConnected) {
      const delta = saved.element.getBoundingClientRect().top - saved.top
      if (Math.abs(delta) > 1) window.scrollBy(0, delta)
    }
    scrollAnchor.current = null
  }, [hosts])

  function selectFile(value?: File) {
    if (!value) return
    if (!/^image\/(jpeg|png|webp|avif)$/.test(value.type) || value.size > 10 * 1024 * 1024) {
      setError('请选择不超过 10MB 的 JPG、PNG、WebP 或 AVIF 图片')
      return
    }
    setFile(value)
    setError('')
  }
  async function commit(item: ChapterIllustration | null, index: number, patch: Record<string, unknown>, upload?: File) {
    if (!data || !fresh || busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError('')
    try {
      const next = await illustrationsApi.save(
        chapterId,
        item?.id || null,
        {
          caption: item?.caption || '',
          size: item?.size || 'medium',
          anchor: makeIllustrationAnchor(paragraphs, index),
          version: item?.version,
          chapterRevision: data.revision,
          ...patch,
        },
        upload,
      )
      setData((current) =>
        current
          ? {
              ...current,
              items: [...current.items.filter((value) => value.id !== next.id), ...(!next.deleted ? [next] : [])].sort((a, b) => a.order - b.order),
            }
          : current,
      )
      setUndo({ before: item, after: next })
      setEditor(null)
      setMoving(null)
      return next
    } catch (err) {
      setError((err as Error).message)
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }
  async function revert() {
    if (!undo) return
    const { before, after } = undo
    const reverted = await commit(
      after,
      before ? (positions.get(before.id) ?? -1) : -1,
      before
        ? {
            caption: before.caption,
            size: before.size,
            anchor: before.anchor,
            assetId: before.assetId,
            deleted: before.deleted,
          }
        : { anchor: after.anchor, deleted: true },
    )
    if (reverted) setUndo(null)
    // commit exposes failures; retain the undo action when retrying is necessary.
  }

  return (
    <>
      {loadError && (
        <div className="illustration-notice" role="alert">
          {loadError}{' '}
          <button
            type="button"
            onClick={() => {
              setData(null)
              setLoadError('')
              setReload((value) => value + 1)
            }}
          >
            重试
          </button>
        </div>
      )}
      {editable && (
        <div className="illustration-manager" onClick={(event) => event.stopPropagation()}>
          <div className="illustration-manager-heading">
            <strong>章节插图</strong>
            <button type="button" className="btn btn--secondary btn--sm" disabled={busy} onClick={onExit}>
              完成
            </button>
          </div>
          {!data ? (
            <span role="status">正在加载插图…</span>
          ) : !fresh ? (
            <span role="alert">正文与已保存章节不同，请先保存正文并重新打开，或重新加载阅读页面。</span>
          ) : (
            <span>{moving ? '点击正文段落间的「＋」，选择新的位置。' : '点击段落之间的「＋」添加，保存后所有读者可见。'}</span>
          )}
          {moving && (
            <button type="button" disabled={busy} onClick={() => setMoving(null)}>
              取消移动
            </button>
          )}
          {!!data?.items.length && (
            <details className="illustration-list">
              <summary>已保存插图（{data.items.length}）</summary>
              <ol>
                {[...data.items]
                  .sort((a, b) => (positions.get(a.id) ?? Infinity) - (positions.get(b.id) ?? Infinity) || a.order - b.order)
                  .map((item) => {
                    const index = positions.get(item.id)
                    return (
                      <li key={item.id}>
                        <strong>{item.caption || '未填写图注'}</strong>
                        <span>
                          {index === null
                            ? '位置待确认'
                            : index === -1
                              ? '章节开头'
                              : index === paragraphs.length
                                ? '章节结尾'
                                : `第 ${(index ?? 0) + 1} 段后：${excerptText(paragraphs[index ?? 0]?.textContent || '')}`}
                        </span>
                        <div>
                          <button type="button" disabled={busy || !fresh || index === null} onClick={() => open(index ?? -1, item)}>
                            编辑
                          </button>
                          <button
                            type="button"
                            disabled={busy || !fresh}
                            onClick={() => {
                              setMoving(item)
                              setError('')
                            }}
                          >
                            移动位置
                          </button>
                          <button
                            type="button"
                            disabled={busy || !fresh}
                            onClick={() => void commit(item, index ?? -1, { anchor: item.anchor, deleted: true })}
                          >
                            移除插图
                          </button>
                        </div>
                      </li>
                    )
                  })}
              </ol>
            </details>
          )}
          {pending.length > 0 && (
            <div className="illustration-pending">
              <strong>位置待确认（{pending.length}）</strong>
              {pending.map((item) => (
                <div key={item.id}>
                  <IllustrationPicture item={item} />
                  <span>原段落：{excerptText(item.anchor.paragraphText)}</span>
                  <button
                    type="button"
                    disabled={busy || !fresh}
                    onClick={() => {
                      setMoving(item)
                      setError('')
                    }}
                  >
                    重新定位
                  </button>
                  <button type="button" disabled={busy || !fresh} onClick={() => void commit(item, -1, { anchor: item.anchor, deleted: true })}>
                    删除
                  </button>
                </div>
              ))}
            </div>
          )}
          {data && fresh && !data.items.length && <span>本章还没有插图。</span>}
          {error && !editor && (
            <div role="alert">
              {error}{' '}
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setError('')
                  setData(null)
                  setLoadError('')
                  setReload((value) => value + 1)
                }}
              >
                刷新插图
              </button>
            </div>
          )}
        </div>
      )}
      {undo && canManage && (
        <div className="illustration-undo" role="status">
          操作已保存{' '}
          <button type="button" disabled={busy} onClick={() => void revert()}>
            撤销
          </button>
        </div>
      )}
      {hosts.map(({ element, index }) =>
        createPortal(
          <>
            {(data?.items || [])
              .filter((item) => positions.get(item.id) === index)
              .map((item) => (
                <figure key={item.id} className="chapter-illustration">
                  <IllustrationPicture item={item} />
                  {editable && (
                    <div className="illustration-actions">
                      <button type="button" disabled={busy || !fresh} onClick={() => open(index, item)}>
                        编辑 / 替换
                      </button>
                      <button
                        type="button"
                        disabled={busy || !fresh}
                        onClick={() => {
                          setMoving(item)
                          setError('')
                        }}
                      >
                        移动
                      </button>
                      <button type="button" disabled={busy || !fresh} onClick={() => void commit(item, index, { anchor: item.anchor, deleted: true })}>
                        删除
                      </button>
                    </div>
                  )}
                </figure>
              ))}
            {editable && (
              <button
                type="button"
                className="illustration-insert"
                disabled={busy || !fresh}
                aria-label={index === -1 ? '在章节开头插图' : index === paragraphs.length ? '在章节结尾插图' : `在第 ${index + 1} 段后插图`}
                onClick={() => (moving ? void commit(moving, index, {}) : open(index))}
              >
                <ImagePlus size={16} />
                {moving ? '移到这里' : index === -1 ? '章节开头插图' : index === paragraphs.length ? '章节结尾插图' : '插入图片'}
              </button>
            )}
          </>,
          element,
          `${chapterId}:${index}`,
        ),
      )}
      <Dialog.Root
        open={!!editor}
        onOpenChange={(value) => {
          if (!value && !busy) setEditor(null)
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="illustration-overlay" />
          <Dialog.Content
            className="illustration-editor"
            onPointerDownOutside={(event) => event.preventDefault()}
            onEscapeKeyDown={(event) => {
              if (busy) event.preventDefault()
            }}
            onKeyDown={(event) => {
              if (!(event.metaKey || event.ctrlKey) || !['Enter', 's'].includes(event.key)) return
              event.preventDefault()
              event.stopPropagation()
              if (editor && !busy && fresh && (file || editor.item)) void commit(editor.item, editor.index, { caption, size }, file)
            }}
            onPaste={(event) => {
              const value = Array.from(event.clipboardData.files).find((value) => value.type.startsWith('image/'))
              if (value) {
                event.preventDefault()
                selectFile(value)
              }
            }}
          >
            <Dialog.Title>{editor?.item ? '编辑章节插图' : '添加章节插图'}</Dialog.Title>
            <Dialog.Description>预览仅自己可见，保存后成为所有读者共享的章节插图。</Dialog.Description>
            <label>
              插入位置
              <select
                disabled={busy}
                value={editor?.index ?? -1}
                onChange={(event) => setEditor((current) => (current ? { ...current, index: Number(event.target.value) } : current))}
              >
                <option value={-1}>章节开头</option>
                {paragraphs.map((paragraph, index) => (
                  <option key={index} value={index}>
                    第 {index + 1} 段后：{excerptText(paragraph.textContent || '').slice(0, 36)}
                  </option>
                ))}
                <option value={paragraphs.length}>章节结尾</option>
              </select>
            </label>
            <div className="illustration-context">
              <span>
                上文：
                {editor && editor.index >= 0 && editor.index < paragraphs.length
                  ? excerptText(paragraphs[editor.index]?.textContent || '')
                  : editor?.index === paragraphs.length
                    ? excerptText(paragraphs.at(-1)?.textContent || '')
                    : '章节开头'}
              </span>
              <span>下文：{editor && editor.index + 1 < paragraphs.length ? excerptText(paragraphs[editor.index + 1]?.textContent || '') : '章节结尾'}</span>
            </div>
            <label className="illustration-upload">
              选择图片（也可以在此粘贴）
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/avif"
                disabled={busy}
                onChange={(event) => {
                  selectFile(event.target.files?.[0])
                  event.target.value = ''
                }}
              />
            </label>
            <span className="illustration-help">JPG、PNG、WebP、AVIF，最大 10MB</span>
            {file && <span className="illustration-help">已选择：{file.name}</span>}
            {preview ? (
              <figure className={`chapter-illustration-picture chapter-illustration-picture--${size}`}>
                <img className="illustration-file-preview" src={preview} alt="待保存插图预览" />
              </figure>
            ) : (
              editor?.item && <IllustrationPicture item={{ ...editor.item, size }} />
            )}
            <label>
              图注（可选）
              <textarea value={caption} maxLength={500} rows={2} disabled={busy} onChange={(event) => setCaption(event.target.value)} />
            </label>
            <label>
              展示宽度
              <select value={size} disabled={busy} onChange={(event) => setSize(event.target.value as 'medium' | 'full')}>
                <option value="medium">适中</option>
                <option value="full">正文宽度</option>
              </select>
            </label>
            {caption && <div className="illustration-caption-preview">{caption}</div>}
            {error && <div role="alert">{error}</div>}
            <div className="illustration-editor-footer">
              <button className="btn btn--secondary" type="button" disabled={busy} onClick={() => setEditor(null)}>
                取消
              </button>
              <button
                className="btn btn--primary"
                type="button"
                disabled={busy || !fresh || (!file && !editor?.item)}
                onClick={() => editor && void commit(editor.item, editor.index, { caption, size }, file)}
              >
                {busy ? '保存中…' : '保存插图'}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  )
}
