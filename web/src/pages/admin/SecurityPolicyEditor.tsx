import type { FormEvent } from 'react'
import { SECURITY_ACTIONS, SECURITY_ACTION_LABELS, type SecurityPolicy } from '@shared/security'
import { DEFAULT_EMAIL_DOMAIN_POLICY, EMAIL_DOMAIN_LIST_LIMIT, parseEmailDomainList, type EmailDomainPolicy } from '@shared/email-domain-policy'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import AdminFloatingDock from '@/components/admin/AdminFloatingDock'
import AdminStatusBadge from '@/components/admin/AdminStatusBadge'
import FormField from '@/components/shared/FormField'
import { PanelHeading } from '@/components/shared/PanelHeading'
import styles from './security-center.module.css'

type NumericKey = { [K in keyof SecurityPolicy]: SecurityPolicy[K] extends number ? K : never }[keyof SecurityPolicy]
const groups: Array<{ title: string; description: string; fields: Array<[NumericKey, string, string]> }> = [
  {
    title: '全站邮件预算',
    description: '总预算包含应急预留，普通申请只能使用剩余部分。',
    fields: [
      ['daily', '每日总预算', '按 UTC 自然日重置'],
      ['monthly', '每月总预算', '按 UTC 自然月重置'],
      ['reserveDaily', '每日应急预留', '仅供管理员核实后的恢复操作'],
      ['reserveMonthly', '每月应急预留', '不能由匿名或普通申请使用'],
    ],
  },
  {
    title: '发送频率',
    description: '控制集中申请与重复发送，同一收件邮箱跨账号累计。',
    fields: [
      ['hourly', '普通发送每小时上限', '全站滚动一小时'],
      ['cooldownSeconds', '账号冷却秒数', '重复申请合并，保留有效链接'],
      ['accountQuarterHour', '账号每 15 分钟上限', '同一账号跨来源累计'],
      ['accountDaily', '账号每天上限', '滚动 24 小时'],
      ['newAccountDaily', '新账号每天上限', '注册后首 24 小时适用'],
      ['recipientDaily', '收件邮箱每天上限', '同一邮箱跨账号累计'],
    ],
  },
  {
    title: '请求保护与记录',
    description: '请求次数与邮件额度分别统计，未发出的申请也受频率保护。',
    fields: [
      ['ipQuarterHour', 'IP 每 15 分钟请求上限', '按场景分别计数'],
      ['identifierQuarterHour', '标识每 15 分钟请求上限', '包括不存在的账号'],
      ['retentionDays', '详细记录保留天数', '1–180 天，清理记录不退回额度'],
    ],
  },
]
const modeDescriptions = {
  enforce: '提交前完成验证；配置不可用时阻止申请。',
  observe: '记录命中，不弹出验证；限流与额度照常执行。',
  off: '不要求人机验证；限流与额度照常执行。',
}
interface Props {
  draft: SecurityPolicy
  dirty: boolean
  busy: boolean
  turnstileReady: boolean
  onChange: <K extends keyof SecurityPolicy>(key: K, value: SecurityPolicy[K]) => void
  onSave: () => void
  onDiscard: () => void
}
export default function SecurityPolicyEditor({ draft, dirty, busy, turnstileReady, onChange, onSave, onDiscard }: Props) {
  const errors: Partial<Record<NumericKey, string>> = {}
  for (const { fields } of groups)
    for (const [key] of fields) {
      const value = draft[key],
        min = key.startsWith('reserve') ? 0 : 1,
        max = key === 'retentionDays' ? 180 : 100000
      if (!Number.isSafeInteger(value) || value < min || value > max) errors[key] = `请输入 ${min}–${max} 之间的整数`
    }
  if (draft.reserveDaily >= draft.daily) errors.reserveDaily = '应急预留须小于每日总预算'
  if (draft.reserveMonthly >= draft.monthly) errors.reserveMonthly = '应急预留须小于每月总预算'
  if (draft.daily > draft.monthly) errors.daily = '每日总预算不能超过每月总预算'
  if (draft.newAccountDaily > draft.accountDaily) errors.newAccountDaily = '不能超过普通账号每天上限'
  const domains = draft.emailDomains || DEFAULT_EMAIL_DOMAIN_POLICY
  const blocklist = parseEmailDomainList(domains.blocklist),
    allowlist = parseEmailDomainList(domains.allowlist)
  const allowlistError = allowlist.error || (domains.allowlistEnabled && !allowlist.domains.length ? '开启白名单时至少填写一个允许的邮箱域名' : '')
  const valid = Object.keys(errors).length === 0 && !blocklist.error && !allowlistError
  function changeDomains<K extends keyof EmailDomainPolicy>(key: K, value: EmailDomainPolicy[K]) {
    onChange('emailDomains', { ...domains, [key]: value })
  }
  function submit(event: FormEvent) {
    event.preventDefault()
    if (valid && dirty && !busy) onSave()
  }
  return (
    <form className={styles.workspace} onSubmit={submit}>
      <div className={styles.columns}>
        <div className={styles.stack}>
          {groups.map((group) => (
            <Card key={group.title}>
              <PanelHeading title={group.title} description={group.description} />
              <CardContent className={styles.panelBody}>
                <div className={styles.fields}>
                  {group.fields.map(([key, label, hint]) => (
                    <FormField key={key} label={label} hint={hint} error={errors[key]}>
                      {({ id }) => (
                        <Input
                          id={id}
                          type="number"
                          min={key.startsWith('reserve') ? 0 : 1}
                          max={key === 'retentionDays' ? 180 : 100000}
                          step={1}
                          required
                          disabled={busy}
                          value={draft[key]}
                          onChange={(e) => onChange(key, Number(e.target.value))}
                        />
                      )}
                    </FormField>
                  ))}
                </div>
                {group.title === '全站邮件预算' && (
                  <p className={styles.hint}>
                    按当前草稿，普通申请每天最多使用 {Math.max(0, draft.daily - draft.reserveDaily)} 封、每月{' '}
                    {Math.max(0, draft.monthly - draft.reserveMonthly)} 封。
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
        <div className={styles.stack}>
          <Card>
            <PanelHeading title="邮箱域名" description="控制邮箱绑定、密码找回、管理员重置及测试邮件可使用的收件域名。" />
            <CardContent className={styles.panelBody}>
              <label className={styles.switchRow} htmlFor="security-domain-allowlist">
                <span>
                  <span>仅允许白名单域名</span>
                  <span className={styles.hint}>开启后，名单外的邮箱无法申请账号邮件；关闭后仅执行黑名单。</span>
                </span>
                <Switch
                  id="security-domain-allowlist"
                  checked={domains.allowlistEnabled}
                  disabled={busy}
                  onCheckedChange={(value) => changeDomains('allowlistEnabled', value)}
                />
              </label>
              <FormField label="域名白名单" error={allowlistError} hint={`每行一个域名，最多 ${EMAIL_DOMAIN_LIST_LIMIT} 个；关闭白名单时保留列表。`}>
                {({ id }) => (
                  <Textarea
                    id={id}
                    className={styles.domainList}
                    rows={4}
                    maxLength={51200}
                    disabled={busy}
                    spellCheck={false}
                    autoCapitalize="none"
                    autoComplete="off"
                    placeholder={'qq.com\ngmail.com'}
                    value={domains.allowlist.join('\n')}
                    onChange={(e) => changeDomains('allowlist', e.target.value.split(/\r?\n/))}
                  />
                )}
              </FormField>
              <FormField label="域名黑名单" error={blocklist.error} hint={`每行一个域名，最多 ${EMAIL_DOMAIN_LIST_LIMIT} 个；黑名单始终优先于白名单。`}>
                {({ id }) => (
                  <Textarea
                    id={id}
                    className={styles.domainList}
                    rows={4}
                    maxLength={51200}
                    disabled={busy}
                    spellCheck={false}
                    autoCapitalize="none"
                    autoComplete="off"
                    placeholder="blocked.example.com"
                    value={domains.blocklist.join('\n')}
                    onChange={(e) => changeDomains('blocklist', e.target.value.split(/\r?\n/))}
                  />
                )}
              </FormField>
              <label className={styles.switchRow} htmlFor="security-domain-subdomains">
                <span>
                  <span>同时匹配子域名</span>
                  <span className={styles.hint}>例如 example.com 同时匹配 mail.example.com；关闭时仅匹配填写的域名。</span>
                </span>
                <Switch
                  id="security-domain-subdomains"
                  checked={domains.includeSubdomains}
                  disabled={busy}
                  onCheckedChange={(value) => changeDomains('includeSubdomains', value)}
                />
              </label>
              <p className={styles.hint}>
                填写纯英文域名，不包含
                @、完整邮箱、网址或通配符；保存时忽略大小写并去重。白名单不豁免限流、额度、验证和收件人停发规则，管理员应急邮件也需遵守。密码和通行密钥登录不受此设置影响。
              </p>
            </CardContent>
          </Card>
          <Card>
            <PanelHeading
              title="场景验证"
              description="为不同账号操作选择人机验证方式。"
              status={<AdminStatusBadge tone={turnstileReady ? 'neutral' : 'warning'}>{turnstileReady ? '验证配置已就绪' : '验证尚未配置'}</AdminStatusBadge>}
            />
            <CardContent className={styles.panelBody}>
              <div className={styles.stack}>
                {SECURITY_ACTIONS.map((action) => (
                  <FormField key={action} label={SECURITY_ACTION_LABELS[action]} hint={modeDescriptions[draft.challenges[action]]}>
                    {({ id }) => (
                      <Select
                        disabled={busy}
                        value={draft.challenges[action]}
                        onValueChange={(value) => onChange('challenges', { ...draft.challenges, [action]: value as 'off' | 'observe' | 'enforce' })}
                      >
                        <SelectTrigger id={id} className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="enforce">强制验证</SelectItem>
                          <SelectItem value="observe">观察命中</SelectItem>
                          <SelectItem value="off">不要求验证</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  </FormField>
                ))}
              </div>
              {!turnstileReady && SECURITY_ACTIONS.some((action) => draft.challenges[action] === 'enforce') && (
                <p className={styles.fieldError}>当前尚未配置人机验证，强制验证场景会阻止申请。请在站点设置中完成配置。</p>
              )}
            </CardContent>
          </Card>
          <Card>
            <PanelHeading title="投递与暂停" description="切换方式或暂停发送会影响新的申请和待发任务。" />
            <CardContent className={styles.panelBody}>
              <div className={styles.stack}>
                <FormField label="投递方式" hint="Resend API 使用已保存的 Resend 邮件凭据。投递反馈需另行配置回调。">
                  {({ id }) => (
                    <Select disabled={busy} value={draft.transport} onValueChange={(value) => onChange('transport', value as 'smtp' | 'resend')}>
                      <SelectTrigger id={id} className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="smtp">SMTP</SelectItem>
                        <SelectItem value="resend">Resend API</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                </FormField>
                <label className={styles.switchRow} htmlFor="security-paused">
                  <span>
                    <span>暂停邮件发送</span>
                    <span className={styles.hint}>暂停新申请与队列领取，待发邮件仍会过期。</span>
                  </span>
                  <Switch id="security-paused" checked={draft.paused} disabled={busy} onCheckedChange={(value) => onChange('paused', value)} />
                </label>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
      <p className={styles.hint}>调整后需填写原因并确认身份，保存成功后生效。切换视图会保留未保存的草稿。</p>
      {dirty && (
        <AdminFloatingDock reserveSpace>
          <span>{valid ? '防护策略有未保存修改' : '请先修正标出的参数'}</span>
          <Button type="button" variant="ghost" disabled={busy} onClick={onDiscard}>
            撤销
          </Button>
          <Button type="submit" disabled={busy || !valid}>
            保存策略
          </Button>
        </AdminFloatingDock>
      )}
    </form>
  )
}
