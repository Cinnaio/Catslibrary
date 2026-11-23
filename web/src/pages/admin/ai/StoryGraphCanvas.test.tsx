import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { StoryGraph } from '@shared/story-graph'
import StoryGraphCanvas from './StoryGraphCanvas'

const graph: StoryGraph = {
  version: 1,
  people: ['a', 'b'].map((id) => ({ id, name: id, aliases: [], summary: '', evidence: [] })),
  relationships: [{ id: 'r', from: 'a', to: 'b', label: '相识', summary: '', directed: false, certainty: 'fact', evidence: [] }],
  threads: [],
}
function mount() {
  const onSelect = vi.fn()
  render(<StoryGraphCanvas graph={graph} selected="" onSelect={onSelect} showThreads={false} focusOnly={false} />)
  const svg = screen.getByRole('group', { name: /可交互故事图谱/ })
  return { svg, onSelect, transform: () => svg.querySelector('g[transform]')!.getAttribute('transform') }
}
describe('story graph navigation', () => {
  it('lets ordinary wheel events scroll the page and only consumes modified zoom gestures', () => {
    const { svg, transform } = mount()
    const initial = transform()
    const scroll = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 100 })
    fireEvent(svg, scroll)
    expect(scroll.defaultPrevented).toBe(false)
    expect(transform()).toBe(initial)
    const zoom = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -100, ctrlKey: true })
    fireEvent(svg, zoom)
    expect(zoom.defaultPrevented).toBe(true)
    expect(transform()).not.toBe(initial)
    fireEvent.click(screen.getByRole('button', { name: '适应当前图谱' }))
    expect(transform()).toBe(initial)
  })
  it('supports keyboard pan without intercepting a node selection', () => {
    const { svg, transform, onSelect } = mount()
    const initial = transform()
    fireEvent.keyDown(svg, { key: 'ArrowLeft' })
    expect(transform()).not.toBe(initial)
    fireEvent.keyDown(screen.getByRole('button', { name: '人物：a' }), { key: 'Enter' })
    expect(onSelect).toHaveBeenCalledWith('a')
    fireEvent.click(screen.getByRole('button', { name: '重置布局和缩放' }))
    expect(transform()).toBe(initial)
  })
  it('keeps dragging a node separate from selecting it', () => {
    const { svg, onSelect } = mount()
    Object.assign(svg, { setPointerCapture: vi.fn(), hasPointerCapture: () => true, releasePointerCapture: vi.fn() })
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 900,
      bottom: 560,
      width: 900,
      height: 560,
      toJSON: () => ({}),
    })
    const person = screen.getByRole('button', { name: '人物：a' })
    function pointer(target: Element, type: string, x: number) {
      const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: 100 })
      Object.defineProperties(event, { isPrimary: { value: true }, pointerId: { value: 1 } })
      fireEvent(target, event)
    }
    const initial = person.getAttribute('transform')
    pointer(person, 'pointerdown', 100)
    pointer(svg, 'pointermove', 160)
    pointer(svg, 'pointerup', 160)
    fireEvent.click(person, { detail: 1 })
    expect(person.getAttribute('transform')).not.toBe(initial)
    expect(onSelect).not.toHaveBeenCalled()
    pointer(person, 'pointerdown', 160)
    pointer(svg, 'pointerup', 160)
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('a')
  })
})
