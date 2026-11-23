import { MotionDetails, MotionPresence } from '@/components/ui/motion'
import type { PendingChapterCounts } from '@shared/novel-updates'
import { pendingUpdateDisplay } from '@shared/novel-updates'
import { Link } from 'react-router-dom'
import ScrapeTaskDetailsDialog from './ScrapeTaskDetailsDialog'
import { Globe2, LockKeyhole } from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { authFetch } from '@/lib/api'
import { startPolling } from '@/lib/polling'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import EmptyState from '@/components/shared/EmptyState'
import FormField from '@/components/shared/FormField'
import { Label } from '@/components/ui/label'
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DialogBody, DialogFrame } from '@/components/shared/DialogFrame'
import SearchSelect from '@/components/shared/SearchSelect'
import NovelRelatedSources from './NovelRelatedSources'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import styles from './NovelFollowupDialog.module.css'

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

function WebPanel({ tabbed, activeTab, children }: { tabbed: boolean; activeTab: string; children: ReactNode }) {
  return tabbed ? (
    <TabsContent value="web" forceMount hidden={activeTab !== 'web'} className={styles.panel}>
      {children}
    </TabsContent>
  ) : (
    <div className={styles.panel}>{children}</div>
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
  const [activeTab, setActiveTab] = useState('web')
  const bodyRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const checkButtonRef = useRef<HTMLButtonElement>(null)
  const sourceActionRef = useRef<HTMLButtonElement>(null)
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
    const stop = startPolling(
      async () => {
        try {
          const data = await refresh()
          if (!data) return
          return active && data.result === 'running'
        } catch (err) {
          if (active) setError((err as Error).message)
        }
      },
      3000,
      false,
    )
    return () => {
      active = false
      stop()
    }
  }, [state?.result, refresh])
  async function act(save: boolean) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const response = await request(novel.id, save ? { action: 'followup-save', enabled, intervalHours: Number(hours) } : { action: 'update' })
      await refresh()
      setNotice(save ? '追更设置已保存' : response.message || '更新任务已启动，可在抓取任务中查看详情')
      if (save && variant === 'settings') {
        requestAnimationFrame(() => {
          const target = checkButtonRef.current
          if (target && !target.disabled) target.focus({ preventScroll: true })
          else titleRef.current?.focus({ preventScroll: true })
        })
      }
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
      requestAnimationFrame(() => sourceActionRef.current?.focus({ preventScroll: true }))
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
  const webActionsVisible = variant === 'event' || activeTab === 'web'
  const hasUnsavedSettings = Boolean(state && (enabled !== state.enabled || hours !== String(state.intervalHours)))
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogFrame
        className={styles.dialog}
        data-variant={variant}
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
        <DialogHeader className={styles.header}>
          <DialogTitle ref={titleRef} tabIndex={-1}>
            {variant === 'event' ? '追更事件详情' : '更新与来源'}
          </DialogTitle>
          <DialogDescription className={styles.book}>
            <span className={styles.bookTitle}>{novel.title}</span>
            {state && <span className={styles.bookMeta}>本地已入库 {state.chapterCount ?? novel.chapterCount ?? 0} 章</span>}
          </DialogDescription>
        </DialogHeader>
        <Tabs
          value={activeTab}
          onValueChange={(value) => {
            setActiveTab(value)
            if (bodyRef.current) bodyRef.current.scrollTop = 0
          }}
          className={styles.tabs}
        >
          {variant === 'settings' && (
            <TabsList className={styles.navigation} aria-label="更新与来源分类">
              <TabsTrigger value="web" disabled={busy}>
                网页追更
                {(hasUnsavedSettings || sourceEditing) && (
                  <span className={styles.draftDot}>
                    <span className="sr-only">，有未保存的调整</span>
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="files" disabled={busy}>
                附加文件
              </TabsTrigger>
              <TabsTrigger value="reference" disabled={busy}>
                章节目录
              </TabsTrigger>
            </TabsList>
          )}
          <DialogBody ref={bodyRef} className={styles.body}>
            {error && (
              <p role="alert" className={styles.inlineAlert}>
                {error}
              </p>
            )}
            {!state && !error && (
              <p role="status" className={styles.loading}>
                正在读取追更设置…
              </p>
            )}
            <WebPanel tabbed={variant === 'settings'} activeTab={activeTab}>
              {state && (
                <div className={styles.webLayout}>
                  {(variant === 'settings' || showSettings) && (
                    <div className={styles.webSettings}>
                      {variant === 'settings' && (
                        <section className={styles.section} aria-label="网页来源">
                          {(state.sourceUrl || sourceEditing) && (
                            <div className={styles.sectionHead}>
                              <h3>网页来源</h3>
                              {sourceEditing ? (
                                <span className={styles.count}>编辑中</span>
                              ) : (
                                <Button ref={sourceActionRef} variant="ghost" size="sm" disabled={busy || state.result === 'running'} onClick={editSource}>
                                  {state.hasConfig ? '调整网页来源' : '绑定网页来源'}
                                </Button>
                              )}
                            </div>
                          )}
                          {sourceEditing ? (
                            <div className={styles.sourceEditor}>
                              <FormField
                                label="作品目录链接"
                                htmlFor="novel-web-source-url"
                                hint="支持站点自动使用内置规则。保存来源后，可另行开启自动追更。"
                                error={sourceError}
                              >
                                <Input
                                  type="url"
                                  autoFocus
                                  value={sourceUrl}
                                  disabled={busy}
                                  placeholder="粘贴作品的目录链接"
                                  onChange={(event) => {
                                    setSourceUrl(event.target.value)
                                    setSelectors('')
                                    setEncoding('')
                                  }}
                                />
                              </FormField>
                              <MotionDetails className={styles.advanced}>
                                <summary>高级配置：自定义选择器</summary>
                                <div className={styles.advancedFields}>
                                  <FormField label="网页编码（留空使用站点规则）" htmlFor="novel-web-encoding">
                                    <Input value={encoding} disabled={busy} onChange={(event) => setEncoding(event.target.value)} placeholder="utf-8 / gbk" />
                                  </FormField>
                                  <FormField label="抓取选择器（JSON）" htmlFor="novel-web-selectors">
                                    <Textarea
                                      value={selectors}
                                      disabled={busy}
                                      onChange={(event) => setSelectors(event.target.value)}
                                      placeholder={'{"chapterList":".chapters a","chapterContent":"#content"}'}
                                    />
                                  </FormField>
                                </div>
                              </MotionDetails>
                              <div className={styles.sourceActions}>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  disabled={busy}
                                  onClick={() => {
                                    setSourceEditing(false)
                                    requestAnimationFrame(() => sourceActionRef.current?.focus({ preventScroll: true }))
                                  }}
                                >
                                  取消来源调整
                                </Button>
                                <Button size="sm" disabled={busy || !sourceUrl.trim()} onClick={() => void saveSource()}>
                                  保存网页来源
                                </Button>
                              </div>
                            </div>
                          ) : state.sourceUrl ? (
                            <div className={styles.sourceAddress}>
                              <Globe2 aria-hidden="true" />
                              <div>
                                <p className={styles.sourceUrl}>{state.sourceUrl}</p>
                                <p className="dialog-frame-hint">从此目录检查新章，并抓取正文入库。</p>
                              </div>
                            </div>
                          ) : (
                            <EmptyState
                              icon={<Globe2 />}
                              message="还没有网页来源"
                              hint={
                                state.importSourceLabel
                                  ? '已有文件导入内容。绑定作品目录后可检查网页新章，也可在「附加文件」中更新文件版本。'
                                  : '绑定作品目录后可检查新章，也可在「附加文件」中更新文件版本。'
                              }
                              action={
                                <Button ref={sourceActionRef} size="sm" disabled={busy || state.result === 'running'} onClick={editSource}>
                                  {state.hasConfig ? '调整网页来源' : '绑定网页来源'}
                                </Button>
                              }
                            />
                          )}
                          {state.importSourceLabel && (
                            <p className="dialog-frame-hint">
                              文件导入：{state.importSourceLabel}
                              {state.hasConfig ? '。首次接入网页追更，请先在「章节目录」核对对应关系。' : ''}
                            </p>
                          )}
                        </section>
                      )}
                      {(variant === 'event' || state.hasConfig || state.enabled) && (
                        <section className={styles.schedule} aria-label="追更设置">
                          {showSettings && (
                            <>
                              <Label htmlFor="followup-enabled" className={styles.setting}>
                                <span className={styles.settingCopy}>
                                  <span className={styles.settingName}>自动追更</span>
                                  <span id="followup-enabled-hint" className="dialog-frame-hint">
                                    定期检查目录，有新章节时自动入库。
                                  </span>
                                </span>
                                <Switch
                                  id="followup-enabled"
                                  aria-label="自动追更"
                                  aria-describedby="followup-enabled-hint"
                                  checked={enabled}
                                  disabled={busy || (!state.hasConfig && !enabled)}
                                  onCheckedChange={setEnabled}
                                />
                              </Label>
                              {!state.hasConfig && <p className="dialog-frame-hint">尚未绑定可抓取正文的网页来源，请在小说管理的「更新与来源」中配置。</p>}
                              {!state.ongoing && <p className="dialog-frame-hint">已完结作品默认不追更；如需继续检查，可手动开启。</p>}
                              <div className={styles.frequency}>
                                <div className={styles.settingCopy}>
                                  <Label id="followup-frequency">检查频率</Label>
                                  <p className="dialog-frame-hint">无新章时降低频率，失败后自动重试。</p>
                                </div>
                                <SearchSelect
                                  aria-labelledby="followup-frequency"
                                  value={hours}
                                  onChange={setHours}
                                  disabled={busy}
                                  options={[1, 3, 6, 12, 24].map((h) => ({ value: String(h), label: `每 ${h} 小时` }))}
                                />
                              </div>
                              <p className="dialog-frame-hint">暂停追更后，正在执行的任务仍会完成。</p>
                            </>
                          )}
                        </section>
                      )}
                    </div>
                  )}
                  {(variant === 'event' || state.hasConfig || state.enabled) && (
                    <section className={styles.result} aria-label="最近检查">
                      <div className={styles.sectionHead}>
                        <h3>{variant === 'event' ? '最新检查结果' : '最近检查'}</h3>
                        <span
                          className={styles.badge}
                          data-tone={state.result === 'failed' || state.result === 'partial' ? 'failed' : state.result === 'running' ? 'partial' : undefined}
                        >
                          {state.result === 'running' ? '更新中' : state.result === 'failed' ? '检查失败' : state.result === 'partial' ? '部分完成' : '已就绪'}
                        </span>
                      </div>
                      <p role="status" data-result={state.result}>
                        {state.message || '尚未检查'}
                      </p>
                      {pending && (
                        <div className={styles.chapters}>
                          {pending.total > 0 && <span>待入库 {pending.total} 章</span>}
                          {state.pendingPublicChapterCount != null && <span>目录可抓取 {state.pendingPublicChapterCount} 章</span>}
                          {pending.protectedCount > 0 && (
                            <span className={styles.protection}>
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
                        <dl className={styles.times}>
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
                        <div className={styles.eventSource}>
                          <span className="dialog-frame-section-label">当前来源</span>
                          <p>{state.sourceUrl || '未记录来源地址'}</p>
                        </div>
                      )}
                      <dl className={styles.times}>
                        <div>
                          <dt>上次完成</dt>
                          <dd>{state.checkedAt ? <CheckTime value={state.checkedAt} /> : '尚未检查'}</dd>
                        </div>
                        <div>
                          <dt>下次检查</dt>
                          <dd>
                            {state.enabled ? (
                              state.result === 'running' ? (
                                '更新完成后安排'
                              ) : state.blockedReason ? (
                                state.blockedReason === 'source_unavailable' ? (
                                  '书源未安装'
                                ) : (
                                  '等待书源恢复'
                                )
                              ) : (
                                <CheckTime value={state.nextCheckAt} />
                              )
                            ) : (
                              '已暂停'
                            )}
                          </dd>
                        </div>
                      </dl>
                    </section>
                  )}
                </div>
              )}
              {variant === 'event' && state && (
                <Link
                  className={styles.manageLink}
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
                <p role="status" className={styles.notice}>
                  {notice}
                </p>
              )}
            </WebPanel>
            {variant === 'settings' && state && (
              <NovelRelatedSources
                novel={{ ...novel, author: novel.author || state.author, chapterCount: state.chapterCount ?? novel.chapterCount }}
                onUpdated={sourcesUpdated}
                activeTab={activeTab}
              />
            )}
          </DialogBody>
          <DialogFooter className={styles.footer} aria-busy={busy}>
            {variant === 'settings' && activeTab === 'web' && hasUnsavedSettings && !sourceEditing && <p className={styles.footerHint}>设置尚未保存</p>}
            <div className={styles.footerActions}>
              {(variant === 'settings' || !editing) && (
                <Button variant="ghost" disabled={busy} onClick={onClose}>
                  关闭
                </Button>
              )}
              {webActionsVisible && !sourceEditing && (
                <>
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
                      <Button
                        ref={checkButtonRef}
                        variant={variant === 'settings' && !hasUnsavedSettings ? 'default' : 'outline'}
                        onClick={() => void act(false)}
                        disabled={busy || !state?.hasConfig || state.result === 'running'}
                      >
                        {state?.result === 'running' ? '更新中…' : variant === 'settings' ? '检查网页更新' : '检查更新'}
                      </Button>
                    )
                  )}
                  {showSettings ? (
                    <MotionPresence asChild open={variant === 'event' || hasUnsavedSettings}>
                      <Button onClick={() => void act(true)} disabled={busy || !state || (variant === 'settings' && !state.hasConfig && enabled)}>
                        {variant === 'settings' ? '保存网页追更设置' : '保存设置'}
                      </Button>
                    </MotionPresence>
                  ) : (
                    <Button variant="secondary" onClick={() => setEditing(true)} disabled={busy || !state}>
                      调整追更设置
                    </Button>
                  )}
                </>
              )}
            </div>
          </DialogFooter>
        </Tabs>
      </DialogFrame>
      {taskId && <ScrapeTaskDetailsDialog key={taskId} jobId={taskId} title={novel.title} onClose={() => setTaskId(null)} />}
    </Dialog>
  )
}
