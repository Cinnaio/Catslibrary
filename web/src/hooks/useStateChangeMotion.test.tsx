import { useState } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStateChangeMotion } from './useStateChangeMotion'

const originalAnimate = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'animate')
let animations: Array<{ cancel: ReturnType<typeof vi.fn>; onfinish: (() => void) | null }>
let animate: ReturnType<typeof vi.fn>
let reduced = false
let preferenceChanged: (() => void) | undefined
function Example() {
  const [mode, setMode] = useState('login')
  const { root: motionRef, prepare } = useStateChangeMotion(mode, '.surface')
  return <section ref={motionRef}>
    <h1 className="surface">{mode}</h1>
    <div className="surface"><input aria-label="账号" defaultValue="reader" /></div>
    <button onClick={event => { prepare(event); setMode(value => value === 'login' ? 'register' : 'login') }}>切换</button>
  </section>
}
beforeEach(() => {
  animations = []; reduced = false; preferenceChanged = undefined
  animate = vi.fn(() => { const animation = { cancel: vi.fn(), onfinish: null }; animations.push(animation); return animation })
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate })
  vi.stubGlobal('matchMedia', () => ({ get matches() { return reduced }, addEventListener: (_: string, listener: () => void) => { preferenceChanged = listener }, removeEventListener: vi.fn() }))
})
afterEach(() => {
  if (originalAnimate) Object.defineProperty(HTMLElement.prototype, 'animate', originalAnimate)
  else Reflect.deleteProperty(HTMLElement.prototype, 'animate')
  vi.unstubAllGlobals()
})
describe('useStateChangeMotion', () => {
  it('初次访问不入场；指针切换复用输入节点并使用共享节奏', () => {
    render(<Example />)
    const input = screen.getByLabelText('账号')
    expect(animate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('切换'), { detail: 1 })
    expect(screen.getByLabelText('账号')).toBe(input)
    expect(input).toHaveValue('reader')
    expect(animate).toHaveBeenCalledTimes(2)
    expect(animate).toHaveBeenCalledWith([{ opacity: '0.6', transform: 'translateY(4px)' }, { opacity: '1', transform: 'none' }], { duration: 180, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' })
  })
  it('快速切换从当前画面续接而不是排队', () => {
    render(<Example />)
    fireEvent.click(screen.getByText('切换'), { detail: 1 })
    const heading = screen.getByRole('heading')
    heading.style.opacity = '0.8'; heading.style.transform = 'translateY(2px)'
    fireEvent.click(screen.getByText('切换'), { detail: 1 })
    expect(animations[0]!.cancel).toHaveBeenCalledOnce()
    expect(animate.mock.calls[2]![0][0]).toEqual({ opacity: '0.8', transform: 'translateY(2px)' })
    expect(screen.getByRole('heading')).toHaveTextContent('login')
  })
  it('键盘切换即时取消未完成动画，不移动焦点', () => {
    render(<Example />)
    fireEvent.click(screen.getByText('切换'), { detail: 1 })
    const input = screen.getByLabelText('账号'); input.focus()
    fireEvent.click(screen.getByText('切换'), { detail: 0 })
    expect(animate).toHaveBeenCalledTimes(2)
    expect(animations[0]!.cancel).toHaveBeenCalledOnce()
    expect(input).toHaveFocus()
  })
  it('减少动态效果只保留短淡入；偏好变化和卸载清理动画', () => {
    reduced = true
    const { unmount } = render(<Example />)
    fireEvent.click(screen.getByText('切换'), { detail: 1 })
    expect(animate).toHaveBeenCalledWith([{ opacity: '0.9', transform: 'none' }, { opacity: '1', transform: 'none' }], expect.objectContaining({ duration: 100 }))
    act(() => preferenceChanged?.())
    expect(animations[0]!.cancel).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByText('切换'), { detail: 1 })
    unmount()
    expect(animations[2]!.cancel).toHaveBeenCalledOnce()
  })
  it('无动画 API 仍正常切换，不影响输入', () => {
    Reflect.deleteProperty(HTMLElement.prototype, 'animate')
    render(<Example />)
    fireEvent.click(screen.getByText('切换'), { detail: 1 })
    expect(screen.getByRole('heading')).toHaveTextContent('register')
    expect(screen.getByLabelText('账号')).toHaveValue('reader')
  })
})
