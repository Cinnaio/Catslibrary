import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { aiApi } from '@/lib/api'
import AiAuditPanel from './AiAuditPanel'

vi.mock('@/lib/api', () => ({
  url: (path: string) => path,
  aiApi: { status: vi.fn().mockResolvedValue({ configured: true }), audit: { calls: vi.fn() } },
}))
afterEach(cleanup)

const missingTypes = [
  ['novel_analysis', '小说分析报告'],
  ['novel_analysis_review', '小说分析事实核对'],
  ['import_review', '导入审校'],
  ['style_profile', '文风分析'],
  ['relationship_profile', '人物关系分析'],
  ['plot_state', '剧情状态分析'],
  ['story_memory', '章节增量记忆'],
  ['plot_suggestion', '情节建议'],
  ['plot_outline', '情节大纲'],
  ['rewrite_selection', '选段改写'],
  ['content-rating-llm', '内容分级'],
  ['selection_image', '选段配图'],
] as const

function call(type: string, avatarUrl = '') {
  return {
    id: type,
    type,
    displayName: '猫',
    username: 'cat',
    avatarUrl,
    promptTokens: 100,
    completionTokens: 20,
    imageCount: 0,
    costMillicents: 0,
    createdAt: Date.now(),
  }
}

describe('调用记录分类与头像', () => {
  it('已有用途显示具体名称，类型筛选使用同样的分类并发起服务端筛选', async () => {
    vi.mocked(aiApi.audit.calls).mockResolvedValue({ calls: missingTypes.map(([type]) => call(type)), total: missingTypes.length } as never)
    render(<AiAuditPanel />)
    for (const [, label] of missingTypes) expect(await screen.findByText(label)).toBeInTheDocument()
    expect(screen.queryByText('其他')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('combobox', { name: '类型' }))
    for (const [, label] of missingTypes) expect(screen.getByRole('option', { name: label })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('option', { name: '情节建议' }))
    await waitFor(() => expect(aiApi.audit.calls).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'plot_suggestion', offset: 0 })))
  })

  it('优先使用现有头像，缺少头像或加载失败时回退为文字', async () => {
    vi.mocked(aiApi.audit.calls).mockResolvedValue({ calls: [call('test', '/api/avatar/cat?v=123'), call('summary')], total: 2 } as never)
    const { container } = render(<AiAuditPanel />)
    await screen.findByText('连通性测试')
    const image = container.querySelector('img')!
    expect(image).toHaveAttribute('src', '/api/avatar/cat?v=123')
    expect(container.querySelectorAll('.shared-initial-avatar')).toHaveLength(1)
    fireEvent.error(image)
    expect(container.querySelectorAll('.shared-initial-avatar')).toHaveLength(2)
  })
})
