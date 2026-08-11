# 知舟 AI 模块 · 后续任务计划

> 交接文档。读这份文件的人/模型可能没有参与前期实现，下面的背景是照做所需的全部前提。
> 每个任务都写了改法、注意点和验收标准，可独立执行。

## 背景

AI 能力已落地一条完整闭环：OpenAI 兼容客户端 → `/api/ai` 路由 → 阅读器「前情提要」+ 后台 AI 服务卡。

### 相关文件

```
api/src/services/ai/client.ts       上游调用、退避重试、错误归一化（AiError）
api/src/services/ai/settings.ts     app_settings.ai_settings 里的开关与配额
api/src/services/ai/usage.ts        ai_usage 记账、按自然日配额校验
api/src/services/ai/generations.ts  ai_generations 读写 + 缓存命中判定
api/src/services/ai/summary.ts      章节提要生成
api/src/routes/ai.ts                GET /status、GET|POST /recap、管理端 settings/test/usage
api/src/routes/ai.test.ts           14 条端到端测试（pglite + fetch 桩）
api/src/db/migrations/002_ai.sql    ai_generations / ai_usage / api_keys 三张表
api/src/db/migrations/003_ai_cache.sql  缓存命中索引 (kind, chapter_id, status)
web/src/lib/api.ts                  aiApi 客户端
web/src/components/reader/ChapterRecap.tsx
web/src/components/admin/AiSettingsCard.tsx  挂在「账户与注册」tab
```

### 必须知道的约定

- **供应商**：OpenAI 兼容端点，配置走 `.env` / `/install` 向导的 `AI_TEXT_BASE_URL` / `AI_TEXT_API_KEY` / `AI_TEXT_MODEL`（默认 `deepseek-v4-flash`）。密钥不进数据库。
- **推理模型陷阱**：`deepseek-v4` 系列的思考 token 计入 `max_tokens`。预算给小会拿到 `content: ""` + `finish_reason: "length"`。摘要类调用给到 1200，创作类调用给到 3000 以上。`client.ts` 已能区分这种截断并报明确错误。
- **缓存即审核队列**：`ai_generations` 同时承担缓存与审核两个角色。缓存键 = `params_json`（含提示词版本 + 模型名），改提示词请把对应的 `*_PROMPT_VERSION` 加 1，历史缓存自动失效重算。
- **命中缓存不记账、不计配额**，这是成本控制的关键路径，任何改动不要破坏它。
- **无 key 时前端不渲染入口**而不是报错（自托管优先，AI 是增强不是依赖）。

### 统一验收

`npm run typecheck` + `npm test` 全绿。当前基线：**104 passed**（其中 `ai.test.ts` 14 条）。

---

## 任务 1 · 章节正文更新后作废提要缓存

**问题**：`api/src/routes/chapters.ts:62` 的 `PUT /:id` 原地覆盖 `content`，但 `ai_generations` 里该章的提要仍在，读者拿到的是旧正文的回顾。

（scraper 走 `api/src/services/scraper/store.ts:530`，只插入新行不覆盖旧行，不受此问题影响。）

**改法**：在 `PUT /:id` 的 `withTx` 之后、`return c.json` 之前：

```ts
import { invalidateChapter } from '../services/ai/generations'
// …
if (body.content !== undefined && content !== existing.content) {
  await invalidateChapter(db, 'summary', id)
}
```

`invalidateChapter` 已存在，当前无人调用。`DELETE /:id` 不需要处理——章节没了不会有人查它的提要。

**验收**
- 建章节 → 生成提要 → `PUT` 改正文 → `GET /api/ai/recap?chapterId=` 返回 `cached: false`、`recap: ''`
- 只改标题不改正文时，缓存**不**失效

---

## 任务 2 · 同章并发去重

**问题**：两个读者同时进同一章且无缓存，会各打一次上游，成本翻倍。

**改法**：在 `api/src/services/ai/summary.ts` 内加进程内 in-flight 表：

```ts
const inflight = new Map<string, Promise<RecapResult>>()
```

`generateRecap` 入口按 `chapter.id` 查表：命中则 `await` 已有 promise；未命中则存入，`finally` 中 `inflight.delete(chapter.id)`。

