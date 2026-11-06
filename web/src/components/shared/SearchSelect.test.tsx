import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import SearchSelect from '@/components/shared/SearchSelect'

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as typeof ResizeObserver
}
Element.prototype.scrollIntoView = () => undefined

describe('SearchSelect', () => {
  it('分批挂载候选，并允许继续浏览完整索引和搜索结果', async () => {
    const options = Array.from({ length: 2000 }, (_, index) => ({
      value: `novel-${index}`,
      label: `小说 ${index}`,
    }))

    render(<SearchSelect searchable options={options} value="" onChange={() => undefined} />)

    fireEvent.click(screen.getByRole('combobox'))

    expect(screen.getAllByRole('option')).toHaveLength(100)
    expect(screen.getByText('已显示 100 项，共 2000 项')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '继续显示 100 项' }))
    expect(screen.getAllByRole('option')).toHaveLength(200)
    fireEvent.change(screen.getByPlaceholderText('搜索…'), { target: { value: '小说 1' } })
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(100))
    fireEvent.click(screen.getByRole('button', { name: '继续显示 100 项' }))
    expect(screen.getAllByRole('option')).toHaveLength(200)
  })

  it('keeps a selected option visible and searches the complete index', async () => {
    const options = Array.from({ length: 2000 }, (_, index) => ({
      value: `novel-${index}`,
      label: `小说 ${index}`,
    }))

    const { unmount } = render(<SearchSelect searchable options={options} value="novel-1999" onChange={() => undefined} />)

    fireEvent.click(screen.getByRole('combobox'))

    expect(screen.getByRole('option', { name: '小说 1999' })).toBeInTheDocument()
    expect(screen.getAllByRole('option')).toHaveLength(100)

    unmount()
    render(<SearchSelect searchable options={options} value="" onChange={() => undefined} />)
    fireEvent.click(screen.getByRole('combobox'))
    fireEvent.change(screen.getByPlaceholderText('搜索…'), { target: { value: '小说 1999' } })

    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1))
    expect(screen.getByRole('option', { name: '小说 1999' })).toBeInTheDocument()
  })

  it('compact 保留宽度上限，不会把触发器放宽到无约束', () => {
    // 回归：compact 曾用 max-w-none，裸用在 flex 工具条里时按钮会被拉到满宽
    // （实测各占 1440px，两个筛选器各占一整行）。宽度上限必须由 compact 自带。
    render(<SearchSelect compact options={[{ value: '', label: '全部分级' }]} value="" onChange={() => undefined} />)

    const trigger = screen.getByRole('combobox')
    expect(trigger).toHaveAttribute('data-field', 'select')
    expect(trigger).toHaveAttribute('data-field-size', 'sm')
    expect(trigger.className).toContain('max-w-[var(--select-compact-width,11rem)]')
    expect(trigger.className).not.toContain('max-w-none')
  })

  it('调用方的 className 仍可覆盖 compact 的宽度上限', () => {
    render(<SearchSelect compact className="w-40" options={[{ value: '', label: '全部分级' }]} value="" onChange={() => undefined} />)

    const trigger = screen.getByRole('combobox')
    // 自定义宽度后写，保留覆盖能力
    expect(trigger.className).toContain('w-40')
    expect(trigger.className.indexOf('w-40')).toBeGreaterThan(trigger.className.indexOf('max-w-[var(--select-compact-width,11rem)]'))
  })

  it('非 compact 表单下拉保留 400px 上限', () => {
    render(<SearchSelect options={[{ value: '', label: '全部分级' }]} value="" onChange={() => undefined} />)

    expect(screen.getByRole('combobox').className).toContain('max-w-[400px]')
  })

  it('长候选默认折叠到选中项附近，展开后才渲染全部', () => {
    // 章节锚点类下拉动辄几百项：一次全挂进浮层会把弹窗撑成整屏，也拖慢打开。
    const options = Array.from({ length: 40 }, (_, index) => ({ value: `c${index}`, label: `第 ${index} 章` }))

    render(
      <SearchSelect matchTriggerWidth compactThreshold={12} options={options} value="c20" onChange={() => undefined} expandAllLabel="展开全部 {count} 项" />,
    )
    fireEvent.click(screen.getByRole('combobox'))

    expect(screen.getByRole('option', { name: '第 20 章' })).toBeInTheDocument()
    expect(screen.getAllByRole('option')).toHaveLength(9)
    expect(screen.getByRole('option', { name: '第 16 章' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '展开全部 40 项' }))
    expect(screen.getAllByRole('option')).toHaveLength(40)
    expect(screen.queryByRole('button', { name: '展开全部 40 项' })).not.toBeInTheDocument()
  })

  it('候选不超过阈值时不折叠', () => {
    const options = Array.from({ length: 12 }, (_, index) => ({ value: `c${index}`, label: `第 ${index} 章` }))

    render(<SearchSelect compactThreshold={12} options={options} value="" onChange={() => undefined} />)
    fireEvent.click(screen.getByRole('combobox'))

    expect(screen.getAllByRole('option')).toHaveLength(12)
    expect(screen.queryByRole('button', { name: /展开全部/ })).not.toBeInTheDocument()
  })

  it('未声明阈值时不折叠，搜索型下拉保持完整候选', () => {
    // 回归：折叠若做成默认行为，小说全库索引会只剩 9 项，且底部「请输入关键词」提示被折叠行顶掉。
    const options = Array.from({ length: 40 }, (_, index) => ({ value: `c${index}`, label: `第 ${index} 章` }))

    render(<SearchSelect options={options} value="" onChange={() => undefined} />)
    fireEvent.click(screen.getByRole('combobox'))

    expect(screen.getAllByRole('option')).toHaveLength(40)
    expect(screen.queryByRole('button', { name: /展开全部/ })).not.toBeInTheDocument()
  })

  it('受控搜索不再渲染第二个搜索框，空结果用调用方给的文案', () => {
    // 调用方通常已经有「查找章节」输入框；浮层里再出一个搜索框会让用户不知道往哪打字。
    render(<SearchSelect search="没有这一章" onSearchChange={() => undefined} options={[]} value="" onChange={() => undefined} emptyText="没有匹配的章节" />)
    fireEvent.click(screen.getByRole('combobox'))

    expect(screen.queryByPlaceholderText('搜索…')).not.toBeInTheDocument()
    expect(screen.getByText('没有匹配的章节')).toBeInTheDocument()
  })

  it('行尾注记同时出现在浮层选项与触发器上', () => {
    const options = [
      { value: 'a', label: '第 1 章', note: '本轮新增' },
      { value: 'b', label: '第 2 章' },
    ]

    render(<SearchSelect options={options} value="a" onChange={() => undefined} />)

    expect(screen.getByRole('combobox')).toHaveTextContent('第 1 章本轮新增')

    fireEvent.click(screen.getByRole('combobox'))
    const option = screen.getByRole('option', { name: /第 1 章/ })
    expect(option).toHaveTextContent('本轮新增')
  })
})
