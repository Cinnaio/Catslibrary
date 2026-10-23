import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { activateProviderPreset, deleteProviderPreset, getProviderPreset, listProviderPresets, saveProviderPreset } from './provider-presets'
import { readRuntimeConfig, writeRuntimeConfig } from '../../runtime-config'
import { withProviderSnapshot, providerForScope } from './provider-snapshot'

let directory: string
const draft = { scope: 'text', name: '备用', baseUrl: 'https://backup.test/v1', model: 'backup-model', apiKey: 'backup-secret' }
beforeEach(() => {
  mkdirSync(path.join(process.cwd(), '..', '.tmp'), { recursive: true })
  directory = mkdtempSync(path.join(process.cwd(), '..', '.tmp', 'zz-presets-'))
  vi.stubEnv('RUNTIME_CONFIG_DIR', directory)
  for (const scope of ['TEXT', 'IMAGE']) for (const key of ['BASE_URL', 'API_KEY', 'MODEL']) vi.stubEnv(`AI_${scope}_${key}`, '')
})
afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(directory, { recursive: true, force: true })
})

describe('provider presets', () => {
  it('imports both effective configurations once, without returning their secrets', () => {
    vi.stubEnv('AI_TEXT_BASE_URL', 'https://current.test/v1')
    vi.stubEnv('AI_TEXT_API_KEY', 'current-secret')
    vi.stubEnv('AI_IMAGE_BASE_URL', 'https://image.test/v1')
    vi.stubEnv('AI_IMAGE_API_KEY', 'image-secret')
    const rows = listProviderPresets()
    expect(rows).toHaveLength(2)
    expect(rows.every((p) => p.name === '默认配置' && p.hasApiKey && p.active)).toBe(true)
    expect(JSON.stringify(rows)).not.toContain('secret')
    expect(listProviderPresets().map((p) => p.id)).toEqual(rows.map((p) => p.id))
    expect(readFileSync(path.join(directory, 'ai-provider-presets.json'), 'utf8')).toContain('current-secret')
  })
  it('saves and edits a preset without activating it, retaining its own key when omitted', () => {
    const saved = saveProviderPreset(draft)[0]!
    expect(process.env.AI_TEXT_BASE_URL).toBe('')
    const edited = saveProviderPreset({ ...draft, model: 'edited-model', apiKey: undefined }, saved.id)[0]!
    expect(edited.model).toBe('edited-model')
    expect(getProviderPreset(saved.id).apiKey).toBe('backup-secret')
    expect(JSON.stringify(edited)).not.toContain('backup-secret')
    expect(() => saveProviderPreset({ ...draft, scope: 'image' }, saved.id)).toThrow('不能修改端点用途')
    expect(() => saveProviderPreset(draft)).toThrow('同用途下已有同名端点')
  })
  it('copies the effective key only on explicit request, and allows deleting every preset', () => {
    vi.stubEnv('AI_TEXT_API_KEY', 'env-secret')
    expect(() => saveProviderPreset({ ...draft, apiKey: undefined })).toThrow('请输入 API Key')
    const row = saveProviderPreset({ ...draft, apiKey: undefined, copyCurrentKey: true })[0]!
    expect(getProviderPreset(row.id).apiKey).toBe('env-secret')
    deleteProviderPreset(row.id)
    expect(listProviderPresets()).toEqual([])
  })
  it('activates a complete configuration atomically and leaves image config untouched', () => {
    writeRuntimeConfig({ AI_TEXT_BASE_URL: 'https://old.test', AI_TEXT_API_KEY: 'old-secret', AI_TEXT_MODEL: 'old-model' })
    vi.stubEnv('AI_TEXT_BASE_URL', 'https://old.test')
    vi.stubEnv('AI_TEXT_API_KEY', 'old-secret')
    vi.stubEnv('AI_TEXT_MODEL', 'old-model')
    vi.stubEnv('AI_IMAGE_BASE_URL', 'https://image.test')
    const rows = saveProviderPreset(draft)
    const row = rows.find((p) => p.name === draft.name)!
    expect(activateProviderPreset(row.id).find((p) => p.id === row.id)?.active).toBe(true)
    expect(process.env.AI_TEXT_API_KEY).toBe('backup-secret')
    expect(process.env.AI_TEXT_MODEL).toBe('backup-model')
    expect(process.env.AI_IMAGE_BASE_URL).toBe('https://image.test')
    expect(readRuntimeConfig().AI_TEXT_BASE_URL).toBe(draft.baseUrl)
    deleteProviderPreset(row.id)
    expect(process.env.AI_TEXT_API_KEY).toBe('backup-secret')
  })
  it('refuses an environment override without changing runtime files or any effective fields', () => {
    const row = saveProviderPreset(draft)[0]!
    writeRuntimeConfig({ AI_TEXT_BASE_URL: 'https://runtime.test', AI_TEXT_API_KEY: 'runtime-secret' })
    vi.stubEnv('AI_TEXT_BASE_URL', 'https://fixed.test')
    vi.stubEnv('AI_TEXT_API_KEY', 'fixed-secret')
    const before = readRuntimeConfig()
    expect(() => activateProviderPreset(row.id)).toThrow('环境变量')
    expect(readRuntimeConfig()).toEqual(before)
    expect(process.env.AI_TEXT_BASE_URL).toBe('https://fixed.test')
    expect(process.env.AI_TEXT_API_KEY).toBe('fixed-secret')
    expect(process.env.AI_TEXT_MODEL).toBe('')
  })
  it('rejects unsafe URL formats, missing fields and unknown IDs; never replaces corrupt data', () => {
    for (const baseUrl of ['ftp://example.test', 'https://user:secret@example.test', 'https://example.test?key=secret', 'invalid']) {
      expect(() => saveProviderPreset({ ...draft, baseUrl })).toThrow()
    }
    expect(() => saveProviderPreset({ ...draft, name: '' })).toThrow()
    expect(() => activateProviderPreset('missing')).toThrow('不存在')
    writeFileSync(path.join(directory, 'ai-provider-presets.json'), '{broken')
    expect(() => listProviderPresets()).toThrow()
    expect(readFileSync(path.join(directory, 'ai-provider-presets.json'), 'utf8')).toBe('{broken')
  })
  it('keeps ongoing multi-step generations on their snapshot while later requests use the new endpoint', async () => {
    const row = saveProviderPreset(draft)[0]!
    await withProviderSnapshot(async () => {
      const before = providerForScope('text')
      activateProviderPreset(row.id)
      await Promise.resolve()
      expect(providerForScope('text')).toEqual(before)
      expect(providerForScope('text').baseUrl).toBe('')
    })
    expect(providerForScope('text').baseUrl).toBe(draft.baseUrl)
    await withProviderSnapshot(async () => {
      expect(providerForScope('text').apiKey).toBe('backup-secret')
    })
  })
})
