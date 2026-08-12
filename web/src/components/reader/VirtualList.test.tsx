import { describe, expect, it } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { VirtualList } from './VirtualList'

const items = Array.from({ length: 100 }, (_, i) => `item-${i}`)

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

describe('VirtualList', () => {
  it('初始只渲染可视区（含缓冲）内的行', () => {
    render(<VirtualList items={items} rowHeight={34} renderRow={(item) => <span>{item}</span>} />)
    // jsdom 无布局：clientHeight 为 0，组件回退为 8 行视口 + 4 行缓冲
    expect(screen.getByText('item-0')).toBeInTheDocument()
    expect(screen.getByText('item-11')).toBeInTheDocument()
    expect(screen.queryByText('item-12')).not.toBeInTheDocument()
  })

  it('滚动后按全局绝对索引渲染行（renderRow 收到正确 index）', async () => {
    const seen = new Map<string, number>()
    const { container } = render(
      <VirtualList
        items={items}
        rowHeight={34}
        renderRow={(item, index) => {
          seen.set(item, index)
          return <span>{item}</span>
        }}
      />,
    )
    const scroller = container.firstElementChild as HTMLElement
    Object.defineProperty(scroller, 'scrollTop', { value: 340, writable: true })
    // paint 在 rAF 回调里 setState，需要在 act 内等待该帧完成
    await act(async () => {
      fireEvent.scroll(scroller)
      await nextFrame()
    })

    // first = floor(340/34) - 4 = 6
    expect(screen.getByText('item-6')).toBeInTheDocument()
    expect(screen.queryByText('item-0')).not.toBeInTheDocument()
    expect(seen.get('item-6')).toBe(6)

    // 行的绝对定位 top 必须与全局索引对应（key 错位会导致行叠错位置）
    const row6 = screen.getByText('item-6').parentElement as HTMLElement
    expect(row6.style.top).toBe(`${6 * 34}px`)
  })
})
