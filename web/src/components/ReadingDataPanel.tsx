import { useEffect, useRef, useState } from 'react'
import type { ReadingDataPreview, ReadingDataResult } from '@shared/reading-data'
import { readingDataApi, getToken } from '../lib/api'
import { readLegacyReadingData } from '../lib/legacy-reading-data'
import { clearHistory, getStorageScope, getStorageUser } from '../lib/storage'
import { useContentPolicy } from '../context/ContentPolicyContext'
import { useConfirm } from './feedback'
import { formatDate } from '../lib/format'

const labels = { bookmark: '书签', progress: '阅读进度', bookshelf: '书架' }
function Preview({ preview }: { preview: ReadingDataPreview }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <>
      <ul className="reading-data-list">
        {preview.items.slice(0, expanded ? undefined : 20).map((item, i) => (
          <li key={`${item.kind}:${item.novelId}:${item.chapterId}:${i}`}>
            <strong>
              {labels[item.kind]} · {item.novelTitle}
              {item.chapterTitle ? ` / ${item.chapterTitle}` : ''}
            </strong>
            <span>{item.detail}</span>
          </li>
        ))}
      </ul>
      {!expanded && preview.items.length > 20 && (
        <button className="btn btn--secondary btn--sm" onClick={() => setExpanded(true)}>
          查看全部 {preview.items.length} 项
        </button>
      )}
      {preview.hasMore && <p className="profile-empty-note">每次最多修复 100 项；完成后可再次检查剩余数据。</p>}
    </>
  )
}

