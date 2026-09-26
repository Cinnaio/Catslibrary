import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import CustomSelect from './CustomSelect'

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as typeof ResizeObserver
}
Element.prototype.scrollIntoView = () => undefined

describe('CustomSelect', () => {
  it('does not mount every searchable option when a large index is opened', () => {
    const options = Array.from({ length: 2000 }, (_, index) => ({
      value: `novel-${index}`,
      label: `小说 ${index}`,
    }))

    render(<CustomSelect searchable options={options} value="" onChange={() => undefined} />)

    fireEvent.click(screen.getByRole('combobox'))

    expect(screen.getAllByRole('option')).toHaveLength(100)
    expect(screen.getByText('共 2000 项，请输入关键词继续筛选')).toBeInTheDocument()
  })

  it('keeps a selected option visible and searches the complete index', async () => {
    const options = Array.from({ length: 2000 }, (_, index) => ({
      value: `novel-${index}`,
      label: `小说 ${index}`,
    }))

    const { unmount } = render(<CustomSelect searchable options={options} value="novel-1999" onChange={() => undefined} />)

    fireEvent.click(screen.getByRole('combobox'))

    expect(screen.getByRole('option', { name: '小说 1999' })).toBeInTheDocument()
    expect(screen.getAllByRole('option')).toHaveLength(100)

    unmount()
    render(<CustomSelect searchable options={options} value="" onChange={() => undefined} />)
    fireEvent.click(screen.getByRole('combobox'))
    fireEvent.change(screen.getByPlaceholderText('搜索…'), { target: { value: '小说 1999' } })

    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1))
    expect(screen.getByRole('option', { name: '小说 1999' })).toBeInTheDocument()
  })

  it('compact 保留宽度上限，不会把触发器放宽到无约束', () => {
    // 回归：compact 曾用 max-w-none，裸用在 flex 工具条里时按钮会被拉到满宽
    // （实测各占 1440px，两个筛选器各占一整行）。宽度上限必须由 compact 自带。
    render(<CustomSelect compact options={[{ value: '', label: '全部分级' }]} value="" onChange={() => undefined} />)

    const trigger = screen.getByRole('combobox')
    expect(trigger.className).toContain('h-8')
    expect(trigger.className).toContain('max-w-[var(--admin-filter-width)]')
    expect(trigger.className).not.toContain('max-w-none')
  })

  it('调用方的 className 仍可覆盖 compact 的宽度上限', () => {
    render(<CustomSelect compact className="w-40" options={[{ value: '', label: '全部分级' }]} value="" onChange={() => undefined} />)

    const trigger = screen.getByRole('combobox')
    // 自定义宽度后写，保留覆盖能力
    expect(trigger.className).toContain('w-40')
    expect(trigger.className.indexOf('w-40')).toBeGreaterThan(trigger.className.indexOf('max-w-[var(--admin-filter-width)]'))
  })

  it('非 compact 表单下拉保留 400px 上限', () => {
    render(<CustomSelect options={[{ value: '', label: '全部分级' }]} value="" onChange={() => undefined} />)

    expect(screen.getByRole('combobox').className).toContain('max-w-[400px]')
  })
})
