# 方案 B 设计 · 小说内容分级字段（v2 · 决策已收敛）

- 日期：2026-09-23（v2 修订：2026-09-24）
- 状态：**设计定稿，待发令实施。本轮仍不改任何源码。**
- 前置：`docs/frontend-redesign-under-admin-spec-review-2026-09-23.md` 的 P0-3（安全模式分类判定漏网）
- 范围：字段设计 + 三个工作流的入口位 + 标注来源与工作台。**不含数据回填，不含判定逻辑切换。**

> **v2 相对 v1 的变更**：① 决策全部收口（原第六节六个待确认项已结）；② **纠正 UI 落点**——v1 指定的 `StepConfirm.tsx` 是**全仓库无引用的死组件**，真正的落点是 `ScrapeSetupPanel.tsx`；③ 正则条数由 34 更正为 **33**；④ 补上核对源码时发现的四处「静默丢字段」陷阱；⑤ 标注来源收敛为 ①②③，排除 ④ 举报。

---

## 一、决策总表（六条已收口）

| # | 议题 | 结论 | 依据 |
|---|---|---|---|
| 1 | 字段命名 | **`content_rating` / `contentRating`** | `novel_ratings.rating`（读者 1–5 星，`001_init.sql`）已占用 `rating`，是硬约束非偏好 |
| 2 | `unknown` 判定行为 | **策略 A：回落现有正则** | 未标注期间与今天**行为等价，零回归**；渐进替换而非大爆炸 |
| 3 | 落地入口 | **只做「确认作品并配置章节」一处** | 唯一逐本确认的形态；创建小说是编辑已有作品、发现小说是批量选择 |
| 4 | 标注来源 | **① 人工逐本 + ② 正则预填 restricted + ③ 抓取带入源站分级；不做 ④ 举报** | 收敛危险面，举报入口本就不存在，不自建 |
| 5 | 读者端展示 | **R18 开关与文案全部保留不动；不加「限制级」徽章** | B 不替代 R18，只把判定依据从「猜」换成「事实」 |
| 6 | 标注工作台 | **加「仅看未标注」筛选 + 标注进度指标卡** | 398 本里挑未标注的，无筛选不可作业 |

---

## 二、为什么需要 B

现状：`web/src/context/ContentPolicyContext.tsx:52-58` 的 `isRestrictedContent` 用 **33 条**正则（`:10-44`）扫标题/简介/分类文本。

P0-3 实测（43 个样本标签）：**6 个命中，37 个漏网**，其中三个是明确的限制级特征。归因验证：`「高h」` 半角命中，`「高Ｈ」` 全角漏网。

这是**枚举法对开放集合的固有失败**——标签由源站和运营自由填写，规则永远追不上，且每补一条都可能误伤（加 `/肉/` 会连带拦掉「肉肉大冒险」）。

B 的本质：判定从**猜文本**改为**读事实**。

---

## 三、字段设计

### 三态，而非二态

```
contentRating: 'general'     一般    —— 明确安全
               'restricted'  限制级  —— 明确成人向
               'unknown'     未标注  —— 默认值，尚未人工判定
```

**为什么必须有 `unknown`**：全库 **398 本**（`.tmp/probe/evidence5.json` 实测 `sampleCount: 398`）尚未标注。若只有两态，默认填 `general` 等于把全部未判定书籍静默放行（比现在更危险），默认填 `restricted` 则全站被拦。三态让「未判定」成为一个可见、可统计、可收敛的状态。

### `unknown` 的行为（决策 2）

`restricted` → 拦；`general` → 放；`unknown` → **回落现有 33 条正则**。

效果：B 上线那天行为与今天完全一致；标注一本，就把这本书从「猜」升级为「确定」。等标注率上来，正则可退化为纯兜底或删除。

### 为什么是独立列，不复用 `categories`

分类是读者可见的题材标签（「玄幻」「言情」），分级是内容治理属性。混在一起会导致：读者在分类栏看到治理词；运营改分类时误删分级；`normalizeCategories` 重写分类时吞掉分级。

**独立列：`content_rating TEXT NOT NULL DEFAULT 'unknown'`。**

---

## 四、字段贯穿链路（锚点已逐个核对）

