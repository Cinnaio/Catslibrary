import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiSettings } from '@/lib/api'
import AiConfigPanel from './AiConfigPanel'
import AiParamsPanel from './AiParamsPanel'

const api = vi.hoisted(() => ({ saveSettings: vi.fn(), saveProviderConfig: vi.fn(), toast: vi.fn() }))
vi.mock('@/lib/api', () => ({ aiApi: { saveSettings: api.saveSettings, saveProviderConfig: api.saveProviderConfig, usage: vi.fn().mockResolvedValue(null) } }))
vi.mock('@/components/feedback', () => ({ useToast: () => ({ toast: api.toast }) }))

const settings: AiSettings = {
  recapEnabled: true,
  dailyQuota: 30,
  maxChapterChars: 6000,
  recapTemperature: 0.7,
  recapMaxTokens: 500,
  recapSystemPrompt: '概括上一章',
  catchupEnabled: true,
  catchupStaleDays: 7,
  catchupMaxChapters: 3,
  catchupTemperature: 0.7,
  catchupMaxTokens: 800,
  writingTemperature: 0.8,
  writingMaxTokens: 15000,
  writingSystemPrompt: '保留文风',
  styleProfileMaxTokens: 1500,
  plotStateMaxTokens: 3000,
  relationshipProfileMaxTokens: 1200,
  titleMaxTokens: 200,
  maxConcurrentWritingTasks: 3,
  imageSize: '1024x1024',
  imageQuality: 'standard',
  imageResponseFormat: 'b64_json',
  coverImageSize: '1024x1536',
  coverRenderTitle: true,
  coverPlatform: 'general',
  coverPromptMaxChars: 2000,
  taskRetentionDays: 90,
  logIpAddress: true,
  logUserAgent: true,
}
const providerConfig = { baseUrl: 'https://example.test/v1', model: 'model', hasApiKey: true }
function config(onReload = vi.fn()) {
  return render(
    <AiConfigPanel
      settings={settings}
      provider={null}
      providerConfig={providerConfig}
      imageProviderConfig={providerConfig}
      loading={false}
      onReload={onReload}
    />,
  )
}
beforeEach(() => {
  vi.clearAllMocks()
  api.saveSettings.mockResolvedValue({})
  api.saveProviderConfig.mockResolvedValue({})
})