export function ReadingDataPanel({ userId, username }: { userId: string; username: string }) {
  const { safeMode } = useContentPolicy()
  const { confirm } = useConfirm()
  const mode = safeMode ? 'safe' : 'adult'
  const [legacy, setLegacy] = useState(readLegacyReadingData)
  const [repair, setRepair] = useState<ReadingDataPreview | null>(null)
  const [restore, setRestore] = useState<ReadingDataPreview | null>(null)
  const [history, setHistory] = useState<ReadingDataResult[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)
  const revision = useRef(0)
  const mounted = useRef(true)
  const mutation = useRef(false)
  useEffect(() => {
    mounted.current = true
    const token = getToken()
    void readingDataApi
      .operations()
      .then((data) => {
        if (mounted.current && token === getToken() && getStorageUser() === userId) setHistory(data.operations)
      })
      .catch(() => {})
    return () => {
      mounted.current = false
    }
  }, [userId])
  function context() {
    const token = getToken(),
      scope = getStorageScope(),
      seq = ++revision.current
    return () => mounted.current && seq === revision.current && token === getToken() && scope === getStorageScope() && getStorageUser() === userId
  }
  async function preview(kind: 'repair' | 'restore') {
    if (mutation.current) return
    const current = context()
    setBusy(true)
    setMessage('')
    setAcknowledged(false)
    if (kind === 'repair') setRepair(null)
    else setRestore(null)
    try {
      const local = readLegacyReadingData()
      if (kind === 'restore') setLegacy(local)
      const result = kind === 'repair' ? await readingDataApi.check(mode) : await readingDataApi.preview(local.data, mode)
      if (!current()) return
      if (kind === 'repair') setRepair(result)
      else setRestore(result)
    } catch (error) {
      if (current()) setMessage((error as Error).message || '检查失败，请重试')
    } finally {
      if (current()) setBusy(false)
    }
  }
  async function apply(kind: 'repair' | 'restore') {
    const report = kind === 'repair' ? repair : restore
    if (!report || report.userId !== userId || mutation.current || (kind === 'restore' && !acknowledged)) return
    const current = context()
    mutation.current = true
    setBusy(true)
    setMessage('')
    try {
      const total = report.items.filter((item) => item.action !== 'skip').length
      const ok = await confirm({
        title: kind === 'repair' ? '确认修复阅读数据' : '确认恢复旧数据',
        message: `当前账号：@${username}。${kind === 'repair' ? `将修复预览中的 ${total} 项，删除失效书签、清除无效进度或更新名称。` : `将添加 ${total} 项，保留账号已有记录。旧浏览器数据原样保留。`}`,
        okText: kind === 'repair' ? '确认修复' : '恢复到当前账号',
        danger: kind === 'repair',
      })
      if (!ok || !current()) return
      if (kind === 'restore' && readLegacyReadingData().fingerprint !== legacy.fingerprint) throw new Error('浏览器旧数据已变化，请重新预览')
      const result = await readingDataApi.apply(
        kind,
        {
          confirmedUserId: userId,
          operationId: crypto.randomUUID(),
          previewToken: report.previewToken,
          expiresAt: report.expiresAt,
          ...(kind === 'restore' ? { data: legacy.data } : {}),
        },
        mode,
      )
      if (!current()) return
      result.clearedNovelIds.forEach(clearHistory)
      setHistory((rows) => [result, ...rows].slice(0, 10))
      setRepair(null)
      setRestore(null)
      setAcknowledged(false)
      setMessage(`${kind === 'repair' ? '修复' : '恢复'}完成：处理 ${result.changed} 项${result.skipped ? `，跳过 ${result.skipped} 项` : ''}。`)
    } catch (error) {
      if (current()) {
        setMessage((error as Error).message || '操作失败，请重新预览')
        setRepair(null)
        setRestore(null)
        setAcknowledged(false)
      }
    } finally {
      mutation.current = false
      if (current()) setBusy(false)
    }
  }
  const legacyCount = legacy.data.bookmarks.length + legacy.data.progress.length + legacy.data.bookshelf.length
  const restoreCount = restore?.items.filter((item) => item.action === 'restore').length || 0
  return (
    <section className="profile-section profile-security-section reading-data-section" aria-label="阅读数据">
      <div className="profile-edit-panel">
        <div className="reading-data-heading">
          <div>
            <h2 className="profile-section-heading">阅读数据</h2>
            <p>@{username} · {safeMode ? '安全模式' : '成人内容模式'}</p>
          </div>
        </div>
        <p className="reading-data-message" role="status" aria-live="polite" hidden={!message}>
          {message}
        </p>
        <div className="reading-data-block">
          <div className="reading-data-block__head">
            <div>
              <h3>检查历史数据</h3>
              <p>检查当前账号的书签与阅读进度，修复前可查看变更。</p>
            </div>
            <button className="btn btn--secondary" disabled={busy} onClick={() => void preview('repair')}>
              {busy ? '处理中…' : '检查当前账号'}
            </button>
          </div>
          {repair && (
            <div className="reading-data-result">
              <p>{repair.items.length ? `发现 ${repair.items.length} 项待修复记录。` : '本次检查没有发现异常。'}</p>
              <Preview key={repair.previewToken} preview={repair} />
              {repair.items.length > 0 && (
                <button className="btn btn--primary" disabled={busy} onClick={() => void apply('repair')}>
                  确认修复 {repair.items.length} 项
                </button>
              )}
            </div>
          )}
        </div>
        <div className="reading-data-block">
          <div className="reading-data-block__head">
            <div>
              <h3>恢复旧浏览器数据</h3>
              <p>{legacyCount
                ? `${legacy.data.bookmarks.length} 个书签 · ${legacy.data.progress.length} 条阅读历史 · ${legacy.data.bookshelf.length} 本书架记录`
                : '当前浏览器没有可识别的旧版阅读数据。'}</p>
            </div>
            <button className="btn btn--secondary" disabled={busy} onClick={() => void preview('restore')}>
              预览可恢复数据
            </button>
          </div>
          {legacy.invalid > 0 && <p>另有 {legacy.invalid} 条格式无效的记录将跳过。</p>}
          {legacy.errors.map((error, i) => (
            <p key={i} className="profile-empty-note">
              {error}
            </p>
          ))}
          {restore && (
            <div className="reading-data-result">
              <p className="reading-data-hint">旧数据没有账号归属，恢复前需确认属于你。账号已有记录与已清除的进度会保留。</p>
              <p>
                可添加 {restoreCount} 项，跳过 {restore.items.length - restoreCount} 项。原始浏览器数据会保留。
              </p>
              <Preview key={restore.previewToken} preview={restore} />
              {restoreCount > 0 && (
                <>
                  <label className="reading-data-confirm">
                    <input type="checkbox" checked={acknowledged} disabled={busy} onChange={(e) => setAcknowledged(e.target.checked)} />
                    我确认旧数据属于我，并恢复到 @{username}
                  </label>
                  <button className="btn btn--primary" disabled={busy || !acknowledged} onClick={() => void apply('restore')}>
                    恢复到当前账号
                  </button>
                </>
              )}
            </div>
          )}
        </div>
        {history.length > 0 && (
          <div className="reading-data-block reading-data-block--history">
            <h3>最近操作</h3>
            <ul className="reading-data-list">
              {history.map((result) => (
                <li key={result.operationId}>
                  <strong>
                    {result.kind === 'repair' ? '修复' : '恢复'} · 处理 {result.changed} 项 · 跳过 {result.skipped} 项
                  </strong>
                  <span>{formatDate(result.createdAt)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  )
}
