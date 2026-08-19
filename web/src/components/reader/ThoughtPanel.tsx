/**
 * 段评想法面板 —— 由 read.js thought-panel 结构平移。
 * 展示某段落的想法列表 + 发布/删除。
 */
import { useRef, useState } from 'react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import type { Thought } from '@shared/types'
import { url } from '../../lib/api'
import { timeText } from '../../lib/format'

interface ThoughtPanelProps {
  thoughts: Thought[]
  selectedText: string
  paragraphExcerpt: string
  canDelete: (thought: Thought) => boolean
  onClose: () => void
  onSubmit: (text: string, displayName: string) => Promise<void>
  onDelete: (id: string) => Promise<void>
}

/** 头像失败走 state 兜底（不能 remove() React 管理的节点）；无 img 时 CSS :has 让首字显示。 */
function ThoughtAvatar({ avatarUrl, name }: { avatarUrl?: string; name: string }) {
  const [failed, setFailed] = useState(false)
  return (
    <span className="thought-avatar">
      {!!avatarUrl && !failed && <img src={url(avatarUrl)} alt="" onError={() => setFailed(true)} />}
      <span>{name.slice(0, 1)}</span>
    </span>
  )
}

export default function ThoughtPanel({ thoughts, selectedText, paragraphExcerpt, canDelete, onClose, onSubmit, onDelete }: ThoughtPanelProps) {
  const restoreFocusRef = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null)
  const [text, setText] = useState('')
  const [name, setName] = useState('')
  const [status, setStatus] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function submit() {
    const trimmed = text.trim()
    if (!trimmed) {
      setStatus('想法内容不能为空')
      return
    }
    if (trimmed.length > 300) {
      setStatus('想法最多 300 字')
      return
    }
    setSubmitting(true)
    setStatus('正在发布…')
    try {
      await onSubmit(trimmed, name.trim())
      setText('')
      setStatus('已发布')
    } catch (err) {
      setStatus((err as Error).message || '发布失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <DialogPrimitive.Root open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="thought-overlay" />
        <DialogPrimitive.Content
          className="thought-panel"
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            restoreFocusRef.current?.focus()
          }}
        >
        <div className="thought-panel__header">
          <div>
            <DialogPrimitive.Title asChild>
              <h2>本段想法</h2>
            </DialogPrimitive.Title>
            <p className="thought-panel__excerpt">{paragraphExcerpt}</p>
          </div>
          <DialogPrimitive.Close asChild>
            <button type="button" className="thought-panel__close" aria-label="关闭想法面板">×</button>
          </DialogPrimitive.Close>
        </div>
        <div className="thought-list">
          {thoughts.length === 0 ? (
            <div className="thought-empty">这一段还没有想法，写下第一条吧。</div>
          ) : (
            thoughts.map((thought) => {
              const name = thought.displayName || '匿名读者'
              return (
                <article className="thought-item" key={thought.id}>
                  <div className="thought-item__meta">
                    <span className="thought-author">
                      <ThoughtAvatar avatarUrl={thought.avatarUrl} name={name} />
                      <span>{name}</span>
                    </span>
                    <span>{timeText(thought.createdAt)}</span>
                  </div>
                  {thought.selectedText && <blockquote className="thought-item__quote">{thought.selectedText}</blockquote>}
                  <p className="thought-item__text">{thought.thoughtText}</p>
                  {canDelete(thought) && (
                    <button className="btn btn--secondary btn--sm btn-delete-own-thought" onClick={() => void onDelete(thought.id)}>
                      删除
                    </button>
                  )}
                </article>
              )
            })
          )}
        </div>
        <form className="thought-compose" onSubmit={(event) => { event.preventDefault(); void submit() }}>
          <div className={`thought-selected-text${selectedText ? '' : ' hidden'}`}>
            {selectedText ? `划选：${selectedText}` : ''}
          </div>
          <input
            type="text"
            className="thought-input"
            maxLength={20}
            aria-label="昵称（可选）"
            placeholder="昵称（可选）"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <textarea
            className="thought-textarea"
            maxLength={300}
            rows={3}
            aria-label="想法内容"
            placeholder="写下你的想法，会公开显示给其他读者…"
            value={text}
            onChange={(e) => setText(e.target.value)}
          ></textarea>
          <div className="thought-compose__footer">
            <span className="thought-status" role="status" aria-live="polite">{status}</span>
            <button type="submit" className="btn btn--primary btn--sm" disabled={submitting}>
              发布想法
            </button>
          </div>
        </form>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