| 层 | 文件 : 行 | 改动 |
|---|---|---|
| DB | 新建 `api/src/db/migrations/032_novel_content_rating.sql` | 现有最新为 `031_novel_cover_history.sql`，032 可用 |
| 行类型 | `api/src/db/mappers.ts:5` `NovelRow` | 加 `content_rating: string` |
| 领域类型 | `api/src/db/mappers.ts:21` `Novel`、`shared/types.ts:6` `Novel` | 加 `contentRating: ContentRating`（**两处都要**） |
| 映射 | `rowToNovel`（`:104-105` 邻域）/ `novelToRow`（`:122-123` 邻域） | 双向都加 |
| 创建 | `api/src/routes/novels.ts:172-209` `createNovel` | INSERT（`:200-202`）：加列 + 占位符 + 参数 |
| 更新 | `api/src/routes/novels.ts:137-141` PUT | UPDATE 加列（参数序要顺延，`updated_at` 与 `id` 的后移） |
| 列表 | `api/src/routes/novels.ts:67` GET | `SELECT *` 已覆盖，无需改 |
| 判定 | `web/src/context/ContentPolicyContext.tsx:46-58` | `ContentMetadata` 加 `contentRating?`；`isRestrictedContent` 改为优先读字段，`unknown` 回落正则 |
| 测试 | `web/src/context/ContentPolicyContext.test.tsx` | 现有 `isRestrictedContent` / `isAllowed` 用例需按新语义扩展 |

### 四处「静默丢字段」陷阱（核对源码时发现，全部不报错）

1. **`rowToNovel` 与 `novelToRow` 双向都要加。** 只加读不加写 → 写入恒为默认值；只加写不加读 → 前端永远拿到 `unknown`。
2. **PUT 有第二处白名单**：`novels.ts:148-158` 的 `updated` 响应对象逐字段重列，再 `c.json` 返回。漏加 `contentRating` 不会报错，但因为 `...existing` 在前面展开，**接口会返回旧值**——改完分级、界面不变，最难查的一类 bug。
3. **`shared/types.ts` 有第二份 `Novel` 定义。** 只改 `mappers.ts` 会让前端类型对不上。
4. **`SetupPreview` 是三分结构**：`ScrapeSetupPanel.tsx:15-22` 定义、`CenterView.tsx:23` 的 `EMPTY_PREVIEW` 初始化、`CenterView.tsx:108-115` 的候选落点 hydration。三处必须同步加键，否则 `onPreviewChange({ ...preview, contentRating })` 丢键且不报错。

> **好消息（v1 未确认，现已核实）**：`createNovel` 里的 `simplifyNovelForSource`（`api/src/services/zh-convert.ts:32-45`）用展开 `...novel` 透传，**不做字段白名单**，不会吞掉新字段。前端 `novelsApi.create(data: Record<string, unknown>)`（`web/src/lib/api.ts:161+`）是无类型透传，也不需要改客户端签名。

---

## 五、UI 入口（唯一实施项）

### ⚠️ v1 的落点错误已纠正

v1 指定 `web/src/pages/admin/scrape/center/StepConfirm.tsx`。**核对结果：该文件已无任何消费者。** 全仓库对 `StepConfirm` 的引用只有它自身（`grep StepConfirm web/src` 仅返回 `StepConfirm.tsx:21/:36` 两行内部定义），其最后一次改动是 `5f97521`，之后被 `839f3f2`（重构确认作品面板）取代。

**真正的落点是 `web/src/pages/admin/scrape/center/ScrapeSetupPanel.tsx`**——`CenterView.tsx:558` 唯一消费它，组件标题正是用户指定的「确认作品并配置章节」（`:109`）。

### 确切落点与形态

`ScrapeSetupPanel.tsx` 的字段区是 `scrape-setup__fields`（`:155-192`），CSS 为两列栅格（`admin-operations.css`：`repeat(2, minmax(0, 1fr))`）。

**插入点：`状态` 字段之后（`:181` 的 `</ScrapeField>` 之后）、`简介`（`:182`）之前。**

```
┌─ 书名 ──────────┐ ┌─ 作者 ──────────┐
├─ 分类 ──────────┤ ├─ 状态 ──────────┤
├─ 内容分级 ──────┤ ├─ (空位) ────────┤
└─ 简介 ──────────────────────────────┘
```