**三个必须注意的点**
1. 复用者**不得重复记账**——`recordUsage` 只在真正发起的那次调用里执行。
2. 失败的 promise 必须从表中清除，否则后续请求会一直复用同一个失败结果。
3. 配额检查在 `routes/ai.ts` 中先于 `generateRecap` 执行，复用者照常受配额约束，这部分不用改。
4. API 是单进程 Node（`@hono/node-server`），进程内 Map 足够，**不要**为此引入 Redis。

**验收**：fetch 桩延迟 50ms，并发发两个同章 `POST /recap` → `fetchMock` 只被调用 1 次、两个响应内容一致、`ai_usage` 只多 1 行。

---

## 任务 3 · 采集真实成本

**问题**：`ai_usage.cost_millicents` 恒为 0，后台用量卡只能看 token 数，看不到钱。

**已知事实**：当前网关的响应体顶层带 `cost` 字段（字符串，如 `"cost":"0"`）。

**改法**
1. `client.ts`：`ChatCompletionResponse` 加 `cost?: string | number`；`AiChatResult` 加 `cost: number`（取 `Number(data?.cost) || 0`）。
2. `summary.ts` 与 `routes/ai.ts` 中的 `recordUsage` 调用传 `costMillicents: Math.round(res.cost * 100_000)`（millicents = 货币单位的十万分之一）。
3. `AiSettingsCard.tsx` 用量格子加一格「今日成本」，显示 `costMillicents / 100_000`，保留 4 位小数。

**注意**：不要假设币种，UI 上不要写 `$` 或 `¥`。`cost` 缺失或非数字时落 0，不要抛错。

**验收**：fetch 桩响应加 `cost: "0.00123"`，断言落库 `cost_millicents` 为 123。

---

## 任务 4 · 进度感知的「回来接着读」回顾

**动机**：现有提要只讲上一章，对连续阅读够用；但真正需要回顾的是「三周前读到第 180 章、回来完全断片」的场景。

**关键设计**：原料全部复用**已缓存**的单章提要，不重新读正文。合成一段长回顾只需一次短上下文调用，边际成本接近零。

**实现**
1. `generations.ts` 的 `GenerationKind` 增加 `'catchup'`。`ai_generations.kind` 无 CHECK 约束，数据库不用改。
2. 新增 `api/src/services/ai/catchup.ts`：
   - 入参 `{ userId, novelId }`
   - 从 `reading_progress` 取 `chapter_id` 与 `updated_at`（唯一索引 `(user_id, novel_id)`）
   - 取该章往前 3-5 章，用 `findPublished(db, 'summary', ...)` **只捞已有缓存**
   - 缓存不足 2 条 → 返回 `null`，前端不渲染。**绝不为此触发批量生成**，否则一次点击烧 5 次钱
   - 拼成一次调用生成 150 字内的连贯回顾，`maxTokens: 1200`
   - 缓存键含参与合成的章节 id 列表，读者继续往下读后自然失效
3. `routes/ai.ts` 加 `POST /catchup`，`requireUser()`，走同一套配额。
4. 前端入口放**书架卡片 / 小说详情页**，不放阅读器——这是「进书之前」的动作。触发条件：距 `reading_progress.updated_at` 超过 7 天。

**验收**
- 预置 3 条已发布单章提要 + 1 条 progress 记录 → `POST /catchup` 返回文本且 `fetchMock` 只调 1 次
- 只有 1 条缓存时返回 `null`，且**完全不调用**上游

---

## 任务 5 · AI 续写

`ai_generations.kind` 里预留的 `continue` 在这里落地。这是本批中最大的一个，建议单独一个 PR。

### 设计约束（不是建议，是必须）

1. **产物一律落 `status: 'draft'`，永不自动发布。** `ai_generations` 的 `draft | published | rejected` 三态就是为此设计的，审核链路必须走完才可能对读者可见。
2. **采纳成为正式章节时必须留下可追溯来源。** 复用现有列，不加迁移：写入 `chapters.source_url = 'ai://<generationId>'`。阅读器据此前缀渲染一个「AI 生成」标记，读者始终知道自己在读什么。
3. **v1 仅管理员可触发。** 走 `requireAdmin()`，不计入读者配额但照常记账。日后要向读者开放，只需换中间件 + 接上现有配额，不需要重构。

### 上下文构造（这一步决定成败）

续写需要的上下文远多于摘要，**不能只喂摘要**——那样出来的文字没有原作语感。三段拼接：

