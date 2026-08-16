/** 格式化工具 —— 相对时间 / 绝对时间（由 home.js timeAgo 平移）。 */

export function timeAgo(ts: number | string | null | undefined): string {
  if (!ts) return ''
  const t = Number(ts)
  if (!t) return ''
  const diff = Date.now() - t
  const days = Math.floor(diff / 86400000)
  if (days > 365) return Math.floor(days / 365) + '年前'
  if (days > 30) return Math.floor(days / 30) + '个月前'
  if (days > 0) return days + '天前'
  const hours = Math.floor(diff / 3600000)
  if (hours > 0) return hours + '小时前'
  return '刚刚'
}

export function formatDate(ts: number | string | null | undefined): string {
  if (!ts) return ''
  const t = Number(ts)
  if (!t) return ''
  const d = new Date(t)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function formatDateTime(ts: number | string | null | undefined): string {
  if (!ts) return ''
  const t = Number(ts)
  if (!t) return ''
  const d = new Date(t)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${formatDate(t)} ${hh}:${mm}`
}

export function wordCountLabel(count: number): string {
  if (!count) return ''
  if (count >= 10000) return (count / 10000).toFixed(1).replace(/\.0$/, '') + '万字'
  return count + '字'
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / 1024 ** i
  const text = i === 0 || value >= 100 ? String(Math.round(value)) : value.toFixed(1).replace(/\.0$/, '')
  return text + ' ' + units[i]
}

export function timeText(ts: number | string | null | undefined): string {
  if (!ts) return ''
  const d = new Date(Number(ts))
  if (Number.isNaN(d.getTime())) return ''
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${m}-${day} ${hh}:${mm}`
}
