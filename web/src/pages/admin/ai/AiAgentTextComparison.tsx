import { useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { compareAgentText } from './agent-text-diff'
import type { AgentTextComparisonControls } from './useAgentTextComparison'
import styles from './agent-text-comparison.module.css'

export interface AgentTextSelectionControls {
  acceptedChanges: number[]
  total: number
  disabled: boolean
  onChange: (acceptedChanges: number[]) => void
}

/** Both suggestion review and final adoption compare the exact saved source texts. */
export default function AiAgentTextComparison({ before, after, controls, selection, beforeLabel = '原文', afterLabel = '改写后' }: {
  before?: string
  after?: string
  beforeLabel?: string
  afterLabel?: string
  controls: AgentTextComparisonControls
  selection?: AgentTextSelectionControls
}) {
  const { side, onlyChanges } = controls
  const differences = useMemo(() => before !== undefined && after !== undefined ? compareAgentText(before, after) : [], [before, after])
  if (before === undefined && after === undefined) return null
  if (before === undefined || after === undefined) return <section className={styles.single} aria-label={before === undefined ? afterLabel : beforeLabel}>
    <h4>{before === undefined ? afterLabel : beforeLabel}</h4>
    <div className={styles.prose}>{(before === undefined ? after : before) || '内容为空。'}</div>
  </section>
  const hasChanges = before !== after
  let change = 0
  const rows = differences.map(part => ({ part, index: part.kind === 'equal' ? -1 : change++ }))
  return <div className={styles.comparison}>
    <div className={styles.diff} data-side={side}>
      <div className={styles.columnHeadings} aria-hidden="true"><span>{beforeLabel}</span><span>{afterLabel}</span></div>
      {rows.filter(({ part }) => !onlyChanges || part.kind !== 'equal').map(({ part, index }, row) => <div className={styles.diffRow} data-kind={part.kind} data-kept={selection && index >= 0 && !selection.acceptedChanges.includes(index) || undefined} key={row}>
        {selection && index >= 0 && <label className={styles.choice}>
          <Checkbox checked={selection.acceptedChanges.includes(index)} disabled={selection.disabled}
            onCheckedChange={checked => selection.onChange(checked === true
              ? [...selection.acceptedChanges, index].sort((a, b) => a - b)
              : selection.acceptedChanges.filter(value => value !== index))} />
          <span>采用第 {index + 1} 处改动</span>
          <span className={styles.choiceStatus}>{selection.acceptedChanges.includes(index) ? '采用新版' : '保留原文'}</span>
        </label>}
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

export function AiAgentTextComparisonToolbar({ controls, hasChanges, selection, beforeLabel = '原文', afterLabel = '改写后' }: {
  controls: AgentTextComparisonControls
  hasChanges: boolean
  selection?: AgentTextSelectionControls
  beforeLabel?: string
  afterLabel?: string
}) {
  const { side, setSide, onlyChanges, setOnlyChanges } = controls
  return <div className={styles.toolbar} role="group" aria-label="对照工具">
    {selection && <div className={styles.selectionTools}>
      <span role="status">采用 {selection.acceptedChanges.length} / {selection.total} 处改动，未选处保留原文</span>
      <div>
        <Button variant="ghost" size="sm" disabled={selection.disabled || selection.acceptedChanges.length === selection.total}
          onClick={() => selection.onChange(Array.from({ length: selection.total }, (_, index) => index))}>全部采用</Button>
        <Button variant="ghost" size="sm" disabled={selection.disabled || !selection.acceptedChanges.length}
          onClick={() => selection.onChange([])}>全部保留原文</Button>
      </div>
    </div>}
    <label className={styles.filter}><Checkbox checked={onlyChanges} onCheckedChange={value => setOnlyChanges(value === true)} />只看改动</label>
    <div className={styles.mobileVersions} role="group" aria-label="选择对比版本">
      <Button variant="ghost" size="sm" aria-pressed={side === 'before'} onClick={() => setSide('before')}>{beforeLabel}</Button>
      <Button variant="ghost" size="sm" aria-pressed={side === 'after'} onClick={() => setSide('after')}>{afterLabel}</Button>
    </div>
    <span className={styles.legend}>{hasChanges ? <><span><i className={styles.beforeSwatch} aria-hidden="true" />原文变动</span><span><i className={styles.afterSwatch} aria-hidden="true" />新版变动</span></> : '两版内容一致'}</span>
  </div>
}
