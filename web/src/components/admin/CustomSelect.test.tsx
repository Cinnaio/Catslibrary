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
})
