/** 内联 SVG 图标（与 Novel-KV 页面 inline SVG 一致，stroke=currentColor）。 */

interface IconProps {
  className?: string
  width?: number | string
  height?: number | string
}

export function SearchIcon({ className, width = 18, height = 18 }: IconProps) {
  return (
    <svg className={className} width={width} height={height} viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="7.5" cy="7.5" r="5" />
      <line x1="11" y1="11" x2="16" y2="16" />
    </svg>
  )
}

export function SunIcon({ className, width = 12, height = 12 }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 18 18" width={width} height={height} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="9" r="3.5" />
      <line x1="9" y1="1" x2="9" y2="3" />
      <line x1="9" y1="15" x2="9" y2="17" />
      <line x1="1" y1="9" x2="3" y2="9" />
      <line x1="15" y1="9" x2="17" y2="9" />
      <line x1="3.4" y1="3.4" x2="4.8" y2="4.8" />
      <line x1="13.2" y1="13.2" x2="14.6" y2="14.6" />
      <line x1="3.4" y1="14.6" x2="4.8" y2="13.2" />
      <line x1="13.2" y1="4.8" x2="14.6" y2="3.4" />
    </svg>
  )
}

export function MoonIcon({ className, width = 12, height = 12 }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 18 18" width={width} height={height} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.5 10.5A6 6 0 0 1 7.5 3.5 6 6 0 1 0 14.5 10.5z" />
    </svg>
  )
}

export function AutoIcon({ className, width = 16, height = 16 }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 18 18" width={width} height={height} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2.5" y="2.5" width="13" height="9.5" rx="1.5" />
      <line x1="7" y1="15.5" x2="11" y2="15.5" />
      <line x1="9" y1="12" x2="9" y2="15.5" />
      <circle cx="9" cy="7.25" r="1.9" />
      <path d="M9 3.7v-.8M9 10.8v-.8M4.6 7.25h-.8M13.4 7.25h-.8M6 4.7l-.6-.6M12.6 10.85l-.6-.6M12.6 4.7l-.6.6M6 10.85l-.6-.6" />
    </svg>
  )
}

export function RefreshIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16.7 8.4A6.8 6.8 0 1 0 18 12" />
      <path d="M16.7 4.8v3.6h-3.6" />
    </svg>
  )
}

export function HomeIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 7.5l7-5.5 7 5.5" />
      <path d="M4.5 8.5v6h3v-4h3v4h3v-6" />
    </svg>
  )
}

export function BackToTopIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="12 11 9 7 6 11" />
      <line x1="4" y1="14" x2="14" y2="14" />
    </svg>
  )
}

export function UserIcon({ className, width = 16, height = 16 }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" width={width} height={height} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="5" r="3" />
      <path d="M3 14c.8-2.4 2.5-3.6 5-3.6s4.2 1.2 5 3.6" />
    </svg>
  )
}

export function StarIcon({ className, width = 18, height = 18 }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" width={width} height={height} fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  )
}

export function ChevronIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 10 10" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <polyline points="2 3 5 7 8 3" />
    </svg>
  )
}

export function MenuIcon({ className, width = 20, height = 20 }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 18 18" width={width} height={height} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <line x1="2" y1="4.5" x2="16" y2="4.5" />
      <line x1="2" y1="9" x2="16" y2="9" />
      <line x1="2" y1="13.5" x2="16" y2="13.5" />
    </svg>
  )
}

export function CloseIcon({ className, width = 18, height = 18 }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 18 18" width={width} height={height} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <line x1="3.5" y1="3.5" x2="14.5" y2="14.5" />
      <line x1="14.5" y1="3.5" x2="3.5" y2="14.5" />
    </svg>
  )
}

export function BookIcon({ className, width = 18, height = 18 }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 18 18" width={width} height={height} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 2.5h7a2 2 0 0 1 2 2v11H6a2 2 0 0 1-2-2v-11z" />
      <path d="M13 4.5h1a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H8" />
      <line x1="6.5" y1="6.5" x2="10.5" y2="6.5" />
      <line x1="6.5" y1="9.5" x2="10.5" y2="9.5" />
    </svg>
  )
}

export function ShieldIcon({ className, width = 18, height = 18 }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 18 18" width={width} height={height} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 2l5 2v4c0 3.5-2.2 6-5 7-2.8-1-5-3.5-5-7V4l5-2z" />
      <path d="M7 9l1.5 1.5L11.5 7" />
    </svg>
  )
}
