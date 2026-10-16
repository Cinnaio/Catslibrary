import { useEffect, useState } from 'react'
import type { NovelVisibility } from '@shared/types'
import { novelsApi, type NovelAccessUser, type NovelVisibilitySettings } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import CustomSelect from './CustomSelect'

export interface NovelVisibilityDraft {
  visibility: NovelVisibility
  allowedUserIds: string[]
  visibilityRevision?: number
}
const options = [
  { value: 'public', label: '公开' },
  { value: 'admin', label: '仅管理员' },
  { value: 'selected', label: '管理员与指定用户' },
]

export default function NovelVisibilityField({ novelId, onChange, disabled }: {
  novelId?: string
  onChange: (value: NovelVisibilityDraft | null) => void
  disabled: boolean
}) {
  const [settings, setSettings] = useState<NovelVisibilitySettings | null>(null)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [query, setQuery] = useState('')
  const [users, setUsers] = useState<NovelAccessUser[]>([])
  const [searchError, setSearchError] = useState('')
  const [searching, setSearching] = useState(false)
  const [offset, setOffset] = useState(0)
  const [total, setTotal] = useState(0)
  useEffect(() => {
    let active = true
    onChange(null)
    setSettings(null)
    setError('')
    const load = novelId ? novelsApi.visibility(novelId) : Promise.resolve<NovelVisibilitySettings>({ visibility: 'public', revision: 0, users: [], audit: [] })
    void load.then((value) => {
      if (!active) return
      setSettings(value)
      onChange({ visibility: value.visibility, allowedUserIds: value.users.map((u) => u.id), visibilityRevision: value.revision })
    }).catch(() => { if (active) setError('可见范围加载失败，请重试后保存。') })
    return () => { active = false }
  }, [novelId, retry, onChange])
  useEffect(() => {
    if (settings?.visibility !== 'selected') return
    let active = true
    setSearching(true)
    setSearchError('')
    const timer = setTimeout(() => {
      void novelsApi.accessUsers(query.trim(), offset).then((data) => {
        if (!active) return
        setUsers(data.users)
        setTotal(data.total)
      }).catch(() => { if (active) { setUsers([]); setSearchError('用户列表加载失败，请重试。') } })
        .finally(() => { if (active) setSearching(false) })
    }, 250)
    return () => { active = false; clearTimeout(timer) }
  }, [settings?.visibility, query, offset, retry])

  function change(next: NovelVisibilitySettings) {
    setSettings(next)
    onChange({ visibility: next.visibility, allowedUserIds: next.visibility === 'selected' ? next.users.map((u) => u.id) : [], visibilityRevision: next.revision })
  }
  return (
    <div className="form-group novel-editor__field novel-editor__field--wide novel-visibility-field">
      <Label id="novel-visibility-label">可见范围</Label>
      {error ? <div role="alert" className="novel-visibility-feedback">{error}<Button variant="secondary" size="sm" onClick={() => setRetry((n) => n + 1)}>重试</Button></div>
        : !settings ? <p role="status">正在加载可见范围…</p>
        : <>
          <CustomSelect aria-labelledby="novel-visibility-label" options={options} value={settings.visibility} disabled={disabled}
            onChange={(visibility) => change({ ...settings, visibility: visibility as NovelVisibility })} />
          <p>私密作品仅对管理员和授权用户可见，其他人访问时显示页面不存在。内容分级仍独立生效。</p>
          {settings.visibility === 'selected' && <div className="novel-visibility-users">
            <div className="novel-visibility-selected" aria-label="已授权用户">
              <span>已选 {settings.users.length} 人 · 管理员始终可见</span>
              {settings.users.map((user) => <div className="novel-visibility-user" key={user.id}>
                <span>{user.displayName || user.username} <span className="novel-visibility-account">@{user.username}{user.status === 'disabled' ? ' · 已停用' : ''}</span></span>
                <Button variant="ghost" size="sm" disabled={disabled} aria-label={`移除授权 ${user.username}`}
                  onClick={() => change({ ...settings, users: settings.users.filter((u) => u.id !== user.id) })}>移除</Button>
              </div>)}
            </div>
            <Label htmlFor="novel-access-search">添加授权用户</Label>
            <Input id="novel-access-search" type="search" placeholder="搜索用户名或昵称" value={query} disabled={disabled}
              onChange={(event) => { setQuery(event.target.value); setOffset(0); setUsers([]) }} />
            {searching ? <p role="status">正在查找用户…</p>
              : searchError ? <div role="alert" className="novel-visibility-feedback">{searchError}<Button size="sm" variant="secondary" onClick={() => setRetry((n) => n + 1)}>重试搜索</Button></div>
              : <>
                <div className="novel-visibility-results" aria-label="可授权用户">
                  {users.length ? users.map((user) => <label className="novel-visibility-user" key={user.id}>
                    <Checkbox checked={settings.users.some((u) => u.id === user.id)} disabled={disabled || settings.users.length >= 500 && !settings.users.some((u) => u.id === user.id)}
                      onCheckedChange={(checked) => change({ ...settings, users: checked ? [...settings.users, user] : settings.users.filter((u) => u.id !== user.id) })} />
                    <span>{user.displayName || user.username} <span className="novel-visibility-account">@{user.username}</span></span>
                  </label>) : <p>没有找到符合条件的用户。</p>}
                </div>
                {total > 15 && <div className="novel-visibility-pagination">
                  <Button size="sm" variant="ghost" disabled={disabled || offset === 0} onClick={() => setOffset((n) => Math.max(0, n - 15))}>上一页</Button>
                  <span>{Math.floor(offset / 15) + 1} / {Math.ceil(total / 15)}</span>
                  <Button size="sm" variant="ghost" disabled={disabled || offset + 15 >= total} onClick={() => setOffset((n) => n + 15)}>下一页</Button>
                </div>}
              </>}
          </div>}
          {!!settings.audit.length && <details className="novel-visibility-audit">
            <summary>最近的可见范围变更</summary>
            <ol>{settings.audit.map((entry) => <li key={entry.revision}>
              {entry.actorName || '管理员'} · {options.find((o) => o.value === entry.visibility)?.label} · {new Date(Number(entry.createdAt)).toLocaleString('zh-CN')}
            </li>)}</ol>
          </details>}
        </>}
    </div>
  )
}
