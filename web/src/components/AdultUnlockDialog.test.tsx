import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import AdultUnlockDialog from './AdultUnlockDialog'

afterEach(() => vi.unstubAllGlobals())
it('未确认成年或未获得 Turnstile 令牌时禁止提交', async () => {
  let callback!: (token: string) => void
  const remove = vi.fn()
  const renderWidget = vi.fn((_element, options) => { callback = options.callback; return 'widget' })
  vi.stubGlobal('turnstile', { render: renderWidget, remove })
  const onUnlock = vi.fn(async () => {})
  const { unmount } = render(<AdultUnlockDialog siteKey="test-site" onUnlock={onUnlock} onCancel={vi.fn()} />)
  const submit = screen.getByRole('button', { name: '确认开启' })
  expect(submit).toBeDisabled()
  fireEvent.click(screen.getByRole('checkbox'))
  expect(submit).toBeDisabled()
  await act(async () => {})
  expect(renderWidget).toHaveBeenCalledWith(expect.any(HTMLElement), expect.objectContaining({
    sitekey: 'test-site', action: 'r18_unlock', theme: 'auto', size: 'flexible',
  }))
  act(() => callback('valid-token'))
  expect(submit).toBeEnabled()
  await act(async () => fireEvent.click(submit))
  expect(onUnlock).toHaveBeenCalledWith('valid-token')
  unmount()
  expect(remove).toHaveBeenCalledWith('widget')
})
it('取消仍调用原有关闭回调', () => {
  const onCancel = vi.fn()
  render(<AdultUnlockDialog siteKey="" onUnlock={vi.fn()} onCancel={onCancel} />)
  fireEvent.click(screen.getByRole('button', { name: '取消' }))
  expect(onCancel).toHaveBeenCalledOnce()
})
it('未配置时显示明确提示且不能提交', () => {
  render(<AdultUnlockDialog siteKey="" onUnlock={vi.fn()} onCancel={vi.fn()} />)
  expect(screen.getByRole('alert')).toHaveTextContent('尚未配置')
  expect(screen.getByRole('button', { name: '确认开启' })).toBeDisabled()
})
