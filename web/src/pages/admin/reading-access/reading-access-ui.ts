import type { ReadingAccessMode, ReadingAccessSubject } from '@shared/reading-access'

export const SUBJECT_LABEL: Record<ReadingAccessSubject, string> = { guest: '游客', account: '登录账号', ip: '可信 IP' }
export const MODE_LABEL: Record<ReadingAccessMode, string> = { observe: '观察模式', enforce: '增强拦截' }
export const WINDOW_LABEL = { 1: '每分钟', 10: '10 分钟', 60: '1 小时', 1440: '1 天' }
export const HOUR_MS = 3600000
const clock = new Intl.DateTimeFormat('zh-CN', {
  month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Shanghai',
})
export const displayTime = (value: number) => clock.format(value)
export const displayCount = (value: number) => value.toLocaleString('zh-CN')
