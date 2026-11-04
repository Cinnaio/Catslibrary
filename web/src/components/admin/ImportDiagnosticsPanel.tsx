import '@/styles/input-fields.css'
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
                  ? `有 ${changed} 行建议调整；整份文件全部采纳后预计识别为 ${aiReview.projectedChapterCount} 章（当前 ${stats.chapterCount} 章）。`
                  : '未发现需要调整的章节划分。'}
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
      {impacts.length > 1 && <p className="book-import__diagnostics-clean">以下展示本次所选调整的整体影响；同一章节涉及多处调整时，字数包含这些调整。</p>}
      {impacts.map((impact) => (
        <div className="book-import__boundary-impact" key={impact.line}>
          <p>
            调整第 {impact.line} 行：{impact.raw}
          </p>
          {impact.change ? (
            <>
              <p className="book-import__impact-explanation">
                {impact.change.beforeRole === impact.change.afterRole
                  ? '这一行的识别方式未变化；下方展示本次所选调整对相关章节的影响。'
                  : impact.change.afterRole === 'prose'
                    ? `这一行不再作为章节标题，改为「${impact.after.title}」的正文。`
                    : `从这一行开始新章节「${impact.after.title}」，后续正文按新边界重新归属。`}
              </p>
              <p className="book-import__impact-role">
                {impact.change.beforeRole === 'heading' ? '章节标题' : '正文'} → {impact.change.afterRole === 'heading' ? '章节标题' : '正文'}
              </p>
              {impact.change.addedChars !== undefined && (
                <p className="book-import__diagnostics-clean">
                  「{impact.after.title}」正文：{impact.before.chars} → {impact.after.chars} 字
                  {impact.after.chars !== impact.before.chars
                    ? `（${impact.after.chars > impact.before.chars ? '增加' : '减少'} ${Math.abs(impact.after.chars - impact.before.chars)} 字）`
                    : '（总字数不变）'}
                </p>
              )}
              {!!impact.change.removedChars && (
                <div className="book-import__impact-text" data-kind="removed">
                  <span>
                    {impact.change.addedChars ? '调整前的变化片段' : '从正文移出的文字'} · {impact.change.removedChars} 字
                  </span>
                  <p>
                    <del>{impact.change.removedText}</del>
                  </p>
                </div>
              )}
              {!!impact.change.addedChars && (
                <div className="book-import__impact-text" data-kind="added">
                  <span>
                    {impact.change.removedChars ? '调整后的变化片段' : '新增到正文的文字'} · {impact.change.addedChars} 字
                  </span>
                  <p>
                    <mark>{impact.change.addedText}</mark>
                  </p>
                </div>
              )}
              {impact.change.textTruncated && <p className="book-import__diagnostics-clean">变化片段较长，仅展示前 400 字；字数统计包含整个变化区域。</p>}
            </>
          ) : (
            <p className="book-import__diagnostics-clean">此预览未包含具体边界变化，请重新点击「查看调整效果」获取完整说明。</p>
          )}
          <div className="book-import__boundary-comparison">
            {(['before', 'after'] as const).map((side) => (
              <div key={side}>
                <strong>{side === 'before' ? '调整前' : '调整后'} · 相关章节</strong>
                {(impact[side].chapters || [impact[side]]).map((chapter, index) => (
                  <p key={index}>
                    {chapter.title} · 正文共 {chapter.chars} 字
                  </p>
                ))}
                {impact[side].chapters?.length === 0 && <p>前置信息，尚未形成章节</p>}
              </div>
            ))}
          </div>
          {impact.context && (
            <details className="book-import__impact-context">
              <summary>查看这一行附近的原文</summary>
              <ol className="book-import__source-lines" aria-label={`第 ${impact.line} 行附近原文`}>
                {impact.context.map((row) => (
                  <li key={row.line} data-active={row.line === impact.line}>
                    <span>{row.line}</span>
                    <span>{row.raw || '（空行）'}</span>
                  </li>
                ))}
              </ol>
            </details>
          )}
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
              建议：将第 {item.line} 行{item.verdict === 'heading' ? '作为章节标题，从这里开始新章节' : '作为正文，不在此处新建章节'}
            </strong>
            <span>
              当前识别为{item.heuristic === 'heading' ? '章节标题' : '正文'} · 原文：{item.raw}
            </span>
          </span>
        </label>
      ))}
      <p className="book-import__diagnostics-clean">
        已选 {selected.size} 处识别建议。采纳后只更新导入预览、调整章节划分，不改写原文；点击「确认导入」才会写入书库。
      </p>
      <div className="book-import__boundary-actions">
        {runId && (
          <Button size="sm" variant="outline" disabled={busy || loading || !selected.size || !canResplit} onClick={() => void compare()}>
            {loading ? '计算中…' : '查看调整效果'}
          </Button>
        )}
        <Button size="sm" disabled={busy || loading || !selected.size || !canResplit} onClick={() => onApply([...selected])}>
          按建议重新识别章节 · {selected.size} 处
        </Button>
      </div>
      {error && (
        <p role="alert" className="book-import__boundary-error">
          {error}
        </p>
      )}
      {comparison && (
        <p role="status" className="book-import__diagnostics-clean">
          整份文件按所选建议调整后，预计识别为 {comparison.chapterCount} 章；最终仅导入你选中的章节。
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
      <div className="book-import__manual-content">
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
            <div className="book-import__mode-picker book-import__boundary-verdict-options">
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
                <span>章节标题</span>
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
                <span>正文</span>
              </label>
            </div>
          </fieldset>
        </div>
        <div className="book-import__manual-actions">
          <div className="book-import__manual-preview-actions">
            <Button size="sm" variant="outline" disabled={busy || loading || !valid} onClick={() => void inspect(false)}>
              查看附近原文
            </Button>
            <Button size="sm" variant="outline" disabled={busy || loading || !valid} onClick={() => void inspect(true)}>
              {loading ? '读取中…' : '预览修正影响'}
            </Button>
          </div>
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
              整份文件调整后，预计识别为 {comparison.chapterCount} 章；最终仅导入你选中的章节。
            </p>
            <ImpactRows impacts={comparison.impacts} />
          </>
        )}
      </div>
    </details>
  )
}
