import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiSettings } from '@/lib/api'
import AiParamsPanel from './AiParamsPanel'

const saveSettings = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', () => ({ aiApi: { saveSettings } }))
vi.mock('@/components/feedback', () => ({ useToast: () => ({ toast: vi.fn() }) }))
const settings: AiSettings = {
  selectionImageRoles: [],
  selectionImageDailyQuota: 10,
  recapEnabled: true,
  dailyQuota: 30,
  maxChapterChars: 6000,
  recapTemperature: 0.2,
  recapMaxTokens: 1200,
  recapSystemPrompt: '提要',
  catchupEnabled: true,
  catchupStaleDays: 7,
  catchupMaxChapters: 5,
  catchupTemperature: 0.2,
  catchupMaxTokens: 1200,
  writingTemperature: 0.8,
  writingMaxTokens: 1800,
  writingSystemPrompt: '写作',
  styleProfileMaxTokens: 1500,
  plotStateMaxTokens: 3000,
  relationshipProfileMaxTokens: 1200,
  titleMaxTokens: 200,
  reviewMaxTokens: 8000,
  maxConcurrentWritingTasks: 3,
  imageSize: '1024x1024',
  imageQuality: 'standard',
  imageResponseFormat: 'b64_json',
  coverImageSize: '1024x1536',
  coverRenderTitle: true,
  coverPlatform: 'default',
  coverPromptMaxChars: 2000,
  importAiReviewEnabled: false,
  importAiMaxCandidates: 80,
  importAiMaxTokens: 2000,
  importAiSystemPrompt: '复核',
  taskRetentionDays: 90,
  logIpAddress: false,
  logUserAgent: false,
}
beforeEach(() => {
  saveSettings.mockReset().mockResolvedValue({})
})
async function mount() {
  render(<AiParamsPanel settings={settings} loading={false} onReload={() => {}} />)
  fireEvent.click(await screen.findByRole('tab', { name: 'AI 创作' }))
  return screen.getByRole('spinbutton', { name: '档案分析超时（秒）' })
}
describe('story memory timeout parameter', () => {
  it('keeps the trial and paid background preparation separate and saves their explicit choices', async () => {
    await mount()
    expect(screen.getByRole('combobox', { name: '故事记忆模式' })).toHaveTextContent('完整档案（原模式）')
    expect(screen.getByRole('spinbutton', { name: '章节增量记忆 Token' })).toHaveValue(16000)
    fireEvent.click(screen.getByRole('combobox', { name: '故事记忆模式' }))
    fireEvent.click(await screen.findByRole('option', { name: '章节增量记忆（试验）' }))
    fireEvent.click(screen.getByRole('switch', { name: /发布后后台准备记忆/ }))
    fireEvent.click(screen.getByRole('button', { name: '保存所有参数' }))
    await waitFor(() => expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({ storyMemoryEngine: 'incremental', storyMemoryAutoUpdate: true })))
  })
  it('shows the legacy default and saves the edited timeout with the writing group', async () => {
    const input = await mount()
    expect(input).toHaveValue(300)
    fireEvent.change(input, { target: { value: '450' } })
    fireEvent.click(screen.getByRole('tab', { name: '前情提要' }))
    fireEvent.click(screen.getByRole('tab', { name: /AI 创作/ }))
    expect(screen.getByRole('spinbutton', { name: '档案分析超时（秒）' })).toHaveValue(450)
    fireEvent.click(screen.getByRole('button', { name: '保存所有参数' }))
    await waitFor(() => expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({ storyMemoryTimeoutSeconds: 450 })))
  })
  it.each(['', '0', '601'])('blocks an invalid timeout %j before saving', async (raw) => {
    const input = await mount()
    fireEvent.change(input, { target: { value: raw } })
    if (!raw) expect(input).toHaveValue(null)
    fireEvent.click(screen.getByRole('button', { name: '保存所有参数' }))
    expect(saveSettings).not.toHaveBeenCalled()
    expect(input).toBeInvalid()
  })
})
