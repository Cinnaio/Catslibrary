/**
 * 主题上下文 —— 三态主题（亮 / 暗 / 跟随系统）。
 * 由 Novel-KV js/theme.js 的 resolve/apply 逻辑平移。
 * - setting 为用户选择（localStorage 'theme'：'light' | 'dark' | 'system'，缺省 'system'）
 * - theme 为实际生效的明暗（setting 为 system 时派生自 prefers-color-scheme）
 * 首次绘制防 FOUC：index.html 内联脚本先行设置 data-theme，此处负责状态同步与切换。
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export type ThemeMode = 'light' | 'dark'
export type ThemeSetting = ThemeMode | 'system'

const STORAGE_KEY = 'theme'
const MEDIA = '(prefers-color-scheme: dark)'

function safeGet(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

function safeSet(theme: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    /* ignore unavailable storage */
  }
}

export function getSystemTheme(): ThemeMode {
  return typeof window.matchMedia === 'function' && window.matchMedia(MEDIA).matches ? 'dark' : 'light'
}

/** 用户设置（兼容旧值：非三态即视为跟随系统） */
export function resolveSetting(): ThemeSetting {
  const saved = safeGet()
  return saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'system'
}

/** 由设置解析出实际生效主题 */
export function resolveTheme(setting: ThemeSetting): ThemeMode {
  return setting === 'system' ? getSystemTheme() : setting
}

export function applyTheme(theme: ThemeMode): void {
  document.documentElement.setAttribute('data-theme', theme)
  document.documentElement.style.colorScheme = theme
}

interface ThemeContextValue {
  /** 实际生效主题（跟随系统时为系统当前值） */
  theme: ThemeMode
  /** 用户选择的模式 */
  setting: ThemeSetting
  /** 设置主题模式；position 提供时以该点作圆形扩散动画 */
  setSetting: (setting: ThemeSetting, position?: { x: number; y: number }) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [setting, setSettingState] = useState<ThemeSetting>(() => resolveSetting())
  const [theme, setThemeState] = useState<ThemeMode>(() => resolveTheme(resolveSetting()))

  // 首帧同步（内联脚本已设置，这里确保与 React 状态一致）
  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  // 系统亮暗变化：仅「跟随系统」模式时联动（非 system 模式不挂监听）
  useEffect(() => {
    if (!window.matchMedia || setting !== 'system') return
    const mq = window.matchMedia(MEDIA)
    const onChange = (e: MediaQueryListEvent) => {
      setThemeState(e.matches ? 'dark' : 'light')
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [setting])

  const setSetting = useCallback((next: ThemeSetting, position?: { x: number; y: number }) => {
    safeSet(next)
    setSettingState(next)
    const nextTheme = resolveTheme(next)
    const current = document.documentElement.getAttribute('data-theme')
    if (current === nextTheme) {
      setThemeState(nextTheme)
      return
    }
    // 主题实际变化：用户手势选择固定值带动画；system 跟随（如系统变化）无手势则直切
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (!position || !document.startViewTransition || reduceMotion) {
      setThemeState(nextTheme)
      return
    }
    const x = position.x
    const y = position.y
    const endRadius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y))
    const clipPath = [
      `circle(0px at ${x}px ${y}px)`,
      `circle(${endRadius}px at ${x}px ${y}px)`,
    ]
    document.documentElement.classList.add('theme-switching')
    const transition = document.startViewTransition(() => setThemeState(nextTheme))
    transition.ready.then(() => {
      document.documentElement.animate(
        { clipPath },
        {
          duration: 360,
          easing: 'cubic-bezier(0.25, 0.8, 0.25, 1)',
          pseudoElement: '::view-transition-new(root)',
        },
      )
    })
    transition.finished.finally(() => {
      document.documentElement.classList.remove('theme-switching')
    })
  }, [])

  const value = useMemo(() => ({ theme, setting, setSetting }), [theme, setting, setSetting])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
