import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { outboundFetch } from '../outbound-fetch'
import { AiError, chat, chatStream } from './client'

const envKeys = ['AI_TEXT_BASE_URL', 'AI_TEXT_API_KEY', 'AI_TEXT_MODEL'] as const
const previousEnv = new Map<string, string | undefined>()

beforeEach(() => {
  for (const key of envKeys) previousEnv.set(key, process.env[key])
  process.env.AI_TEXT_BASE_URL = 'https://closed.test/v1'
  process.env.AI_TEXT_API_KEY = 'mock-key'
  process.env.AI_TEXT_MODEL = 'mock-text'
})

afterEach(() => {
  vi.unstubAllGlobals()
  for (const key of envKeys) {
    const value = previousEnv.get(key)
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

const messages = [{ role: 'user' as const, content: '测试' }]

describe('closed-network text client and refusal handling', () => {
  it('blocks an unknown provider URL before any real network can be reached', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      throw new Error(`unexpected network: ${String(input)}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    await expect(outboundFetch('https://unknown-provider.invalid/v1/chat/completions', {}, { scope: 'ai-text' })).rejects.toThrow('unexpected network')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('maps JSON refusal to invalid 422 without retrying', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { refusal: 'safety policy' } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(chat({ messages })).rejects.toMatchObject({ code: 'invalid', status: 422 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('maps structured HTTP refusal and keeps normal prose containing 抱歉 valid', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'content_filter', message: 'blocked' } }), { status: 400, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ model: 'mock-text', choices: [{ message: { content: '抱歉，他来晚了一步。' }, finish_reason: 'stop' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(chat({ messages })).rejects.toMatchObject({ code: 'invalid', status: 422 })
    await expect(chat({ messages })).resolves.toMatchObject({ text: '抱歉，他来晚了一步。' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('stops a stream when a later structured refusal arrives after partial output', async () => {
    const body = [
      'data: ' + JSON.stringify({ model: 'mock-text', choices: [{ delta: { content: '部分' } }] }),
      'data: ' + JSON.stringify({ choices: [{ finish_reason: 'content_filter' }] }),
      'data: [DONE]',
      '',
    ].join('\n')
    const fetchMock = vi.fn(async () => new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }))
    vi.stubGlobal('fetch', fetchMock)
    const deltas: string[] = []
    const result = chatStream({ messages }, (delta) => { deltas.push(delta) })
    await expect(result).rejects.toMatchObject({ code: 'invalid', status: 422 })
    expect(deltas).toEqual(['部分'])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retains the AiError contract for ordinary upstream failures', async () => {
    const fetchMock = vi.fn(async () => new Response('bad gateway', { status: 502 }))
    vi.stubGlobal('fetch', fetchMock)
    const result = chat({ messages })
    await expect(result).rejects.toBeInstanceOf(AiError)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})