| 段 | 内容 | 来源 | 目的 |
|---|---|---|---|
| 前情 | 最近 3-5 章的单章提要 | `findPublished(db, 'summary', ...)` 缓存 | 剧情连续性，便宜 |
| 语感 | 最后一章结尾的**原文** 1500-2000 字 | `chapters.content`，经 `prepareChapterText` 清洗 | 文风、人称、对白习惯 |
| 约束 | 目标字数、视角、不得引入新主要角色等 | 请求参数 | 可控性 |

### 实现

1. 新增 `api/src/services/ai/continuation.ts`：
   - `CONTINUATION_PROMPT_VERSION` 常量，改提示词时递增
   - `temperature: 0.85`（摘要用的是 0.2，创作需要发挥空间）
   - `maxTokens: 3000` 起步——目标产出 800-1500 字，推理模型还要额外吃掉一大截思考预算
   - 落 `saveGeneration({ kind: 'continue', status: 'draft', ... })`，`params_json` 记录参与构造的章节 id 与目标字数
   - **不做缓存命中复用**：续写是创作，同样输入产出不同结果是特性不是 bug
2. `routes/ai.ts` 新增：
   - `POST /continue`（`requireAdmin()`）→ 生成草稿，返回 `generationId` 与正文
   - `GET /generations?status=draft&kind=continue`（`requireAdmin()`）→ 草稿列表。**`generations.ts` 里的 `listGenerations` 已实现且当前无人调用，直接接上即可**
   - `PUT /generations`（`requireAdmin()`）→ 改 `status` 为 `published` / `rejected`，写 `reviewed_at` 与 `review_note`
   - `POST /generations/:id/adopt`（`requireAdmin()`）→ 采纳为正式章节：插入 `chapters`，`sort_order` = 该书当前最大值 + 1，`source_url = 'ai://<id>'`，同步 `novels.chapter_count`，并把该 generation 置为 `published`
3. 前端新增后台页面「AI 草稿」（建议进 `web/src/pages/admin/`，在 `admin-registry.ts` 注册为新 tab）：
   - 选小说 → 显示最后一章 → 「生成续写草稿」按钮（可填目标字数）
   - 草稿列表：正文预览、模型、生成时间、采纳 / 驳回两个操作
   - 驳回时可填 `review_note`
4. 阅读器：`chapters.source_url` 以 `ai://` 开头时，在章节标题下方渲染一个克制的「AI 生成」标记。样式走 `web/src/styles/reader.css`，圆角与字号必须落在 DESIGN.md 的档位上（该文件已完成设计系统迁移，不要引入新的字面值）。

### 验收

- `POST /continue` 产出的行 `status` 必须是 `draft`；未经 `adopt` 时 `chapters` 表行数不变
- `adopt` 后：新章节 `source_url` 为 `ai://<generationId>`、`sort_order` 正确递增、`novels.chapter_count` 同步、generation 变为 `published`
- 非管理员访问上述任一端点返回 403
- 上游截断（`finish_reason: "length"` + 空 content）时返回 422 且**不落草稿**

---

## 明确不做

写下来是为了防止后续跑偏：

- **向量检索 / 全书 RAG**：自托管单库体量下，pgvector 运维 + embedding 持续开销换不来对等收益。要做「我记得有个情节…」就用「AI 生成关键词 → 现有全文检索」，成本低一个数量级。
- **`api_keys` 表接线**：建了没用是对的。除非确有外部客户端需求，否则保持空置——半实现的鉴权比不实现更危险。
- **批量预热提要**：等任务 1、2 落地、功能确认正确后再谈，否则是在放大一个尚未验证的东西。

---

## 建议执行顺序

| 批次 | 任务 | 说明 |
|---|---|---|
| PR 1 | 1 + 2 + 3 | 均为既有代码的小补丁，互不冲突，风险接近零 |
| PR 2 | 4 | 依赖任务 2 的去重逻辑（合成调用同样怕并发重复） |
| PR 3 | 5 | 最大的一个，含新后台页面与新数据流 |

## 尚未决定的事项

- **AI 能力对谁开放**：当前默认所有登录读者可用（每日 30 次，管理员不限额，后台可改）。若要收紧为仅管理员，把 `dailyQuota` 设为 0 即可，无需改代码。
- **续写是否最终向读者开放**：v1 定为仅管理员，见任务 5 约束 3。
- **`/install` 向导的 `AI_IMAGE_*` 三项**：`setup.ts` 的白名单里已有这三个键，但向导没有对应表单，图像能力也尚未实现。等真正做封面生成时一并补。
