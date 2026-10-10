/**
 * 导入解析诊断面板。
 *
 * 解决的问题：以前「90 章的文件只解析出 45 章」要等导入完成、翻章节列表才发现。
 * 这里把切分统计、异常信号与证据不足的行摆到预览页上，管理员在提交前就能看到
 * 「这一行为什么被当成 / 没当成章节标题」，也能直接跑 AI 复核让模型翻案。
 */
import type { BookImportAiReview, BookImportDiagnostics, BookImportLineEvidence } from '@shared/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ChevronDown, ChevronUp, CircleAlert, Info, LoaderCircle, Sparkles } from 'lucide-react'
import { useState } from 'react'

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
}: {
  diagnostics: BookImportDiagnostics
  aiReview: BookImportAiReview | null
  onReview: () => void
  onApply: () => void
  busy: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const { stats, anomalies, uncertain, uncertainTotal } = diagnostics
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
          {uncertainTotal > 0 && <Badge variant="secondary">{uncertainTotal} 行待复核</Badge>}
          <Button variant="outline" size="sm" onClick={() => setExpanded(!expanded)}>
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
        <div className="book-import__diagnostics-detail">
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

          {uncertain.length > 0 ? (
            <>
              <div className="book-import__diagnostics-review">
                <span>有 {uncertainTotal} 行判定证据不足。AI 复核只裁决这些行，切分与编号仍由确定性代码完成。</span>
                <Button variant="outline" size="sm" onClick={onReview} disabled={busy}>
                  {busy ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" /> : <Sparkles aria-hidden="true" />}
                  运行 AI 复核
                </Button>
              </div>
              {aiReview && (
                <div className="book-import__diagnostics-review-result" role="status">
                  {changed > 0 ? (
                    <>
                      <span>
                        复核了 {aiReview.candidateCount} 行，建议改判 {changed} 行
                        {aiReview.projectedChapterCount ? `，采纳后为 ${aiReview.projectedChapterCount} 章` : ''}
                        （当前 {stats.chapterCount} 章）。
                      </span>
                      <Button size="sm" onClick={onApply} disabled={busy}>
                        采纳建议并重新切分
                      </Button>
                    </>
                  ) : (
                    <span>复核了 {aiReview.candidateCount} 行，未发现需要改判的边界。</span>
                  )}
                </div>
              )}
              <ScrollArea className="book-import__evidence-list">
                {uncertain.map((item) => (
                  <div key={item.line} className="book-import__evidence-row" data-verdict={item.verdict}>
                    <span className="book-import__evidence-line">第 {item.line} 行</span>
                    <span className="book-import__evidence-raw">{item.raw.trim() || '（空行）'}</span>
                    <span className="book-import__evidence-risk">{evidenceRisk(item)}</span>
                  </div>
                ))}
              </ScrollArea>
            </>
          ) : (
            <p className="book-import__diagnostics-clean">没有证据不足的行，解析结果可以直接使用。</p>
          )}
        </div>
      )}
    </section>
  )
}
