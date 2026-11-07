import type { AdminStatusTone } from '@/lib/admin-status'

export const mailStateLabels: Record<string, string> = {
  queued: '待发送',
  sending: '发送中',
  accepted: '服务商已受理',
  delivered: '已投递',
  unknown: '结果待核实',
  failed: '发送失败',
  expired: '已过期',
  cancelled: '已取消',
  bounced: '永久退信',
  complained: '收到投诉',
}
export const outcomeLabels: Record<string, string> = { blocked: '已拦截', observed: '观察命中', suppressed: '已停发' }
export const purposeLabels: Record<string, string> = { 'verify-email': '验证邮箱', 'reset-password': '找回密码', test: '投递测试' }
export const targetLabels = { account: '账号', email: '收件邮箱', ip: '请求来源' }
export const callbackLabels: Record<string, string> = {
  'email.sent': '服务商已受理',
  'email.delivered': '收件服务器已接收',
  'email.bounced': '收到退信',
  'email.complained': '收件人投诉',
  'email.failed': '服务商报告失败',
  'email.suppressed': '服务商停止投递',
}
const reasonLabels: Record<string, string> = {
  global_rate: '全站请求频率超限',
  identifier_rate: '账号标识请求过于频繁',
  ip_rate: '同一来源请求过于频繁',
  session_rate: '当前会话请求过于频繁',
  restriction: '命中限制规则',
  challenge: '人机验证规则',
  mail_recipient_rate: '账号或收件人申请过于频繁',
  mail_hour_budget: '达到每小时发送上限',
  mail_budget_exhausted: '可用发送额度不足',
  mail_emergency_rate: '应急发送冷却中',
  mail_paused: '邮件发送已暂停',
  mail_restricted: '命中停发规则',
  mail_domain_blocked: '命中邮箱域名黑名单',
  mail_domain_not_allowed: '邮箱域名不在白名单中',
  lease_recovered: '等待重新确认投递',
  lease_expired: '发送超时，结果待核实',
  queue_expired: '超过待发有效期',
  payload_unreadable: '邮件内容无法解密',
  account_or_configuration_changed: '账号或发送配置已变化',
  recipient_restricted: '收件人已受限',
  quota_boundary: '预算周期已变化',
  admin_cancelled: '管理员取消',
  admin_reconciled: '管理员已核实结果',
  smtp_rejected: '邮件服务拒绝发送',
  smtp_temporary: '邮件服务暂时不可用',
  smtp_unknown: '未能确认服务商是否受理',
  resend_configuration: 'Resend 配置不完整',
  provider_network: '服务商连接中断',
  provider_response: '未能确认服务商返回结果',
  restored: '备份恢复后取消',
}
export function securityReason(code: string): string {
  if (!code) return ''
  return reasonLabels[code] || callbackLabels[code] || (/^provider_\d+$/.test(code) ? '服务商返回异常' : '已记录处理原因，详见技术信息')
}
export function statusTone(state: string): AdminStatusTone {
  if (['delivered', 'accepted'].includes(state)) return 'success'
  if (['failed', 'bounced', 'complained', 'suppressed', 'blocked'].includes(state)) return 'danger'
  if (['unknown', 'queued'].includes(state)) return 'warning'
  if (state === 'sending') return 'info'
  return 'neutral'
}
export function securityDate(value: number): string {
  return value ? new Date(Number(value)).toLocaleString('zh-CN', { hour12: false }) : '暂无记录'
}
