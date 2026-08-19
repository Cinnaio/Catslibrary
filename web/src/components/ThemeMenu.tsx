/**
 * ThemeMenu —— 主题下拉三选一（浅色 / 深色 / 跟随系统）。
 * 通用组件：trigger 为原生按钮（样式类由调用方传入，复用各场景的 theme-btn 外观），
 * 弹层 fixed 定位并做视口翻转，适配页头 / 阅读器顶栏 / 移动端阅读栏 / 管理侧栏。
 * 跟随系统模式由 ThemeContext 的 setting 承担，菜单项高亮当前模式。
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { useTheme, type ThemeSetting } from '../context/ThemeContext'
import { AutoIcon, MoonIcon, SunIcon } from './icons'
import { useAccent } from '../context/AccentContext'

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

/** 预设主题色（全部通过 AA 对比度，深浅两主题均可用） */
const ACCENT_PRESETS: Array<{ color: string; label: string }> = [
  { color: '#8B6045', label: '奶茶棕' },
  { color: '#2F5D62', label: '黛青' },
  { color: '#3E6B4F', label: '松绿' },
  { color: '#A23B4E', label: '绛红' },
  { color: '#9A6B1F', label: '金秋' },
  { color: '#6B4E8C', label: '墨紫' },
  { color: '#3E7B7A', label: '青瓷' },
  { color: '#C05B4A', label: '珊瑚' },
  { color: '#4A5568', label: '石板' },
]

/* 弹层估算尺寸（用于视口翻转判断） */
const MENU_W = 200
const MENU_H = 252
const MENU_GAP = 6

export function ThemeMenu({ className, wrapperClassName, ariaLabel = '主题设置', title = '主题设置', align = 'end', children }: ThemeMenuProps) {
  const { setting, setSetting } = useTheme()
  const { accent, setAccent } = useAccent()
  const isCustomAccent = accent != null && !ACCENT_PRESETS.some((p) => p.color === accent)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const close = useCallback(() => setOpen(false), [])

  // 打开时定位：右/左对齐触发按钮，底部空间不足则向上弹，并约束在视口内。
  // 弹层 absolute 相对 .theme-menu 定位，坐标以 wrapper 为原点（换算自视口坐标）。
  useLayoutEffect(() => {
    if (!open || !triggerRef.current || !wrapperRef.current) return
    const triggerRect = triggerRef.current.getBoundingClientRect()
    const wrapperRect = wrapperRef.current.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const spaceBelow = vh - triggerRect.bottom
    const spaceAbove = triggerRect.top
    const openUp = spaceBelow < MENU_H && spaceAbove > spaceBelow
    const top = (openUp ? triggerRect.top - MENU_H - MENU_GAP : triggerRect.bottom + MENU_GAP) - wrapperRect.top
    // 相对 wrapper 的 left；再按「弹层最终落在视口内」换算并钳制
    let left = (align === 'end' ? triggerRect.right - MENU_W : triggerRect.left) - wrapperRect.left
    const minLeft = 8 - wrapperRect.left
    const maxLeft = vw - MENU_W - 8 - wrapperRect.left
    left = Math.max(minLeft, Math.min(left, maxLeft))
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
    <div ref={wrapperRef} className={wrapperClassName ? `theme-menu ${wrapperClassName}` : 'theme-menu'}>
      <button
        ref={triggerRef}
        type="button"
        data-slot="theme-menu-trigger"
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

      <div
        ref={menuRef}
        className={`theme-menu__popover${open ? ' open' : ''}`}
        role="menu"
        aria-label={ariaLabel}
        style={pos ?? undefined}
        aria-hidden={!open}
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

        <div className="theme-menu__divider" aria-hidden="true" />
        <div className="theme-menu__palette">
          <div className="theme-menu__palette-head">
            <span>主题色</span>
            {accent && (
              <button
                type="button"
                className="theme-menu__reset"
                onClick={(e) => {
                  e.stopPropagation()
                  setAccent(null)
                }}
              >
                恢复默认
              </button>
            )}
          </div>
          <div className="theme-menu__swatches" role="radiogroup" aria-label="主题色">
            {ACCENT_PRESETS.map((p) => (
              <button
                key={p.color}
                type="button"
                role="radio"
                aria-checked={accent === p.color}
                aria-label={p.label}
                title={p.label}
                className={`theme-menu__swatch${accent === p.color ? ' active' : ''}`}
                style={{ background: p.color }}
                onClick={(e) => {
                  e.stopPropagation()
                  setAccent(p.color)
                }}
              />
            ))}
            <label
              className={`theme-menu__swatch theme-menu__swatch--custom${isCustomAccent ? ' active' : ''}`}
              title="自定义颜色"
              style={isCustomAccent ? { background: accent ?? undefined } : undefined}
            >
              <input
                type="color"
                aria-label="自定义颜色"
                value={isCustomAccent && accent ? accent : ACCENT_PRESETS[0]!.color}
                onChange={(e) => {
                  e.stopPropagation()
                  setAccent(e.target.value)
                }}
              />
              <span aria-hidden="true">＋</span>
            </label>
          </div>
        </div>
      </div>
    </div>
  )
}
