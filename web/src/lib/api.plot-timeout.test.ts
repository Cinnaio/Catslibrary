import { afterEach, expect, it, vi } from 'vitest'
import { aiApi } from './api'
import { normalizePlotTimeoutSeconds } from '@shared/ai-plot-timeout'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

it.each([undefined, 300])('推荐情节和分章大纲等待完整模型响应，超时配置为 %s 秒', async (timeoutSeconds) => {
  const timeout = vi.spyOn(AbortSignal, 'timeout')
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => new Response('{"suggestions":[],"outline":"第一章"}'))
  vi.stubGlobal('fetch', fetch)
  for (const chapterCount of [undefined, 1, 3]) {
    await aiApi.writing.plotSuggestions({ novelId: 'n', chapterCount, timeoutSeconds })
    expect(timeout).toHaveBeenLastCalledWith(((timeoutSeconds ?? 180) + 10) * 1000)
    expect(JSON.parse(String(fetch.mock.calls.at(-1)![1]!.body))).toMatchObject({ timeoutSeconds: timeoutSeconds ?? 180 })
  }
})

it.each([[undefined, 180], [null, 180], ['300', 180], [NaN, 180], [Infinity, 180], [0, 30], [9999, 600], [45.9, 45]])('超时参数 %s 归一化为 %s 秒', (value, expected) => {
  expect(normalizePlotTimeoutSeconds(value)).toBe(expected)
})
