import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { AccentProvider } from '../context/AccentContext'
import { ThemeProvider } from '../context/ThemeContext'
import { ThemeMenu } from './ThemeMenu'

describe('ThemeMenu', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('默认触发器只显示当前主题，并在选择后更新状态名称', async () => {
    localStorage.setItem('theme', 'dark')
    const user = userEvent.setup()
    render(
      <AccentProvider>
        <ThemeProvider>
          <ThemeMenu className="theme-btn" />
        </ThemeProvider>
      </AccentProvider>,
    )

    const trigger = screen.getByRole('button', { name: '主题设置，当前深色' })
    expect(trigger.querySelectorAll('svg')).toHaveLength(1)

    await user.click(trigger)
    const menu = screen.getByRole('menu', { name: '主题设置' })
    expect(menu).toHaveAttribute('data-side', 'bottom')
    await user.click(screen.getByRole('menuitemradio', { name: '跟随系统' }))

    expect(screen.getByRole('button', { name: '主题设置，当前跟随系统' })).toBeInTheDocument()
  })
})
