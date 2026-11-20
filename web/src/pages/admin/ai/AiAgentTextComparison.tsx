import { useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { compareAgentText } from './agent-text-diff'
import type { AgentTextComparisonControls } from './useAgentTextComparison'
import styles from './agent-text-comparison.module.css'

/** Both suggestion review and final adoption compare the exact saved source texts. */
export default function AiAgentTextComparison({ before, after, controls, beforeLabel = '原文', afterLabel = '改写后' }: {
  before?: string
  after?: string
  beforeLabel?: string
  afterLabel?: string
  controls: AgentTextComparisonControls
}) {
  const { side, onlyChanges } = controls
  const differences = useMemo(() => before !== undefined && after !== undefined ? compareAgentText(before, after) : [], [before, after])
  if (before === undefined && after === undefined) return null
  if (before === undefined || after === undefined) return <section className={styles.single} aria-label={before === undefined ? afterLabel : beforeLabel}>
    <h4>{before === undefined ? afterLabel : beforeLabel}</h4>
    <div className={styles.prose}>{(before === undefined ? after : before) || '内容为空。'}</div>
  </section>
  const hasChanges = before !== after
  return <div className={styles.comparison}>
    <div className={styles.diff} data-side={side}>
      <div className={styles.columnHeadings} aria-hidden="true"><span>{beforeLabel}</span><span>{afterLabel}</span></div>
      {differences.filter(part => !onlyChanges || part.kind !== 'equal').map((part, index) => <div className={styles.diffRow} data-kind={part.kind} key={index}>
        <section className={styles.diffCell} data-side="before" aria-label={`${beforeLabel}段落`}>
          {part.kind === 'equal' ? <span>{part.before}</span> : part.before ? <><span className={styles.changeLabel}>{part.kind === 'removed' ? '删去' : '原文改动'}</span><del>{part.before}</del></> : <span className={styles.placeholder}>此处无原文</span>}
        </section>
        <section className={styles.diffCell} data-side="after" aria-label={`${afterLabel}段落`}>
          {part.kind === 'equal' ? <span>{part.after}</span> : part.after ? <><span className={styles.changeLabel}>{part.kind === 'added' ? '新增' : '新版改动'}</span><ins>{part.after}</ins></> : <span className={styles.placeholder}>此处无新版内容</span>}
        </section>
      </div>)}
      {onlyChanges && !hasChanges && <p className={styles.placeholder}>没有需要对照的改动。</p>}
    </div>
  </div>
}

export function AiAgentTextComparisonToolbar({ controls, hasChanges, beforeLabel = '原文', afterLabel = '改写后' }: {
  controls: AgentTextComparisonControls
  hasChanges: boolean
  beforeLabel?: string
  afterLabel?: string
}) {
  const { side, setSide, onlyChanges, setOnlyChanges } = controls
  return <div className={styles.toolbar} role="group" aria-label="对照工具">
    <label className={styles.filter}><Checkbox checked={onlyChanges} onCheckedChange={value => setOnlyChanges(value === true)} />只看改动</label>
    <div className={styles.mobileVersions} role="group" aria-label="选择对比版本">
      <Button variant="ghost" size="sm" aria-pressed={side === 'before'} onClick={() => setSide('before')}>{beforeLabel}</Button>
      <Button variant="ghost" size="sm" aria-pressed={side === 'after'} onClick={() => setSide('after')}>{afterLabel}</Button>
    </div>
    <span className={styles.legend}>{hasChanges ? <><span><i className={styles.beforeSwatch} aria-hidden="true" />原文变动</span><span><i className={styles.afterSwatch} aria-hidden="true" />新版变动</span></> : '两版内容一致'}</span>
  </div>
}
