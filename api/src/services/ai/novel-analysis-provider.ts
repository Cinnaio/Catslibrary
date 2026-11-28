import { AiError, isTextAiConfigured, textProvider } from './client'
import { getProviderPreset } from './provider-presets'
import { withProviderSnapshot } from './provider-snapshot'

/** A local choice for this analysis run; never activate or rewrite the site's default provider. */
export function withAnalysisProvider<T>(value: unknown, run: (presetId: string) => T): T {
  if (value !== undefined && (typeof value !== 'string' || value.length > 160))
    throw new AiError('invalid', '模型预设标识无效', 422)
  const presetId = (value as string | undefined) || ''
  const preset = presetId ? getProviderPreset(presetId) : undefined
  if (preset && preset.scope !== 'text') throw new AiError('invalid', '分析请选择文本模型预设', 422)
  return withProviderSnapshot(() => {
    if (!isTextAiConfigured()) throw new AiError('disabled', '请配置可用的文本模型预设', 503)
    return run(presetId)
  }, preset ? { text: { baseUrl: preset.baseUrl, apiKey: preset.apiKey, model: preset.model } } : undefined)
}

/** Public task metadata contains neither endpoints nor credentials. */
export const analysisProviderMetadata = (providerPresetId: string) => ({ providerPresetId, model: textProvider().model })
export function readAnalysisProvider(params?: string): { providerPresetId?: string; model?: string } {
  try {
    const value = JSON.parse(params || '{}')
    return { providerPresetId: typeof value?.providerPresetId === 'string' ? value.providerPresetId : undefined,
      model: typeof value?.model === 'string' ? value.model : undefined }
  } catch { return {} }
}
