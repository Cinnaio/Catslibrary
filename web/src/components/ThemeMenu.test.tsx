import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { AccentProvider } from '../context/AccentContext'
import { ThemeProvider } from '../context/ThemeContext'
import '../styles/theme-menu.css'
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
    expect(trigger).toHaveAttribute('data-state', 'open')
    const menu = screen.getByRole('menu', { name: '主题设置' })
    expect(menu).toHaveAttribute('data-side', 'bottom')
    await user.click(screen.getByRole('menuitemradio', { name: '跟随系统' }))

    expect(trigger).toHaveAttribute('data-state', 'closed')
    expect(screen.getByRole('button', { name: '主题设置，当前跟随系统' })).toBeInTheDocument()
  })

  it('关闭时弹层锚定在触发器右侧，避免隐形弹层撑宽页面', () => {
    render(
      <AccentProvider>
        <ThemeProvider>
          <ThemeMenu className="theme-btn" />
        </ThemeProvider>
      </AccentProvider>,
    )

    const popover = document.querySelector('.theme-menu__popover')!
    expect(popover.parentElement).toHaveAttribute('data-align', 'end')
    expect(popover).toHaveStyle({ right: '0px' })
  })
})
