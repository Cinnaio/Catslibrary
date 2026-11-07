import { useState } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useListMotion } from './useListMotion'

const originalAnimate = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'animate')
let animations: Array<{ finish: () => void; cancel: ReturnType<typeof vi.fn> }>
let animate: ReturnType<typeof vi.fn>

beforeEach(() => {
  animations = []
  animate = vi.fn(() => {
    let finish!: () => void
    const finished = new Promise<void>(resolve => { finish = resolve })
    const animation = { finished, finish, cancel: vi.fn(() => finish()), onfinish: null }
    animations.push(animation)
    return animation
  })
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate })
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(() => [new DOMRect(0, 0, 100, 40)] as unknown as DOMRectList)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function(this: HTMLElement) {
    return new DOMRect(0, Array.from(this.parentElement?.children || []).indexOf(this) * 40, 100, 40)
  })
})
afterEach(() => {
  if (originalAnimate) Object.defineProperty(HTMLElement.prototype, 'animate', originalAnimate)
  else Reflect.deleteProperty(HTMLElement.prototype, 'animate')
  vi.restoreAllMocks(); vi.unstubAllGlobals()
})

function List({ scope = 'reader' }: { scope?: string }) {
  const [ids, setIds] = useState(['first', 'second', 'third'])
  const motion = useListMotion(scope)
  return <>
    <button onClick={() => setIds(['second', 'third'])}>静默更新</button>
    <button onClick={async () => { await motion.remove('first'); motion.prepare(); setIds(['second', 'third']) }}>移除</button>
    <div ref={motion.root}>{ids.map(id => <article key={id} data-motion-item={id}>{id}</article>)}</div>
  </>
}

it('普通数据更新不触发列表动效', () => {
  render(<List />)
  fireEvent.click(screen.getByText('静默更新'))
  expect(screen.queryByText('first')).not.toBeInTheDocument()
  expect(animate).not.toHaveBeenCalled()
})

it('主动移除先退出，随后对保留节点补位，不复制条目', async () => {
  render(<List />)
  const second = screen.getByText('second')
  fireEvent.click(screen.getByText('移除'))
  expect(screen.getByText('first')).toHaveAttribute('aria-hidden', 'true')
  await act(async () => animations[0]!.finish())
  expect(screen.queryByText('first')).not.toBeInTheDocument()
  expect(screen.getByText('second')).toBe(second)
  expect(animate).toHaveBeenCalledTimes(3)
  expect(animate.mock.calls[1]![0]).toEqual([{ transform: 'translate(0px, 40px)' }, { transform: 'none' }])
})

it('切换账户或视图时取消待结束的动画，释放等待', async () => {
  const { rerender } = render(<List />)
  fireEvent.click(screen.getByText('移除'))
  await act(async () => { rerender(<List scope="other-account" />) })
  expect(animations[0]!.cancel).toHaveBeenCalled()
})
