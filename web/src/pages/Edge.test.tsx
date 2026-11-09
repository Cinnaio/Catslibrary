import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import * as matchers from '@testing-library/jest-dom/matchers'
import { readEdgeData } from '../lib/edge'

expect.extend(matchers)

const mocks = vi.hoisted(() => ({
  user: null as null | { id: string },
  loading: false,
  policy: { mode: 'adult' as 'adult' | 'safe', setMode: vi.fn(), adultContentEnabled: true, checking: false, policyError: '' },
}))

vi.mock('@/context/SessionContext', () => ({
  useSession: () => ({ user: mocks.user, loading: mocks.loading }),
  useOptionalSession: () => ({ user: mocks.user, loading: mocks.loading }),
}))
vi.mock('@/context/ContentPolicyContext', () => ({ useContentPolicy: () => mocks.policy }))
vi.mock('@/hooks/useDocumentTitle', () => ({ useDocumentTitle: vi.fn() }))
vi.mock('@/lib/edge-audio', () => ({ EdgeAudio: class {
  start() { return Promise.resolve(true) }
  startHeartbeat() { return Promise.resolve(true) }
  stop() {}
  stopHeartbeat() {}
  dispose() {}
} }))

import Edge from './Edge'

function renderEdge() {
  return render(<MemoryRouter><Edge /></MemoryRouter>)
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'performance', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
  localStorage.clear()
  mocks.user = { id: 'reader' }
  mocks.policy = { mode: 'adult', setMode: vi.fn(), adultContentEnabled: true, checking: false, policyError: '' }
  vi.stubGlobal('AudioContext', class {})
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
})

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('gates the tool behind the adult content mode', () => {
  mocks.policy = { mode: 'safe', setMode: vi.fn(), adultContentEnabled: true, checking: false, policyError: '' }
  renderEdge()
  expect(screen.getByText('节拍指令需要成人内容模式')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '开始这一局' })).not.toBeInTheDocument()
})

it('runs a round and records the finished session for the current account', () => {
  renderEdge()
  fireEvent.click(screen.getByRole('button', { name: '开始这一局' }))
  expect(screen.getByRole('button', { name: '不玩了' })).toBeInTheDocument()
  // 这一局开始后规则锁定。
  expect(screen.getByLabelText('时长（分钟）')).toBeDisabled()
  for (const name of ['三幕结构', '时间银行', '申报时机判定', '较长的指令']) {
    expect(screen.getByRole('switch', { name: new RegExp(name) })).toBeDisabled()
  }
  expect(screen.getByRole('switch', { name: /隐藏剩余时间/ })).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: '不玩了' }))
  expect(screen.getByRole('button', { name: '再来一次' })).toBeInTheDocument()
  expect(readEdgeData('user:reader').data.history).toEqual([expect.objectContaining({ ending: 'ended', difficulty: 'easy' })])
  expect(readEdgeData('guest').data.history).toHaveLength(0)
  expect(screen.getByRole('switch', { name: /三幕结构/ })).toBeEnabled()
})

it('hides timing feedback and uses the fixed bonus when its rule is disabled', () => {
  renderEdge()
  fireEvent.click(screen.getByRole('switch', { name: /申报时机判定/ }))
  fireEvent.click(screen.getByRole('button', { name: '开始这一局' }))
  expect(screen.queryByRole('button', { name: '磨着不停' })).not.toBeInTheDocument()
  expect(screen.queryByText(/现在按太早|还可以再撑|就是现在/)).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '忍住了' }))
  expect(screen.getAllByText(/许可率 90%/).length).toBeGreaterThan(0)
})

it('validates the editable overtime duration before saving or starting', () => {
  renderEdge()
  fireEvent.click(screen.getByRole('button', { name: '加时赛' }))
  const input = screen.getByLabelText('单次加时（秒）')
  expect(input).toHaveAttribute('min', '45')
  fireEvent.change(input, { target: { value: '' } })
  expect(screen.getByRole('button', { name: '开始这一局' })).toBeDisabled()
  fireEvent.change(input, { target: { value: '90' } })
  fireEvent.blur(input)
  expect(readEdgeData('user:reader').data.settings.overtimeSeconds).toBe(90)
  fireEvent.click(screen.getByRole('button', { name: '开始这一局' }))
  expect(input).toBeDisabled()
})

it('keeps the saved overtime duration when an invalid draft is hidden by another finale', () => {
  renderEdge()
  fireEvent.click(screen.getByRole('button', { name: '加时赛' }))
  const input = screen.getByLabelText('单次加时（秒）')
  fireEvent.change(input, { target: { value: '90' } })
  fireEvent.blur(input)
  fireEvent.change(input, { target: { value: '' } })
  fireEvent.click(screen.getByRole('button', { name: '必定允许' }))
  expect(screen.queryByLabelText('单次加时（秒）')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '开始这一局' })).toBeEnabled()
  fireEvent.change(screen.getByLabelText('时长（分钟）'), { target: { value: '6' } })
  fireEvent.click(screen.getByRole('button', { name: '开始这一局' }))
  expect(readEdgeData('user:reader').data.settings).toMatchObject({ minutes: 6, overtimeSeconds: 90, finale: 'always' })
  expect(screen.getByRole('button', { name: '不玩了' })).toBeInTheDocument()
})

it('declares an edge only outside the hands-off phase and adds the chance bonus', () => {
  renderEdge()
  fireEvent.click(screen.getByRole('button', { name: '开始这一局' }))
  const declare = screen.getByRole('button', { name: '忍住了' })
  if (screen.queryByRole('heading', { name: '松手', level: 2 })) {
    expect(declare).toBeDisabled()
  }
  // 推进到第一个非红色相位后再申报；随机源是会话内的种子，结果稳定。
  for (let step = 0; step < 60 && screen.queryByRole('heading', { name: '松手', level: 2 }); step += 1) {
    act(() => { vi.advanceTimersByTime(1000) })
  }
  fireEvent.click(screen.getByRole('button', { name: '忍住了' }))
  expect(screen.getByText(/第 1 次申报记下了/)).toBeInTheDocument()
  // 时机判定开启时，刚切进新指令就按属于 early，只加 1%；这里只断言确实涨了。
  expect(screen.getAllByText(/许可率 8[6-9]%|许可率 90%/).length).toBeGreaterThan(0)
})

it('finishes through the permit window after the planned duration', () => {
  renderEdge()
  fireEvent.change(screen.getByLabelText('时长（分钟）'), { target: { value: '1' } })
  fireEvent.click(screen.getByRole('button', { name: '开始这一局' }))
  act(() => { vi.advanceTimersByTime(61_000) })
  fireEvent.click(screen.getByRole('button', { name: '按下了' }))
  expect(readEdgeData('user:reader').data.history[0]).toMatchObject({ ending: 'permitted', minutes: 1 })
})
