import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import ThoughtImage from './ThoughtImage'
import ThoughtPanel from './ThoughtPanel'
import type { Thought } from '@shared/types'

const api = vi.hoisted(() => ({ imageBlob: vi.fn() }))
vi.mock('../../lib/api', () => ({ thoughtsApi: { imageBlob: api.imageBlob } }))

beforeEach(() => {
  api.imageBlob.mockReset().mockResolvedValue(new Blob(['image'], { type: 'image/webp' }))
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn(() => 'blob:thought-image')
    static revokeObjectURL = vi.fn()
  })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('点击图片打开大图，复用已加载图片，关闭后恢复焦点', async () => {
  render(<ThoughtImage id="thought-1" />)
  const trigger = await screen.findByRole('button', { name: '放大查看插画' })
  fireEvent.click(trigger)
  const dialog = screen.getByRole('dialog', { name: '插画大图' })
  expect(within(dialog).getByRole('img')).toHaveAttribute('src', 'blob:thought-image')
  expect(api.imageBlob).toHaveBeenCalledTimes(1)
  fireEvent.click(within(dialog).getByRole('button', { name: '关闭图片预览' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  await waitFor(() => expect(trigger).toHaveFocus())
})

it('想法面板中按 Esc 只关闭大图，保留原面板', async () => {
  render(<ThoughtPanel open thoughts={[{ id: 'thought-1', thoughtText: '插画想法', imageUrl: '/api/thoughts/image/thought-1', createdAt: 1 } as Thought]} selectedText="" paragraphExcerpt="雨夜" canDelete={() => false} onClose={vi.fn()} onSubmit={vi.fn()} onDelete={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: '放大查看插画' }))
  expect(screen.getByRole('dialog', { name: '插画大图' })).toBeVisible()
  fireEvent.keyDown(document, { key: 'Escape' })
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '插画大图' })).not.toBeInTheDocument())
  expect(screen.getByRole('dialog', { name: '本段想法' })).toBeVisible()
})

it('点击大图外部背景可关闭预览', async () => {
  render(<ThoughtImage id="thought-1" />)
  fireEvent.click(await screen.findByRole('button', { name: '放大查看插画' }))
  // Radix 在打开后的下一帧安装外部 pointerdown 监听。
  await new Promise((resolve) => setTimeout(resolve, 10))
  const overlay = document.querySelector('.thought-image-preview-overlay')!
  fireEvent.pointerDown(overlay)
  fireEvent.pointerUp(overlay)
  fireEvent.click(overlay)
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})
