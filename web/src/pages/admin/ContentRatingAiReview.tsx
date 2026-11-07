import { MotionDetails } from '@/components/ui/motion'
import { useEffect, useRef, type RefObject } from 'react'
import { CheckCircle2, ChevronDown, XCircle } from 'lucide-react'
import type { AdminContentRatingAiSuggestion, AdminContentRatingBodySnapshot, AdminContentRatingEvidence } from '@/lib/api'
import { RESTRICTED_BODY_KEYWORDS } from '@shared/restricted-patterns'
import AdminContentRatingBadge from '@/components/admin/AdminContentRatingBadge'
import AdminStatusBadge from '@/components/admin/AdminStatusBadge'
import FormField from '@/components/shared/FormField'
import { ReadingDialog } from '@/components/shared/ReadingDialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import styles from './content-rating-ai-review.module.css'

type ReviewDecision = 'approve' | 'reject' | null

interface ContentRatingAiReviewProps {
  suggestion: AdminContentRatingAiSuggestion | null
  decision: ReviewDecision
  reason: string
  error: string
  saving: boolean
  reasonInputRef: RefObject<HTMLTextAreaElement | null>
  triggerRef: RefObject<HTMLElement | null>
  onDecision: (decision: ReviewDecision) => void
  onReason: (reason: string) => void
  onClose: () => void
  onSubmit: () => void
}

const KEYWORD_WEIGHTS = new Map(RESTRICTED_BODY_KEYWORDS.map(item => [item.keyword, item.weight]))
const isStrongKeyword = (keyword: string) => (KEYWORD_WEIGHTS.get(keyword) ?? 1) >= 3
const number = (value: number) => Number(value || 0).toLocaleString('zh-CN')

function evidenceField(item: AdminContentRatingEvidence): string {
  if (item.type === 'category' || item.field === 'categories') return '分类'
  if (item.field === 'title') return '标题'
  if (item.field === 'description') return '简介'
  if (item.field === 'body') return '正文'
  return '模型记录'
}

