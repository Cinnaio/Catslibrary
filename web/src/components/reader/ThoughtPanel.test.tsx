import { render, screen } from '@testing-library/react'
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
