/**
 * 导入解析诊断面板。
 *
 * 解决的问题：以前「90 章的文件只解析出 45 章」要等导入完成、翻章节列表才发现。
 * 这里把切分统计、异常信号与证据不足的行摆到预览页上，管理员在提交前就能看到
 * 「这一行为什么被当成 / 没当成章节标题」，也能直接跑 AI 复核让模型翻案。
 */
import type { BookImportAiReview, BookImportBoundaryImpact, BookImportBoundaryOverride, BookImportDiagnostics, BookImportLineEvidence } from '@shared/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ChevronDown, ChevronUp, CircleAlert, Info, LoaderCircle, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { bookImportApi } from '@/lib/api'

const RULE_LABELS: Record<string, string> = {
  'numbered-heading': '第 N 章写法',
  'bare-number-spaced': '裸编号（带空格）',
  'bare-number-tight': '裸编号（紧贴）',
  'forced-heading': 'AI 复核采纳',
  'implausible-number': '编号不在合理区间',
  'overlong-title': '标题过长',
  'prose-ending-long-title': '句读收尾且超长',
  'forum-floor': '论坛楼层',
  'list-marker': '编号列表项',
  'quantity-unit': '数量单位',
  'leading-indent': '行首有缩进',
  'prose-ending': '句号收尾',
  'unnumbered-heading-shape': '无编号章名形态',
  prose: '普通正文',
}

function ruleLabel(rule: string): string {
  return RULE_LABELS[rule] || rule
}

/** 证据行的一句话结论：漏判（可能丢内容）与误判（可能多切章）都要说清风险方向。 */
function evidenceRisk(item: BookImportLineEvidence): string {
  if (item.verdict === 'prose' && item.rejectedBy) return `被判为正文（${ruleLabel(item.rejectedBy)}），若实为标题会丢失章节边界`
  if (item.verdict === 'heading') return `被判为标题（${ruleLabel(item.rule)}），若实为正文会切出多余章节`
  return '判定不确定'
}

