import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { runtimeConfigDataDir, readRuntimeConfig, writeRuntimeConfig, syncRuntimeConfigToEnv, type RuntimeConfigKey } from '../../runtime-config'
import { textProvider, AiError } from './client'
import { imageProvider } from './image'

export type ProviderScope = 'text' | 'image'
interface Preset {
  id: string
  name: string
  scope: ProviderScope
  baseUrl: string
  model: string
  apiKey: string
}
interface Store {
  presets: Preset[]
}
function file() {
  return path.join(runtimeConfigDataDir(), 'ai-provider-presets.json')
}
function effective(scope: ProviderScope) {
  return scope === 'text' ? textProvider() : imageProvider()
}
function read(): Store {
  let store: Store
  try {
    store = JSON.parse(readFileSync(file(), 'utf8')) as Store
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    store = { presets: [] }
    for (const scope of ['text', 'image'] as const) {
      const current = effective(scope)
      if (current.baseUrl) store.presets.push({ id: randomUUID(), name: '默认配置', scope, ...current })
    }
    write(store)
  }
  if (
    !store ||
    !Array.isArray(store.presets) ||
    store.presets.some(
      (p) =>
        !p || !['text', 'image'].includes(p.scope) || ['id', 'name', 'baseUrl', 'model', 'apiKey'].some((key) => typeof p[key as keyof Preset] !== 'string'),
    )
  )
    throw new Error('端点预设文件格式错误')
  return store
}
function write(store: Store) {
  const target = file()
  mkdirSync(path.dirname(target), { recursive: true })
  const temp = `${target}.${randomUUID()}.tmp`
  writeFileSync(temp, JSON.stringify(store, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 })
  try {
    renameSync(temp, target)
  } finally {
    rmSync(temp, { force: true })
  }
}
export function listProviderPresets() {
  return read().presets.map(({ apiKey, ...preset }) => {
    const current = effective(preset.scope)
    return { ...preset, hasApiKey: !!apiKey, active: current.baseUrl === preset.baseUrl && current.model === preset.model && current.apiKey === apiKey }
  })
}
export function getProviderPreset(id: string) {
  const preset = read().presets.find((p) => p.id === id)
  if (!preset) throw new AiError('invalid', '端点预设不存在', 404)
  return preset
}
export function saveProviderPreset(body: Record<string, unknown>, id?: string) {
  const store = read()
  const previous = id ? store.presets.find((p) => p.id === id) : undefined
  if (id && !previous) throw new AiError('invalid', '端点预设不存在', 404)
  if (body.scope !== 'text' && body.scope !== 'image') throw new AiError('invalid', '请选择端点用途', 400)
  const scope = body.scope
  if (previous && previous.scope !== scope) throw new AiError('invalid', '不能修改端点用途', 400)
  const field = (key: string, max: number) => {
    if (typeof body[key] !== 'string' || !body[key].trim() || body[key].length > max) throw new AiError('invalid', `端点 ${key} 不能为空或过长`, 400)
    return body[key].trim()
  }
  const name = field('name', 80)
  const baseUrl = field('baseUrl', 2048)
  const model = field('model', 200)
  let url: URL
  try {
    url = new URL(baseUrl)
  } catch {
    throw new AiError('invalid', '请输入有效的接口地址', 400)
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
    throw new AiError('invalid', '接口地址应使用 HTTP(S)，且不含凭据、查询参数或片段', 400)
  if (store.presets.some((p) => p.id !== id && p.scope === scope && p.name === name)) throw new AiError('invalid', '同用途下已有同名端点', 409)
  if (!previous && store.presets.length >= 100) throw new AiError('invalid', '最多保存 100 个端点', 400)
  let apiKey = previous?.apiKey || ''
  if (body.apiKey !== undefined) {
    if (typeof body.apiKey !== 'string' || body.apiKey.length > 8192) throw new AiError('invalid', 'API Key 格式无效', 400)
    apiKey = body.apiKey.trim()
  } else if (!previous && body.copyCurrentKey === true) {
    apiKey = effective(scope).apiKey
  }
  if (!apiKey) throw new AiError('invalid', '请输入 API Key', 400)
  const preset: Preset = { id: previous?.id || randomUUID(), name, scope, baseUrl, model, apiKey }
  if (previous) store.presets = store.presets.map((p) => (p.id === id ? preset : p))
  else store.presets.push(preset)
  write(store)
  return listProviderPresets()
}
export function deleteProviderPreset(id: string) {
  const store = read()
  getProviderPreset(id)
  // 删除仅移除收藏，运行中的供应商配置保持有效。
  store.presets = store.presets.filter((p) => p.id !== id)
  write(store)
  return listProviderPresets()
}
export function activateProviderPreset(id: string) {
  const preset = getProviderPreset(id)
  const before = readRuntimeConfig()
  const prefix = preset.scope === 'image' ? 'AI_IMAGE_' : 'AI_TEXT_'
  const patch: Partial<Record<RuntimeConfigKey, string>> = {
    [`${prefix}BASE_URL`]: preset.baseUrl,
    [`${prefix}MODEL`]: preset.model,
    [`${prefix}API_KEY`]: preset.apiKey,
  }
  for (const [key, value] of Object.entries(patch)) {
    const current = process.env[key]?.trim() || ''
    if (current && current !== before[key as RuntimeConfigKey] && current !== value) {
      throw new AiError('conflict', '环境变量或 .env 固定了当前供应商，请先移除对应 AI_TEXT_* 或 AI_IMAGE_* 配置并重启，再切换端点', 409)
    }
  }
  writeRuntimeConfig(patch)
  syncRuntimeConfigToEnv(before, patch)
  return listProviderPresets()
}
