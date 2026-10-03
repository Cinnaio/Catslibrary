import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import AdultUnlockDialog from './AdultUnlockDialog'

afterEach(() => vi.unstubAllGlobals())
it('未确认成年或未获得 Turnstile 令牌时禁止提交', async () => {
  let callback!: (token: string) => void
  const remove = vi.fn()
  vi.stubGlobal('turnstile', { render: vi.fn((_element, options) => { callback = options.callback; return 'widget' }), remove })
  const onUnlock = vi.fn(async () => {})
  const { unmount } = render(<AdultUnlockDialog siteKey="test-site" onUnlock={onUnlock} onCancel={vi.fn()} />)
  const submit = screen.getByRole('button', { name: '确认开启' })
  expect(submit).toBeDisabled()
  fireEvent.click(screen.getByRole('checkbox'))
  expect(submit).toBeDisabled()
  await act(async () => {})
  act(() => callback('valid-token'))
  expect(submit).toBeEnabled()
  await act(async () => fireEvent.click(submit))
  expect(onUnlock).toHaveBeenCalledWith('valid-token')
  unmount()
  expect(remove).toHaveBeenCalledWith('widget')
})
it('未配置时显示明确提示且不能提交', () => {
  render(<AdultUnlockDialog siteKey="" onUnlock={vi.fn()} onCancel={vi.fn()} />)
  expect(screen.getByRole('alert')).toHaveTextContent('尚未配置')
  expect(screen.getByRole('button', { name: '确认开启' })).toBeDisabled()
})
