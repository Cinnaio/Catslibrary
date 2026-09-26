import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// jsdom 不实现 ResizeObserver，而 cmdk（CustomSelect 的下拉）在挂载时就会构造它。
// 不补这个桩，任何打开过下拉的用例都会以 ReferenceError 崩掉。
if (!('ResizeObserver' in globalThis)) {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Object.defineProperty(globalThis, 'ResizeObserver', { writable: true, configurable: true, value: ResizeObserverStub })
}

// jsdom 同样没有实现 scrollIntoView，而 cmdk 在选中项变化时会调用它来滚动列表。
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {}
}

// jsdom 的 PointerEvent 缺失会让 Radix Popover 的部分交互（如打开下拉）失效。
if (!('PointerEvent' in globalThis)) {
  Object.defineProperty(globalThis, 'PointerEvent', { writable: true, configurable: true, value: MouseEvent })
}

// 未开启 vitest globals 时 testing-library 不会自动 cleanup，手动挂上
afterEach(() => {
  cleanup()
})
