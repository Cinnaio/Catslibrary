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

金额优先使用 `usage.cost`，兼容顶层 `cost`，保留现有 API 单位（金额 × 100000），数据库使用 `NUMERIC(24, 8)` 保存小数单位。生成路径不再四舍五入到整数，汇总 SQL 不再转成整数；页面至少显示四位、按需要最多显示八位小数，更小的正金额显示 `<0.00000001`。未回传时金额存储为 0，另用 `cost_reported=false` 区分真实免费；界面显示「未回传」。汇总展示回传覆盖次数，平均成本仅以金额已回传的调用为分母。

NewAPI 响应未回传金额且携带 `x-oneapi-request-id` 时，使用同一供应商、同一 API Key 的只读 `/api/log/token` 获取消费账单。仅接受请求 ID 精确且唯一匹配的 type=2 记录，不按时间、模型或 Token 数猜测关联。由公开 `/api/status` 获取 `quota_per_unit`，并仅在 `quota_display_type=USD` 时使用 `quota / quota_per_unit` 得到美元金额；其他币种或无效单位保留未知。不使用 `usage.credit`、模型价格、分组倍率估算实际扣费。

公开计价单位缓存 15 分钟；单次账单查询总超时 5 秒，账单尚未出现时最多读取 3 次（间隔 250ms / 600ms）。禁止重定向，密钥只放 Authorization 请求头；失败不重试生成，不丢弃输出，费用保留未回传。官方接口及未标识 NewAPI 的中转站不发额外账单请求。审计记录保存上游请求 ID、成本来源与已确认币种，展开详情可查看；封面合并多次文本调用时不伪造单个请求 ID。

迁移 `040_ai_upstream_usage.sql` 为历史记录保留未知缓存；历史非零成本标记已回传，旧零成本无法判定是免费还是缺失，标记未知。迁移只添加字段，不重算旧 Token 和金额。站内生成内容命中缓存不产生新上游请求，仍不新增用量记录。

迁移 `041_ai_billing_precision.sql` 提升成本精度并增加账单追溯字段，旧整数金额保持原义。旧调用没有上游请求 ID，不能可靠回填账单，也不能恢复已舍入的金额；修复从新调用生效。

字段参考：

- [NewAPI 用量与缓存结构](https://github.com/QuantumNous/new-api/blob/main/relaykit/dto/openai_response.go)
- [OpenAI 提示缓存](https://developers.openai.com/api/docs/guides/prompt-caching)
- [DeepSeek 上下文缓存](https://api-docs.deepseek.com/guides/kv_cache/)
- [Claude 提示缓存](https://platform.claude.com/docs/zh-CN/build-with-claude/prompt-caching)
- [Gemini OpenAI 兼容端点](https://ai.google.dev/gemini-api/docs/openai)
- [OpenRouter 用量与成本](https://openrouter.ai/docs/cookbook/administration/usage-accounting)
