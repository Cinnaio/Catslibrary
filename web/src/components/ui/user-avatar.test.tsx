import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { UserAvatar } from './user-avatar'

describe('UserAvatar', () => {
  it('优先显示用户图片并解析 API 相对地址', () => {
    const { container } = render(<UserAvatar name="猫" src="/api/avatars/cat.png" />)
    expect(container.querySelector('img')).toHaveAttribute('src', '/api/avatars/cat.png')
    expect(container.querySelector('.shared-initial-avatar')).toBeNull()
    expect(container.firstChild).toHaveAttribute('aria-hidden', 'true')
  })
  it('未设置或图片失败时显示文字，头像地址更新后重新显示图片', () => {
    const { container, rerender } = render(<UserAvatar name="猫" />)
    expect(container.textContent).toBe('猫')
    rerender(<UserAvatar name="猫" src="https://example.com/cat.png" />)
    fireEvent.error(container.querySelector('img')!)
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toBe('猫')
    rerender(<UserAvatar name="猫" src="https://example.com/new-cat.png" />)
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://example.com/new-cat.png')
  })
  it('资料页本地预览不添加 API 前缀，并继承原有尺寸', () => {
    const { container } = render(<UserAvatar name="猫" src="blob:http://localhost/preview" size="inherit" />)
    expect(container.querySelector('img')).toHaveAttribute('src', 'blob:http://localhost/preview')
    expect(container.firstChild).toHaveClass('shared-user-avatar--inherit')
  })
})
