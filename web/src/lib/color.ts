/**
 * 调色盘 —— 色值工具：hex 校验、WCAG 相对亮度、按钮墨色（accent-ink）判定。
 * 纯函数，供 AccentContext 与 index.html 首帧脚本共用同一套判定逻辑。
 */

export const ACCENT_INK_LIGHT = '#FFFFFF'
export const ACCENT_INK_DARK = '#1D1510'

/** 白字对比度 ≥ 4.5:1 的最大相对亮度（1.05 / (L + 0.05) = 4.5 → L ≈ 0.1833） */
const WHITE_INK_MAX_LUMINANCE = 0.1833

export function isValidHex(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value)
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  if (!isValidHex(hex)) return null
  const n = Number.parseInt(hex.slice(1), 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

/** WCAG 相对亮度（0–1）。非法值按黑色处理。 */
export function relativeLuminance(hex: string): number {
  const rgb = hexToRgb(hex)
  if (!rgb) return 0
  const channel = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b)
}

/** 强调色上的文字色：白或深墨，保证 AA 对比度（≥4.5:1）。 */
export function accentInk(hex: string): string {
  return relativeLuminance(hex) > WHITE_INK_MAX_LUMINANCE ? ACCENT_INK_DARK : ACCENT_INK_LIGHT
}

/** 向白色混合 p（0–1，gamma 空间），用于估算深色主题下强调色的提亮结果。 */
export function mixWithWhite(hex: string, p: number): string {
  const rgb = hexToRgb(hex)
  if (!rgb) return hex
  const toHex = (c: number) => c.toString(16).padStart(2, '0')
  const mix = (c: number) => Math.round(c + (255 - c) * p)
  return '#' + toHex(mix(rgb.r)) + toHex(mix(rgb.g)) + toHex(mix(rgb.b))
}
