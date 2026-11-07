import { useState } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MotionDetails, MotionPresence, MotionView } from './motion'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './collapsible'

const originalAnimate = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'animate')
type RunningAnimation = { cancel: ReturnType<typeof vi.fn>; onfinish: (() => void) | null }
let animations: RunningAnimation[]
let animate: ReturnType<typeof vi.fn>
let reduced = false
const listeners = new Set<() => void>()

beforeEach(() => {
  animations = []; reduced = false; listeners.clear()
  animate = vi.fn(() => {
    const animation: RunningAnimation = { cancel: vi.fn(), onfinish: null }
    animations.push(animation)
    return animation
  })
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate })
  vi.stubGlobal('matchMedia', () => ({ get matches() { return reduced }, addEventListener: (_: string, fn: () => void) => listeners.add(fn), removeEventListener: (_: string, fn: () => void) => listeners.delete(fn) }))
})
afterEach(() => {
  if (originalAnimate) Object.defineProperty(HTMLElement.prototype, 'animate', originalAnimate)
  else Reflect.deleteProperty(HTMLElement.prototype, 'animate')
  vi.unstubAllGlobals()
})

function Disclosure() {
  const [open, setOpen] = useState(false)
  return <>
    <button aria-controls="draft" aria-expanded={open} onClick={() => setOpen(value => !value)}>切换</button>
    <MotionPresence open={open} asChild keepMounted mode="disclosure"><section id="draft"><input aria-label="草稿" defaultValue="保留输入" /></section></MotionPresence>
  </>
}

describe('motion presence', () => {
  it('收起立即隔离焦点与可访问内容，退出结束才隐藏，往返保留输入节点', () => {
    render(<Disclosure />)
    const input = screen.getByLabelText('草稿')
    const panel = input.closest('section')!
    expect(panel).toHaveAttribute('hidden')
    fireEvent.click(screen.getByText('切换'))
    expect(panel).not.toHaveAttribute('hidden')
    fireEvent.change(input, { target: { value: '未保存的内容' } })
    input.focus()
    fireEvent.click(screen.getByText('切换'))
    expect(panel).toHaveAttribute('inert')
    expect(panel).toHaveAttribute('aria-hidden', 'true')
    expect(panel).not.toHaveAttribute('hidden')
    expect(screen.getByText('切换')).toHaveFocus()
    act(() => animations.at(-1)!.onfinish?.())
    expect(panel).toHaveAttribute('hidden')
    fireEvent.click(screen.getByText('切换'))
    expect(screen.getByLabelText('草稿')).toBe(input)
    expect(input).toHaveValue('未保存的内容')
    expect(panel).not.toHaveAttribute('inert')
  })

  it('快速反向开关取消旧动画，旧完成回调不能隐藏已重新打开的内容', () => {
    render(<Disclosure />)
    fireEvent.click(screen.getByText('切换'))
    const entering = animations.at(-1)!
    fireEvent.click(screen.getByText('切换'))
    const exiting = animations.at(-1)!
    fireEvent.click(screen.getByText('切换'))
    expect(entering.cancel).toHaveBeenCalled()
    expect(exiting.cancel).toHaveBeenCalled()
    act(() => exiting.onfinish?.())
    expect(screen.getByLabelText('草稿').closest('section')).not.toHaveAttribute('hidden')
    expect(screen.getByLabelText('草稿').closest('section')).not.toHaveAttribute('inert')
  })

  it('按需挂载的浮层退出结束后卸载', () => {
    const { rerender } = render(<MotionPresence open><button>浮层操作</button></MotionPresence>)
    rerender(<MotionPresence open={false}><button>浮层操作</button></MotionPresence>)
    expect(screen.getByText('浮层操作')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '浮层操作' })).not.toBeInTheDocument()
    act(() => animations.at(-1)!.onfinish?.())
    expect(screen.queryByText('浮层操作')).not.toBeInTheDocument()
  })

  it('没有动画 API 时即时切换，隐藏内容不会滞留', () => {
    Reflect.deleteProperty(HTMLElement.prototype, 'animate')
    render(<Disclosure />)
    fireEvent.click(screen.getByText('切换'))
    expect(screen.getByLabelText('草稿').closest('section')).not.toHaveAttribute('hidden')
    fireEvent.click(screen.getByText('切换'))
    expect(screen.getByLabelText('草稿').closest('section')).toHaveAttribute('hidden')
  })

  it('减少动态效果即时切换；运行中改变偏好也会清理退出画面', () => {
    render(<Disclosure />)
    fireEvent.click(screen.getByText('切换'))
    fireEvent.click(screen.getByText('切换'))
    act(() => { reduced = true; listeners.forEach(listener => listener()) })
    expect(screen.getByLabelText('草稿').closest('section')).toHaveAttribute('hidden')
    const count = animate.mock.calls.length
    fireEvent.click(screen.getByText('切换'))
    expect(animate).toHaveBeenCalledTimes(count)
    expect(screen.getByLabelText('草稿').closest('section')).not.toHaveAttribute('hidden')
  })

  it('卸载清理动画和偏好监听', () => {
    const { unmount } = render(<Disclosure />)
    fireEvent.click(screen.getByText('切换'))
    unmount()
    expect(animations.at(-1)!.cancel).toHaveBeenCalled()
    expect(listeners.size).toBe(0)
  })
})

