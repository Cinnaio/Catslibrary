import { useState } from 'react'
import { LogOut } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { useSession } from '../context/SessionContext'
import { useToast } from './feedback'
import { url } from '../lib/api'
import { cn } from '../lib/utils'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from './ui/dropdown-menu'
import { ChevronIcon, UserIcon } from './icons'
import { useExclusiveMenu } from '../hooks/useExclusiveMenu'

export type AccountMenuVariant = 'site' | 'admin' | 'mobile'

interface AccountMenuProps {
  variant?: AccountMenuVariant
  className?: string
  wrapperClassName?: string
  onNavigate?: () => void
}

export function AccountMenu({ variant = 'site', className, wrapperClassName, onNavigate }: AccountMenuProps) {
  const { user, logout } = useSession()
  const { toast } = useToast()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const setExclusiveOpen = useExclusiveMenu('account', setOpen)
  const [failedAvatarUrl, setFailedAvatarUrl] = useState('')

  if (!user) return null

  const name = user.displayName || user.username || (variant === 'admin' ? '管理员' : '知舟读者')
  const avatarUrl = user.avatarUrl ? url(user.avatarUrl) : ''
  const showAvatar = !!avatarUrl && failedAvatarUrl !== avatarUrl
  const showName = variant === 'admin'
  const initial = name.slice(0, 1)
  const triggerLabel = `账户菜单：${name}`

  async function handleLogout() {
    setOpen(false)
    onNavigate?.()
    try {
      await logout()
      navigate('/', { replace: true })
    } catch (err) {
      toast((err as Error).message || '退出登录失败', 'error')
    }
  }

  const avatar = showAvatar ? <img src={avatarUrl} alt="" onError={() => setFailedAvatarUrl(avatarUrl)} /> : <span>{initial}</span>
  const triggerAvatar =
    variant === 'site' ? (
      avatar
    ) : (
      <span
        className={cn('account-menu__avatar', variant === 'admin' && 'admin-shell__account-avatar', variant === 'mobile' && 'mobile-drawer__avatar')}
        aria-hidden="true"
      >
        {avatar}
      </span>
    )

  return (
    <div className={cn('account-menu', `account-menu--${variant}`, wrapperClassName)}>
      <DropdownMenu open={open} onOpenChange={setExclusiveOpen} modal={false}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              'account-menu__trigger',
              `account-menu__trigger--${variant}`,
              variant === 'site' && 'account-avatar',
              variant === 'admin' && 'admin-shell__account',
              className,
            )}
            aria-label={triggerLabel}
            title={`打开${name}账户菜单`}
          >
            {triggerAvatar}
            {showName && <span className="account-menu__name admin-shell__account-name">{name}</span>}
            {showName && <ChevronIcon className="account-menu__chevron" aria-hidden="true" />}
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" sideOffset={8} className="account-menu__content">
          <DropdownMenuLabel className="account-menu__identity">
            <span className="account-menu__identity-name">{name}</span>
            <span className="account-menu__identity-handle">@{user.username || 'reader'}</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild className="account-menu__item">
            <Link to="/profile" onClick={onNavigate}>
              <UserIcon aria-hidden="true" />
              <span>个人中心</span>
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem className="account-menu__item account-menu__item--danger" onSelect={() => void handleLogout()}>
            <LogOut aria-hidden="true" />
            <span>退出登录</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
