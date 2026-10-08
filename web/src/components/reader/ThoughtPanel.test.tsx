import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import type { Thought } from '@shared/types'
import ThoughtPanel from './ThoughtPanel'
it('无法定位的想法仍可查看原引用和删除，禁止在旧下标继续发布', () => {
  render(<ThoughtPanel open readOnly thoughts={[{ id: 't', thoughtText: '历史想法', selectedText: '原引用', createdAt: 1 } as Thought]} selectedText="" paragraphExcerpt="" canDelete={() => true} onClose={vi.fn()} onSubmit={vi.fn()} onDelete={vi.fn()} />)
  expect(screen.getByText('历史想法')).toBeVisible()
  expect(screen.getByText('原引用')).toBeVisible()
  expect(screen.getByRole('button', { name: '删除' })).toBeVisible()
  expect(screen.queryByRole('button', { name: '发布想法' })).not.toBeInTheDocument()
})

it('划词写想法只展示所选引用，不同时展示整段摘要', () => {
  render(<ThoughtPanel open thoughts={[]} selectedText="所选文字" paragraphExcerpt="整段正文所选文字后续正文" canDelete={() => false} onClose={vi.fn()} onSubmit={vi.fn()} onDelete={vi.fn()} />)
  expect(screen.getByText('划选：所选文字')).toBeVisible()
  expect(screen.queryByText('整段正文所选文字后续正文')).not.toBeInTheDocument()
})

it('授权用户可提交空配文图片任务，普通发布不被误触发', async () => {
  const generate = vi.fn().mockResolvedValue(undefined)
  const submit = vi.fn()
  render(<ThoughtPanel open canGenerateImage thoughts={[]} selectedText="雨夜" paragraphExcerpt="" canDelete={() => false} onClose={vi.fn()} onSubmit={submit} onDelete={vi.fn()} onGenerateImage={generate} />)
  fireEvent.click(screen.getByRole('button', { name: '生成图片并发布想法' }))
  await waitFor(() => expect(generate).toHaveBeenCalledWith('', ''))
  expect(submit).not.toHaveBeenCalled()
})

it('无权限或没有划选文字时不显示出图入口', () => {
  const props = { open: true, thoughts: [], selectedText: '雨夜', paragraphExcerpt: '', canDelete: () => false, onClose: vi.fn(), onSubmit: vi.fn(), onDelete: vi.fn() }
  const view = render(<ThoughtPanel {...props} />)
  expect(screen.queryByRole('button', { name: '生成图片并发布想法' })).toBeNull()
  view.rerender(<ThoughtPanel {...props} canGenerateImage selectedText="" />)
  expect(screen.queryByRole('button', { name: '生成图片并发布想法' })).toBeNull()
})

it('图片生成期间禁用重复提交并展示后台进度', () => {
  const generate = vi.fn()
  render(<ThoughtPanel open canGenerateImage imageGenerating imageStatus="正在生成插画，可继续阅读" thoughts={[]} selectedText="雨夜" paragraphExcerpt="" canDelete={() => false} onClose={vi.fn()} onSubmit={vi.fn()} onDelete={vi.fn()} onGenerateImage={generate} />)
  const button = screen.getByRole('button', { name: '插画生成中…' })
  expect(button).toBeDisabled()
  fireEvent.click(button)
  expect(generate).not.toHaveBeenCalled()
  expect(screen.getByText('正在生成插画，可继续阅读')).toBeVisible()
})

it('任务提交失败保留配文，以便重试', async () => {
  const generate = vi.fn().mockRejectedValue(new Error('今日图片额度已用完'))
  render(<ThoughtPanel open canGenerateImage thoughts={[]} selectedText="雨夜" paragraphExcerpt="" canDelete={() => false} onClose={vi.fn()} onSubmit={vi.fn()} onDelete={vi.fn()} onGenerateImage={generate} />)
  fireEvent.change(screen.getByRole('textbox', { name: '想法内容' }), { target: { value: '想象中的雨夜' } })
  fireEvent.click(screen.getByRole('button', { name: '生成图片并发布想法' }))
  await screen.findByText('今日图片额度已用完')
  expect(screen.getByRole('textbox', { name: '想法内容' })).toHaveValue('想象中的雨夜')
})