it('分区切换只更新视觉，不重新挂载输入、不重复响应普通数据更新', () => {
  const view = (key: string, label = '内容') => <MotionView asChild motionKey={key}><section><span>{label}</span><input aria-label="保留节点" defaultValue="draft" /></section></MotionView>
  const { rerender } = render(view('first'))
  const input = screen.getByLabelText('保留节点'); input.focus()
  rerender(view('second'))
  expect(screen.getByLabelText('保留节点')).toBe(input)
  expect(input).toHaveFocus()
  expect(animate).toHaveBeenCalledTimes(1)
  rerender(view('second', '后台更新'))
  expect(animate).toHaveBeenCalledTimes(1)
})

it('折叠说明继续使用原生 details / summary 和受控 open', () => {
  const { rerender } = render(<MotionDetails open><summary>说明</summary><input aria-label="说明草稿" defaultValue="draft" /></MotionDetails>)
  const input = screen.getByLabelText('说明草稿')
  expect(input.closest('details')).toHaveAttribute('open')
  rerender(<MotionDetails open={false}><summary>说明</summary><input aria-label="说明草稿" defaultValue="draft" /></MotionDetails>)
  expect(screen.getByLabelText('说明草稿')).toBe(input)
  expect(input.closest('details')).not.toHaveAttribute('open')
})

it('Radix 非受控折叠支持退出动画，并立即禁用收起内容', () => {
  render(<Collapsible><CollapsibleTrigger>展开 Radix</CollapsibleTrigger><CollapsibleContent><input aria-label="折叠输入" /></CollapsibleContent></Collapsible>)
  expect(screen.queryByLabelText('折叠输入')).not.toBeInTheDocument()
  fireEvent.click(screen.getByText('展开 Radix'))
  const input = screen.getByLabelText('折叠输入')
  input.focus()
  fireEvent.click(screen.getByText('展开 Radix'))
  expect(input.closest('[data-slot="collapsible-content"]')).toHaveAttribute('inert')
  expect(screen.getByText('展开 Radix')).toHaveFocus()
  act(() => animations.at(-1)!.onfinish?.())
  expect(screen.queryByLabelText('折叠输入')).not.toBeInTheDocument()
})

it('Radix 受控 forceMount 折叠保留草稿，快速重开不被旧退出回调卸载', () => {
  const view = (open: boolean) => <Collapsible open={open}><CollapsibleTrigger>受控折叠</CollapsibleTrigger><CollapsibleContent forceMount><input aria-label="持久草稿" defaultValue="draft" /></CollapsibleContent></Collapsible>
  const { rerender } = render(view(true))
  const input = screen.getByLabelText('持久草稿')
  rerender(view(false))
  const exiting = animations.at(-1)!
  rerender(view(true))
  act(() => exiting.onfinish?.())
  expect(screen.getByLabelText('持久草稿')).toBe(input)
  expect(input.closest('[data-slot="collapsible-content"]')).not.toHaveAttribute('hidden')
})
