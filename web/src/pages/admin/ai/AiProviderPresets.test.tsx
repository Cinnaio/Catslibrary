import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AiProviderPresets from './AiProviderPresets'

const api = vi.hoisted(() => ({
  providerPresets: vi.fn(),
  saveProviderPreset: vi.fn(),
  activateProviderPreset: vi.fn(),
  deleteProviderPreset: vi.fn(),
  toast: vi.fn(),
}))
vi.mock('@/lib/api', () => ({ aiApi: api }))
vi.mock('@/components/feedback', () => ({ useToast: () => ({ toast: api.toast }) }))
const rows = [
  { id: 'a', name: '主端点', scope: 'text', baseUrl: 'https://a.test/v1', model: 'a-model', hasApiKey: true, active: true },
  { id: 'b', name: '备用端点', scope: 'text', baseUrl: 'https://b.test/v1', model: 'b-model', hasApiKey: true, active: false },
  { id: 'c', name: '图像端点', scope: 'image', baseUrl: 'https://c.test/v1', model: 'c-model', hasApiKey: true, active: true },
] as const
const props = {
  scope: 'text' as const,
  config: { baseUrl: rows[0].baseUrl, model: rows[0].model, hasApiKey: true },
  draft: { baseUrl: rows[0].baseUrl, model: rows[0].model, apiKey: '••••••••' },
  disabled: false,
  dirty: false,
  onApplied: vi.fn(),
  onBusy: vi.fn(),
}
beforeEach(() => {
  vi.clearAllMocks()
  api.providerPresets.mockResolvedValue({ presets: rows })
  api.activateProviderPreset.mockResolvedValue({ presets: rows.map((p) => ({ ...p, active: p.id === 'b' })) })
  api.saveProviderPreset.mockResolvedValue({ presets: rows })
})

describe('AI provider preset picker', () => {
  it('filters by scope, previews selection and waits for explicit application', async () => {
    render(<AiProviderPresets {...props} />)
    const select = await screen.findByRole('option', { name: '主端点 · 当前生效' })
    expect(select).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '应用预设' })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /图像端点/ })).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('已保存预设'), { target: { value: 'b' } })
    expect(api.activateProviderPreset).not.toHaveBeenCalled()
    expect(screen.getByLabelText('当前生效的文本配置')).toHaveTextContent(rows[0].baseUrl)
    expect(screen.getByLabelText('当前生效的文本配置')).not.toHaveTextContent(rows[1].baseUrl)
    fireEvent.click(screen.getByRole('button', { name: '应用预设' }))
    await waitFor(() => expect(api.activateProviderPreset).toHaveBeenCalledWith('b'))
    await waitFor(() => expect(props.onApplied).toHaveBeenCalledTimes(1))
  })
  it('saves current config without sending the mask or switching the service', async () => {
    render(<AiProviderPresets {...props} />)
    await screen.findByRole('option', { name: '主端点 · 当前生效' })
    await userEvent.click(screen.getByRole('button', { name: '管理预设' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: '保存当前为预设' }))
    fireEvent.change(screen.getByLabelText('预设名称'), { target: { value: '另存端点' } })
    fireEvent.submit(document.getElementById('ai-text-preset-form')!)
    await waitFor(() =>
      expect(api.saveProviderPreset).toHaveBeenCalledWith(
        { name: '另存端点', scope: 'text', baseUrl: rows[0].baseUrl, model: rows[0].model, copyCurrentKey: true },
        undefined,
      ),
    )
    expect(api.activateProviderPreset).not.toHaveBeenCalled()
  })
  it('preserves the selected preset key when editing and reports activation failures', async () => {
    render(<AiProviderPresets {...props} />)
    await screen.findByRole('option', { name: '主端点 · 当前生效' })
    fireEvent.change(screen.getByLabelText('已保存预设'), { target: { value: 'b' } })
    await userEvent.click(screen.getByRole('button', { name: '管理预设' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: '编辑所选预设' }))
    fireEvent.change(screen.getByLabelText('模型名称'), { target: { value: 'updated' } })
    fireEvent.submit(document.getElementById('ai-text-preset-form')!)
    await waitFor(() =>
      expect(api.saveProviderPreset).toHaveBeenCalledWith({ name: '备用端点', scope: 'text', baseUrl: rows[1].baseUrl, model: 'updated' }, 'b'),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    api.activateProviderPreset.mockRejectedValueOnce(new Error('环境变量固定了供应商'))
    fireEvent.click(screen.getByRole('button', { name: '应用预设' }))
    await waitFor(() => expect(api.toast).toHaveBeenCalledWith('环境变量固定了供应商', 'error'))
    expect(props.onApplied).not.toHaveBeenCalled()
  })
  it('blocks switching over unsaved edits and requires confirmation to delete', async () => {
    api.deleteProviderPreset.mockResolvedValue({ presets: [rows[1]] })
    render(<AiProviderPresets {...props} dirty />)
    await screen.findByRole('option', { name: '主端点 · 当前生效' })
    fireEvent.change(screen.getByLabelText('已保存预设'), { target: { value: 'b' } })
    expect(screen.getByRole('button', { name: '应用预设' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('已保存预设'), { target: { value: 'a' } })
    await userEvent.click(screen.getByRole('button', { name: '管理预设' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: '删除所选预设' }))
    expect(api.deleteProviderPreset).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
    await waitFor(() => expect(api.deleteProviderPreset).toHaveBeenCalledWith('a'))
    expect(props.onApplied).not.toHaveBeenCalled()
  })
})
