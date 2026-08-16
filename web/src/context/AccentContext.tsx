/**
 * 调色盘 —— 用户自定义全站强调色（accent）。
 * 与 ThemeContext 正交：换色不影响明暗；切明暗不丢色（CSS 按 [data-theme] 自适应）。
 * - localStorage['accent']：#RRGGBB 或空（空 = 默认奶茶棕）
 * - 应用方式：<html> 写 data-accent + --accent-base / --accent-ink-{light,dark}，
 *   tokens.css 在 html[data-accent] 下把 accent 家族从 --accent-base 派生。
 * 首帧防 FOUC 由 index.html 内联脚本先行写入。
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { accentInk, isValidHex, mixWithWhite } from '../lib/color'

const STORAGE_KEY = 'accent'
const ACCENT_ATTR = 'data-accent'
const BASE_PROP = '--accent-base'
const INK_LIGHT_PROP = '--accent-ink-light'
const INK_DARK_PROP = '--accent-ink-dark'
/** 深色主题提亮比例（与 tokens.css 的 color-mix 78% 一致，用于估算深色下的墨色） */
const DARK_LIFT = 0.22

function safeGet(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

function safeSet(value: string | null): void {
  try {
    if (value) localStorage.setItem(STORAGE_KEY, value)
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore unavailable storage */
  }
}

/** 读取用户设置；非法/缺失视为未自定义。 */
export function resolveAccent(): string | null {
  const saved = safeGet()
  return saved && isValidHex(saved) ? saved.toLowerCase() : null
}

/** 应用/清除自定义强调色（写 <html> inline 变量与 data-accent 标记）。 */
export function applyAccent(accent: string | null): void {
  const root = document.documentElement
  if (!accent) {
    root.removeAttribute(ACCENT_ATTR)
    root.style.removeProperty(BASE_PROP)
    root.style.removeProperty(INK_LIGHT_PROP)
    root.style.removeProperty(INK_DARK_PROP)
    return
  }
  root.setAttribute(ACCENT_ATTR, '')
  root.style.setProperty(BASE_PROP, accent)
  root.style.setProperty(INK_LIGHT_PROP, accentInk(accent))
  root.style.setProperty(INK_DARK_PROP, accentInk(mixWithWhite(accent, DARK_LIFT)))
}

interface AccentContextValue {
  /** 当前自定义强调色（null = 使用默认奶茶棕） */
  accent: string | null
  setAccent: (accent: string | null) => void
}

const AccentContext = createContext<AccentContextValue | null>(null)

export function AccentProvider({ children }: { children: ReactNode }) {
  const [accent, setAccentState] = useState<string | null>(() => resolveAccent())

  // 首帧同步（内联脚本已写入，这里确保与 React 状态一致；测试等无内联脚本场景兜底）
  useEffect(() => {
    applyAccent(accent)
  }, [accent])

  const setAccent = useCallback((next: string | null) => {
    const normalized = next && isValidHex(next) ? next.toLowerCase() : null
    safeSet(normalized)
    setAccentState(normalized)
    applyAccent(normalized)
  }, [])

  const value = useMemo(() => ({ accent, setAccent }), [accent, setAccent])
  return <AccentContext.Provider value={value}>{children}</AccentContext.Provider>
}

export function useAccent(): AccentContextValue {
  const ctx = useContext(AccentContext)
  if (!ctx) throw new Error('useAccent must be used within AccentProvider')
  return ctx
}
