import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, ArrowUpRight, Loader2, Network, RefreshCw, Search } from 'lucide-react'
import type { StoryCertainty, StoryEvidence, StoryGraphResponse } from '@shared/story-graph'
import { aiApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import StoryGraphCanvas from './StoryGraphCanvas'
import '@/styles/admin/pages/story-graph.css'

const certaintyLabel: Record<StoryCertainty, string> = {
  fact: '已确认事实',
  belief: '人物认知',
  clue: '未解线索',
  possibility: '可选方向',
  inference: '分析推断',
}
const threadLabel = { state: '角色状态', conflict: '待解决冲突', clue: '未解伏笔', item: '关键物品', place: '重要地点' }
const archiveLabel = { relationship: '关系画像', plot: '情节状态' }
const eligibilityLabel: Record<string, string> = {
  missing: '尚未提取',
  stale: '需要更新',
  beyond_anchor: '晚于当前起点',
  source_changed: '正文已变化',
  legacy_unknown: '需要完整初始化',
  usable: '可用',
}

export default function StoryGraphPanel({ novelId, afterChapterId }: { novelId: string; afterChapterId?: string }) {
  const [data, setData] = useState<StoryGraphResponse | null>(null)
  const [loading, setLoading] = useState(Boolean(novelId))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState('')
  const [query, setQuery] = useState('')
  const [showThreads, setShowThreads] = useState(false)
  const [focusOnly, setFocusOnly] = useState(false)
  const [tab, setTab] = useState<'detail' | 'archives'>('detail')
  const mounted = useRef(true)
  const writingUrl = `/admin/ai?sub=writing&novel=${encodeURIComponent(novelId)}${afterChapterId ? `&afterChapterId=${encodeURIComponent(afterChapterId)}` : ''}`

  useEffect(() => {
    mounted.current = true
    let cancelled = false
    if (!novelId)
      return () => {
        mounted.current = false
      }
    aiApi.writing
      .getStoryGraph(novelId, afterChapterId)
      .then((result) => {
        if (!cancelled) setData(result)
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message || '图谱读取失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
      mounted.current = false
    }
  }, [novelId, afterChapterId])

  async function generate() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const result = await aiApi.writing.generateStoryGraph(novelId, afterChapterId)
      if (mounted.current) {
        setData(result)
        setSelected('')
      }
    } catch (err) {
      if (mounted.current) setError((err as Error).message || '图谱生成失败，请重试')
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  if (!novelId)
    return (
      <div className="story-graph-empty">
        <Network />
        <h2>先选择一本小说</h2>
        <p>从创作工作台或小说管理打开本书的故事图谱。</p>
        <Link to="/admin/novels">前往小说管理</Link>
      </div>
    )
  const graph = data?.graph
  const person = graph?.people.find((p) => p.id === selected)
  const relationship = graph?.relationships.find((r) => r.id === selected)
  const thread = graph?.threads.find((t) => t.id === selected)
  const detail = person || relationship || thread
  const personName = (id: string) => graph?.people.find((p) => p.id === id)?.name || id
  const filteredPeople = graph?.people.filter((p) => `${p.name} ${p.aliases.join(' ')}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) || []
  function select(id: string) {
    setSelected(id)
    setTab('detail')
  }
  function renderEvidence(evidence: StoryEvidence[]) {
    return (
      <div className="story-graph-evidence">
        <h4>档案依据</h4>
        <p>以下为有效分析档案的摘录；请通过来源章节核对正文。</p>
        {evidence.map((e, i) => (
          <div key={i} className="story-graph-evidence__entry">
            <span>{archiveLabel[e.kind]}</span>
            <blockquote>{e.quote}</blockquote>
            {e.chapterIds.length ? (
              e.chapterIds.map((id) => (
                <Link key={id} target="_blank" rel="noopener noreferrer" to={`/read/${encodeURIComponent(novelId)}/${encodeURIComponent(id)}`}>
                  {data?.chapters.find((c) => c.id === id)?.title || '来源章节'}
                  <ArrowUpRight className="size-3" />
                </Link>
              ))
            ) : (
              <small>档案未提供可核对的章节标记</small>
            )}
          </div>
        ))}
      </div>
    )
  }

  return (
    <section className="story-graph" aria-label="故事图谱工作区">
      <div className="story-graph-heading">
        <div>
          <Link to={writingUrl} className="story-graph-back">
            <ArrowLeft className="size-3.5" />
            返回创作工作台
          </Link>
          <h2>{data?.novel.title || '故事图谱'}</h2>
          <p>{data?.anchor ? `查看范围截至第 ${data.anchor.ordinal} 章 · ${data.anchor.title}` : '等待小说章节与分析档案'}</p>
        </div>
        <div className="story-graph-heading__actions">
          <Button
            variant="secondary"
            size="sm"
            disabled={loading || busy}
            onClick={() => {
              setLoading(true)
              setError('')
              aiApi.writing
                .getStoryGraph(novelId, afterChapterId)
                .then((r) => {
                  if (mounted.current) setData(r)
                })
                .catch((e: Error) => {
                  if (mounted.current) setError(e.message)
                })
                .finally(() => {
                  if (mounted.current) setLoading(false)
                })
            }}
          >
            <RefreshCw className="size-3.5" />
            刷新状态
          </Button>
          {data && data.status !== 'ready' && (
            <Button size="sm" disabled={busy || loading || data.status === 'unavailable'} onClick={() => void generate()}>
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Network className="size-3.5" />}
              {busy ? '整理图谱中…' : data.status === 'outdated' ? '更新图谱' : '生成故事图谱'}
            </Button>
          )}
        </div>
      </div>
      {error && (
        <div role="alert" className="story-graph-message story-graph-message--error">
          {error}
        </div>
      )}
      {data && (
        <div className="story-graph-status" aria-live="polite">
          {data.archives.map((a) => (
            <span key={a.kind}>
              {archiveLabel[a.kind]} · {eligibilityLabel[a.eligibility] || '不可用'}
              {a.content ? ` · 截至 ${a.chaptersThrough} 章${a.origin === 'manual' ? ' · 人工校正' : ''}` : ''}
            </span>
          ))}
          {data.status === 'ready' ? (
            <span>图谱已保存 · {new Date(data.updatedAt).toLocaleString('zh-CN')}</span>
          ) : (
            <span>生成会调用文本模型并计入用量；再次打开复用已保存结果。</span>
          )}
        </div>
      )}
      {loading ? (
        <div className="story-graph-empty" role="status">
          <Loader2 className="animate-spin" />
          <p>正在读取本书图谱…</p>
        </div>
      ) : !graph ? (
        <div className="story-graph-empty">
          <Network />
          <h3>
            {data?.status === 'unavailable'
              ? '先准备本书的分析档案'
              : data?.status === 'outdated'
                ? '分析范围或档案已变化'
                : data
                  ? '把人物与故事连起来'
                  : '暂时无法读取图谱'}
          </h3>
          <p>
            {data?.status === 'unavailable'
              ? '当前起点没有可用的关系或情节档案。返回创作工作台完成分析后，再生成图谱。'
              : data?.status === 'outdated'
                ? '请更新图谱，新的结果将使用当前有效档案及人工校正内容。'
                : '基于有效的关系画像与情节状态整理人物关系、冲突和伏笔。'}
          </p>
          {data?.status === 'unavailable' && (
            <Link to={writingUrl}>
              前往小说分析
              <ArrowUpRight className="size-3.5" />
            </Link>
          )}
          {busy && <p role="status">正在整理，请稍候。档案与正文会保留。</p>}
        </div>
      ) : !graph.people.length ? (
        <div className="story-graph-empty">
          <Network />
          <h3>档案中暂无可确认的人物</h3>
          <p>可以先补充或校正关系档案，再刷新图谱。</p>
          <Link to={writingUrl}>前往小说分析</Link>
        </div>
      ) : (
        <>
          <div className="story-graph-toolbar">
            <label className="story-graph-search">
              <Search className="size-4" />
              <Input data-admin-search aria-label="搜索人物或别名" placeholder="搜索人物或别名…" value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
            <label>
              <Checkbox checked={showThreads} onCheckedChange={(v) => setShowThreads(v === true)} />
              显示相关情节
            </label>
            <label>
              <Checkbox disabled={!person} checked={focusOnly} onCheckedChange={(v) => setFocusOnly(v === true)} />
              只看所选人物周边
            </label>
            <span>
              {graph.people.length} 位人物 · {graph.relationships.length} 条关系
            </span>
          </div>
          <div className="story-graph-workbench">
            <div className="story-graph-map">
              <StoryGraphCanvas
                key={String(data?.updatedAt)}
                graph={graph}
                selected={selected}
                onSelect={select}
                showThreads={showThreads}
                focusOnly={focusOnly}
              />
              <div className="story-graph-legend">
                <span>
                  <i />
                  人物关系
                </span>
                <span>
                  <i className="is-dashed" />
                  推断 / 可选方向
                </span>
                {showThreads && <span>方形节点：关联情节</span>}
              </div>
            </div>
            <aside className="story-graph-detail" aria-label="图谱详情">
              <div className="story-graph-detail__tabs">
                <button type="button" aria-pressed={tab === 'detail'} onClick={() => setTab('detail')}>
                  关系与情节
                </button>
                <button type="button" aria-pressed={tab === 'archives'} onClick={() => setTab('archives')}>
                  文字档案
                </button>
              </div>
              <div className="story-graph-detail__body" aria-live="polite">
                {tab === 'archives' ? (
                  data?.archives.map((a) => (
                    <section key={a.kind}>
                      <h3>{archiveLabel[a.kind]}</h3>
                      <p className="story-graph-archive">{a.content || '当前起点暂无可用档案。'}</p>
                      <Link to={writingUrl}>
                        在创作工作台更新或人工校正
                        <ArrowUpRight className="size-3.5" />
                      </Link>
                    </section>
                  ))
                ) : detail ? (
                  <>
                    <div className="story-graph-detail__heading">
                      <span>
                        {person
                          ? '人物'
                          : relationship
                            ? certaintyLabel[relationship.certainty]
                            : thread
                              ? `${threadLabel[thread.kind]} · ${certaintyLabel[thread.certainty]}`
                              : ''}
                      </span>
                      <h3>{person?.name || relationship?.label || thread?.title}</h3>
                      {relationship && (
                        <p>
                          {personName(relationship.from)} {relationship.directed ? '→' : '↔'} {personName(relationship.to)}
                        </p>
                      )}
                      {person?.aliases.length ? <p>别名：{person.aliases.join('、')}</p> : null}
                    </div>
                    <p className="story-graph-detail__summary">{detail.summary}</p>
                    {person && (
                      <section>
                        <h4>人物关系</h4>
                        {graph.relationships
                          .filter((r) => r.from === person.id || r.to === person.id)
                          .map((r) => (
                            <button className="story-graph-related" key={r.id} onClick={() => select(r.id)}>
                              {personName(r.from)} {r.directed ? '→' : '↔'} {personName(r.to)}
                              <span>{r.label}</span>
                            </button>
                          ))}
                      </section>
                    )}
                    {(person || relationship) && (
                      <section>
                        <h4>关联情节</h4>
                        {graph.threads
                          .filter((t) => t.people.some((id) => (person ? id === person.id : id === relationship?.from || id === relationship?.to)))
                          .map((t) => (
                            <button className="story-graph-related" key={t.id} onClick={() => select(t.id)}>
                              {t.title}
                              <span>
                                {threadLabel[t.kind]} · {certaintyLabel[t.certainty]}
                              </span>
                            </button>
                          ))}
                      </section>
                    )}
                    {thread && (
                      <section>
                        <h4>涉及人物</h4>
                        {thread.people.map((id) => (
                          <button key={id} className="story-graph-person-chip" onClick={() => select(id)}>
                            {personName(id)}
                          </button>
                        ))}
                      </section>
                    )}
                    {renderEvidence(detail.evidence)}
                  </>
                ) : (
                  <div className="story-graph-detail__intro">
                    <Network />
                    <h3>从一个人物开始</h3>
                    <p>选择人物查看当前处境、关系与伏笔；选择连线查看双方立场及档案依据。</p>
                    <p>虚线表示分析推断或可选方向，人物认知与未解线索会在详情中标明。</p>
                  </div>
                )}
              </div>
            </aside>
          </div>
          <div className="story-graph-people" aria-label="人物列表">
            <span>人物</span>
            {filteredPeople.length ? (
              filteredPeople.map((p) => (
                <button key={p.id} className="story-graph-person-chip" aria-pressed={selected === p.id} onClick={() => select(p.id)}>
                  {p.name}
                </button>
              ))
            ) : (
              <p>没有找到匹配人物，试试其他名字。</p>
            )}
          </div>
        </>
      )}
    </section>
  )
}
