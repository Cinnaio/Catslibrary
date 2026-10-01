import { describe, expect, it } from 'vitest'
import { mergeUsageAuditFields, upstreamUsage } from './upstream-usage'

describe('upstream usage normalization', () => {
  it.each([
    {
      name: 'OpenAI / NewAPI',
      data: {
        usage: {
          prompt_tokens: 1000,
          completion_tokens: 90,
          prompt_tokens_details: { cached_tokens: 800, cache_write_tokens: 100 },
          completion_tokens_details: { reasoning_tokens: 40 },
        },
      },
      expected: { promptTokens: 1000, completionTokens: 90, cacheReadTokens: 800, cacheWriteTokens: 100, reasoningTokens: 40 },
    },
    {
      name: 'NewAPI Claude conversion',
      data: { usage: { prompt_tokens: 1000, completion_tokens: 90, prompt_tokens_details: { cached_tokens: 800, cached_creation_tokens: 100 } } },
      expected: { promptTokens: 1000, cacheReadTokens: 800, cacheWriteTokens: 100 },
    },
    {
      name: 'NewAPI cache-write aliases do not add twice',
      data: { usage: { prompt_tokens_details: { cache_write_tokens: 0, cached_creation_tokens: 100 } } },
      expected: { cacheWriteTokens: 100 },
    },
    {
      name: 'DeepSeek',
      data: { usage: { prompt_cache_hit_tokens: '800', prompt_cache_miss_tokens: 200, completion_tokens: 90 } },
      expected: { promptTokens: 1000, cacheReadTokens: 800, cacheWriteTokens: null },
    },
    {
      name: 'Claude native usage forwarded by gateway',
      data: { usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 800, cache_creation_input_tokens: 100 } },
      expected: { promptTokens: 1000, completionTokens: 50, cacheReadTokens: 800, cacheWriteTokens: 100 },
    },
    {
      name: 'Claude TTL cache creation',
      data: { usage: { input_tokens: 100, cache_read_input_tokens: 800, cache_creation: { ephemeral_5m_input_tokens: 20, ephemeral_1h_input_tokens: 80 } } },
      expected: { promptTokens: 1000, cacheWriteTokens: 100 },
    },
    {
      name: 'OpenAI Responses usage forwarded by gateway',
      data: { usage: { input_tokens: 1000, output_tokens: 90, input_tokens_details: { cached_tokens: 800 }, output_tokens_details: { reasoning_tokens: 40 } } },
      expected: { promptTokens: 1000, completionTokens: 90, cacheReadTokens: 800, reasoningTokens: 40 },
    },
    {
      name: 'Gemini metadata forwarded by gateway',
      data: { usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 50, thoughtsTokenCount: 40, cachedContentTokenCount: 800 } },
      expected: { promptTokens: 1000, completionTokens: 90, cacheReadTokens: 800, reasoningTokens: 40 },
    },
    { name: 'Moonshot choice-level cache', data: { choices: [{ usage: { cached_tokens: 128 } }] }, expected: { cacheReadTokens: 128 } },
    { name: 'llama.cpp cache timings', data: { timings: { cache_n: 128 } }, expected: { cacheReadTokens: 128 } },
    {
      name: 'explicit zero beats another alias',
      data: { usage: { prompt_tokens_details: { cached_tokens: 0 }, prompt_cache_hit_tokens: 800 } },
      expected: { cacheReadTokens: 0 },
    },
    {
      name: 'missing is unknown',
      data: { usage: { prompt_tokens: 1000 } },
      expected: { cacheReadTokens: null, cacheWriteTokens: null, reasoningTokens: null },
    },
    {
      name: 'invalid fields are unknown',
      data: { usage: { cached_tokens: true, prompt_cache_hit_tokens: -1, cache_creation_input_tokens: 'Infinity', completion_tokens: '' } },
      expected: { cacheReadTokens: null, cacheWriteTokens: null, completionTokens: null },
    },
  ])('$name', ({ data, expected }) => {
    expect(upstreamUsage(data)).toMatchObject(expected)
  })

  it('preserves unknown fields when merging multiple cover calls', () => {
    expect(
      mergeUsageAuditFields(
        { cost: 1, costReported: true, cacheReadTokens: 100, cacheWriteTokens: 0 },
        { cost: 0, costReported: false, cacheReadTokens: null, cacheWriteTokens: 50 },
      ),
    ).toMatchObject({
      costReported: false,
      cacheReadTokens: null,
      cacheWriteTokens: 50,
    })
  })
})