export default function ImportDiagnosticsPanel({
  diagnostics,
  aiReview,
  onReview,
  onApply,
  busy,
  runId,
  revision = 0,
  overrides = [],
  reviewedLines = [],
  canResplit = true,
  expiresAt,
  onEdit,
  onUndo,
  onReset,
}: {
  diagnostics: BookImportDiagnostics
  aiReview: BookImportAiReview | null
  onReview: () => void
  onApply: (lines: number[]) => void
  busy: boolean
  runId?: string
  revision?: number
  overrides?: BookImportBoundaryOverride[]
  reviewedLines?: number[]
  canResplit?: boolean
  expiresAt?: number
  onEdit?: (changes: Pick<BookImportBoundaryOverride, 'line' | 'verdict'>[]) => void
  onUndo?: (line: number) => void
  onReset?: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const { stats, anomalies, uncertain, uncertainTotal } = diagnostics
  const pendingCount = diagnostics.pendingCount ?? uncertainTotal
  const warnings = anomalies.filter((item) => item.severity === 'warning')
  const changed = aiReview?.suggestions.length || 0

  return (
    <section className="book-import__section book-import__diagnostics" aria-labelledby="book-import-diagnostics-title">
      <div className="book-import__section-heading">
        <div>
          <h3 id="book-import-diagnostics-title">解析诊断</h3>
          <p>
            {stats.parser === 'text'
              ? `${stats.totalLines} 行中识别到 ${stats.headingLines} 个章节标题，切出 ${stats.chapterCount} 章`
              : `结构化来源，切出 ${stats.chapterCount} 章`}
            {stats.numbering.detected > 0 ? `；编号 ${stats.numbering.min}-${stats.numbering.max}` : ''}
          </p>
        </div>
        <div className="book-import__diagnostics-actions">
          {warnings.length > 0 && <Badge variant="destructive">{warnings.length} 项异常</Badge>}
          {pendingCount > 0 && <Badge variant="secondary">{pendingCount} 行待复核</Badge>}
          <Button variant="outline" size="sm" aria-expanded={expanded} aria-controls="book-import-diagnostics-detail" onClick={() => setExpanded(!expanded)}>
            {expanded ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
            {expanded ? '收起' : '展开明细'}
          </Button>
        </div>
      </div>

      {anomalies.length > 0 && (
        <ul className="book-import__anomalies">
          {anomalies.map((item) => (
            <li key={item.code} data-severity={item.severity}>
              {item.severity === 'warning' ? <CircleAlert aria-hidden="true" /> : <Info aria-hidden="true" />}
              <span>{item.message}</span>
            </li>
          ))}
        </ul>
      )}

      {expanded && (
        <div className="book-import__diagnostics-detail" id="book-import-diagnostics-detail">
          <dl className="book-import__diagnostics-stats">
            <div>
              <dt>章节数</dt>
              <dd>{stats.chapterCount}</dd>
            </div>
            <div>
              <dt>标题行</dt>
              <dd>{stats.headingLines}</dd>
            </div>
            <div>
              <dt>卷标题</dt>
              <dd>{stats.volumeHeadingLines}</dd>
            </div>
            <div>
              <dt>重抄标题</dt>
              <dd>{stats.mergedHeadingLines}</dd>
            </div>
            <div>
              <dt>前置信息行</dt>
              <dd>{stats.frontMatterLines}</dd>
            </div>
            <div>
              <dt>丢弃空章</dt>
              <dd>{stats.droppedEmptyChapters}</dd>
            </div>
            <div>
              <dt>正文中位字数</dt>
              <dd>{stats.chapterChars.median}</dd>
            </div>
            <div>
              <dt>编号缺号</dt>
              <dd>{stats.numbering.missing}</dd>
            </div>
            <div>
              <dt>编号重号</dt>
              <dd>{stats.numbering.duplicated}</dd>
            </div>
          </dl>

          <p className="book-import__diagnostics-clean">
            共 {reviewedLines.length + (diagnostics.pendingCount ?? uncertainTotal)} 行存疑 · 已复核 {reviewedLines.length} 行 · 尚未复核{' '}
            {diagnostics.pendingCount ?? uncertainTotal} 行。
            {(diagnostics.truncatedCount || 0) > 0 && ` 当前展示 ${uncertain.length} 行，另有 ${diagnostics.truncatedCount} 行将在后续批次处理。`}
          </p>
          {!canResplit && <p className="book-import__diagnostics-clean">原文快照不可用，无法复核或修正边界。请重新上传生成预览。</p>}
          {expiresAt && (
            <p className="book-import__diagnostics-clean">
              此预览保留至 {new Date(expiresAt).toLocaleString('zh-CN')}。完成导入后，解析快照保留 30 天；清理不影响导入历史和安全撤回。
            </p>
          )}
          {uncertain.length > 0 && (
            <div className="book-import__diagnostics-review">
              <span>AI 仅复核存疑行，章节切分由解析器完成。复核完成的行不会重复计费处理。</span>
              <Button variant="outline" size="sm" onClick={onReview} disabled={busy || !canResplit}>
                {busy ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" /> : <Sparkles aria-hidden="true" />}
                {reviewedLines.length ? '继续复核下一批' : '运行 AI 复核'}
              </Button>
            </div>
          )}
          {aiReview && (
            <div className="book-import__diagnostics-review-result" role="status">
              <span>
                本轮复核了 {aiReview.candidateCount} 行，
                {changed > 0
                  ? `待采纳建议改判 ${changed} 行，全部采纳后为 ${aiReview.projectedChapterCount} 章（当前 ${stats.chapterCount} 章）。`
                  : '未发现需要改判的边界。'}
              </span>
            </div>
          )}
          {changed > 0 && (
            <BoundarySuggestions
              key={`suggestions-${revision}-${aiReview?.reviewedAt}`}
              review={aiReview!}
              busy={busy}
              canResplit={canResplit}
              onApply={onApply}
              runId={runId}
              revision={revision}
            />
          )}
          {uncertain.length > 0 ? (
            <ScrollArea className="book-import__evidence-list">
              {uncertain.map((item) => (
                <div key={item.line} className="book-import__evidence-row" data-verdict={item.verdict}>
                  <span className="book-import__evidence-line">第 {item.line} 行</span>
                  <span className="book-import__evidence-raw">{item.raw.trim() || '（空行）'}</span>
                  <span className="book-import__evidence-risk">{evidenceRisk(item)}</span>
                </div>
              ))}
            </ScrollArea>
          ) : (
            <p className="book-import__diagnostics-clean">没有证据不足的行需要继续复核。规则未发现存疑不代表切分必然正确，请继续核对章节列表和异常提示。</p>
          )}
          {runId && onEdit && canResplit && <ManualBoundaryEditor key={`manual-${revision}`} runId={runId} revision={revision} busy={busy} onEdit={onEdit} />}
          {overrides.length > 0 && (
            <div className="book-import__boundary-history">
              <div className="book-import__diagnostics-review">
                <h4>已修正 {overrides.length} 行</h4>
                <Button variant="outline" size="sm" disabled={busy || !canResplit} onClick={onReset}>
                  恢复原始解析
                </Button>
              </div>
              <ul>
                {overrides.map((item) => (
                  <li key={item.line}>
                    <span>
                      第 {item.line} 行 · {item.verdict === 'heading' ? '章节标题' : '正文'} · {item.source === 'ai' ? 'AI 建议' : '人工修正'}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy || !canResplit}
                      onClick={() => onUndo?.(item.line)}
                      aria-label={`撤销第 ${item.line} 行修正`}
                    >
                      撤销
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function ImpactRows({ impacts }: { impacts: BookImportBoundaryImpact[] }) {
  return (
    <div className="book-import__boundary-impacts">
      {impacts.map((impact) => (
        <div className="book-import__boundary-impact" key={impact.line}>
          <p>
            第 {impact.line} 行：{impact.raw}
          </p>
          <div className="book-import__boundary-comparison">
            <div>
              <strong>
                修正前 · {impact.before.title} · {impact.before.chars} 字
              </strong>
              <p>{impact.before.excerpt || '无正文'}</p>
            </div>
            <div>
              <strong>
                修正后 · {impact.after.title} · {impact.after.chars} 字
              </strong>
              <p>{impact.after.excerpt || '无正文'}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

function BoundarySuggestions({
  review,
  busy,
  canResplit,
  onApply,
  runId,
  revision,
}: {
  review: BookImportAiReview
  busy: boolean
  canResplit: boolean
  onApply: (lines: number[]) => void
  runId?: string
  revision: number
}) {
  const [selected, setSelected] = useState(() => new Set(review.suggestions.map((item) => item.line)))
  const [comparison, setComparison] = useState<{ chapterCount: number; impacts: BookImportBoundaryImpact[] } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  async function compare() {
    if (!runId || loading) return
    setLoading(true)
    setError('')
    try {
      const result = await bookImportApi.previewBoundaries(
        runId,
        revision,
        review.suggestions.filter((item) => selected.has(item.line)),
      )
      setComparison(result)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }
  return (
    <div className="book-import__boundary-suggestions">
      {review.suggestions.map((item) => (
        <label className="book-import__boundary-choice" key={item.line}>
          <Checkbox
            checked={selected.has(item.line)}
            disabled={busy || loading || !canResplit}
            aria-label={`采纳第 ${item.line} 行建议`}
            onCheckedChange={(checked) => {
              setSelected((previous) => {
                const next = new Set(previous)
                if (checked === true) next.add(item.line)
                else next.delete(item.line)
                return next
              })
              setComparison(null)
            }}
          />
          <span>
            <strong>
              第 {item.line} 行 · {item.heuristic === 'heading' ? '标题' : '正文'} → {item.verdict === 'heading' ? '标题' : '正文'}
            </strong>
            <span>{item.raw}</span>
          </span>
        </label>
      ))}
      <div className="book-import__boundary-actions">
        {runId && (
          <Button size="sm" variant="outline" disabled={busy || loading || !selected.size || !canResplit} onClick={() => void compare()}>
            {loading ? '计算中…' : '比较所选修正'}
          </Button>
        )}
        <Button size="sm" disabled={busy || loading || !selected.size || !canResplit} onClick={() => onApply([...selected])}>
          采纳建议并重新切分 · {selected.size} 行
        </Button>
      </div>
      {error && (
        <p role="alert" className="book-import__boundary-error">
          {error}
        </p>
      )}
      {comparison && (
        <p role="status" className="book-import__diagnostics-clean">
          采纳所选修正后为 {comparison.chapterCount} 章。
        </p>
      )}
      <ImpactRows impacts={comparison?.impacts || (selected.size === review.suggestions.length ? review.impacts || [] : [])} />
    </div>
  )
}

function ManualBoundaryEditor({
  runId,
  revision,
  busy,
  onEdit,
}: {
  runId: string
  revision: number
  busy: boolean
  onEdit: (changes: Pick<BookImportBoundaryOverride, 'line' | 'verdict'>[]) => void
}) {
  const [line, setLine] = useState('')
  const [verdict, setVerdict] = useState<'heading' | 'prose'>('heading')
  const [context, setContext] = useState<Array<{ line: number; raw: string }>>([])
  const [comparison, setComparison] = useState<{ chapterCount: number; impacts: BookImportBoundaryImpact[] } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const valid = Number.isSafeInteger(Number(line)) && Number(line) > 0
  async function inspect(preview: boolean) {
    if (!valid || busy || loading) return
    setLoading(true)
    setError('')
    try {
      if (preview) setComparison(await bookImportApi.previewBoundaries(runId, revision, [{ line: Number(line), verdict }]))
      else setContext((await bookImportApi.lines(runId, Number(line))).lines)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }
  return (
    <details className="book-import__manual-boundary">
      <summary>人工修正边界</summary>
      <p className="book-import__diagnostics-clean">按原文行号修正遗漏或误识别的标题。先预览影响，再应用；已采纳的其他修正会保留。</p>
      <div className="book-import__boundary-form">
        <div>
          <Label htmlFor="import-boundary-line">原文行号</Label>
          <Input
            id="import-boundary-line"
            type="number"
            min="1"
            step="1"
            value={line}
            disabled={busy || loading}
            onChange={(event) => {
              setLine(event.target.value)
              setComparison(null)
              setContext([])
            }}
          />
        </div>
        <fieldset disabled={busy || loading}>
          <legend>判定为</legend>
          <label>
            <input
              type="radio"
              name="import-boundary-verdict"
              checked={verdict === 'heading'}
              onChange={() => {
                setVerdict('heading')
                setComparison(null)
              }}
            />
            章节标题
          </label>
          <label>
            <input
              type="radio"
              name="import-boundary-verdict"
              checked={verdict === 'prose'}
              onChange={() => {
                setVerdict('prose')
                setComparison(null)
              }}
            />
            正文
          </label>
        </fieldset>
      </div>
      <div className="book-import__boundary-actions">
        <Button size="sm" variant="outline" disabled={busy || loading || !valid} onClick={() => void inspect(false)}>
          查看附近原文
        </Button>
        <Button size="sm" variant="outline" disabled={busy || loading || !valid} onClick={() => void inspect(true)}>
          {loading ? '读取中…' : '预览修正影响'}
        </Button>
        <Button size="sm" disabled={busy || loading || !comparison} onClick={() => onEdit([{ line: Number(line), verdict }])}>
          应用人工修正
        </Button>
      </div>
      {error && (
        <p role="alert" className="book-import__boundary-error">
          {error}
        </p>
      )}
      {context.length > 0 && (
        <ol className="book-import__source-lines" aria-label="附近原文">
          {context.map((item) => (
            <li key={item.line} data-active={item.line === Number(line)}>
              <span>{item.line}</span>
              <span>{item.raw || '（空行）'}</span>
            </li>
          ))}
        </ol>
      )}
      {comparison && (
        <>
          <p role="status" className="book-import__diagnostics-clean">
            修正后为 {comparison.chapterCount} 章。
          </p>
          <ImpactRows impacts={comparison.impacts} />
        </>
      )}
    </details>
  )
}
