import { MotionDetails, MotionPresence } from '@/components/ui/motion'
import { useState } from 'react'
import { AlertCircle, ChevronDown } from 'lucide-react'
import type { SecurityOverview } from '@shared/security'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import AdminStatusBadge from '@/components/admin/AdminStatusBadge'
import { AdminDataPanel } from '@/components/admin/AdminDataPanel'
import { getAdminTableRowStaggerDelay } from '@/lib/admin-table-motion'
import { PanelHeading } from '@/components/shared/PanelHeading'
import FormField from '@/components/shared/FormField'
import EmptyState from '@/components/shared/EmptyState'
import { securityDate } from './security-center-format'
import styles from './security-center.module.css'

interface Props {
  overview: SecurityOverview
  dirty: boolean
  busy: boolean
  reconcile: { daily: number; monthly: number }
  onReconcileChange: (value: Props['reconcile']) => void
  onReconcile: () => void
  onPause: () => void
  onView: (view: 'mail' | 'events' | 'service' | 'policy') => void
}

export default function SecurityOverviewPanel({ overview: o, dirty, busy, reconcile, onReconcileChange, onReconcile, onPause, onView }: Props) {
  const [reconcileOpen, setReconcileOpen] = useState(false)
  const expanded = reconcileOpen || o.restoreHold
  const invalidReconcile =
    !Number.isSafeInteger(reconcile.daily) ||
    !Number.isSafeInteger(reconcile.monthly) ||
    reconcile.daily < o.today ||
    reconcile.monthly < o.month ||
    reconcile.monthly < reconcile.daily
  return (
    <div className={styles.workspace}>
      {o.alerts.length > 0 && (
        <Card>
          <PanelHeading title="需要关注" status={<AdminStatusBadge tone="warning">{o.alerts.length} 项</AdminStatusBadge>} />
          <CardContent className={styles.panelBody}>
            <ul className={styles.alerts}>
              {o.alerts.map((a) => (
                <li key={a.code} data-severity={a.severity}>
                  <AlertCircle size={16} aria-hidden="true" />
                  <span>{a.message}</span>
                  {['unknown', 'delivery', 'mail', 'challenge', 'paused'].includes(a.code) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onView(a.code === 'mail' ? 'service' : ['challenge', 'paused'].includes(a.code) ? 'policy' : 'mail')}
                    >
                      查看{a.code === 'mail' ? '服务' : ['challenge', 'paused'].includes(a.code) ? '策略' : '记录'}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      <div className={styles.columns}>
        <Card>
          <PanelHeading title="邮件用量" description="包含待发预占和结果未知的消耗，按 UTC 自然日、月重置。" />
          <CardContent className={styles.panelBody}>
            <dl className={styles.status}>
              {[
                { label: '今日额度', used: o.today, total: o.policy.daily, ordinary: o.ordinaryToday, reserve: o.policy.reserveDaily },
                { label: '本月额度', used: o.month, total: o.policy.monthly, ordinary: o.ordinaryMonth, reserve: o.policy.reserveMonthly },
              ].map((item) => (
                <div key={item.label}>
                  <dt>{item.label}</dt>
                  <dd>
                    {item.used.toLocaleString()} / {item.total.toLocaleString()} 封
                    <span className={styles.hint}>
                      普通额度 {item.ordinary} / {item.total - item.reserve}，应急预留 {item.reserve} 封
                    </span>
                  </dd>
                </div>
              ))}
              {[
                ['等待发送', `${o.queued} 封`],
                ['结果待核实', `${o.unknown} 封`],
                ['近一天失败或退信', `${o.failed} 封`],
                ['近一天已拦截', `${o.blocked} 次`],
                ['近一天已受理', `${o.accepted} 封`],
                ['近一天确认投递', `${o.delivered} 封`],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            <p className={styles.hint}>
              本站统计不代表服务商剩余额度。下次日重置：{securityDate(o.nextResetAt)}。确认投递表示收件服务器接收，不代表用户已阅读。
            </p>
            <div className={styles.sectionActions}>
              <Button variant="ghost" onClick={() => onView('events')}>
                查看风控事件
              </Button>
              <Button variant="secondary" onClick={() => onView('mail')}>
                查看邮件记录
              </Button>
            </div>
          </CardContent>
        </Card>
        <Card>
          <PanelHeading
            title="服务状态"
            status={<AdminStatusBadge tone={o.policy.paused ? 'warning' : 'neutral'}>{o.policy.paused ? '已暂停' : '按策略发送'}</AdminStatusBadge>}
          />
          <CardContent className={styles.panelBody}>
            <dl className={styles.status}>
              <div>
                <dt>投递方式</dt>
                <dd>{o.policy.transport === 'resend' ? 'Resend API' : 'SMTP'}</dd>
              </div>
              {[
                ['邮件服务', o.mailReady],
                ['队列加密', o.encryptionReady],
                ['人机验证', o.turnstileReady],
                ['回调签名', o.webhookReady],
              ].map(([label, ready]) => (
                <div key={String(label)}>
                  <dt>{label}</dt>
                  <dd>{ready ? '已配置' : '未配置'}</dd>
                </div>
              ))}
              <div>
                <dt>最近工作心跳</dt>
                <dd>{securityDate(o.workerAt)}</dd>
              </div>
              <div>
                <dt>最近投递回调</dt>
                <dd>{securityDate(o.lastWebhookAt)}</dd>
              </div>
            </dl>
            {!o.alerts.length && <p className={styles.hint}>当前没有需要处理的告警。</p>}
            {dirty && <p className={styles.hint}>请先保存或撤销防护策略草稿，再切换发送状态。</p>}
            <div className={styles.sectionActions}>
              <Button variant="secondary" disabled={dirty || busy} onClick={onPause}>
                {o.policy.paused ? '恢复发送' : '暂停发送'}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
      <Card>
        <PanelHeading
          title="核对外部用量"
          description="共享服务商额度或恢复备份后，手动补齐本站账本。"
          actions={
            <Button
              variant="ghost"
              aria-expanded={expanded}
              aria-controls="security-budget-reconcile"
              disabled={o.restoreHold}
              onClick={() => setReconcileOpen(!expanded)}
            >
              {expanded ? '收起' : '展开核对'}
              <ChevronDown className={styles.chevron} data-open={expanded} size={14} aria-hidden="true" />
            </Button>
          }
        />
        <MotionPresence asChild open={expanded} mode="disclosure" keepMounted><CardContent id="security-budget-reconcile"  className={styles.panelBody}>
          <form
            className={styles.stack}
            onSubmit={(e) => {
              e.preventDefault()
              if (!invalidReconcile) onReconcile()
            }}
          >
            <p className={styles.hint}>先核对服务商控制台，再录入包含待发与结果未知任务的保守总量。只能上调，记录后仍需手动恢复发送。</p>
            <div className={styles.fields}>
              <FormField label="今日已用与预占" hint={`当前账本 ${o.today} 封，不可下调。`}>
                {({ id }) => (
                  <Input
                    id={id}
                    type="number"
                    required
                    min={o.today}
                    step={1}
                    value={reconcile.daily}
                    onChange={(e) => onReconcileChange({ ...reconcile, daily: Number(e.target.value) })}
                  />
                )}
              </FormField>
              <FormField label="本月已用与预占" hint={`当前账本 ${o.month} 封，应不小于今日总量。`}>
                {({ id }) => (
                  <Input
                    id={id}
                    type="number"
                    required
                    min={Math.max(o.month, reconcile.daily)}
                    step={1}
                    value={reconcile.monthly}
                    onChange={(e) => onReconcileChange({ ...reconcile, monthly: Number(e.target.value) })}
                  />
                )}
              </FormField>
            </div>
            {invalidReconcile && (
              <p className={styles.fieldError} role="status">
                请输入不低于当前账本的整数，本月总量不能少于今日总量。
              </p>
            )}
            <div className={styles.sectionActions}>
              <Button type="submit" variant="secondary" disabled={busy || invalidReconcile}>
                记录核对结果
              </Button>
            </div>
          </form>
        </CardContent></MotionPresence>
      </Card>
      <MotionDetails className={styles.disclosure}>
        <summary>
          近两周邮件申请
          <ChevronDown size={14} aria-hidden="true" />
        </summary>
        <div className={styles.disclosureBody}>
          {o.trend.length ? (
            <AdminDataPanel
              ariaLabel="近两周邮件申请"
              columns={[
                { key: 'day', label: '申请日期', primary: true },
                { key: 'sent', label: '邮件数量' },
                { key: 'failed', label: '失败与退信' },
              ]}
              density="comfortable"
            >
              <Table className="admin-data-table admin-data-table--animated">
                <TableCaption className="sr-only">按申请日期统计，失败包含退信。</TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">申请日期</TableHead>
                    <TableHead scope="col">邮件数量</TableHead>
                    <TableHead scope="col">失败与退信</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {o.trend.map((row, index) => (
                    <TableRow key={row.day} style={{ animationDelay: `${getAdminTableRowStaggerDelay(index, o.trend.length)}ms` }}>
                      <TableCell data-primary data-label="申请日期">
                        {row.day}
                      </TableCell>
                      <TableCell data-label="邮件数量">{row.sent} 封</TableCell>
                      <TableCell data-label="失败与退信">{row.failed} 封</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </AdminDataPanel>
          ) : (
            <EmptyState message="还没有邮件申请" hint="发生邮件申请后，这里将显示近两周的记录。" />
          )}
        </div>
      </MotionDetails>
    </div>
  )
}
