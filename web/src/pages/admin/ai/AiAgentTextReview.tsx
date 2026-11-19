import { useMemo, useState } from 'react'
import { ArrowLeftRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogTrigger } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ReadingDialog } from '@/components/shared/ReadingDialog'
import { compareAgentText } from './agent-text-diff'
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
  const [compareSide, setCompareSide] = useState('after')
  const [onlyChanges, setOnlyChanges] = useState(false)
  const differences = useMemo(() => compareOpen ? compareAgentText(before, after) : [], [compareOpen, before, after])
  const hasChanges = before !== after
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
              footer={<div className={styles.actions}>
                <Button variant="ghost" onClick={() => setCompareOpen(false)}>返回阅读</Button>
                <Button disabled={busy} onClick={adoptFromComparison}>{actionLabel}</Button>
              </div>}
            >
              <div className={styles.compareToolbar}>
                <label className={styles.filter}><Checkbox checked={onlyChanges} onCheckedChange={value => setOnlyChanges(value === true)} />只看改动</label>
                <div className={styles.mobileVersions} role="group" aria-label="选择对比版本">
                  <Button variant="ghost" size="sm" aria-pressed={compareSide === 'before'} onClick={() => setCompareSide('before')}>原文</Button>
                  <Button variant="ghost" size="sm" aria-pressed={compareSide === 'after'} onClick={() => setCompareSide('after')}>改写后</Button>
                </div>
                <span className={styles.legend}>{hasChanges ? '删去 / 原文改动　新增 / 新版改动' : '两版内容一致'}</span>
              </div>
              <div className={styles.diff} data-side={compareSide}>
                <div className={styles.columnHeadings} aria-hidden="true"><span>原文</span><span>改写后</span></div>
                {differences.filter(part => !onlyChanges || part.kind !== 'equal').map((part, index) => (
                  <div className={styles.diffRow} data-kind={part.kind} key={index}>
                    <section className={styles.diffCell} data-side="before" aria-label="原文段落">
                      {part.kind === 'equal' ? <span>{part.before}</span> : part.before ? <><span className={styles.changeLabel}>{part.kind === 'removed' ? '删去' : '原文改动'}</span><del>{part.before}</del></> : <span className={styles.placeholder}>此处无原文</span>}
                    </section>
                    <section className={styles.diffCell} data-side="after" aria-label="改写后段落">
                      {part.kind === 'equal' ? <span>{part.after}</span> : part.after ? <><span className={styles.changeLabel}>{part.kind === 'added' ? '新增' : '新版改动'}</span><ins>{part.after}</ins></> : <span className={styles.placeholder}>此处无新版内容</span>}
                    </section>
                  </div>
                ))}
                {onlyChanges && !hasChanges && <p className={styles.placeholder}>没有需要对照的改动。</p>}
              </div>
            </ReadingDialog>
          </Dialog>
        </div>
        <TabsContent value="after" className={styles.reader} tabIndex={0}><div className={styles.prose}>{after || '新版内容为空。'}</div></TabsContent>
        <TabsContent value="before" className={styles.reader} tabIndex={0}><div className={styles.prose}>{before || '原文内容为空。'}</div></TabsContent>
      </Tabs>
      <footer className={styles.actions}>
        <Button variant="outline" size="sm" onClick={onDiscuss}>继续调整</Button>
        <Button size="sm" disabled={busy} onClick={onAdopt}>{actionLabel}</Button>
      </footer>
    </section>
  )
}
