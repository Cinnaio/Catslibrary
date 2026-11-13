import { MotionDetails } from '@/components/ui/motion'
import type { PendingChapterCounts } from '@shared/novel-updates'
import { pendingUpdateDisplay } from '@shared/novel-updates'
import { Link } from 'react-router-dom'
import ScrapeTaskDetailsDialog from './ScrapeTaskDetailsDialog'
import { LockKeyhole } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { authFetch } from '@/lib/api'
import { startPolling } from '@/lib/polling'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DialogBody, DialogFrame } from "@/components/shared/DialogFrame"
import SearchSelect from "@/components/shared/SearchSelect"
import NovelRelatedSources from './NovelRelatedSources'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import '@/styles/admin/pages/novel-followup.css'

interface Followup extends PendingChapterCounts {
  chapterCount?: number
  remoteChapterCount?: number
  enabled: boolean
  intervalHours: number
  nextCheckAt: number
  blockedReason?: string
  checkedAt: number
  result: string
  message: string
  addedCount: number
  jobId?: string
  sourceUrl?: string
  failures?: number
  encoding?: string
  selectors?: string
  importSourceLabel?: string
  author?: string
  hasConfig: boolean
  ongoing: boolean
}
async function request(novelId: string, body?: Record<string, unknown>): Promise<Followup> {
  const response = await authFetch(body ? '/scrape' : `/scrape?action=followup&novelId=${encodeURIComponent(novelId)}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    ...(body ? { body: JSON.stringify({ novelId, ...body }) } : {}),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || '追更请求失败')
  return data
}
function CheckTime({ value }: { value: number }) {
  if (!value) return <span>尚未安排</span>
  const time = new Date(value)
  return (
    <time dateTime={time.toISOString()}>
      <span>{time.toLocaleDateString('zh-CN')}</span>
      <span>{time.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}</span>
    </time>
  )
}

export default function NovelFollowupDialog({
  novel,
  onClose,
  variant = 'settings',
  onCompleted,
}: {
  novel: { id: string; title: string; author?: string; chapterCount?: number }
  onClose: () => void
  variant?: 'settings' | 'event'
  onCompleted?: () => void
}) {
  const titleRef = useRef<HTMLHeadingElement>(null)
  const [returnFocus] = useState(() => document.activeElement as HTMLElement | null)
  const [state, setState] = useState<Followup | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [hours, setHours] = useState('6')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const [sourceEditing, setSourceEditing] = useState(false)
  const [sourceUrl, setSourceUrl] = useState('')
  const [selectors, setSelectors] = useState('')
  const [encoding, setEncoding] = useState('')
  const [sourceError, setSourceError] = useState('')
  const [taskId, setTaskId] = useState<string | null>(null)
  const showSettings = variant === 'settings' || editing
  const readRevision = useRef(0)
  const refresh = useCallback(async () => {
    const revision = ++readRevision.current
    try {
      const data = await request(novel.id)
      if (revision !== readRevision.current) return null
      setState(data)
      return data
    } catch (error) {
      if (revision !== readRevision.current) return null
      throw error
    }
  }, [novel.id])
  useEffect(() => {
    let active = true
    const revision = ++readRevision.current
    setState(null)
    request(novel.id)
      .then((data) => {
        if (!active || revision !== readRevision.current) return
        setState(data)
        setEnabled(data.enabled)
        setHours(String(data.intervalHours))
      })
      .catch((err) => {
        if (active) setError(err.message)
      })
    return () => {
      active = false
      readRevision.current++
    }
  }, [novel.id])
  useEffect(() => {
    if (state?.result !== 'running') return
    let active = true
    const stop = startPolling(async () => {
      try {
        const data = await refresh()
        if (!data) return
        return active && data.result === 'running'
      } catch (err) {
        if (active) setError((err as Error).message)
      }
    }, 3000, false)
    return () => { active = false; stop() }
  }, [state?.result, refresh])
  async function act(save: boolean) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const response = await request(novel.id, save ? { action: 'followup-save', enabled, intervalHours: Number(hours) } : { action: 'update' })
      await refresh()
      setNotice(save ? '追更设置已保存' : response.message || '更新任务已启动，可在抓取任务中查看详情')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  function editSource() {
    setSourceUrl(state?.sourceUrl || '')
    setSelectors(state?.hasConfig ? state.selectors || '' : '')
    setEncoding(state?.hasConfig ? state.encoding || 'utf-8' : '')
    setSourceError('')
    setSourceEditing(true)
  }
  async function saveSource() {
    setBusy(true)
    setSourceError('')
    setNotice('')
    try {
      const customSelectors = selectors.trim() ? JSON.parse(selectors) : undefined
      const data = await request(novel.id, {
        action: 'followup-source-save',
        sourceUrl,
        ...(customSelectors !== undefined ? { selectors: customSelectors } : {}),
        ...(encoding.trim() ? { encoding: encoding.trim() } : {}),
      })
      setState(data)
      setEnabled(data.enabled)
      setHours(String(data.intervalHours))
      setSourceEditing(false)
      setNotice('网页来源已保存，自动追更已暂停；确认后可手动开启。')
    } catch (error) {
      setSourceError(error instanceof SyntaxError ? '选择器需填写有效的 JSON 对象' : (error as Error).message)
    } finally {
      setBusy(false)
    }
  }
  function sourcesUpdated() {
    void refresh().catch((error) => setError(error.message))
    onCompleted?.()
  }
  const pending = state ? pendingUpdateDisplay({ ...state, chapterCount: state.chapterCount || 0, remoteChapterCount: state.remoteChapterCount || 0 }) : null
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogFrame
        className={`novel-followup-dialog${variant === 'event' ? ' novel-followup-dialog--event' : ' novel-followup-dialog--sources'}`}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          titleRef.current?.focus()
        }}
        onCloseAutoFocus={(event) => {
          if (variant === 'event' && returnFocus?.isConnected) {
            event.preventDefault()
            returnFocus.focus()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle ref={titleRef} tabIndex={-1}>
            {variant === 'event' ? '追更事件详情' : '更新与来源'}
          </DialogTitle>
          <DialogDescription className="novel-followup-dialog__book">{novel.title}</DialogDescription>
        </DialogHeader>
        <DialogBody className="novel-followup-dialog__body">
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {!state && !error && <p role="status">正在读取追更设置…</p>}
          {state && (
            <>
              <p className="novel-followup-dialog__origin">
                本地已入库 {state.chapterCount ?? novel.chapterCount ?? 0} 章{state.importSourceLabel ? ` · 文件导入：${state.importSourceLabel}` : ''}
              </p>
              {variant === 'settings' && (
                <>
                  <section className="novel-followup-dialog__section" aria-labelledby="novel-web-source-title">
                    <div className="novel-followup-dialog__section-head">
                      <h3 id="novel-web-source-title">网页追更</h3>
                      <span className="novel-followup-dialog__badge" data-tone={state.hasConfig ? (state.enabled ? 'partial' : 'idle') : undefined}>
                        {state.hasConfig ? (state.enabled ? `每 ${state.intervalHours} 小时` : '已暂停') : '未配置来源'}
                      </span>
                    </div>
                    <p className="dialog-frame-hint">从网页目录检查新章，并通过正文抓取任务入库。</p>
                    {state.importSourceLabel && state.hasConfig && (
                      <p className="dialog-frame-hint">文件导入的书籍首次接入网页追更时，请先用下方参考目录核对章节对应关系。</p>
                    )}
                    {state.sourceUrl ? (
                      <div className="novel-followup-dialog__entry">
                        <div className="novel-followup-dialog__facts">
                          <div>
                            <dt>作品目录</dt>
                            <dd>{state.sourceUrl}</dd>
                          </div>
                        </div>
                        <div className="novel-followup-dialog__entry-actions">
                          <Button variant="outline" size="sm" disabled={busy || sourceEditing || state.result === 'running'} onClick={editSource}>
                            {state.hasConfig ? '调整网页来源' : '绑定网页来源'}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <p className="novel-followup-dialog__muted">
                          {state.importSourceLabel
                            ? '当前书籍已有文件导入内容，尚未配置可抓取正文的网页来源。可绑定网页来源自动追更，或使用下方附加源检查文件版本。'
                            : '尚未配置可抓取正文的网页来源。可绑定网页来源，或使用下方附加文件更新。'}
                        </p>
                        <div className="novel-followup-dialog__entry-actions">
                          <Button variant="secondary" size="sm" disabled={busy || sourceEditing || state.result === 'running'} onClick={editSource}>
                            {state.hasConfig ? '调整网页来源' : '绑定网页来源'}
                          </Button>
                        </div>
                      </>
                    )}
                    {sourceEditing && (
                      <div className="novel-followup-dialog__entry novel-followup-dialog__source-editor">
                        <Label htmlFor="novel-web-source-url">作品目录链接</Label>
                        <Input
                          id="novel-web-source-url"
                          type="url"
                          value={sourceUrl}
                          disabled={busy}
                          onChange={(event) => {
                            setSourceUrl(event.target.value)
                            setSelectors('')
                            setEncoding('')
                          }}
                        />
                        <p className="dialog-frame-hint">支持站点自动使用内置规则。保存来源后，可另行开启自动追更。</p>
                        <MotionDetails>
                          <summary>高级配置：自定义选择器</summary>
                          <Label htmlFor="novel-web-encoding">网页编码（留空使用站点规则）</Label>
                          <Input
                            id="novel-web-encoding"
                            value={encoding}
                            disabled={busy}
                            onChange={(event) => setEncoding(event.target.value)}
                            placeholder="utf-8 / gbk"
                          />
                          <Label htmlFor="novel-web-selectors">抓取选择器（JSON）</Label>
                          <Textarea
                            id="novel-web-selectors"
                            value={selectors}
                            disabled={busy}
                            onChange={(event) => setSelectors(event.target.value)}
                            placeholder={'{"chapterList":".chapters a","chapterContent":"#content"}'}
                          />
                        </MotionDetails>
                        {sourceError && <p role="alert">{sourceError}</p>}
                        <div className="novel-followup-dialog__source-actions">
                          <Button size="sm" disabled={busy || !sourceUrl.trim()} onClick={() => void saveSource()}>
                            保存网页来源
                          </Button>
                          <Button variant="outline" size="sm" disabled={busy} onClick={() => setSourceEditing(false)}>
                            取消来源调整
                          </Button>
                        </div>
                      </div>
                    )}
                  </section>
                </>
              )}
              {(variant === 'event' || state.hasConfig || state.enabled) && (
                <>
                  {showSettings && (
                    <>
                      <div className="novel-followup-dialog__setting">
                        <div>
                          <Label htmlFor="followup-enabled">自动追更</Label>
                          <p className="dialog-frame-hint">定期检查目录，有新章节时自动入库。</p>
                        </div>
                        <Checkbox
                          id="followup-enabled"
                          checked={enabled}
                          disabled={busy || (!state.hasConfig && !enabled)}
                          onCheckedChange={(value) => setEnabled(value === true)}
                        />
                      </div>
                      {!state.hasConfig && <p className="dialog-frame-hint">尚未绑定可抓取正文的网页来源，请在小说管理的「更新与来源」中配置。</p>}
                      {!state.ongoing && <p className="dialog-frame-hint">已完结作品默认不追更；如需继续检查，可手动开启。</p>}
                      <div className="novel-followup-dialog__frequency">
                        <Label id="followup-frequency">检查频率</Label>
                        <SearchSelect
                          aria-labelledby="followup-frequency"
                          value={hours}
                          onChange={setHours}
                          disabled={busy}
                          options={[1, 3, 6, 12, 24].map((h) => ({ value: String(h), label: `每 ${h} 小时` }))}
                        />
                        <p className="dialog-frame-hint">无新章时逐步降低频率，失败后自动重试。</p>
                      </div>
                    </>
                  )}
                  <section className="novel-followup-dialog__result" aria-label="最近检查">
                    <div className="novel-followup-dialog__section-head">
                      <span className="dialog-frame-section-label">{variant === 'event' ? '最新检查结果' : '最近检查'}</span>
                      <span className="novel-followup-dialog__badge" data-tone={state.result === 'failed' || state.result === 'partial' ? 'failed' : state.result === 'running' ? 'partial' : undefined}>
                        {state.result === 'running' ? '更新中' : state.result === 'failed' ? '检查失败' : state.result === 'partial' ? '部分完成' : '已就绪'}
                      </span>
                    </div>
                    <p role="status" data-result={state.result}>
                      {state.message || '尚未检查'}
                    </p>
                    {pending && (
                      <div className="novel-followup-dialog__chapters">
                        {pending.total > 0 && <span>待入库 {pending.total} 章</span>}
                        {state.pendingPublicChapterCount != null && <span>目录可抓取 {state.pendingPublicChapterCount} 章</span>}
                        {pending.protectedCount > 0 && (
                          <span className="novel-update-protection">
                            <LockKeyhole aria-hidden="true" />
                            受保护 {pending.protectedCount} 章
                          </span>
                        )}
                        {pending.unknown && <span>保护状态待检查{state.pendingUnknownChapterCount ? `（${state.pendingUnknownChapterCount} 章）` : ''}</span>}
                      </div>
                    )}
                    {pending && pending.protectedCount > 0 && (
                      <p className="dialog-frame-hint">受保护不代表无法抓取；请确认源站账号与购买权限，权限变化后重新检查。</p>
                    )}
                    {variant === 'event' && (
                      <dl className="novel-followup-dialog__times">
                        <div>
                          <dt>自动追更</dt>
                          <dd>{state.enabled ? `已开启 · 每 ${state.intervalHours} 小时` : '已暂停'}</dd>
                        </div>
                        <div>
                          <dt>上次新增</dt>
                          <dd>{state.addedCount || 0} 章</dd>
                        </div>
                        <div>
                          <dt>连续失败</dt>
                          <dd>{state.failures == null ? '未统计' : `${state.failures} 次`}</dd>
                        </div>
                        <div>
                          <dt>关联任务</dt>
                          <dd>
                            {state.jobId ? (
                              <Button variant="link" size="sm" disabled={busy} onClick={() => setTaskId(state.jobId!)}>
                                查看任务详情
                              </Button>
                            ) : (
                              '暂无关联任务'
                            )}
                          </dd>
                        </div>
                      </dl>
                    )}
                    {variant === 'event' && (
                      <div className="dashboard-event-source">
                        <span className="dialog-frame-section-label">当前来源</span>
                        <p>{state.sourceUrl || '未记录来源地址'}</p>
                      </div>
                    )}
                    <dl className="novel-followup-dialog__times">
                      <div>
                        <dt>上次完成</dt>
                        <dd>{state.checkedAt ? <CheckTime value={state.checkedAt} /> : '尚未检查'}</dd>
                      </div>
                      <div>
                        <dt>下次检查</dt>
                        <dd>{state.enabled ? state.result === 'running' ? '更新完成后安排' : state.blockedReason ? (state.blockedReason === 'source_unavailable' ? '书源未安装' : '等待书源恢复') : <CheckTime value={state.nextCheckAt} /> : '已暂停'}</dd>
                      </div>
                    </dl>
                  </section>
                  {showSettings && <p className="dialog-frame-hint">暂停追更后，正在执行的任务仍会完成。</p>}
                </>
              )}
              {variant === 'settings' && (
                <NovelRelatedSources
                  novel={{ ...novel, author: novel.author || state.author, chapterCount: state.chapterCount ?? novel.chapterCount }}
                  onUpdated={sourcesUpdated}
                />
              )}
              {variant === 'event' && (
                <Link
                  className="dashboard-panel-link"
                  aria-disabled={busy}
                  onClick={(event) => {
                    if (busy) event.preventDefault()
                  }}
                  to={`/admin/novels?novelId=${encodeURIComponent(novel.id)}`}
                >
                  管理这本小说 →
                </Link>
              )}
              {notice && (
                <p role="status" className="text-sm">
                  {notice}
                </p>
              )}
            </>
          )}
        </DialogBody>
        <DialogFooter>
          {variant === 'settings' && (
            <Button variant="outline" disabled={busy} onClick={onClose}>
              关闭
            </Button>
          )}
          {variant === 'event' && !editing && (
            <Button variant="outline" disabled={busy} onClick={onClose}>
              关闭
            </Button>
          )}
          {variant === 'event' && editing ? (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setEditing(false)
                setEnabled(state?.enabled || false)
                setHours(String(state?.intervalHours || 6))
              }}
            >
              取消调整
            </Button>
          ) : (
            (variant === 'event' || state?.hasConfig || state?.enabled) && (
              <Button variant="outline" onClick={() => void act(false)} disabled={busy || sourceEditing || !state?.hasConfig || state.result === 'running'}>
                {state?.result === 'running' ? '更新中…' : variant === 'settings' ? '检查网页更新' : '检查更新'}
              </Button>
            )
          )}
          {showSettings ? (
            (variant === 'event' || state?.hasConfig || state?.enabled) && (
              <Button onClick={() => void act(true)} disabled={busy || !state || (variant === 'settings' && ((!state.hasConfig && enabled) || sourceEditing))}>
                {variant === 'settings' ? '保存网页追更设置' : '保存设置'}
              </Button>
            )
          ) : (
            <Button variant="secondary" onClick={() => setEditing(true)} disabled={busy || !state}>
              调整追更设置
            </Button>
          )}
        </DialogFooter>
      </DialogFrame>
      {taskId && <ScrapeTaskDetailsDialog key={taskId} jobId={taskId} title={novel.title} onClose={() => setTaskId(null)} />}
    </Dialog>
  )
}
