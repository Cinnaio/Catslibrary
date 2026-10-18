import { useEffect, useRef, useState } from 'react'
import type { BookImportPreview } from '@shared/types'
import type { SupplementaryBinding, SupplementaryFile, SupplementaryOverview, SupplementarySource, SupplementaryCatalog } from '@shared/supplementary-source'
import { adminApi, supplementarySourceApi as api } from '@/lib/api'
import { AdminDialogContent } from './AdminDialog'
import BookImportDialog from './BookImportDialog'
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Checkbox } from '@/components/ui/checkbox'
import { LoaderCircle, Plus, RefreshCw, ExternalLink, Upload } from 'lucide-react'
import '@/styles/supplementary-sources.css'

function time(value: number) {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '尚未检查'
}
const newDraft = () => ({ id: '', name: '', url: '', password: '', enabled: false, intervalHours: 6 })
function versionState(file: SupplementaryFile) {
  return file.stale ? '旧清单' : file.incomplete ? '目录后续分页未完成' : '所在目录已完整读取'
}

export default function SupplementarySourcesDialog({
  onClose,
  onCompleted,
  novel,
  initialSourceId,
}: {
  onClose: () => void
  onCompleted: () => void
  novel?: { id: string; title: string; author?: string }
  initialSourceId?: string
}) {
  const scopedNovelId = novel?.id
  const [overview, setOverview] = useState<SupplementaryOverview | null>(null)
  const [sourceId, setSourceId] = useState('')
  const [tab, setTab] = useState('bindings')
  const [draft, setDraft] = useState<ReturnType<typeof newDraft> | null>(null)
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [search, setSearch] = useState(novel?.title || '')
  const [offset, setOffset] = useState(0)
  const [catalog, setCatalog] = useState<SupplementaryCatalog | null>(null)
  const [catalogError, setCatalogError] = useState('')
  const [fileToBind, setFileToBind] = useState<SupplementaryFile | null>(null)
  const [novelSearch, setNovelSearch] = useState('')
  const [novels, setNovels] = useState<Array<{ id: string; title: string; author: string; chapterCount: number }>>([])
  const [novelId, setNovelId] = useState(novel?.id || '')
  const [novelError, setNovelError] = useState('')
  const [versions, setVersions] = useState<Record<string, string>>({})
  const [preview, setPreview] = useState<BookImportPreview | null>(null)
  const [uploadContext, setUploadContext] = useState<{ bindingId: string; fileKey: string } | null>(null)
  const uploadRef = useRef<HTMLInputElement>(null)
  const bindRef = useRef<HTMLElement>(null)
  const source = overview?.sources.find((s) => s.id === sourceId)

  useEffect(() => {
    let active = true
    api
      .overview()
      .then((data) => {
        if (active) {
          setOverview(data)
          setSourceId(initialSourceId || data.bindings.find((b) => b.novelId === scopedNovelId)?.sourceId || data.sources[0]?.id || '')
          if (scopedNovelId && !data.bindings.some((b) => b.novelId === scopedNovelId)) setTab('files')
          if (!data.sources.length) setDraft(newDraft())
        }
      })
      .catch((e) => {
        if (active) setError(e.message)
      })
    return () => {
      active = false
    }
  }, [scopedNovelId, initialSourceId])
  useEffect(() => {
    let active = true
    setCatalog(null)
    setCatalogError('')
    if (!sourceId) return
    const timer = setTimeout(() => {
      api
        .files(sourceId, search, offset)
        .then((data) => {
          if (active) setCatalog(data)
        })
        .catch((e) => {
          if (active) setCatalogError(e.message)
        })
    }, 200)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [sourceId, search, offset, overview])
  useEffect(() => {
    let active = true
    setNovels([])
    setNovelError('')
    setNovelId(novel?.id || '')
    if (!fileToBind || novel?.id) return
    const timer = setTimeout(() => {
      adminApi
        .novelIndex({ search: novelSearch, limit: '30' })
        .then((data) => {
          if (active) setNovels((data.novels || []) as typeof novels)
        })
        .catch((e) => {
          if (active) setNovelError(e.message)
        })
    }, 200)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [fileToBind, novelSearch, novel?.id])
  useEffect(() => {
    if (fileToBind) bindRef.current?.scrollIntoView({ block: 'nearest' })
  }, [fileToBind])
  async function action(task: () => Promise<void>) {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await task()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  function edit(s: SupplementarySource) {
    setDraft({ id: s.id, name: s.name, url: s.url, password: '', enabled: s.enabled, intervalHours: s.intervalHours })
  }
  async function save() {
    if (!draft) return
    await action(async () => {
      const { password, ...rest } = draft
      const saved = await api.save({ ...rest, ...(password ? { password } : {}) })
      setOverview(await api.overview())
      setSourceId(saved.id)
      setDraft(null)
      setNotice('来源已保存。检查目录后可以绑定已有书籍。')
    })
  }
  function selectedFile(b: SupplementaryBinding) {
    return b.candidates.find((f) => f.key === versions[b.id]) || b.candidates[0]
  }
  function chooseBinding(file: SupplementaryFile) {
    setFileToBind(file)
    setNovelSearch(file.title)
    setNovelId(novel?.id || '')
  }

  if (preview)
    return (
      <BookImportDialog
        key={preview.runId}
        open
        initialPreview={preview}
        onCompleted={onCompleted}
        onOpenChange={(open) => {
          if (!open) {
            setPreview(null)
            void action(async () => setOverview(await api.overview()))
          }
        }}
      />
    )
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !lock.current) onClose()
      }}
    >
      <AdminDialogContent
        size="wide"
        variant="editor"
        className="supplementary-dialog"
        onEscapeKeyDown={(e) => {
          if (busy) e.preventDefault()
        }}
        onPointerDownOutside={(e) => {
          if (busy) e.preventDefault()
        }}
      >
        <DialogHeader>
          <DialogTitle>{novel ? '附加文件更新' : '附加更新源'}</DialogTitle>
          <DialogDescription>
            {novel ? (
              <>
                <span className="supplementary-dialog__book">{novel.title}</span>
                绑定和预览固定到这本书；来源设置由所有绑定书籍共用。
              </>
            ) : (
              '从共享网盘目录寻找书籍新版，核对章节差异后再更新。作品原书源和信息保持不变。'
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="admin-dialog__body supplementary-body" aria-busy={busy}>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {notice && (
            <p role="status" className="supplementary-note">
              {notice}
            </p>
          )}
          {!overview && !error && <p role="status">正在读取附加源…</p>}
          {!overview && error && (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  const data = await api.overview()
                  setOverview(data)
                  setSourceId(data.sources[0]?.id || '')
                  if (!data.sources.length) setDraft(newDraft())
                })
              }
            >
              重新读取
            </Button>
          )}
          {overview && (
            <>
              <div className="supplementary-toolbar">
                <div className="supplementary-field supplementary-grow">
                  <Label htmlFor="supp-source">共享目录</Label>
                  <select
                    id="supp-source"
                    className="supplementary-select"
                    value={sourceId}
                    disabled={busy}
                    onChange={(e) => {
                      setSourceId(e.target.value)
                      setOffset(0)
                      setSearch(novel?.title || '')
                      setFileToBind(null)
                      setDraft(null)
                    }}
                  >
                    <option value="" disabled>
                      选择一个来源
                    </option>
                    {overview.sources.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="supplementary-toolbar__actions">
                  <Button variant="outline" size="sm" disabled={busy} onClick={() => setDraft(newDraft())}>
                    <Plus className="size-3.5" aria-hidden="true" />
                    添加目录
                  </Button>
                  {source && (
                    <Button variant="outline" size="sm" disabled={busy} onClick={() => edit(source)}>
                      编辑来源
                    </Button>
                  )}
                </div>
              </div>
              {draft && (
                <section className="supplementary-editor" aria-labelledby="supp-editor-title">
                  <h3 id="supp-editor-title">{draft.id ? '编辑来源' : '添加共享目录'}</h3>
                  <div className="supplementary-form-grid">
                    <div className="supplementary-field">
                      <Label htmlFor="supp-name">来源名称</Label>
                      <Input
                        id="supp-name"
                        value={draft.name}
                        maxLength={80}
                        disabled={busy}
                        onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                        placeholder="例如：微博书单 · 10月"
                      />
                    </div>
                    <div className="supplementary-field">
                      <Label htmlFor="supp-url">蓝奏文件夹链接</Label>
                      <Input
                        id="supp-url"
                        type="url"
                        value={draft.url}
                        disabled={busy}
                        onChange={(e) => setDraft({ ...draft, url: e.target.value })}
                        placeholder="https://…/b…"
                      />
                    </div>
                    <div className="supplementary-field">
                      <Label htmlFor="supp-password">提取码（选填）</Label>
                      <Input
                        id="supp-password"
                        type="password"
                        autoComplete="off"
                        maxLength={100}
                        value={draft.password}
                        disabled={busy}
                        onChange={(e) => setDraft({ ...draft, password: e.target.value })}
                        placeholder={draft.id ? '留空保留原提取码' : '无提取码可留空'}
                      />
                    </div>
                    <div className="supplementary-field">
                      <Label htmlFor="supp-hours">检查间隔（小时）</Label>
                      <Input
                        id="supp-hours"
                        type="number"
                        min={1}
                        max={168}
                        value={draft.intervalHours}
                        disabled={busy}
                        onChange={(e) => setDraft({ ...draft, intervalHours: Number(e.target.value) })}
                      />
                    </div>
                  </div>
                  <label className="supplementary-check">
                    <Checkbox checked={draft.enabled} disabled={busy} onCheckedChange={(value) => setDraft({ ...draft, enabled: value === true })} />
                    定时检查目录（只发现文件，不自动写入章节）
                  </label>
                  {novel && <p className="supplementary-note">此处修改的是共享目录设置，检查频率和开关对所有绑定书籍生效。</p>}
                  {draft.id && <p className="supplementary-note">换月时可更换目录链接，已有书籍绑定会保留；更换后需重新检查目录。</p>}
                  <div className="supplementary-actions">
                    <Button size="sm" disabled={busy || !draft.name.trim() || !draft.url.trim()} onClick={() => void save()}>
                      保存来源
                    </Button>
                    <Button variant="ghost" size="sm" disabled={busy} onClick={() => setDraft(null)}>
                      取消
                    </Button>
                  </div>
                </section>
              )}
              {source && (
                <>
                  <section className="supplementary-summary">
                    <div className="supplementary-summary__info">
                      <div className="supplementary-summary__header">
                        <strong className="supplementary-summary__name">{source.name}</strong>
                        <span className={`supplementary-status-pill supplementary-status-pill--${source.status}`}>
                          {source.status === 'error'
                            ? '上次检查失败'
                            : source.status === 'partial'
                              ? '部分目录未完整读取'
                              : source.status === 'ok'
                                ? '目录检查成功'
                                : '尚未检查'}
                        </span>
                      </div>
                      <dl className="supplementary-summary__facts">
                        <div>
                          <dt>已索引</dt>
                          <dd>{source.fileCount} 个文件</dd>
                        </div>
                        <div>
                          <dt>上次检查</dt>
                          <dd>{time(source.checkedAt)}</dd>
                        </div>
                        <div>
                          <dt>定时检查</dt>
                          <dd>{source.enabled ? `每 ${source.intervalHours} 小时 · 下次 ${time(source.nextCheckAt)}` : '未开启'}</dd>
                        </div>
                      </dl>
                    </div>
                    <div className="supplementary-summary__actions">
                      <a href={source.url} target="_blank" rel="noreferrer" className="supplementary-link">
                        打开原目录
                        <ExternalLink aria-hidden="true" />
                      </a>
                      <Button
                        size="sm"
                        className="supplementary-check-btn"
                        disabled={busy}
                        onClick={() =>
                          void action(async () => {
                            setOverview(await api.check(source.id))
                            setNotice('目录检查完成。文件名进度仅作参考，请生成预览核对正文。')
                          })
                        }
                      >
                        {busy ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" /> : <RefreshCw className="size-3.5" aria-hidden="true" />}
                        检查目录
                      </Button>
                    </div>
                  </section>
                  {source.status === 'error' && (
                    <Alert variant="destructive" className="supplementary-alert">
                      <AlertDescription>{source.error}。下方保留上次成功的文件清单，不能代表当前最新结果。</AlertDescription>
                    </Alert>
                  )}
                  {source.status === 'partial' && (
                    <Alert className="supplementary-alert supplementary-alert--partial">
                      <AlertDescription>{source.error}。其余已成功读取的目录可以继续使用。</AlertDescription>
                    </Alert>
                  )}
                  <Tabs
                    value={tab}
                    className="admin-capsule-tabs supplementary-tabs"
                    onValueChange={(value) => {
                      setTab(value)
                      setFileToBind(null)
                    }}
                  >
                    <TabsList aria-label="附加源内容">
                      <TabsTrigger value="bindings">
                        已绑定书籍（{overview.bindings.filter((b) => b.sourceId === sourceId && (!novel || b.novelId === novel.id)).length}）
                      </TabsTrigger>
                      <TabsTrigger value="files">目录文件与绑定</TabsTrigger>
                    </TabsList>
                  </Tabs>
                  {tab === 'bindings' && (
                    <div className="supplementary-list">
                      {!overview.bindings.some((b) => b.sourceId === sourceId && (!novel || b.novelId === novel.id)) && (
                        <div className="supplementary-empty">
                          <p className="supplementary-empty__title">还没有绑定书籍</p>
                          <p className="supplementary-empty__desc">先检查目录，再从「目录文件与绑定」选择文件，确认它对应的站内作品。</p>
                          <Button variant="outline" size="sm" disabled={busy} onClick={() => setTab('files')}>
                            选择文件并绑定
                          </Button>
                        </div>
                      )}
                      {overview.bindings
                        .filter((b) => b.sourceId === sourceId && (!novel || b.novelId === novel.id))
                        .map((b) => {
                          const file = selectedFile(b)
                          return (
                            <article key={b.id} className="supplementary-card">
                              <div className="supplementary-card__head">
                                <h3>{b.novelTitle}</h3>
                                {file && (
                                  <span className="supplementary-chip" data-tone={file.stale ? 'idle' : file.incomplete ? 'partial' : 'primary'}>
                                    {file.stale ? '旧清单' : file.incomplete ? '目录未读全' : '目录已读完'}
                                  </span>
                                )}
                              </div>
                              <dl className="supplementary-card__facts">
                                <div>
                                  <dt>来源书名</dt>
                                  <dd>
                                    {b.aliasTitle} · {b.aliasAuthor || '作者未标注'}
                                  </dd>
                                </div>
                                {file && (
                                  <>
                                    <div>
                                      <dt>候选版本</dt>
                                      <dd>
                                        <select
                                          id={`supp-version-${b.id}`}
                                          aria-label="候选版本"
                                          className="supplementary-select"
                                          value={file.key}
                                          disabled={busy}
                                          onChange={(e) => setVersions({ ...versions, [b.id]: e.target.value })}
                                        >
                                          {b.candidates.map((f) => (
                                            <option key={f.key} value={f.key}>
                                              {f.stale ? '旧清单 · ' : f.incomplete ? '目录未读全 · ' : ''}
                                              {f.folder} · {f.name}
                                            </option>
                                          ))}
                                        </select>
                                      </dd>
                                    </div>
                                    <div>
                                      <dt>版本线索</dt>
                                      <dd>
                                        {file.size} · {versionState(file)} · 文件名进度仅供参考
                                      </dd>
                                    </div>
                                  </>
                                )}
                              </dl>
                              {!file && (
                                <p className="supplementary-card__note">
                                  已读取的清单中未找到同书名、同作者的文件。目录未读全时不能判断有无更新；可重新检查，或在文件列表绑定新的来源别名。
                                </p>
                              )}
                              <div className="supplementary-card__actions">
                                {file && (
                                  <>
                                    <Button size="sm" disabled={busy} onClick={() => void action(async () => setPreview(await api.preview(b.id, file.key)))}>
                                      下载并预览
                                    </Button>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      disabled={busy}
                                      onClick={() => {
                                        setUploadContext({ bindingId: b.id, fileKey: file.key })
                                        uploadRef.current?.click()
                                      }}
                                    >
                                      <Upload className="size-3.5" aria-hidden="true" />
                                      上传对应文件
                                    </Button>
                                    <a className="supplementary-link" href={file.url} target="_blank" rel="noreferrer">
                                      原文件
                                      <ExternalLink aria-hidden="true" />
                                    </a>
                                  </>
                                )}
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="supplementary-unbind"
                                  disabled={busy}
                                  onClick={() =>
                                    void action(async () => {
                                      setOverview(await api.unbind(b.id))
                                      setNotice('已解除来源绑定，书籍和章节均已保留。')
                                    })
                                  }
                                >
                                  解除绑定
                                </Button>
                              </div>
                            </article>
                          )
                        })}
                    </div>
                  )}
                  {tab === 'files' && (
                    <section className="supplementary-list">
                      <div className="supplementary-field">
                        <Label htmlFor="supp-search">查找书名或作者</Label>
                        <Input
                          id="supp-search"
                          value={search}
                          disabled={busy}
                          onChange={(e) => {
                            setSearch(e.target.value)
                            setOffset(0)
                          }}
                          placeholder="在目录文件中搜索"
                        />
                      </div>
                      {catalogError && (
                        <Alert variant="destructive">
                          <AlertDescription>{catalogError}</AlertDescription>
                        </Alert>
                      )}
                      {!catalog && !catalogError && <p role="status">正在读取文件清单…</p>}
                      {catalog && (
                        <p className="supplementary-note">
                          已发现 {catalog.total} 本书籍、{catalog.fileCount} 个文件。最高进度来自已读文件名，不代表目录已检查完整。
                        </p>
                      )}
                      {!!catalog?.folders.length && (
                        <details className="supplementary-coverage">
                          <summary>查看目录读取情况</summary>
                          <ul>
                            {catalog.folders.map((folder) => (
                              <li key={folder.name}>
                                <strong>{folder.name}</strong>
                                <span>
                                  已索引 {folder.fileCount} 个文件{folder.staleCount ? `（含 ${folder.staleCount} 个旧记录）` : ''} ·{' '}
                                  {folder.incomplete ? '未读全' : '已读完'}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                      {catalog && !catalog.total && (
                        <p className="supplementary-empty">已读取的清单中没有匹配书籍。尚未检查时请先检查目录；目录未读全时不能据此判断没有文件。</p>
                      )}
                      {catalog?.items.map((book) => (
                        <article key={book.key} className="supplementary-card">
                          <div className="supplementary-card__head">
                            <h3>{book.title}</h3>
                            <span className="supplementary-chip" data-tone="partial">
                              {book.highestRevision === null ? '进度未标注' : `最高 更${book.highestRevision}`}
                            </span>
                          </div>
                          <dl className="supplementary-card__facts">
                            <div>
                              <dt>作者</dt>
                              <dd>{book.author || '作者未标注'}</dd>
                            </div>
                            <div>
                              <dt>版本</dt>
                              <dd>
                                已发现 {book.versions.length} 个版本 · 最近目录 {book.versions[0]?.folder}
                              </dd>
                            </div>
                          </dl>
                          <details className="supplementary-versions">
                            <summary>查看 {book.versions.length} 个已发现版本</summary>
                            <div>
                              {book.versions.map((file) => (
                                <div key={file.key} className="supplementary-version-row">
                                  <div className="supplementary-copy">
                                    <p>{file.name}</p>
                                    <p>
                                      {file.folder} · {file.size} · {versionState(file)}
                                    </p>
                                  </div>
                                  <div className="supplementary-actions">
                                    <a className="supplementary-link" href={file.url} target="_blank" rel="noreferrer">
                                      原文件
                                      <ExternalLink aria-hidden="true" />
                                    </a>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      disabled={busy}
                                      aria-label={`绑定此版本：${file.folder} ${file.name}`}
                                      onClick={() => chooseBinding(file)}
                                    >
                                      绑定此版本
                                    </Button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </details>
                          <div className="supplementary-card__actions">
                            <Button variant="outline" size="sm" disabled={busy} onClick={() => chooseBinding(book.versions[0]!)}>
                              绑定已有书籍
                            </Button>
                          </div>
                        </article>
                      ))}
                      {catalog && catalog.total > 30 && (
                        <div className="supplementary-pagination">
                          <Button variant="outline" size="sm" disabled={busy || !offset} onClick={() => setOffset(Math.max(0, offset - 30))}>
                            上一页
                          </Button>
                          <span className="supplementary-pagination__info">
                            第 {offset + 1}–{Math.min(offset + 30, catalog.total)} 本 / 共 {catalog.total} 本
                          </span>
                          <Button variant="outline" size="sm" disabled={busy || offset + 30 >= catalog.total} onClick={() => setOffset(offset + 30)}>
                            下一页
                          </Button>
                        </div>
                      )}
                    </section>
                  )}
                  {fileToBind && (
                    <section ref={bindRef} className="supplementary-editor" aria-labelledby="supp-bind-title">
                      <h3 id="supp-bind-title">确认「{fileToBind.title}」对应的作品</h3>
                      <p className="supplementary-note">核对书名与作者。确认后会记住这个来源别名，不修改站内书名。</p>
                      {novel ? (
                        <p>
                          将绑定到：{novel.title} · {novel.author || '作者未标注'}。请核对来源书名与作者。
                        </p>
                      ) : (
                        <>
                          <div className="supplementary-field">
                            <Label htmlFor="supp-novel-search">搜索站内作品</Label>
                            <Input id="supp-novel-search" value={novelSearch} disabled={busy} onChange={(e) => setNovelSearch(e.target.value)} />
                          </div>
                          {novelError && <p role="alert">{novelError}</p>}
                          <div className="supplementary-field">
                            <Label htmlFor="supp-novel">选择对应作品</Label>
                            <select
                              id="supp-novel"
                              className="supplementary-select"
                              value={novelId}
                              disabled={busy}
                              onChange={(e) => setNovelId(e.target.value)}
                            >
                              <option value="">请选择并核对作者</option>
                              {novels.map((n) => (
                                <option key={n.id} value={n.id}>
                                  {n.title} · {n.author || '未知作者'} · {n.chapterCount} 章
                                </option>
                              ))}
                            </select>
                          </div>
                        </>
                      )}
                      <div className="supplementary-actions">
                        <Button
                          size="sm"
                          disabled={busy || !novelId}
                          onClick={() =>
                            void action(async () => {
                              const updated = await api.bind(sourceId, novelId, fileToBind.key)
                              setOverview(updated)
                              const saved = updated.bindings.find(
                                (binding) =>
                                  binding.sourceId === sourceId &&
                                  binding.novelId === novelId &&
                                  binding.candidates.some((file) => file.key === fileToBind.key),
                              )
                              if (saved) setVersions((previous) => ({ ...previous, [saved.id]: fileToBind.key }))
                              setFileToBind(null)
                              setTab('bindings')
                              setNotice('已绑定。生成预览可以核对实际章节差异。')
                            })
                          }
                        >
                          确认绑定
                        </Button>
                        <Button variant="ghost" size="sm" disabled={busy} onClick={() => setFileToBind(null)}>
                          取消
                        </Button>
                      </div>
                    </section>
                  )}
                </>
              )}
            </>
          )}
          <input
            ref={uploadRef}
            type="file"
            accept=".txt,.text,.epub"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0]
              const context = uploadContext
              e.target.value = ''
              if (file && context) void action(async () => setPreview(await api.upload(context.bindingId, context.fileKey, file)))
            }}
          />
        </div>
        <DialogFooter className="supplementary-dialog-footer">
          <p className="supplementary-note">先预览再更新；新版缺少的章节不会自动删除。</p>
          <Button size="sm" disabled={busy} onClick={onClose}>
            关闭
          </Button>
        </DialogFooter>
      </AdminDialogContent>
    </Dialog>
  )
}
