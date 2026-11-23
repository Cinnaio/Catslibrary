import AiStreamPreview from '@/components/shared/AiStreamPreview'
import type { AiTextProgress } from '@shared/ai-text-progress'
import { useDeferredValue, useEffect, useRef, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, ArrowUpRight, ChevronRight, Loader2, Network, RefreshCw, X } from 'lucide-react'
import type { StoryCertainty, StoryEvidence, StoryGraphResponse } from '@shared/story-graph'
import { aiApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { SearchField } from '@/components/shared/SearchField'
import StoryGraphCanvas from './StoryGraphCanvas'
import styles from './StoryGraph.module.css'

const certaintyLabel: Record<StoryCertainty, string> = {
  fact: '已确认事实',
  belief: '人物认知',
  clue: '未解线索',
  possibility: '可选方向',
  inference: '分析推断',
}
const threadLabel = { state: '角色状态', conflict: '待解决冲突', clue: '未解伏笔', item: '关键物品', place: '重要地点' }
const archiveLabel = { relationship: '关系分析', plot: '情节分析' }
const eligibilityLabel: Record<string, string> = {
  missing: '尚未提取',
  stale: '需要更新',
  beyond_anchor: '晚于当前起点',
  source_changed: '正文已变化',
  legacy_unknown: '需要完整初始化',
  usable: '可用',
  rebuilding: '待重建',
}
type Props = { novelId: string; afterChapterId?: string }

// A book or chapter change starts a fresh exploration and cannot display the previous scope.
export default function StoryGraphPanel(props: Props) {
  return <StoryGraphWorkspace key={`${props.novelId}:${props.afterChapterId || ''}`} {...props} />
}

function StoryGraphWorkspace({ novelId, afterChapterId }: Props) {
  const [data, setData] = useState<StoryGraphResponse | null>(null)
  const [loading, setLoading] = useState(Boolean(novelId))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState('')
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const searching = query !== deferredQuery
  const [showThreads, setShowThreads] = useState(false)
  const [focusOnly, setFocusOnly] = useState(false)
  const [tab, setTab] = useState('people')
  const mounted = useRef(true)
  const version = useRef(0)
  const pending = useRef(false)
  const focusDetail = useRef(false)
  const [progress, setProgress] = useState<AiTextProgress | null>(null)
  const writingUrl = `/admin/ai?sub=writing&novel=${encodeURIComponent(novelId)}${afterChapterId ? `&afterChapterId=${encodeURIComponent(afterChapterId)}` : ''}`

  useEffect(() => {
    mounted.current = true
    const current = ++version.current
    if (novelId) {
      aiApi.writing
        .getStoryGraph(novelId, afterChapterId)
        .then((result) => {
          if (mounted.current && current === version.current) setData(result)
        })
        .catch((err: Error) => {
          if (mounted.current && current === version.current) setError(err.message || '图谱读取失败')
        })
        .finally(() => {
          if (mounted.current && current === version.current) setLoading(false)
        })
    }
    return () => {
      mounted.current = false
    }
  }, [novelId, afterChapterId])

  async function refresh() {
    if (pending.current || loading) return
    pending.current = true
    const current = ++version.current
    setLoading(true)
    setError('')
    try {
      const result = await aiApi.writing.getStoryGraph(novelId, afterChapterId)
      if (mounted.current && current === version.current) {
        setData(result)
        setSelected('')
        setFocusOnly(false)
        setTab('people')
      }
    } catch (err) {
      if (mounted.current && current === version.current) setError((err as Error).message || '图谱读取失败')
    } finally {
      if (mounted.current && current === version.current) {
        setLoading(false)
        pending.current = false
      }
    }
  }

  async function generate() {
    if (pending.current || loading) return
    pending.current = true
    const current = ++version.current
    setProgress(null)
    setBusy(true)
    setError('')
    try {
      const result = await aiApi.writing.generateStoryGraph(novelId, afterChapterId, (next) => {
        if (mounted.current && current === version.current) setProgress(next)
      })
      if (mounted.current && current === version.current) {
        setData(result)
        setSelected('')
        setTab('people')
        setFocusOnly(false)
      }
    } catch (err) {
      const message = (err as Error).message || '图谱生成失败，请重试'
      if (mounted.current && current === version.current)
        setError(
          /^HTTP (502|504)$/.test(message)
            ? `故事图谱生成请求失败（${message}），未收到具体错误原因。请先刷新状态确认结果，再检查服务日志；原报告与正文已保留。`
            : message,
        )
    } finally {
      if (mounted.current && current === version.current) {
        setBusy(false)
        pending.current = false
      }
    }
  }

  // Outdated data is never presented as the current chapter's map, even if a server includes it.
  const graph = data?.status === 'ready' ? data.graph : null
  const person = graph?.people.find((p) => p.id === selected)
  const relationship = graph?.relationships.find((r) => r.id === selected)
  const thread = graph?.threads.find((t) => t.id === selected)
  const detail = person || relationship || thread
  const personName = (id: string) => graph?.people.find((p) => p.id === id)?.name || id
  const term = deferredQuery.trim().toLocaleLowerCase()
  const filteredPeople = graph?.people.filter((p) => `${p.name} ${p.aliases.join(' ')}`.toLocaleLowerCase().includes(term)) || []
  const relatedRelationships = graph?.relationships.filter((r) => r.from === person?.id || r.to === person?.id) || []
  const relatedThreads =
    graph?.threads.filter((t) => t.people.some((id) => (person ? id === person.id : id === relationship?.from || id === relationship?.to))) || []

  function select(id: string) {
    focusDetail.current = true
    setSelected(id)
    setQuery('')
    setFocusOnly(true)
    setTab('detail')
    if (graph?.threads.some((t) => t.id === id)) setShowThreads(true)
  }
  function overview() {
    setSelected('')
    setQuery('')
    setFocusOnly(false)
    setTab('people')
  }
  function renderEvidence(evidence: StoryEvidence[]) {
    return (
      <section className={styles.evidence}>
        <h4>从哪里得知</h4>
        <p className={styles.muted}>这是分析报告的摘录，可打开来源章节核对正文。</p>
        {!evidence.length && <p className={styles.muted}>暂未提供可核对的报告依据。</p>}
        {evidence.map((entry, index) => (
          <div key={index} className={styles.evidenceEntry}>
            <span className={styles.eyebrow}>{archiveLabel[entry.kind]}</span>
            <blockquote>{entry.quote}</blockquote>
            <div className={styles.sourceLinks}>
              {entry.chapterIds.length ? (
                entry.chapterIds.map((id) => (
                  <Link key={id} target="_blank" rel="noopener noreferrer" to={`/read/${encodeURIComponent(novelId)}/${encodeURIComponent(id)}`}>
                    {data?.chapters.find((c) => c.id === id)?.title || '来源章节'}
                    <ArrowUpRight size={14} aria-hidden="true" />
                  </Link>
                ))
              ) : (
                <small>报告未提供可核对的章节标记</small>
              )}
            </div>
          </div>
        ))}
      </section>
    )
  }

  if (!novelId)
    return (
      <section className={styles.root}>
        <div className={styles.empty}>
          <Network size={28} aria-hidden="true" />
          <h2>先选择一本小说</h2>
          <p>从作品库选择一本小说，再来探索它的人物与故事。</p>
          <Link to="/admin/novels">选择作品</Link>
        </div>
      </section>
    )

  return (
    <section className={styles.root} aria-label="故事图谱工作区">
      <header className={styles.heading}>
        <Link to={writingUrl} className={styles.back}>
          <ArrowLeft size={15} aria-hidden="true" />
          返回创作工作台
        </Link>
        <div className={styles.headingMain}>
          <div className={styles.headingText}>
            <p className={styles.eyebrow}>故事星图</p>
            <h2>{data?.novel.title || '把故事慢慢展开'}</h2>
            <p className={styles.subtitle}>每个人都有来处，每条线都有故事。</p>
          </div>
          <div className={styles.headingActions}>
            <Button variant="secondary" size="sm" disabled={loading || busy} onClick={() => void refresh()}>
              <RefreshCw className={loading ? 'size-3.5 animate-spin' : 'size-3.5'} aria-hidden="true" />
              刷新状态
            </Button>
            {data && data.status !== 'ready' && data.status !== 'unavailable' && (
              <Button size="sm" disabled={busy || loading} onClick={() => void generate()}>
                {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Network size={15} aria-hidden="true" />}
                {busy ? '整理图谱中…' : data.status === 'outdated' ? '更新图谱' : '生成故事图谱'}
              </Button>
            )}
          </div>
        </div>
        <div className={styles.meta}>
          <span>{data?.anchor ? `截至第 ${data.anchor.ordinal} 章 · ${data.anchor.title}` : '等待小说章节与分析报告'}</span>
          {data?.status === 'ready' && <span>更新于 {new Date(data.updatedAt).toLocaleString('zh-CN')}</span>}
        </div>
      </header>
      {busy && <AiStreamPreview progress={progress} structured />}
      {error && (
        <div role="alert" className={styles.error}>
          {error}
        </div>
      )}
      {loading && !data ? (
        <div className={styles.empty} role="status">
          <Loader2 className="animate-spin" />
          <p>正在读取本书图谱…</p>
        </div>
      ) : !graph ? (
        <div className={styles.empty}>
          <Network size={32} aria-hidden="true" />
          <h3>
            {data?.status === 'unavailable'
              ? '先准备本书的分析报告'
              : data?.status === 'outdated'
                ? '分析范围或报告已变化'
                : data
                  ? '把人物与故事连起来'
                  : '暂时无法读取图谱'}
          </h3>
          <p>
            {data?.status === 'unavailable'
              ? '当前起点没有可用的关系或情节报告。完成分析后，再来展开这张星图。'
              : data?.status === 'outdated'
                ? '请更新图谱，新的结果将使用当前有效报告及人工校正内容。'
                : data
                  ? '从一个人物出发，沿着关系找到另一人，再读一读他们背后的故事依据。点击上方生成按钮开始整理。'
                  : '可以刷新状态重试，已有报告与正文会保留。'}
          </p>
          {data?.status === 'unavailable' && (
            <Link to={writingUrl}>
              前往小说分析
              <ArrowUpRight size={14} />
            </Link>
          )}
          {data && data.status !== 'unavailable' && <small>生成会调用文本模型并计入用量，打开页面不会自动生成。</small>}
        </div>
      ) : !graph.people.length ? (
        <div className={styles.empty}>
          <h3>报告中暂无可确认的人物</h3>
          <p>可以先补充或校正关系报告，再刷新图谱。</p>
          <Link to={writingUrl}>前往小说分析</Link>
        </div>
      ) : (
        <div className={styles.workbench}>
          <div className={styles.map} aria-busy={searching} data-transitioning={searching || undefined}>
            <div className={styles.mapToolbar}>
              <div>
                <span className={styles.eyebrow}>{term ? '寻人' : focusOnly && detail ? '人物周边' : '故事全景'}</span>
                <h3>
                  {term
                    ? `找到 ${filteredPeople.length} 位人物`
                    : person
                      ? person.name
                      : relationship
                        ? `${personName(relationship.from)}与${personName(relationship.to)}`
                        : thread?.title || '从一个名字开始'}
                </h3>
              </div>
              <div className={styles.mapActions}>
                {selected && (
                  <Button variant="ghost" size="sm" onClick={overview}>
                    回到全景
                  </Button>
                )}
                <label className={styles.option}>
                  <Checkbox checked={showThreads} onCheckedChange={(value) => setShowThreads(value === true)} />
                  显示相关情节
                </label>
                <label className={styles.option}>
                  <Checkbox disabled={!detail} checked={focusOnly} onCheckedChange={(value) => setFocusOnly(value === true)} />
                  只看相关人物
                </label>
              </div>
            </div>
            <StoryGraphCanvas
              key={String(data?.updatedAt)}
              graph={graph}
              selected={selected}
              onSelect={select}
              showThreads={showThreads}
              focusOnly={focusOnly}
              searchIds={term ? filteredPeople.map((p) => p.id) : undefined}
            />
            <div className={styles.legend}>
              <span>
                <i />
                人物关系
              </span>
              <span>
                <i className={styles.dashed} />
                推断 / 可选方向
              </span>
              {showThreads && <span>方形节点 · 关联情节</span>}
              <small>
                {graph.people.length} 位人物 · {graph.relationships.length} 条关系
              </small>
            </div>
          </div>
          <aside className={styles.sidebar} aria-label="图谱详情">
            <div className={styles.search}>
              <SearchField
                label="搜索人物或别名"
                placeholder="找一个名字，或他的别名"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value)
                  setTab('people')
                }}
              />
              {query && (
                <Button variant="ghost" size="icon" aria-label="清除人物搜索" onClick={() => setQuery('')}>
                  <X size={16} />
                </Button>
              )}
            </div>
            <Tabs value={tab} onValueChange={setTab} className={styles.tabs}>
              <TabsList variant="line" aria-label="星图探索">
                <TabsTrigger value="people">人物索引</TabsTrigger>
                <TabsTrigger value="detail">线索详情</TabsTrigger>
                <TabsTrigger value="archives">文字报告</TabsTrigger>
              </TabsList>
              <TabsContent value="people" className={styles.tabBody}>
                <p className={styles.muted}>{term ? `匹配 ${filteredPeople.length} 人，画布同时保留他们的直接关系。` : '选一个人，看看他与谁相连。'}</p>
                <div key={term} className={styles.people} aria-label="人物列表" aria-busy={searching} data-transitioning={searching || undefined}>
                  {filteredPeople.length ? (
                    filteredPeople.map((p, index) => (
                      <button
                        key={p.id}
                        type="button"
                        aria-label={p.name}
                        aria-pressed={selected === p.id}
                        className={styles.personRow}
                        style={{ '--stagger-i': Math.min(index, 8) } as CSSProperties}
                        onClick={() => select(p.id)}
                      >
                        <span className={styles.personInitial} aria-hidden="true">
                          {Array.from(p.name)[0]}
                        </span>
                        <span>
                          <strong>{p.name}</strong>
                          <small>{p.summary || (p.aliases.length ? p.aliases.join('、') : '查看人物线索')}</small>
                        </span>
                        <ChevronRight size={15} aria-hidden="true" />
                      </button>
                    ))
                  ) : (
                    <div className={styles.inlineEmpty}>
                      <p>没有找到匹配人物，试试其他名字。</p>
                      <Button variant="ghost" size="sm" onClick={() => setQuery('')}>
                        查看全部人物
                      </Button>
                    </div>
                  )}
                </div>
              </TabsContent>
              <TabsContent value="detail" className={styles.tabBody}>
                {detail ? (
                  <div key={selected} className={styles.detail}>
                    <div className={styles.detailHeading}>
                      <span className={styles.eyebrow}>
                        {person
                          ? '人物'
                          : relationship
                            ? certaintyLabel[relationship.certainty]
                            : thread
                              ? `${threadLabel[thread.kind]} · ${certaintyLabel[thread.certainty]}`
                              : ''}
                      </span>
                      <h3
                        ref={(node) => {
                          if (node && focusDetail.current) {
                            node.focus({ preventScroll: true })
                            if (window.matchMedia?.('(max-width: 900px)').matches) node.scrollIntoView?.({ block: 'nearest' })
                            focusDetail.current = false
                          }
                        }}
                        tabIndex={-1}
                      >
                        {person?.name || relationship?.label || thread?.title}
                      </h3>
                      {relationship && (
                        <p>
                          {personName(relationship.from)} {relationship.directed ? '→' : '↔'} {personName(relationship.to)}
                        </p>
                      )}
                      {person?.aliases.length ? <p>也被称作 {person.aliases.join('、')}</p> : null}
                    </div>
                    <p className={styles.summary}>{detail.summary}</p>
                    {person && (
                      <section>
                        <h4>与谁相连</h4>
                        {relatedRelationships.length ? (
                          relatedRelationships.map((r) => (
                            <button type="button" className={styles.related} key={r.id} onClick={() => select(r.id)}>
                              <span>
                                {personName(r.from)} {r.directed ? '→' : '↔'} {personName(r.to)}
                                <small>
                                  {r.label} · {certaintyLabel[r.certainty]}
                                </small>
                              </span>
                              <ChevronRight size={15} aria-hidden="true" />
                            </button>
                          ))
                        ) : (
                          <p className={styles.muted}>当前报告还没有收录与他人的关系。</p>
                        )}
                      </section>
                    )}
                    {(person || relationship) && (
                      <section>
                        <h4>故事还牵着什么</h4>
                        {relatedThreads.length ? (
                          relatedThreads.map((t) => (
                            <button type="button" className={styles.related} key={t.id} onClick={() => select(t.id)}>
                              <span>
                                {t.title}
                                <small>
                                  {threadLabel[t.kind]} · {certaintyLabel[t.certainty]}
                                </small>
                              </span>
                              <ChevronRight size={15} aria-hidden="true" />
                            </button>
                          ))
                        ) : (
                          <p className={styles.muted}>当前报告暂无关联情节。</p>
                        )}
                      </section>
                    )}
                    {(relationship || thread) && (
                      <section>
                        <h4>涉及人物</h4>
                        <div className={styles.personLinks}>
                          {(thread?.people || (relationship ? [relationship.from, relationship.to] : [])).map((id) => (
                            <Button variant="secondary" size="sm" key={id} onClick={() => select(id)}>
                              {personName(id)}
                            </Button>
                          ))}
                        </div>
                      </section>
                    )}
                    {renderEvidence(detail.evidence)}
                  </div>
                ) : (
                  <div className={styles.inlineEmpty}>
                    <h3>沿着一条线，读懂一段关系</h3>
                    <p>选择画布中的人物、连线或情节，这里会展开说明与来源。</p>
                    <Button variant="secondary" size="sm" onClick={() => setTab('people')}>
                      从人物索引开始
                    </Button>
                  </div>
                )}
              </TabsContent>
              <TabsContent value="archives" className={styles.tabBody}>
                {data?.archives.map((a) => (
                  <section key={a.kind} className={styles.archive}>
                    <div className={styles.archiveHeading}>
                      <h3>{archiveLabel[a.kind]}</h3>
                      <span>{eligibilityLabel[a.eligibility] || '不可用'}</span>
                    </div>
                    {a.content && (
                      <p className={styles.muted}>
                        截至 {a.chaptersThrough} 章{a.origin === 'manual' ? ' · 人工校正' : ''}
                      </p>
                    )}
                    <p className={styles.archiveText}>{a.content || '当前起点暂无可用报告。'}</p>
                    <Link to={writingUrl}>
                      更新或人工校正
                      <ArrowUpRight size={14} />
                    </Link>
                  </section>
                ))}
              </TabsContent>
            </Tabs>
          </aside>
        </div>
      )}
      {data && !graph && (
        <div className={styles.archiveStatus}>
          {data?.archives.map((a) => (
            <span key={a.kind}>
              {archiveLabel[a.kind]} · {eligibilityLabel[a.eligibility] || '不可用'}
            </span>
          ))}
        </div>
      )}
    </section>
  )
}