function BodySamples({ body }: { body?: AdminContentRatingBodySnapshot }) {
  return (
    <section className={styles.section} aria-label="正文采样">
      <div className={styles.sectionHead}>
        <h3>原文采样</h3>
        {body?.hasBody && <span className={styles.meta}>{number(body.excerpts.length)} 个片段</span>}
      </div>
      {!body ? (
        <p className={styles.hint}>本次建议未附正文采样记录，请结合元数据与原文核对。</p>
      ) : !body.hasBody ? (
        <p className={styles.hint}>尚未获取正文，本次建议依据标题、简介与分类，无法据此确认正文内容。</p>
      ) : (
        <>
          <p className={styles.hint}>
            扫描 {number(body.chapterCount)} 章 · {number(body.scannedCharacters)} 字 · 信号命中 {number(body.matchedChapterCount)} 章（{Math.round(body.matchedChapterRatio * 100)}%）
          </p>
          <p className={styles.hint}>命中词用于定位片段，分级需结合原文语境判断。</p>
          {body.keywordHits.length > 0 && (
            <MotionDetails className={styles.disclosure}>
              <summary>
                <span>命中词明细 <span className={styles.meta}>{number(body.keywordHits.length)} 个词</span></span>
                <ChevronDown aria-hidden="true" />
              </summary>
              <div className={styles.keywordGroups}>
                {[true, false].map(strong => {
                  const words = body.keywordHits.filter(item => isStrongKeyword(item.keyword) === strong)
                  return words.length > 0 && (
                    <div key={String(strong)} className={styles.keywordGroup}>
                      <span className={styles.meta}>{strong ? '直白词' : '语境词'}</span>
                      <div className={styles.keywords}>
                        {words.map(item => (
                          <Badge key={item.keyword} variant="outline" className={styles.keyword} data-strong={strong}>
                            {item.keyword} · {number(item.chapters)} 章
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </MotionDetails>
          )}
          {body.excerpts.length > 0 ? (
            <div className={styles.excerpts}>
              {body.excerpts.map((excerpt, index) => {
                const strong = excerpt.strongKeywords ?? excerpt.keywords.filter(isStrongKeyword)
                const weak = excerpt.weakKeywords ?? excerpt.keywords.filter(word => !isStrongKeyword(word))
                return (
                  <MotionDetails key={`${excerpt.chapter}-${index}`} className={styles.excerpt} open={index === 0}>
                    <summary>
                      <span className={styles.excerptHeading}>
                        <span>{excerpt.chapter}</span>
                        <span className={styles.meta}>{excerpt.origin === 'match' ? '命中定位' : '均匀抽样'}</span>
                      </span>
                      <ChevronDown aria-hidden="true" />
                    </summary>
                    <div className={styles.excerptContent}>
                      <p className={styles.hint}>
                        {strong.length > 0 ? `直白词：${strong.join('、')}` : weak.length > 0 ? `语境词：${weak.join('、')}` : '本段未记录命中词'}
                      </p>
                      <blockquote>{excerpt.text}</blockquote>
                    </div>
                  </MotionDetails>
                )
              })}
            </div>
          ) : <p className={styles.hint}>未附原文片段，请另行核对正文。</p>}
        </>
      )}
    </section>
  )
}

export default function ContentRatingAiReview({ suggestion, decision, reason, error, saving, reasonInputRef, triggerRef, onDecision, onReason, onClose, onSubmit }: ContentRatingAiReviewProps) {
  const approveButton = useRef<HTMLButtonElement>(null)
  const previousDecision = useRef<ReviewDecision>(null)

  useEffect(() => {
    if (decision) {
      reasonInputRef.current?.focus({ preventScroll: true })
      reasonInputRef.current?.scrollIntoView({ block: 'nearest' })
    } else if (previousDecision.current) {
      approveButton.current?.focus({ preventScroll: true })
    }
    previousDecision.current = decision
  }, [decision, reasonInputRef])

  const impact = decision === 'reject'
    ? '拒绝后保留作品当前分级，并记录审核理由。'
    : suggestion?.suggestedRating === 'restricted'
      ? '批准后将作品标为限制级，并记录人工审核。'
      : '批准后继续保持未标注，不会标为一般。'

  return (
    <Dialog open={!!suggestion} onOpenChange={open => { if (!open && !saving) onClose() }}>
      <ReadingDialog
        title={suggestion?.title || '作品'}
        eyebrow={<><span>AI 分级建议审核</span><span>{decision ? decision === 'approve' ? '确认批准' : '确认拒绝' : '核对依据'}</span></>}
        description={suggestion && <span className={styles.workMeta}><span>{suggestion.author || '未知作者'}</span><span>当前分级 <AdminContentRatingBadge rating={suggestion.currentRating} /></span></span>}
        bodyLabel="分级建议与原文审阅"
        showCloseButton={!saving}
        onEscapeKeyDown={event => { if (saving) event.preventDefault() }}
        onInteractOutside={event => { if (saving) event.preventDefault() }}
        onCloseAutoFocus={event => {
          if (triggerRef.current?.isConnected) {
            event.preventDefault()
            triggerRef.current.focus({ preventScroll: true })
          }
        }}
        footer={
          <div className={styles.footer}>
            <p className={styles.hint}>{decision ? impact : '核对模型依据与原文后，再决定是否采纳。'}</p>
            <div className={styles.actions}>
              {!decision ? (
                <>
                  <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>取消</Button>
                  <Button type="button" variant="outline" onClick={() => onDecision('reject')} disabled={saving}>
                    <XCircle aria-hidden="true" />拒绝建议
                  </Button>
                  <Button ref={approveButton} type="button" onClick={() => onDecision('approve')} disabled={saving}>
                    <CheckCircle2 aria-hidden="true" />进入批准确认
                  </Button>
                </>
              ) : (
                <>
                  <Button type="button" variant="outline" onClick={() => onDecision(null)} disabled={saving}>返回查看</Button>
                  <Button type="button" onClick={onSubmit} disabled={saving}>
                    {saving ? '提交中…' : decision === 'approve' ? '确认批准建议' : '确认拒绝建议'}
                  </Button>
                </>
              )}
            </div>
          </div>
        }
      >
        {suggestion && <div className={styles.content}>
          <section className={styles.section} aria-label="AI 建议">
            <div className={styles.sectionHead}>
              <div className={styles.verdict}>
                <h3>模型建议</h3>
                <AdminStatusBadge tone={suggestion.suggestedRating === 'restricted' ? 'danger' : 'muted'}>
                  {suggestion.suggestedRating === 'restricted' ? '限制级' : '继续未标注'}
                </AdminStatusBadge>
              </div>
              <span className={styles.meta}>模型自报置信度 {Math.round(suggestion.confidence * 100)}%</span>
            </div>
            <p className={styles.reason}>{suggestion.reason || '未记录模型理由'}</p>
          </section>

          {decision && <section className={styles.confirmation} aria-label="审核确认" aria-busy={saving}>
            <div className={styles.sectionHead}>
              <h3>{decision === 'approve' ? '批准这条建议' : '拒绝这条建议'}</h3>
              {decision === 'approve' && suggestion.reason.trim() && <Button type="button" variant="ghost" size="sm" onClick={() => onReason(suggestion.reason.trim().slice(0, 500))} disabled={saving}>复用 AI 建议理由</Button>}
            </div>
            <p className={styles.hint}>{impact}</p>
            <FormField label={decision === 'approve' ? '批准理由' : '拒绝理由'} htmlFor="content-rating-ai-review-reason" hint="必填，最多 500 字。请写明人工核对后的判断依据。" error={error}>
              <Textarea
                ref={reasonInputRef}
                id="content-rating-ai-review-reason"
                value={reason}
                onChange={event => onReason(event.target.value)}
                placeholder={decision === 'approve' ? '说明元数据与正文证据为何支持这次人工确认。' : '说明证据不足、误判风险或不采纳的原因。'}
                rows={3}
                maxLength={500}
                disabled={saving}
                className={styles.reasonInput}
              />
            </FormField>
          </section>}

          <section className={styles.section} aria-label="模型提取的证据">
            <MotionDetails className={styles.disclosure} open>
              <summary><span className={styles.disclosureHeading}>模型提取的证据 <span className={styles.meta}>{suggestion.evidence.length} 条</span></span><ChevronDown aria-hidden="true" /></summary>
              {suggestion.evidence.length > 0 ? <ol className={styles.evidence}>
                {suggestion.evidence.map((item, index) => <li key={`${item.type}-${item.field || ''}-${index}`}>
                  <span className={styles.evidenceField}>{evidenceField(item)}</span>
                  <div><p>{item.value || item.rule || '未记录证据内容'}</p>{item.rule && item.value && <span className={styles.meta}>规则：{item.rule}</span>}</div>
                </li>)}
              </ol> : <p className={styles.hint}>未附模型证据，请核对元数据与原文。</p>}
            </MotionDetails>
          </section>

          <BodySamples body={suggestion.inputSnapshot.body} />

          <MotionDetails className={styles.disclosure}>
            <summary><span>审核口径与模型信息</span><ChevronDown aria-hidden="true" /></summary>
            <p className={styles.hint}>模型建议经人工确认才会生效。批准“继续未标注”不会将作品标为一般；作品或建议已变化时，须重新加载后审核。</p>
            <dl className={styles.metadata}>
              <div><dt>模型</dt><dd>{suggestion.model || '未记录'}</dd></div>
              <div><dt>提示版本</dt><dd>{suggestion.promptVersion || '未记录'}</dd></div>
              <div><dt>作品修订</dt><dd>{suggestion.novelRevision}</dd></div>
            </dl>
          </MotionDetails>
        </div>}
      </ReadingDialog>
    </Dialog>
  )
}
