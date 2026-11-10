import { useState } from 'react'
import { Activity, Bell, ChevronDown, Clock3 } from 'lucide-react'
import type { AgentTurnUsage } from '@shared/ai-agent'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MotionDetails } from '@/components/ui/motion'
import FormField from '@/components/shared/FormField'
import { getStorageScope } from '@/lib/storage'
import styles from './agent-workspace.module.css'

const format = (count: number) => count.toLocaleString('zh-CN', { maximumFractionDigits: 6 })
const duration = (ms: number) => (ms < 60000 ? `${Math.floor(ms / 1000)} 秒` : `${Math.floor(ms / 60000)} 分 ${Math.floor(ms / 1000) % 60} 秒`)
function reminderKey() {
  const scope = getStorageScope()
  return scope.startsWith('user:') ? `agent-token-reminder:${scope}` : ''
}
function readReminder(key: string) {
  try {
    const value = Number(key ? localStorage.getItem(key) || 0 : 0)
    return Number.isSafeInteger(value) && value >= 0 && value <= 100000000 ? value : 0
  } catch {
    return 0
  }
}

export default function AiAgentUsage({ turns }: { turns: AgentTurnUsage[] }) {
  const key = reminderKey()
  return <UsageDetails key={key} turns={turns} storageKey={key} />
}

function UsageDetails({ turns, storageKey }: { turns: AgentTurnUsage[]; storageKey: string }) {
  const [threshold, setThreshold] = useState(() => readReminder(storageKey))
  const [draft, setDraft] = useState(() => (threshold ? String(threshold) : ''))
  const [error, setError] = useState('')
  const latest = turns[0]
  if (!latest) return null
  const reached = latest.tracked && threshold > 0 && latest.inputTokens + latest.outputTokens >= threshold
  return (
    <div className={styles.usage}>
      {reached && (
        <p role="status" className={styles.usageNotice}>
          本轮已记录 Token 达到 {format(threshold)} 的提醒值。此提醒不会自动停止任务；
          {['queued', 'running'].includes(latest.status) ? '可使用「停止回复」结束本轮。' : '本轮已结束。'}
        </p>
      )}
      <MotionDetails className={styles.settings}>
        <summary className={styles.settingsSummary}>
          <Activity size={15} className={styles.settingsIcon} aria-hidden="true" />
          <span className={styles.settingsTitle}>本轮用量</span>
          <span className={styles.settingsMeta}>{latest.tracked ? `已记账 ${latest.chatCalls + latest.summaryCalls} 次` : '旧轮次未关联用量'}</span>
          <span className={styles.usageDuration}>
            <Clock3 size={12} aria-hidden="true" />
            {duration(latest.elapsedMs)}
          </span>
          <ChevronDown size={14} className={styles.settingsChevron} aria-hidden="true" />
        </summary>
        <div className={styles.usageBody}>
          <div className={styles.usageOverview}>
            <UsageTurn turn={latest} index={0} />
            <p className={styles.muted}>
              仅含本对话的助手与摘要调用，不含独立草稿、封面和分析生成。按已保存记录更新，未回传或未保存的用量可能缺失，金额不是完整账单。
            </p>
            {turns.length > 1 && (
              <MotionDetails className={styles.usageHistory}>
                <summary>
                  之前的用量 <span>{turns.length - 1} 轮</span>
                  <ChevronDown size={14} aria-hidden="true" />
                </summary>
                <div className={styles.usageHistoryList}>
                  {turns.slice(1).map((turn, index) => (
                    <UsageTurn key={turn.taskId} turn={turn} index={index + 1} />
                  ))}
                </div>
              </MotionDetails>
            )}
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              if (reminderKey() !== storageKey) {
                setError('账号状态已变化，请刷新后设置提醒')
                return
              }
              const value = draft.trim() ? Number(draft) : 0
              if (!Number.isSafeInteger(value) || value < 0 || value > 100000000) {
                setError('请输入 0–100000000 的整数，留空关闭提醒')
                return
              }
              setThreshold(value)
              setError('')
              const key = reminderKey()
              try {
                if (key) localStorage.setItem(key, String(value))
              } catch {
                setError('提醒已在当前页面生效，浏览器未能保存设置')
              }
            }}
            className={styles.usageReminder}
          >
            <div className={styles.usageReminderHeading}>
              <Bell size={14} aria-hidden="true" />
              <strong>用量提醒</strong>
              <span className={styles.settingsState}>{threshold ? '已开启' : '已关闭'}</span>
            </div>
            <FormField label="单轮 Token 提醒值" hint="输入与输出累计达到此值时提醒；留空或 0 关闭。按当前账号保存在此浏览器。">
              <Input type="number" min={0} max={100000000} step={1} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="默认关闭" />
            </FormField>
            <div>
              <Button type="submit" variant="outline" size="sm">
                保存提醒
              </Button>
            </div>
            {error && (
              <p role="alert" className={styles.error}>
                {error}
              </p>
            )}
          </form>
        </div>
      </MotionDetails>
    </div>
  )
}

function UsageTurn({ turn, index }: { turn: AgentTurnUsage; index: number }) {
  return (
    <section className={styles.usageTurn} aria-label={index ? `之前第 ${index} 轮用量` : '本轮用量明细'}>
      <div className={styles.usageTurnHeading}>
        <strong>{index ? `之前第 ${index} 轮` : '本轮记录'}</strong>
        <span>历时 {duration(turn.elapsedMs)}</span>
      </div>
      {!turn.tracked ? (
        <p className={styles.muted}>旧轮次没有精确关联记录，无法按轮统计。</p>
      ) : (
        <>
          <dl className={styles.usageMetrics}>
            <div>
              <dt>已记录输入 Token</dt>
              <dd>{format(turn.inputTokens)}</dd>
            </div>
            <div>
              <dt>已记录输出 Token</dt>
              <dd>{format(turn.outputTokens)}</dd>
            </div>
            <div>
              <dt>已记录调用</dt>
              <dd>
                {format(turn.chatCalls + turn.summaryCalls)}
                <small>次</small>
              </dd>
            </div>
          </dl>
          <p className={styles.muted}>
            助手 {turn.chatCalls} 次 · 摘要 {turn.summaryCalls} 次
          </p>
          {!!turn.unknownTokenCalls && <p className={styles.muted}>{turn.unknownTokenCalls} 次调用未完整回传 Token，用量可能不完整。</p>}
          <dl className={styles.usageCost}>
            <dt>已回传费用</dt>
            <dd>{turn.costs.length ? turn.costs.map((cost) => `${cost.currency || '币种未提供'} ${format(cost.amount)}`).join('；') : '暂无'}</dd>
          </dl>
          {!!turn.unknownCostCalls && <p className={styles.muted}>{turn.unknownCostCalls} 次调用费用未知，不计为免费。</p>}
          {!turn.chatCalls && !turn.summaryCalls && <p className={styles.muted}>尚无已保存的调用用量，不能据此认定没有产生费用。</p>}
        </>
      )}
    </section>
  )
}
