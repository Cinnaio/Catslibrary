import { useMemo, useState } from 'react'
import type { AgentRewriteSelection } from '@shared/ai-agent'
import { compareAgentText, mergeAgentText } from './agent-text-diff'
import { ArrowLeftRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogTrigger } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ReadingDialog } from '@/components/shared/ReadingDialog'
import AiAgentTextComparison, { AiAgentTextComparisonToolbar } from './AiAgentTextComparison'
import { useAgentTextComparisonControls } from './useAgentTextComparison'
import styles from './agent-text-review.module.css'

interface Props {
  title: string
  before: string
  after: string
  status: string
  actionLabel: string
  busy: boolean
  warning?: string
  onDiscuss: () => void
  selectionRevision?: string
  savedSelection?: AgentRewriteSelection
  selectionLocked?: boolean
  onAdopt: (selection?: AgentRewriteSelection) => void
}

export default function AiAgentTextReview({ title, before, after, status, actionLabel, busy, warning, selectionRevision, savedSelection, selectionLocked = false, onDiscuss, onAdopt }: Props) {
  const [compareOpen, setCompareOpen] = useState(false)
  const [side, setSide] = useState('after')
  const comparison = useAgentTextComparisonControls()
  const differences = useMemo(() => compareAgentText(before, after), [before, after])
  const allChanges = useMemo(() => differences.filter(part => part.kind !== 'equal').map((_, index) => index), [differences])
  const [choice, setChoice] = useState<AgentRewriteSelection | null>(null)
  const saved = savedSelection?.revision === selectionRevision ? savedSelection : undefined
  const acceptedChanges = (selectionLocked ? saved : choice?.revision === selectionRevision ? choice : saved)?.acceptedChanges ?? allChanges
  const selection = selectionRevision ? {
    total: allChanges.length, acceptedChanges, disabled: busy || selectionLocked,
    onChange: (indexes: number[]) => setChoice({ version: 1, revision: selectionRevision, acceptedChanges: indexes }),
  } : undefined
  const merged = useMemo(() => selectionRevision ? mergeAgentText(differences, acceptedChanges) : after, [selectionRevision, differences, acceptedChanges, after])
  const partial = !!selection && acceptedChanges.length < allChanges.length
  const adoptDisabled = busy || (!selectionLocked && !!selection && merged === before)
  const adoptLabel = selection && !selectionLocked ? '预览所选结果' : actionLabel
  function adoptFromComparison() {
    if (adoptDisabled) return
    setCompareOpen(false)
    if (selectionRevision && !selectionLocked) onAdopt({ version: 1, revision: selectionRevision, acceptedChanges })
    else onAdopt()
  }
  return (
    <section className={styles.review} aria-label="改写建议阅读">
      <header className={styles.heading}>
        <h4>{title}</h4>
        <p role="status">{status}</p>
        {selection && <p role="status">采用 {acceptedChanges.length} / {allChanges.length} 处改动{partial ? ' · 未选处保留原文' : ''}</p>}
        {warning && <p className={styles.warning}>{warning}</p>}
      </header>
      <Tabs className={styles.readingTabs} value={side} onValueChange={setSide}>
        <div className={styles.toolbar}>
          <TabsList aria-label="选择阅读版本">
            <TabsTrigger value="after">{partial ? '合并结果' : '改写后'}</TabsTrigger>
            <TabsTrigger value="before">原文</TabsTrigger>
          </TabsList>
          <Dialog open={compareOpen} onOpenChange={setCompareOpen}>
            <DialogTrigger asChild>
              <Button variant="ghost" size="sm"><ArrowLeftRight size={14} aria-hidden="true" />查看差异</Button>
            </DialogTrigger>
            <ReadingDialog
              className={styles.comparisonDialog}
              title={title + ' · 改写对比'}
              description={selection ? "勾选采用的改动，未选处保留原文。无法逐段对应的改动会合并显示；先预览合并结果，再确认保存。" : "按段落对照原文与新版，改动处以底色和文字标记。确认采纳后才更新对应正文。"}
              bodyLabel="原文与改写后正文对比"
              toolbar={<AiAgentTextComparisonToolbar controls={comparison} selection={selection} hasChanges={before !== after} />}
              footer={<div className={styles.actions}>
                <Button variant="ghost" onClick={() => setCompareOpen(false)}>返回阅读</Button>
                <Button disabled={adoptDisabled} onClick={adoptFromComparison}>{adoptLabel}</Button>
              </div>}
            >
              <AiAgentTextComparison before={before} after={after} controls={comparison} selection={selection} />
            </ReadingDialog>
          </Dialog>
        </div>
        <TabsContent value="after" className={styles.reader} tabIndex={0}><div className={styles.prose}>{merged || '新版内容为空。'}</div></TabsContent>
        <TabsContent value="before" className={styles.reader} tabIndex={0}><div className={styles.prose}>{before || '原文内容为空。'}</div></TabsContent>
      </Tabs>
      <footer className={styles.actions}>
        <Button variant="ghost" size="sm" onClick={onDiscuss}>继续调整</Button>
        <Button size="sm" disabled={adoptDisabled} onClick={adoptFromComparison}>{adoptLabel}</Button>
      </footer>
    </section>
  )
}
