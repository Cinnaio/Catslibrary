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

describe('upstream cost accounting', () => {
  it('persists cache fields from JSON and from the final stream frame without summing snapshots', async () => {
    const usage = {
      prompt_tokens: 1000,
      completion_tokens: 90,
      prompt_tokens_details: { cached_tokens: 800, cached_creation_tokens: 100 },
      completion_tokens_details: { reasoning_tokens: 40 },
    }
    const expected = { promptTokens: 1000, completionTokens: 90, cacheReadTokens: 800, cacheWriteTokens: 100, reasoningTokens: 40, costReported: false }
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () => new Response(JSON.stringify({ choices: [{ message: { content: '回复' } }], usage }), { headers: { 'Content-Type': 'application/json' } }),
      ),
    )
    await expect(chat({ messages })).resolves.toMatchObject(expected)
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            [
              `data: ${JSON.stringify({ choices: [{ delta: { content: '回复' } }], usage: { ...usage, completion_tokens: 20 } })}`,
              `data: ${JSON.stringify({ choices: [], usage })}`,
              `data: ${JSON.stringify({ choices: [], usage: null })}`,
              'data: [DONE]',
              '',
            ].join('\n'),
            { headers: { 'Content-Type': 'text/event-stream' } },
          ),
      ),
    )
    await expect(chatStream({ messages }, () => {})).resolves.toMatchObject(expected)
  })
  const cases = [
    { name: 'usage.cost 优先于顶层 cost', fields: { usage: { cost: '0.00123' }, cost: 9 }, expected: 0.00123 },
    { name: '保留明确的零成本', fields: { usage: { cost: 0 }, cost: 9 }, expected: 0 },
    { name: '兼容顶层 cost', fields: { cost: '0.02' }, expected: 0.02 },
    { name: '无效 usage.cost 回退顶层', fields: { usage: { cost: 'invalid' }, cost: 0.03 }, expected: 0.03 },
    { name: 'null usage.cost 回退顶层', fields: { usage: { cost: null }, cost: 0.04 }, expected: 0.04 },
    { name: '不把空字符串当成零成本', fields: { usage: { cost: ' ' }, cost: 0.05 }, expected: 0.05 },
    { name: '拒绝负数和无限值', fields: { usage: { cost: -1 }, cost: 'Infinity' }, expected: 0 },
    { name: '不接受布尔值成本', fields: { usage: { cost: true } }, expected: 0 },
    { name: '缺失成本不估算', fields: { usage: { prompt_tokens: 1000 } }, expected: 0 },
  ]

  it.each(cases)('$name（JSON 与流式 JSON 回退）', async ({ fields, expected }) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              choices: [{ message: { content: '回复' }, finish_reason: 'stop' }],
              ...fields,
            }),
            { headers: { 'Content-Type': 'application/json' } },
          ),
      ),
    )
    expect((await chat({ messages })).cost).toBe(expected)
    expect((await chatStream({ messages }, () => {})).cost).toBe(expected)
  })

  it.each([0, 0.00123])('读取最终 usage 帧成本 %s，后续无成本帧不覆盖', async (cost) => {
    const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body)).stream_options).toEqual({ include_usage: true })
      return new Response(
        [
          `data: ${JSON.stringify({ choices: [{ delta: { content: '回复' } }], cost: 9 })}`,
          `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 12, completion_tokens: 3, cost } })}`,
          `data: ${JSON.stringify({ choices: [], usage: { cost: 'invalid' } })}`,
          'data: [DONE]',
          '',
        ].join('\n'),
        { headers: { 'Content-Type': 'text/event-stream' } },
      )
    })
    vi.stubGlobal('fetch', fetchMock)
    await expect(chatStream({ messages }, () => {})).resolves.toMatchObject({ cost, promptTokens: 12, completionTokens: 3 })
  })
})

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
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ choices: [{ message: { refusal: 'safety policy' } }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    )
    vi.stubGlobal('fetch', fetchMock)
    await expect(chat({ messages })).rejects.toMatchObject({ code: 'invalid', status: 422 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('maps structured HTTP refusal and keeps normal prose containing 抱歉 valid', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { code: 'content_filter', message: 'blocked' } }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ model: 'mock-text', choices: [{ message: { content: '抱歉，他来晚了一步。' }, finish_reason: 'stop' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
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
    const result = chatStream({ messages }, (delta) => {
      deltas.push(delta)
    })
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
