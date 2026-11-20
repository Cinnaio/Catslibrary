import { useState } from 'react'
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
  onAdopt: () => void
}

export default function AiAgentTextReview({ title, before, after, status, actionLabel, busy, warning, onDiscuss, onAdopt }: Props) {
  const [compareOpen, setCompareOpen] = useState(false)
  const [side, setSide] = useState('after')
  const comparison = useAgentTextComparisonControls()
  function adoptFromComparison() {
    setCompareOpen(false)
    onAdopt()
  }
  return (
    <section className={styles.review} aria-label="改写建议阅读">
      <header className={styles.heading}>
        <h4>{title}</h4>
        <p role="status">{status}</p>
        {warning && <p className={styles.warning}>{warning}</p>}
      </header>
      <Tabs className={styles.readingTabs} value={side} onValueChange={setSide}>
        <div className={styles.toolbar}>
          <TabsList aria-label="选择阅读版本">
            <TabsTrigger value="after">改写后</TabsTrigger>
            <TabsTrigger value="before">原文</TabsTrigger>
          </TabsList>
          <Dialog open={compareOpen} onOpenChange={setCompareOpen}>
            <DialogTrigger asChild>
              <Button variant="ghost" size="sm"><ArrowLeftRight size={14} aria-hidden="true" />查看差异</Button>
            </DialogTrigger>
            <ReadingDialog
              className={styles.comparisonDialog}
              title={title + ' · 改写对比'}
              description="按段落对照原文与新版，改动处以底色和文字标记。确认采纳后才更新对应正文。"
              bodyLabel="原文与改写后正文对比"
              toolbar={<AiAgentTextComparisonToolbar controls={comparison} hasChanges={before !== after} />}
              footer={<div className={styles.actions}>
                <Button variant="ghost" onClick={() => setCompareOpen(false)}>返回阅读</Button>
                <Button disabled={busy} onClick={adoptFromComparison}>{actionLabel}</Button>
              </div>}
            >
              <AiAgentTextComparison before={before} after={after} controls={comparison} />
            </ReadingDialog>
          </Dialog>
        </div>
        <TabsContent value="after" className={styles.reader} tabIndex={0}><div className={styles.prose}>{after || '新版内容为空。'}</div></TabsContent>
        <TabsContent value="before" className={styles.reader} tabIndex={0}><div className={styles.prose}>{before || '原文内容为空。'}</div></TabsContent>
      </Tabs>
      <footer className={styles.actions}>
        <Button variant="ghost" size="sm" onClick={onDiscuss}>继续调整</Button>
        <Button size="sm" disabled={busy} onClick={onAdopt}>{actionLabel}</Button>
      </footer>
    </section>
  )
}
