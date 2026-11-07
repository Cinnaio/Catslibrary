import { DEFAULT_EMAIL_DOMAIN_POLICY, type EmailDomainPolicy } from './email-domain-policy'

export const SECURITY_ACTIONS = ['forgot-password', 'verify-email', 'login', 'register'] as const
export type SecurityAction = (typeof SECURITY_ACTIONS)[number]
export type ChallengeMode = 'off' | 'observe' | 'enforce'
export interface SecurityPolicy {
  revision: number
  paused: boolean
  daily: number
  monthly: number
  reserveDaily: number
  reserveMonthly: number
  hourly: number
  cooldownSeconds: number
  accountQuarterHour: number
  accountDaily: number
  recipientDaily: number
  newAccountDaily: number
  ipQuarterHour: number
  identifierQuarterHour: number
  retentionDays: number
  challenges: Record<SecurityAction, ChallengeMode>
  transport: 'smtp' | 'resend'
  emailDomains: EmailDomainPolicy
}
export const DEFAULT_SECURITY_POLICY: SecurityPolicy = {
  revision: 0,
  paused: false,
  daily: 80,
  monthly: 2400,
  reserveDaily: 20,
  reserveMonthly: 400,
  hourly: 10,
  cooldownSeconds: 60,
  accountQuarterHour: 3,
  accountDaily: 5,
  recipientDaily: 5,
  newAccountDaily: 2,
  ipQuarterHour: 20,
  identifierQuarterHour: 6,
  retentionDays: 30,
  challenges: { 'forgot-password': 'enforce', 'verify-email': 'observe', login: 'observe', register: 'observe' },
  transport: 'smtp',
  emailDomains: DEFAULT_EMAIL_DOMAIN_POLICY,
}
export interface ChallengeConfiguration {
  action: SecurityAction
  mode: ChallengeMode
  siteKey: string
  configured: boolean
}
export interface SecurityEvent {
  can_restrict_source: boolean
  target_id: string
  id: string
  action: string
  rule: string
  outcome: string
  identity_hint: string
  count: number
  policy_revision: number
  created_at: number
  updated_at: number
}
export interface MailRecord {
  id: string
  user_id: string
  actor_id: string
  recipient_hint: string
  purpose: string
  state: string
  emergency: boolean
  attempts: number
  error_code: string
  created_at: number
  updated_at: number
  expires_at: number
  provider_id: string
  transport: string
}
export interface SecurityRestriction {
  id: string
  kind: 'account' | 'email' | 'ip'
  action: SecurityAction | 'all'
  effect: 'block' | 'allow'
  hint: string
  reason: string
  expires_at: number
  created_at: number
  actor_id: string
}
export interface SecurityOverview {
  policy: SecurityPolicy
  today: number
  month: number
  ordinaryToday: number
  ordinaryMonth: number
  queued: number
  unknown: number
  failed: number
  blocked: number
  accepted: number
  delivered: number
  encryptionReady: boolean
  mailReady: boolean
  turnstileReady: boolean
  webhookReady: boolean
  lastWebhookAt: number
  workerAt: number
  nextResetAt: number
  restoreHold: boolean
  breakerUntil: number
  trend: Array<{ day: string; sent: number; failed: number }>
  alerts: Array<{ code: string; message: string; severity: 'warning' | 'error' }>
}
export const SECURITY_ACTION_LABELS: Record<SecurityAction, string> = {
  'forgot-password': '找回密码',
  'verify-email': '绑定与更换邮箱',
  login: '登录',
  register: '注册',
}
