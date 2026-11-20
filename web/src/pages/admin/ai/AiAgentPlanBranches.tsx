import { useEffect, useRef, useState } from 'react'
import { AGENT_PLAN_BRANCH_LIMIT, AGENT_PLAN_BRANCH_NAME_LIMIT, type AgentChapterPlan, type AgentChapterPlanBranchState } from '@shared/ai-agent'
import { agentApi } from '@/lib/ai-agent-api'
import { newOperationId, type ApiError } from '@/lib/api'
import { getAdminTableRowStaggerDelay } from '@/lib/admin-table-motion'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { MotionView } from '@/components/ui/motion'
import FormField from '@/components/shared/FormField'
import EmptyState from '@/components/shared/EmptyState'
import { InlineError, LoadingState } from '@/components/shared/AsyncStates'
import { ReadingDialog } from '@/components/shared/ReadingDialog'
import { chapterPlanFields, chapterPlanLabels } from './agent-chapter-plan-fields'
import styles from './agent-plan-branches.module.css'

type Pending = { kind: 'save'; name: string; expectedRevision: number; operationId: string }
  | { kind: 'select'; branchId: string; expectedRevision: number; operationId: string }
  | { kind: 'remove'; branchId: string }
const labels = { ...chapterPlanLabels, targetWords: '目标字数' }
const fields = [...chapterPlanFields, 'targetWords'] as const
const failure = (e: unknown) => e instanceof Error ? e.message : '分支操作失败，请重试'