**形态**：与 `状态` 同款 `ScrapeField` + `CustomSelect`（`aria-labelledby={labelId}`），选项 `未标注 / 一般 / 限制级`，新增一个 `CONTENT_RATING_OPTIONS` 常量放在 `STATUS_OPTIONS`（`:55`）旁。

**为什么是这里**：三个工作流里，只有它是「一本一行、逐本确认」的形态。

### 改动点清单

1. `ScrapeSetupPanel.tsx:15-22` `SetupPreview` 加 `contentRating: ContentRating`
2. `:181` 后插入一格 `ScrapeField` + `CustomSelect`
3. `CenterView.tsx:23` `EMPTY_PREVIEW` 加 `contentRating: 'unknown'`
4. `CenterView.tsx:108-115` 候选落点 hydration 加该键
5. `CenterView.tsx:284-292` `novelsApi.create({...})` 带上 `contentRating: preview.contentRating`

**不做**：`NovelsTab.tsx:748` 后的创建小说入口（该弹窗是编辑已有作品）、`DiscoveryPanel.tsx:89` 的批量条。

### 批量路径的行为（已确认，无需处理）

`CenterView.tsx:378` 的 `createAndScrape`（发现小说明细 → 批量抓取）走独立的 `novelsApi.create`，**不经 `SetupPreview`**，因此这一批书全部落 `unknown`。这是可接受的：`unknown` 走正则兜底，且标注本就该是人工判断而非批量猜测。**先观察 `SetupPreview` 路径的实际使用比例，再决定要不要补批量入口。**

### 附带议题（独立，不属 B）

`StepConfirm.tsx` 已成为无消费者的死组件，连带 `.scrape-preview*` 一批样式。是否清理，建议单独开一次小改动，**不要混进 B**。

---

## 六、标注来源（决策 4：做 ①②③，不做 ④）

字段建好后，**谁来填**？这是 B 真正的难点，不是技术。

| 路线 | 怎么运作 | 定位 |
|---|---|---|
| **① 人工逐本标** | 运营在小说管理里逐本改；新书在「确认作品」处顺手标 | **主路径**，唯一能产出 `general` 的途径 |
| **② 正则预填** | 用现有 33 条正则跑一遍存量，**命中的写 `restricted`** | **收危险面的批量手段**，不做判定 |
| **③ 抓取带入** | 源站若有分级标记（PO18 可能有），抓取时读入 | **锦上添花**，需逐源适配，无则跳过 |
| ~~④ 举报兜底~~ | —— | **不做**（用户决策） |

### 一条不可让步的红线

**② 绝不能把未命中的书填成 `general`。**

正则只认它认识的——「肉」这类漏网标签它认不出。若逻辑写成「没命中就是一般」，漏网的书会被**永久性地「认证为安全」**：现在是每次加载都重新猜，还有机会被后续规则捞到；一旦写死成 `general`，它就再也不会被检视。

**所以 ② 的正确用法是**：命中的填 `restricted`（宁多拦、人工再审），未命中的**保持 `unknown`**。`unknown` 继续走正则兜底，与今天等价。

### 收敛逻辑

```
启动：全库 398 本 → unknown（行为 == 今天）
  ↓ ② 正则预填 restricted      危险面立刻收干净，且零误放
  ↓ ① 人工审 restricted        把误拦改回 general，这批是高质量的 general
  ↓ ① 人工标高热度 unknown     逐本消化剩余
  ↓ ③ 新抓取书自带源站分级
终态：正则退化为 unknown 的兜底
```

---

## 七、标注工作台（决策 6）

### 「仅看未标注」筛选

`GET /api/novels` 已有条件式筛选先例（`novels.ts:27-58`）：`status`、`quality`（uncategorized / missing-cover / stale）、`categories LIKE`、`search`。

其中 **`quality` 是最贴近的模板**（`:51`：`conditions.push("(categories = '[]' ... )")`）。加 `contentRating=unknown` 走同一模式：一个 query 参数、一条 `conditions.push`、一个 `params.push`。

前端在 `NovelsTab.tsx` 的 `AdminToolbar` 区加一个筛选项，并与 `params`（`:175` 邻域）拼接。

### 标注进度指标卡