describe('AI settings confirmation', () => {
  it('does not write quota or switch changes until confirmed, supports revert and preserves zero', async () => {
    config()
    fireEvent.change(screen.getByLabelText('每人每日生成上限'), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('switch'))
    expect(api.saveSettings).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }))
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledWith({ dailyQuota: 0, maxChapterChars: 6000, recapEnabled: false }))
  })
  it('rejects empty and out-of-range policy fields and keeps drafts on failed save', async () => {
    config()
    fireEvent.change(screen.getByLabelText('每人每日生成上限'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }))
    expect(api.saveSettings).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('每人每日生成上限'), { target: { value: '31' } })
    api.saveSettings.mockRejectedValueOnce(new Error('保存失败'))
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }))
    await waitFor(() => expect(api.toast).toHaveBeenCalledWith('保存失败', 'error'))
    expect(screen.getByLabelText('每人每日生成上限')).toHaveValue(31)
    fireEvent.click(screen.getByRole('button', { name: '撤销修改' }))
    expect(screen.getByLabelText('每人每日生成上限')).toHaveValue(30)
  })
  it('never sends a masked key or empty focused key when saving a model change', async () => {
    config()
    fireEvent.focus(screen.getByLabelText('API Key', { exact: true }))
    fireEvent.change(screen.getByLabelText('模型', { exact: true }), { target: { value: 'new-model' } })
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }))
    await waitFor(() => expect(api.saveProviderConfig).toHaveBeenCalledWith({ baseUrl: providerConfig.baseUrl, model: 'new-model' }))
  })
  it('keeps another group draft when the parent reloads unchanged effective values', async () => {
    const view = config()
    fireEvent.change(screen.getByLabelText('每人每日生成上限'), { target: { value: '42' } })
    view.rerender(
      <AiConfigPanel
        settings={{ ...settings }}
        provider={null}
        providerConfig={{ ...providerConfig, model: 'saved-model' }}
        imageProviderConfig={{ ...providerConfig }}
        loading={false}
        onReload={vi.fn()}
      />,
    )
    expect(screen.getByLabelText('每人每日生成上限')).toHaveValue(42)
  })
  it('validates all dirty groups before any write and preserves failed groups after a partial save', async () => {
    const onReload = vi.fn()
    const view = config(onReload)
    fireEvent.change(screen.getByLabelText('模型', { exact: true }), { target: { value: 'saved-text' } })
    fireEvent.change(screen.getByLabelText('图像模型'), { target: { value: 'pending-image' } })
    fireEvent.change(screen.getByLabelText('每人每日生成上限'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }))
    expect(api.saveProviderConfig).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('每人每日生成上限'), { target: { value: '42' } })
    api.saveProviderConfig.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('图像保存失败'))
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }))
    await waitFor(() => expect(onReload).toHaveBeenCalledTimes(1))
    expect(api.toast).toHaveBeenCalledWith('图像保存失败；已保存文本供应商，其余修改保留，可重试', 'error')
    expect(api.saveSettings).not.toHaveBeenCalled()
    view.rerender(
      <AiConfigPanel
        settings={{ ...settings }}
        provider={null}
        providerConfig={{ ...providerConfig, model: 'saved-text' }}
        imageProviderConfig={{ ...providerConfig }}
        loading={false}
        onReload={onReload}
      />,
    )
    expect(screen.getByLabelText('图像模型')).toHaveValue('pending-image')
    expect(screen.getByLabelText('每人每日生成上限')).toHaveValue(42)
    api.saveProviderConfig.mockClear().mockResolvedValue({})
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }))
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledWith({ dailyQuota: 42, maxChapterChars: 6000, recapEnabled: true }))
    expect(api.saveProviderConfig).toHaveBeenCalledTimes(1)
    expect(api.saveProviderConfig).toHaveBeenCalledWith({ baseUrl: providerConfig.baseUrl, model: 'pending-image', scope: 'image' })
  })
  it('tracks parameter changes, reverts and submits the effective draft only when valid', async () => {
    render(<AiParamsPanel settings={settings} loading={false} onReload={vi.fn()} />)
    expect(screen.getByRole('button', { name: '保存所有参数' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('创作任务并发上限'), { target: { value: '4' } })
    expect(screen.getByRole('button', { name: '保存所有参数' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: '撤销修改' }))
    expect(screen.getByLabelText('创作任务并发上限')).toHaveValue(3)
    fireEvent.change(screen.getByLabelText('创作任务并发上限'), { target: { value: '11' } })
    fireEvent.click(screen.getByRole('button', { name: '保存所有参数' }))
    expect(api.saveSettings).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('创作任务并发上限'), { target: { value: '4' } })
    fireEvent.click(screen.getByRole('button', { name: '保存所有参数' }))
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledWith({ ...settings, maxConcurrentWritingTasks: 4 }))
  })
  it('keeps edits across categories, marks changed groups and submits the combined draft', async () => {
    render(<AiParamsPanel settings={settings} loading={false} onReload={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('最大输出 Token', { selector: '#recap-tokens' }), { target: { value: '600' } })
    fireEvent.click(screen.getByRole('tab', { name: '任务与运维' }))
    fireEvent.change(screen.getByLabelText('创作任务并发上限'), { target: { value: '4' } })
    expect(screen.getByText('2 项参数待保存 · 切换分类保留修改')).toBeInTheDocument()
    expect(screen.getAllByRole('img', { name: '1 项待保存' })).toHaveLength(2)
    fireEvent.click(screen.getByRole('tab', { name: /前情提要/ }))
    expect(screen.getByLabelText('最大输出 Token', { selector: '#recap-tokens' })).toHaveValue(600)
    fireEvent.click(screen.getByRole('button', { name: '保存所有参数' }))
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledWith({ ...settings, recapMaxTokens: 600, maxConcurrentWritingTasks: 4 }))
  })

  it('reveals an invalid hidden category before saving and supports keyboard tab navigation', () => {
    render(<AiParamsPanel settings={settings} loading={false} onReload={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: '任务与运维' }))
    fireEvent.change(screen.getByLabelText('创作任务并发上限'), { target: { value: '11' } })
    fireEvent.click(screen.getByRole('tab', { name: '前情提要' }))
    fireEvent.click(screen.getByRole('button', { name: '保存所有参数' }))
    expect(api.saveSettings).not.toHaveBeenCalled()
    expect(screen.getByRole('tab', { name: /任务与运维/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByLabelText('创作任务并发上限')).toHaveFocus()
    fireEvent.keyDown(screen.getByRole('tab', { name: /任务与运维/ }), { key: 'Home' })
    expect(screen.getByRole('tab', { name: '前情提要' })).toHaveAttribute('aria-selected', 'true')
  })
})
