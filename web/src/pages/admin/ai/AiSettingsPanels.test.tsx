import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiSettings } from '@/lib/api'
import AiConfigPanel from './AiConfigPanel'
import AiParamsPanel from './AiParamsPanel'
import AiSettingsWorkspace from './AiSettingsWorkspace'

const api = vi.hoisted(() => ({ settings: vi.fn(), saveSettings: vi.fn(), saveProviderConfig: vi.fn(), toast: vi.fn() }))
vi.mock('@/lib/api', () => ({ aiApi: { settings: api.settings, saveSettings: api.saveSettings, saveProviderConfig: api.saveProviderConfig, providerPresets: vi.fn().mockResolvedValue({ presets: [] }), usage: vi.fn().mockResolvedValue(null) } }))
vi.mock('@/components/feedback', () => ({ useToast: () => ({ toast: api.toast }) }))

const settings: AiSettings = {
  selectionImageRoles: ['admin'],
  selectionImageDailyQuota: 10,
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
  importAiReviewEnabled: false,
  importAiMaxCandidates: 80,
  importAiMaxTokens: 2000,
  importAiSystemPrompt: '只输出 JSON 行号数组',
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
  api.settings.mockResolvedValue({ settings, provider: null, imageProvider: null, providerConfig, imageProviderConfig: providerConfig })
})

describe('AI settings confirmation', () => {
  it('responds to an explicit parameter-group deep link without discarding the current draft', () => {
    const onReload = vi.fn()
    const { rerender } = render(<AiParamsPanel settings={settings} loading={false} onReload={onReload} group="recap" />)
    fireEvent.change(screen.getByLabelText('最大输出 Token', { selector: '#recap-tokens' }), { target: { value: '600' } })
    rerender(<AiParamsPanel settings={settings} loading={false} onReload={onReload} group="writing" />)
    expect(screen.getByRole('tab', { name: /AI 创作/ })).toHaveAttribute('aria-selected', 'true')
    rerender(<AiParamsPanel settings={settings} loading={false} onReload={onReload} group="recap" />)
    expect(screen.getByLabelText('最大输出 Token', { selector: '#recap-tokens' })).toHaveValue(600)
  })
  it('keeps model and parameter drafts across settings views, and saving parameters does not overwrite model drafts', async () => {
    const onBusyChange = vi.fn()
    const { rerender } = render(<AiSettingsWorkspace view="config" onBusyChange={onBusyChange} />)
    fireEvent.change(await screen.findByLabelText('模型', { exact: true }), { target: { value: 'draft-model' } })
    rerender(<AiSettingsWorkspace view="params" onBusyChange={onBusyChange} />)
    const tokens = await screen.findByLabelText('最大输出 Token', { selector: '#recap-tokens' })
    fireEvent.change(tokens, { target: { value: '600' } })
    rerender(<AiSettingsWorkspace view={null} onBusyChange={onBusyChange} />)
    expect(screen.queryByRole('button', { name: '保存所有参数' })).not.toBeInTheDocument()
    rerender(<AiSettingsWorkspace view="config" onBusyChange={onBusyChange} />)
    expect(screen.getByLabelText('模型', { exact: true })).toHaveValue('draft-model')
    rerender(<AiSettingsWorkspace view="params" onBusyChange={onBusyChange} />)
    expect(tokens).toHaveValue(600)
    api.settings.mockResolvedValue({ settings: { ...settings, recapMaxTokens: 600, dailyQuota: 99 }, provider: null, imageProvider: null, providerConfig, imageProviderConfig: providerConfig })
    fireEvent.click(screen.getByRole('button', { name: '保存所有参数' }))
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledWith({ recapMaxTokens: 600 }))
    await waitFor(() => expect(api.settings).toHaveBeenCalledTimes(3))
    rerender(<AiSettingsWorkspace view="config" onBusyChange={onBusyChange} />)
    expect(screen.getByLabelText('模型', { exact: true })).toHaveValue('draft-model')
  })
  it('a failed model-settings read does not block the parameter view', async () => {
    api.settings.mockRejectedValueOnce(new Error('模型配置读取失败'))
    const onBusyChange = vi.fn()
    const { rerender } = render(<AiSettingsWorkspace view="config" onBusyChange={onBusyChange} />)
    await screen.findByRole('alert')
    rerender(<AiSettingsWorkspace view="params" onBusyChange={onBusyChange} />)
    await screen.findByRole('button', { name: '保存所有参数' })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
  it('saves independent graph controls and preserves archive settings', async () => {
    render(<AiParamsPanel settings={settings} loading={false} onReload={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'AI 创作' }))
    expect(screen.getByLabelText('故事图谱 Token')).toHaveValue(16000)
    expect(screen.getByRole('combobox', { name: '故事图谱思考模式' })).toHaveTextContent('关闭思考')
    fireEvent.change(screen.getByLabelText('故事图谱 Token'), { target: { value: '24000' } })
    fireEvent.click(screen.getByRole('combobox', { name: '故事图谱思考模式' }))
    fireEvent.click(screen.getByRole('option', { name: '低强度思考' }))
    expect(api.saveSettings).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '保存所有参数' }))
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledWith({ storyGraphMaxTokens: 24000, storyGraphReasoningMode: 'low' }))
  })
  it('rejects an empty graph budget before saving', () => {
    render(<AiParamsPanel settings={settings} loading={false} onReload={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('故事图谱 Token'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: '保存所有参数' }))
    expect(api.saveSettings).not.toHaveBeenCalled()
    expect(screen.getByLabelText('故事图谱 Token')).toHaveFocus()
  })
  it('角色和图片配额先编辑后保存，取消全部角色可关闭功能', async () => {
    config()
    fireEvent.click(screen.getByRole('tab', { name: '读者生成策略' }))
    expect(screen.getByRole('checkbox', { name: '管理员' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: '读者' })).not.toBeChecked()
    fireEvent.click(screen.getByRole('checkbox', { name: '管理员' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '读者' }))
    fireEvent.change(screen.getByLabelText('每人每日图片生成上限'), { target: { value: '3' } })
    expect(api.saveSettings).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }))
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ selectionImageRoles: ['reader'], selectionImageDailyQuota: 3 })))
    api.saveSettings.mockClear()
    fireEvent.click(screen.getByRole('checkbox', { name: '读者' }))
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }))
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ selectionImageRoles: [] })))
  })
  it('does not write quota or switch changes until confirmed, supports revert and preserves zero', async () => {
    config()
    fireEvent.click(screen.getByRole('tab', { name: '读者生成策略' }))
    fireEvent.change(screen.getByLabelText('每人每日生成上限'), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('switch'))
    expect(api.saveSettings).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }))
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledWith({ dailyQuota: 0, maxChapterChars: 6000, recapEnabled: false, selectionImageRoles: ['admin'], selectionImageDailyQuota: 10 }))
  })
  it('rejects empty and out-of-range policy fields and keeps drafts on failed save', async () => {
    config()
    fireEvent.click(screen.getByRole('tab', { name: '读者生成策略' }))
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
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledWith({ dailyQuota: 42, maxChapterChars: 6000, recapEnabled: true, selectionImageRoles: ['admin'], selectionImageDailyQuota: 10 }))
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
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledWith({ maxConcurrentWritingTasks: 4 }))
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
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledWith({ recapMaxTokens: 600, maxConcurrentWritingTasks: 4 }))
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