`AdminMetricStrip` **确实存在**（`web/src/components/admin/AdminWorkspace.tsx:90` 导出，`AdminMetricItem` 类型在同文件：`label` / `value` / `detail` / `detailTone`），`DashboardTab.tsx:90-101` 是现成用例。

建议放三个数：`已标注 / 限制级 / 待标注`。**不新增组件**，直接扩 `DashboardTab` 的 `STATS`。

---

## 八、读者端（决策 5：一切保留，不加徽章）

**先把话说清楚：B 不是「用一套更完备的东西替代 R18」。**

读者端现有的 R18 体系是**「读者侧的一个全局开关」**，不是「作品侧的一个属性」：

| 位置 | 现有表述 |
|---|---|
| `ContentRestrictionNotice.tsx:17-43` | 「内容安全模式已拦截」/「显示限制级内容？」/ 18 岁确认 |
| `SiteHeader.tsx:140-146` | 按钮文案「安全模式 / 成人内容」 |
| `ContentPolicyTab.tsx:39-65` | 后台开关「成人内容模式」 |
| `pages/admin/ai/AiWritingPanel.tsx:762` | 创作页「R18 已启用 / 常规内容」 |

```
现在：开关决定「全站受限书可不可见」，判定依据 = 正则猜标题/简介/分类
B：  开关语义不变，判定依据 = 读 content_rating 字段
```

**开关、18 岁确认、文案、后台总闸——全部保留不动。** 变的只有「这本书算不算限制级」这个判断的来源。

### 明确不做：「限制级」徽章

即「在成人模式下，让读者一眼看出这本是限制级」。现在确实没有这种徽章（卡片上只有「连载中/已完结」和「+N 待更新」）——所以那是**新功能**，不是替代。

**理由**：一个只在成人模式下出现、且对已开启该模式的读者没有任何决策价值的徽章，是纯噪音，违反 `DESIGN.md` 的 `10% Accent Rule` 与首页卡片信息密度约束。**若确实想要，单独提需求，单独设计。**

---

## 九、实施顺序与验收

**顺序（每步可独立验收、可回滚）**

1. **迁移 + 读路径**：`032` 迁移、`NovelRow`/`Novel`、`rowToNovel`。验收：`GET /api/novels` 返回 `contentRating: 'unknown'`，全库无变化。
2. **写路径**：`novelToRow`、`createNovel` INSERT、PUT UPDATE **+ `updated` 响应对象**。验收：改一本 → 刷新 → 值持久。**这一条必须实测 PUT 的返回体，专抓陷阱 2。**
3. **UI 入口**：`ScrapeSetupPanel` 加格 + `SetupPreview`/`EMPTY_PREVIEW`/hydration 三处同步。验收：抓一本新书，选定分级，落库正确。
4. **判定切换**：`ContentPolicyContext` 优先读字段，`unknown` 回落正则；扩 `ContentPolicyContext.test.tsx`。验收：**同一批书在切换前后可见性完全一致**（这是策略 A 的核心承诺，必须实测）。
5. **工作台**：筛选 + 指标卡。
6. **② 正则预填**：单独脚本，只写 `restricted`，跑前先备份，可回滚。验收：预填后 `general` 数量仍为 0。

**全局验收口径**：第 4 步完成的那一刻，「安全模式下的可见书目」在标注率为 0 的情况下必须与切换前**逐本一致**。做不到就说明策略 A 没实现，回退。

---

## 十、与 P0-3 归一化的关系

B 不替代 A，**A 是 B 的前置**：

- 归一化（全角→半角、简繁统一）是无副作用的纯规范化，无论用不用 B 都该做
- B 落地后，正则降级为 `unknown` 的兜底，归一化让兜底更可靠

**建议**：先做 A 的归一化（约 10 行，零误伤，立刻消除「高Ｈ」漏网）→ 再按本文档第九节推进 B。

---

## 附：仍待你拍板的两项（不阻塞开工）

1. **`restricted` 的人工审核队列**要不要做？不做的话，「预填 restricted」之后是靠小说管理的状态筛选去找，还是靠进度指标卡的数字人工比对。（我倾向：先不加队列，用「仅看未标注」的反面——`contentRating=restricted` 筛选——凑合，等标注量真的上来了再说。）
2. **`StepConfirm.tsx` 死组件清理**是否并入 B。（我倾向：**不并入**。）
