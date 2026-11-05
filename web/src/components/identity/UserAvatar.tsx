import type { ComponentProps } from 'react'
import { url } from '@/lib/api'
import { Avatar } from '@/components/ui/avatar'

/** 账户头像适配器负责 API 地址；通用 Avatar 只呈现调用方给出的 URL。 */
export function UserAvatar({ src, ...props }: ComponentProps<typeof Avatar>) {
  const raw = src?.trim() || ''
  const source = /^(blob:|data:image\/)/i.test(raw) ? raw : raw ? url(raw) : ''
  return <Avatar src={source} {...props} />
}
