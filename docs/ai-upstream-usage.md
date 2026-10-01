# AI 上游用量与缓存统计

项目调用协议仍为 OpenAI 兼容的 `/chat/completions` 与 `/images/generations`。用量在 `api/src/services/ai/upstream-usage.ts` 归一，所有真实生成与测试调用在记账前通过 `usageAuditFields` 持久化。普通 JSON、流式 JSON 回退、SSE 最终用量帧共用规则；流式计数按上游累计快照更新，不把每帧累计值重复相加。

| 来源或格式 | 输入 / 输出 | 缓存读取 | 缓存写入 |
| --- | --- | --- | --- |
| OpenAI、NewAPI、OpenRouter 及 OpenAI 兼容中转 | `prompt_tokens` / `completion_tokens` | `prompt_tokens_details.cached_tokens` | `prompt_tokens_details.cache_write_tokens`；NewAPI 兼容 `cached_creation_tokens` |
| Responses 用量经中转透传 | `input_tokens` / `output_tokens` | `input_tokens_details.cached_tokens` | `input_tokens_details.cache_write_tokens` |
| DeepSeek 官方及透传 | `prompt_tokens` / `completion_tokens`；缺总输入时可由 hit + miss 得到 | `prompt_cache_hit_tokens` | 未回传则未知 |
| Claude 原生用量经中转透传 | `input_tokens + cache_read_input_tokens + cache_creation_input_tokens` / `output_tokens` | `cache_read_input_tokens` | `cache_creation_input_tokens` 或 5m / 1h 分拆之和 |
| Gemini metadata 经中转透传 | `promptTokenCount` / `candidatesTokenCount + thoughtsTokenCount` | `cachedContentTokenCount` | 未回传则未知 |
| Moonshot / llama.cpp 扩展 | 沿用响应中的总输入 / 输出 | `usage.cached_tokens`、`choices[].usage.cached_tokens`、`timings.cache_n` | 未回传则未知 |

已有官方 OpenAI 兼容端点（包括 Gemini 的 `/v1beta/openai`）可以直接使用；上述原生用量字段兼容不代表新增 Anthropic Messages、OpenAI Responses 或 Gemini generateContent 的请求协议。

字段缺失、无效、负数使用 NULL；明确 0 保留 0。缓存是输入的子集，推理是输出的子集，不重复计算总 Token。多个别名不相加；NewAPI 的原生与转换缓存写入同时存在时取较大值，避免重复计数。封面描述词仍按项目原有规则合并多次文本调用，任一调用字段未知时，合并字段也保持未知。

金额优先使用 `usage.cost`，兼容顶层 `cost`，转换为现有整数金额单位（金额 × 100000）。未回传时金额存储为 0，另用 `cost_reported=false` 区分真实免费；界面显示「未回传」。汇总展示回传覆盖次数，平均成本仅以金额已回传的调用为分母。

NewAPI 的 usage 是 Token 统计，其消费日志中的 quota 属于实例账单口径，不能直接当作货币金额；本次不调用中转站管理接口、不读取管理凭据、不猜测倍率。若供应商未在响应中回传金额，显示未回传。官方接口仅回传 Token 而无金额时同样处理。

迁移 `040_ai_upstream_usage.sql` 为历史记录保留未知缓存；历史非零成本标记已回传，旧零成本无法判定是免费还是缺失，标记未知。迁移只添加字段，不重算旧 Token 和金额。站内生成内容命中缓存不产生新上游请求，仍不新增用量记录。

字段参考：

- [NewAPI 用量与缓存结构](https://github.com/QuantumNous/new-api/blob/main/relaykit/dto/openai_response.go)
- [OpenAI 提示缓存](https://developers.openai.com/api/docs/guides/prompt-caching)
- [DeepSeek 上下文缓存](https://api-docs.deepseek.com/guides/kv_cache/)
- [Claude 提示缓存](https://platform.claude.com/docs/zh-CN/build-with-claude/prompt-caching)
- [Gemini OpenAI 兼容端点](https://ai.google.dev/gemini-api/docs/openai)
- [OpenRouter 用量与成本](https://openrouter.ai/docs/cookbook/administration/usage-accounting)
