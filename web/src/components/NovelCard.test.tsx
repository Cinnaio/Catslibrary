import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { Novel } from '@shared/types'
import NovelCard, { coverUrl } from './NovelCard'

const novel: Novel = {
  id: 'novel_1',
  title: '雾城来信',
  author: '某作者',
  description: '一段简介',
  coverUrl: '',
  categories: [],
  status: 'ongoing',
  sourceUrl: '',
  chapterCount: 10,
  remoteChapterCount: 12,
  updateCheckedAt: 0,
  createdAt: 1,
  updatedAt: 1,
}

function renderCard(n: Novel) {
  return render(
    <MemoryRouter>
      <NovelCard novel={n} />
    </MemoryRouter>,
  )
}

describe('NovelCard', () => {
  it('渲染标题、作者与待更新角标', () => {
    renderCard(novel)
    expect(screen.getByText('雾城来信')).toBeInTheDocument()
    expect(screen.getByText('作者：某作者')).toBeInTheDocument()
    expect(screen.getByText('+2')).toBeInTheDocument() // remote 12 - local 10
  })

  it('封面加载失败时回退为首字占位（不用 innerHTML）', () => {
    renderCard(novel)
    const img = screen.getByAltText('雾城来信')
    fireEvent.error(img)
    expect(screen.queryByAltText('雾城来信')).not.toBeInTheDocument()
    expect(screen.getByText('雾')).toBeInTheDocument()
  })

  it('demo 数据不生成封面 URL', () => {
    expect(coverUrl({ id: 'demo_1' })).toBe('')
    expect(coverUrl({ id: 'novel_1', updatedAt: 5 })).toContain('/cover/novel_1')
  })
})
