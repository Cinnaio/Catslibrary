import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generateImage } from './image'

const envKeys = ['AI_IMAGE_BASE_URL', 'AI_IMAGE_API_KEY', 'AI_IMAGE_MODEL'] as const
const previousEnv = new Map<string, string | undefined>()
const pngB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

beforeEach(() => {
  for (const key of envKeys) previousEnv.set(key, process.env[key])
  process.env.AI_IMAGE_BASE_URL = 'https://closed-image.test/v1'
  process.env.AI_IMAGE_API_KEY = 'mock-key'
  process.env.AI_IMAGE_MODEL = 'mock-image'
})

afterEach(() => {
  vi.unstubAllGlobals()
  for (const key of envKeys) {
    const value = previousEnv.get(key)
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe('closed-network image client and refusal handling', () => {
  it('maps structured image refusal without retrying or decoding a candidate', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: { code: 'policy_violation', message: 'blocked image' } }), { status: 400, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(generateImage({ prompt: 'safe test prompt' })).rejects.toMatchObject({ code: 'invalid', status: 422 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('checks refusal fields even when the HTTP status is successful', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ refusal: 'content policy' }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(generateImage({ prompt: 'safe test prompt' })).rejects.toMatchObject({ code: 'invalid', status: 422 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('decodes a successful mock image while preserving the request contract', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>
      expect(body.n).toBe(1)
      expect(body.response_format).toBe('b64_json')
      return new Response(JSON.stringify({ model: 'mock-image', data: [{ b64_json: pngB64 }], cost: '0.01' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchMock)
    const result = await generateImage({ prompt: 'safe test prompt', size: '1024x1536' })
    expect(result.data.byteLength).toBeGreaterThan(0)
    expect(result.model).toBe('mock-image')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
