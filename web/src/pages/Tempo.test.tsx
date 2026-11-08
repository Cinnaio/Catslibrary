import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import * as matchers from '@testing-library/jest-dom/matchers'
import { DEFAULT_TEMPO_SETTINGS, readTempoData, writeTempoData } from '../lib/tempo'

expect.extend(matchers)

const mocks = vi.hoisted(() => ({ user: null as null | { id: string }, loading: false, playing: false, dispose: vi.fn() }))
vi.mock('@/context/SessionContext', () => ({ useSession: () => ({ user: mocks.user, loading: mocks.loading }) }))
vi.mock('@/hooks/useDocumentTitle', () => ({ useDocumentTitle: vi.fn() }))
vi.mock('@/lib/tempo-audio', () => ({ TempoMetronome: class {
  start() { mocks.playing = true; return Promise.resolve(true) }
  stop() { mocks.playing = false }
  dispose() { mocks.playing = false; mocks.dispose() }
} }))
import Tempo from './Tempo'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'performance', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
  localStorage.clear()
  mocks.user = null
  mocks.loading = false
  mocks.playing = false
  mocks.dispose.mockClear()
  vi.stubGlobal('AudioContext', class {})
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
})

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

function advance(ms: number) { act(() => { vi.advanceTimersByTime(ms) }) }
function start() { fireEvent.click(screen.getByRole('button', { name: '开始计时' })) }

it('pauses in the background, resumes explicitly and saves the actual foreground duration', () => {
  render(<Tempo />)
  start()
  advance(1000)
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
  fireEvent(document, new Event('visibilitychange'))
  advance(10000)
  expect(screen.getByRole('timer')).toHaveAttribute('aria-label', '剩余 04:59')
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  fireEvent(document, new Event('visibilitychange'))
  expect(screen.getByRole('button', { name: '继续计时' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '继续计时' }))
  advance(2000)
  fireEvent.click(screen.getByRole('button', { name: '结束' }))
  expect(readTempoData('guest').data.history).toEqual([expect.objectContaining({ elapsedMs: 3000, completed: false })])
})

it('completes one session once and resets the preview when the next duration changes', () => {
  render(<Tempo />)
  fireEvent.change(screen.getByLabelText('时长（分钟）'), { target: { value: '1' } })
  start()
  advance(60000)
  expect(readTempoData('guest').data.history).toEqual([expect.objectContaining({ elapsedMs: 60000, completed: true })])
  advance(2000)
  expect(readTempoData('guest').data.history).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: '3 分钟' }))
  expect(screen.getByRole('timer')).toHaveAttribute('aria-label', '剩余 03:00')
})

it('keeps sound on after starting and resuming, and stops it on pause and unmount', async () => {
  const view = render(<Tempo />)
  fireEvent.click(screen.getByRole('switch', { name: '节拍声' }))
  await act(async () => { start() })
  expect(mocks.playing).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: '暂停' }))
  expect(mocks.playing).toBe(false)
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '继续计时' })) })
  expect(mocks.playing).toBe(true)
  view.unmount()
  expect(mocks.playing).toBe(false)
  expect(mocks.dispose).toHaveBeenCalled()
})

it('switches account records and cancels the previous active session', () => {
  mocks.user = { id: 'a' }
  const view = render(<Tempo />)
  start()
  advance(1000)
  fireEvent.click(screen.getByRole('button', { name: '结束' }))
  fireEvent.click(screen.getByRole('button', { name: '再来一次' }))
  mocks.user = { id: 'b' }
  view.rerender(<Tempo />)
  expect(screen.getByRole('button', { name: '开始计时' })).toBeInTheDocument()
  expect(screen.queryByText('提前结束')).not.toBeInTheDocument()
  expect(readTempoData('user:a').data.history).toHaveLength(1)
  expect(readTempoData('user:b').data.history).toHaveLength(0)
})

it('does not expose local data while identity is loading and rejects invalid durations', () => {
  mocks.loading = true
  const view = render(<Tempo />)
  expect(screen.queryByRole('button', { name: '开始计时' })).not.toBeInTheDocument()
  mocks.loading = false
  view.rerender(<Tempo />)
  fireEvent.change(screen.getByLabelText('时长（分钟）'), { target: { value: '' } })
  expect(screen.getByRole('button', { name: '开始计时' })).toBeDisabled()
  fireEvent.change(screen.getByLabelText('时长（分钟）'), { target: { value: '2' } })
  start()
  expect(screen.getByLabelText('时长（分钟）')).toBeDisabled()
  expect(screen.getByLabelText('节拍（BPM）')).toBeDisabled()
})

it('requires confirmation to clear history and keeps settings', () => {
  writeTempoData('guest', { settings: { ...DEFAULT_TEMPO_SETTINGS, bpm: 90 }, history: [{ id: 'one', finishedAt: Date.now(), minutes: 5, bpm: 90, elapsedMs: 1000, completed: false }] })
  render(<Tempo />)
  fireEvent.click(screen.getByRole('button', { name: '清空记录' }))
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '取消' }))
  expect(readTempoData('guest').data.history).toHaveLength(1)
  advance(200)
  fireEvent.click(screen.getByRole('button', { name: '清空记录' }))
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '清空记录' }))
  expect(readTempoData('guest').data.history).toEqual([])
  expect(readTempoData('guest').data.settings.bpm).toBe(90)
})

it('keeps unsaved records visible and retries without duplicate records', () => {
  render(<Tempo />)
  start()
  advance(1000)
  const storage = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Quota exceeded') })
  fireEvent.click(screen.getByRole('button', { name: '结束' }))
  expect(screen.getByText('提前结束')).toBeInTheDocument()
  expect(readTempoData('guest').data.history).toHaveLength(0)
  storage.mockRestore()
  fireEvent.click(screen.getByRole('button', { name: '重试保存' }))
  expect(readTempoData('guest').data.history).toEqual([expect.objectContaining({ elapsedMs: 1000 })])
})

it('stops sounds on backgrounding even before the timer rerenders', async () => {
  render(<Tempo />)
  fireEvent.click(screen.getByRole('switch', { name: '节拍声' }))
  await act(async () => { start() })
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
  fireEvent(document, new Event('visibilitychange'))
  expect(mocks.playing).toBe(false)
})

it('keeps the newest speech owned after an older canceled utterance fires late', () => {
  const speak = vi.fn()
  const cancel = vi.fn()
  vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(public text: string) {} })
  vi.stubGlobal('speechSynthesis', { speak, cancel, getVoices: () => [] })
  const view = render(<Tempo />)
  fireEvent.click(screen.getByRole('switch', { name: '语音提示' }))
  start()
  const first = speak.mock.calls[0]![0] as SpeechSynthesisUtterance
  advance(60000)
  expect(speak).toHaveBeenCalledTimes(2)
  first.onerror?.(new Event('error') as SpeechSynthesisErrorEvent)
  const previousCancels = cancel.mock.calls.length
  view.unmount()
  expect(cancel).toHaveBeenCalledTimes(previousCancels + 1)
})