export default function AiAgentPlanBranches({ sessionId, disabled, onBusyChange, onBack, onChanged, onSelected }: {
  sessionId: string
  disabled: boolean
  onBusyChange: (busy: boolean) => void
  onBack: () => void
  onChanged: (plan: AgentChapterPlan | null) => void
  onSelected: () => void
}) {
  const [data, setData] = useState<AgentChapterPlanBranchState | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [onlyChanges, setOnlyChanges] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [pending, setPending] = useState<Pending | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const alive = useRef(true)
  const locked = useRef(false)
  const generation = useRef(0)
  async function load() {
    const request = ++generation.current
    setLoading(true)
    setError('')
    setRemoving(false)
    try {
      const result = await agentApi.planBranches(sessionId)
      if (!alive.current || request !== generation.current) return
      setData(result)
      setSelectedId(id => result.branches.some(branch => branch.id === id) ? id : result.branches[0]?.id || '')
    } catch (e) {
      if (alive.current && request === generation.current) setError(failure(e))
    } finally {
      if (alive.current && request === generation.current) setLoading(false)
    }
  }
  useEffect(() => {
    alive.current = true
    const request = ++generation.current
    agentApi.planBranches(sessionId).then(result => {
      if (!alive.current || generation.current !== request) return
      setData(result)
      setSelectedId(result.branches[0]?.id || '')
    }).catch(e => {
      if (alive.current && generation.current === request) setError(failure(e))
    }).finally(() => {
      if (alive.current && generation.current === request) setLoading(false)
    })
    return () => { alive.current = false }
  }, [sessionId])
  const selected = data?.branches.find(branch => branch.id === selectedId)
  const current = data?.plan
  const same = !!current && !!selected && fields.every(key => current[key] === selected.plan[key])
  const blocked = disabled || loading || busy || !!pending

  async function execute(request: Pending) {
    if (locked.current || disabled || loading) return
    locked.current = true
    setBusy(true)
    onBusyChange(true)
    setPending(request)
    setError('')
    setNotice('')
    try {
      const result = request.kind === 'save' ? await agentApi.savePlanBranch(sessionId, request.name, request.expectedRevision, request.operationId)
        : request.kind === 'select' ? await agentApi.selectPlanBranch(sessionId, request.branchId, request.expectedRevision, request.operationId)
          : await agentApi.removePlanBranch(sessionId, request.branchId)
      if (!alive.current) return
      setData(result)
      setPending(null)
      setRemoving(false)
      onChanged(result.plan)
      if (request.kind === 'save') {
        setName('')
        setSelectedId(result.branches.find(branch => branch.name === request.name)?.id || '')
        setNotice('分支已保存。你可以返回当前计划，编辑或请助手完善另一种走向，再来对比。')
      } else if (request.kind === 'select') onSelected()
      else {
        setSelectedId(result.branches[0]?.id || '')
        setNotice('分支已移除，当前计划和已提交的草稿任务保留。')
      }
    } catch (e) {
      if (!alive.current) return
      setError(failure(e))
      const status = (e as ApiError | null)?.status
      if (status && status >= 400 && status < 500 && status !== 408 && status !== 429) setPending(null)
    } finally {
      locked.current = false
      if (alive.current) setBusy(false)
      onBusyChange(false)
    }
  }
  const rows = fields.filter(key => !onlyChanges || !current || !selected || current[key] !== selected.plan[key])
  return <ReadingDialog title="剧情分支对比" description="先保存一种走向，再返回编辑或请助手完善另一种走向。选定分支后会设为当前计划，仍需另行确认写作。"
    footer={<div className={styles.actions}>
      <Button variant="ghost" disabled={busy} onClick={() => { if (data) onChanged(data.plan); onBack() }}>返回当前计划</Button>
      {selected && <>
        <Button variant="ghost" disabled={blocked} onClick={() => setRemoving(true)}>移除分支</Button>
        <Button disabled={blocked || same || !current || removing} onClick={() => void execute({ kind: 'select', branchId: selected.id, expectedRevision: current!.revision, operationId: newOperationId('plan-branch') })}>设为当前计划</Button>
      </>}
    </div>}>
    <div className={styles.root} aria-busy={loading || busy}>
      {error && <InlineError message={error} onRetry={busy || loading || (pending && disabled) ? undefined : pending ? () => void execute(pending) : () => void load()}>
        {pending && <span>请求结果尚未确认；重试会沿用同一次操作。</span>}
      </InlineError>}
      {loading && <LoadingState label="正在读取章节分支" rows={3} />}
      {data && <>
        <section className={styles.save} aria-label="保存当前走向">
          <p>当前计划{current ? ' · 第 ' + current.revision + ' 版《' + current.title + '》' : '尚未保存'} · 分支 {data.branches.length}/{AGENT_PLAN_BRANCH_LIMIT}</p>
          <div className={styles.saveRow}>
            <FormField label="分支名称" hint="例如：独自赴约、向同伴求助。保存当前已保存的完整计划。">
              <Input value={name} maxLength={AGENT_PLAN_BRANCH_NAME_LIMIT} disabled={blocked || !current} onChange={e => setName(e.target.value)} />
            </FormField>
            <Button variant="outline" disabled={blocked || !current || !name.trim() || data.branches.length >= AGENT_PLAN_BRANCH_LIMIT}
              onClick={() => void execute({ kind: 'save', name: name.trim(), expectedRevision: current!.revision, operationId: newOperationId('plan-branch') })}>保存当前计划为分支</Button>
          </div>
          {data.branches.length >= AGENT_PLAN_BRANCH_LIMIT && <p>分支已满。若当前走向尚未保留，切换前请先移除一个不需要的分支。</p>}
        </section>
        {notice && <p role="status">{notice}</p>}
        {!data.branches.length ? <EmptyState message="还没有保存的分支" hint="先保存当前走向，再尝试另一种情节发展。" /> : <>
          <ul className={styles.branches} aria-label="已保存的剧情分支">
            {data.branches.map((branch, index) => <li key={branch.id} className={styles.branch} style={{ animationDelay: getAdminTableRowStaggerDelay(index, data.branches.length) + 'ms' }}>
              <Button variant={branch.id === selectedId ? 'secondary' : 'outline'} aria-pressed={branch.id === selectedId} disabled={busy || !!pending || loading} onClick={() => { setSelectedId(branch.id); setRemoving(false) }}>{branch.name}</Button>
              <span>保存自第 {branch.plan.revision} 版{branch.source === 'switch' ? ' · 切换前保留' : ''}</span>
            </li>)}
          </ul>
          {selected && <>
            <div className={styles.compareHeading}>
              <p>当前计划与「{selected.name}」</p>
              <label className={styles.filter}><Checkbox checked={onlyChanges} onCheckedChange={value => setOnlyChanges(value === true)} />只看不同</label>
            </div>
            <MotionView motionKey={selected.id + ':' + onlyChanges} className={styles.comparison}>
              {rows.length ? rows.map(key => <section key={key} className={styles.field} aria-label={labels[key] + '对比'}>
                <h3>{labels[key]} <span>{current && current[key] === selected.plan[key] ? '相同' : '不同'}</span></h3>
                <dl className={styles.columns}>
                  <div><dt>当前计划</dt><dd>{current?.[key] || '尚未决定'}</dd></div>
                  <div><dt>{selected.name}</dt><dd>{selected.plan[key] || '尚未决定'}</dd></div>
                </dl>
              </section>) : <p>这个分支与当前计划的内容相同。</p>}
            </MotionView>
            <p className={styles.note}>切换只更新当前计划；如果当前走向尚未保留，会先自动保存为一个分支。已提交的草稿任务继续使用提交时的计划。</p>
            {removing && <div className={styles.confirm} role="group" aria-label="移除分支确认">
              <p>移除「{selected.name}」后无法恢复这份分支记录。当前计划和已提交的草稿任务仍会保留。</p>
              <div className={styles.actions}><Button variant="ghost" disabled={busy} onClick={() => setRemoving(false)}>取消</Button>
                <Button variant="destructive" disabled={blocked} onClick={() => void execute({ kind: 'remove', branchId: selected.id })}>确认移除</Button></div>
            </div>}
          </>}
        </>}
      </>}
    </div>
  </ReadingDialog>
}
