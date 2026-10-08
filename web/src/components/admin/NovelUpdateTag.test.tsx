import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import type { Novel } from '@shared/types'
import NovelUpdateTag from './NovelUpdateTag'
const base = {
  chapterCount: 91,
  remoteChapterCount: 95,
  pendingChapterCount: 4,
  pendingProtectedChapterCount: 0,
  pendingPublicChapterCount: 4,
  pendingUnknownChapterCount: 0,
} as Novel
it('普通更新展示准确章数', () => {
  render(<NovelUpdateTag novel={base} />)
  expect(screen.getByText('待更新 4 章')).toBeInTheDocument()
  expect(screen.queryByText(/受保护/)).not.toBeInTheDocument()
})
it('混合更新显示其中受保护的数量', () => {
  render(<NovelUpdateTag novel={{ ...base, pendingProtectedChapterCount: 2, pendingPublicChapterCount: 2 }} />)
  expect(screen.getByText('待更新 4 章')).toBeInTheDocument()
  expect(screen.getByText('含受保护 2 章')).toBeInTheDocument()
})
it('全部受保护时不展示普通待更新标签', () => {
  render(<NovelUpdateTag novel={{ ...base, pendingProtectedChapterCount: 4, pendingPublicChapterCount: 0 }} />)
  expect(screen.getByText('受保护 4 章')).toBeInTheDocument()
  expect(screen.queryByText('待更新 4 章')).not.toBeInTheDocument()
})
it('旧数据保护状态待检查，不能当作公开章节', () => {
  render(<NovelUpdateTag novel={{ chapterCount: 91, remoteChapterCount: 95 } as Novel} />)
  expect(screen.getByText('待更新 4 章')).toBeInTheDocument()
  expect(screen.getByText('保护状态待检查')).toBeInTheDocument()
})
