import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  listNovels: vi.fn(),
  settings: vi.fn(),
  tasks: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  url: (path: string) => `/api${path}`,
  novelsApi: { list: api.listNovels },
  aiApi: {
    settings: api.settings,
    tasks: api.tasks,
    coverCandidates: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  },
  newOperationId: (prefix: string) => `${prefix}-test`,
}))

vi.mock('@/components/feedback', () => ({
  useToast: () => ({ toast: vi.fn() }),
  useConfirm: () => ({ confirm: vi.fn().mockResolvedValue(true) }),
}))

vi.mock('@/components/admin/CustomSelect', () => ({
  default: (props: { options: Array<{ value: string; label: string }>; value: string; onChange: (value: string) => void }) => (
    <select aria-label="目标小说" value={props.value} onChange={(event) => props.onChange(event.target.value)}>
      <option value="">请选择小说</option>
      {props.options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}))

import AiCoverPanel from './AiCoverPanel'

describe('AiCoverPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.listNovels.mockResolvedValue({
      novels: [
        {
          id: 'novel_1',
          title: '测试小说',
          author: '作者',
          description: '',
          coverUrl: 'https://source.example/original-cover.jpg',
          categories: [],
          status: 'ongoing',
          contentRating: 'general',
          sourceUrl: '',
          chapterCount: 1,
          remoteChapterCount: 1,
          updateCheckedAt: 0,
          createdAt: 1,
          updatedAt: 42,
        },
      ],
      totalPages: 1,
    })
    api.settings.mockResolvedValue({ imageProvider: { configured: true }, settings: {} })
    api.tasks.mockResolvedValue({ items: [] })
  })

  it('最近更新列表使用当前封面端点，而不是原始入库封面 URL', async () => {
    render(<AiCoverPanel />)

    const image = await waitFor(() => {
      const value = Array.from(document.querySelectorAll('img')).find((item) => item.getAttribute('src') === '/api/cover/novel_1?v=42&cover=4')
      if (!value) throw new Error('最近更新封面尚未渲染')
      return value as HTMLImageElement
    })

    expect(image.getAttribute('src')).toBe('/api/cover/novel_1?v=42&cover=4')
    expect(image.src).not.toBe('https://source.example/original-cover.jpg')
  })

  it('从小说操作进入时保留深链传入的目标小说', async () => {
    render(<AiCoverPanel initialNovelId="novel_1" />)

    await waitFor(() => {
      const target = screen.getAllByLabelText('目标小说').some((element) => (element as HTMLSelectElement).value === 'novel_1')
      expect(target).toBe(true)
    })
  })
})
