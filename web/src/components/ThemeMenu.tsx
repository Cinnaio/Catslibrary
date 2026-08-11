/**
 * ThemeMenu —— 主题下拉三选一（浅色 / 深色 / 跟随系统）。
 * 通用组件：trigger 为原生按钮（样式类由调用方传入，复用各场景的 theme-btn 外观），
 * 弹层 fixed 定位并做视口翻转，适配页头 / 阅读器顶栏 / 移动端阅读栏 / 管理侧栏。
 * 跟随系统模式由 ThemeContext 的 setting 承担，菜单项高亮当前模式。
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { useTheme, type ThemeSetting } from '../context/ThemeContext'
import { AutoIcon, MoonIcon, SunIcon } from './icons'

interface ThemeMenuProps {
  className?: string
  /** 外层容器类名（如管理侧栏需要 w-full 填满菜单项） */
  wrapperClassName?: string
  ariaLabel?: string
  title?: string
  /** 弹层水平对齐：end 右对齐触发按钮（默认），start 左对齐 */
  align?: 'end' | 'start'
  /** 触发按钮内容（图标等） */
  children: ReactNode
}

const OPTIONS: { value: ThemeSetting; label: string; icon: ReactNode }[] = [
  { value: 'light', label: '浅色', icon: <SunIcon /> },
  { value: 'dark', label: '深色', icon: <MoonIcon /> },
  { value: 'system', label: '跟随系统', icon: <AutoIcon /> },
]

/* 弹层估算尺寸（用于视口翻转判断） */
const MENU_W = 168
const MENU_H = 132
const MENU_GAP = 6

export function ThemeMenu({ className, wrapperClassName, ariaLabel = '主题设置', title = '主题设置', align = 'end', children }: ThemeMenuProps) {
  const { setting, setSetting } = useTheme()
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const close = useCallback(() => setOpen(false), [])

  // 打开时定位：右/左对齐触发按钮，底部空间不足则向上弹，并约束在视口内
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const spaceBelow = vh - rect.bottom
    const spaceAbove = rect.top
    const openUp = spaceBelow < MENU_H && spaceAbove > spaceBelow
    const top = openUp ? rect.top - MENU_H - MENU_GAP : rect.bottom + MENU_GAP
    const left = Math.max(8, Math.min(align === 'end' ? rect.right - MENU_W : rect.left, vw - MENU_W - 8))
    setPos({ top, left })
  }, [open, align])

  // 外部点击 / Escape / 滚动关闭
  useEffect(() => {
    if (!open) return
    function onDown(e: globalThis.MouseEvent) {
      const t = e.target as Node
      if (triggerRef.current?.contains(t) || menuRef.current?.contains(t)) return
      close()
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', close, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', close, true)
    }
  }, [open, close])

  function pick(value: ThemeSetting, e: ReactMouseEvent<HTMLButtonElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    setSetting(value, { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
    close()
  }

  return (
    <div className={wrapperClassName ? `theme-menu ${wrapperClassName}` : 'theme-menu'}>
      <button
        ref={triggerRef}
        type="button"
        className={className}
        aria-label={ariaLabel}
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
      >
        {children}
      </button>

      {open && (
        <div
          ref={menuRef}
          className="theme-menu__popover"
          role="menu"
          aria-label={ariaLabel}
          style={pos ?? undefined}
        >
          {OPTIONS.map((opt) => {
            const active = setting === opt.value
            return (
              <button
                key={opt.value}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                className={`theme-menu__item${active ? ' active' : ''}`}
                onClick={(e) => {
                  e.stopPropagation()
                  pick(opt.value, e)
                }}
              >
                {opt.icon}
                <span>{opt.label}</span>
                {active && (
                  <svg className="theme-menu__check" viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="2 6 5 9 10 3" />
                  </svg>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
