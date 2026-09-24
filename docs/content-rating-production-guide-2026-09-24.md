# 方案 B 生产落地手册

- 日期：2026-09-24
- 适用：把「小说内容分级字段」从当前工作区发布到生产环境
- 验证状态：**全部步骤已在真实库（398 本）上跑通**，含落库与回滚

> 关键前提：**迁移是 API 启动时自动执行的**（`api/src/index.ts:62` 的 `migrate({ keepPoolOpen: true })`）。
> 生产库不对外开放**不影响**落地——服务端自己连 `DATABASE_URL`，无需从外部访问数据库端口。
> 你只需要「能把新代码放上去并重启 API」。

---

## 零、变更清单（本次要上生产的东西）

| 文件 | 作用 | 风险 |
|---|---|---|
| `api/src/db/migrations/032_novel_content_rating.sql` | 加 `content_rating` 列 + 索引 | 幂等（`IF NOT EXISTS`），只加列不加约束 |
| `api/src/db/mappers.ts` | 行映射双向加字段 + `toContentRating` 归一 | 非枚举值一律归 `unknown`，不当成安全 |
| `api/src/routes/novels.ts` | 创建/更新/筛选/统计/预填接口 | 预填只写 `restricted` |
| `api/src/routes/admin.ts` | 概览返回标注进度 | 只读统计 |
| `shared/restricted-patterns.ts` | **新增**：33 条正则，前后端共用 | 与旧 web 内联版本逐条一致 |
| `shared/types.ts` | `ContentRating` 类型 + `Novel.contentRating` | — |
| `web/src/context/ContentPolicyContext.tsx` | 判定改为「字段优先、`unknown` 回落正则」 | **上线瞬间行为等价** |
| `web/src/pages/admin/scrape/center/ScrapeSetupPanel.tsx` | 「确认作品」加分级下拉 | 纯新增 |
| `web/src/pages/admin/NovelsTab.tsx` | 分级列 + 筛选 + 编辑字段 | 纯新增 |
| `web/src/pages/admin/DashboardTab.tsx` | 两张标注进度卡 | 纯新增 |
| `api/src/routes/content-rating.test.ts` | **新增**：10 条契约测试 | — |

---

## 一、发布（第 1 步：上代码 + 自动迁移）

### 1.1 提交并推送

当前改动**尚未提交**。先在开发机：

```bash
git add -A
git commit -m "feat(novel): 增加内容分级字段（三态）与标注工作台"
git push origin main
```

### 1.2 生产机拉取并重启

```bash
cd /你的/知舟目录
git pull
npm ci --omit=dev          # 若前端也要更新则去掉 --omit=dev
npm run build              # 关键：把 032 迁移拷进 api/dist/migrations
# 重启 API（按你现有的进程管理方式，systemd / pm2 / docker compose restart）
```

`npm run build` 不可跳过：`api/scripts/copy-migrations.mjs` 负责把 `src/db/migrations/*.sql` 复制到 `dist/migrations`。**若生产是直接跑 `api/dist/index.js`，漏掉这步迁移就不会被应用。**

> 若生产以源码方式跑（`npm run dev:api` / `tsx src/index.ts`），迁移目录本就是源码目录，`build` 可省，但仍建议跑一次确保前端产物同步。

### 1.3 确认迁移已生效

看启动日志，应出现以下之一：

```
[migrate] applied 032_novel_content_rating.sql     ← 首次会打印这行
```

或（若此前已被应用过）：

```
[migrate] up to date
```

用 `psql` 复核（在能连库的机器上）：

```sql
\d+ novels                                    -- 应出现 content_rating text NOT NULL DEFAULT 'unknown'
SELECT content_rating, COUNT(*) FROM novels GROUP BY 1;   -- 应全部是 unknown
```

**此时前台行为与发布前完全一致**——已用真实库 398 本实测：安全模式可见书目逐本一致，不一致 0 本。

---

## 二、预填（第 2 步：独立进行，可随时回滚）

**这一步与发布解耦**。分级字段已生效，但 398 本仍是 `unknown`（走正则兜底）。预填是把"正则猜的"固化成"已确认的"。

### 2.1 先干跑

```bash
curl -X POST https://你的域名/api/novels \
  -H "Authorization: Bearer <管理员token>" \
  -H 'Content-Type: application/json' \
  -d '{"action":"prefill-content-rating","dryRun":true}'
```

返回：

```json
{ "ok": true, "scanned": 398, "matched": 202, "applied": 0, "dryRun": true, "ids": [...], "unknown": 398, "sample": [...] }
```

`matched` 就是**将会**被改成 `restricted` 的本数，`sample` 是前 50 条供过目。

> 无 token 时：用 `POST /api/auth/login` 取 token，或走 `GET /api/auth/bootstrap-admin` 判断是否已有管理员。
> 若生产不便直连 API，可在生产机上跑一次性脚本直连数据库（见附录 A）。

### 2.2 过目命中清单

```bash
# 在能连库的机器上执行（读 .env 的 DATABASE_URL）；只读，不写库
npx tsx scripts/export-content-rating-preview.ts            # 写入 docs/ 下带日期的文件
npx tsx scripts/export-content-rating-preview.ts --stdout   # 输出到标准输出
```

当前真实库结果：**命中 202 本（50.8%）**。全量清单与误命中审计见 `docs/content-rating-prefill-preview-2026-09-24.md`。

**误命中结论：202 本里纯误判仅 1 本**（`云端孤岛`，`强X` 匹配到「倔强x假正经」的人物配对写法）。另有 5 本存在旁证误命中，但都有其他正常命中，不影响结论。

> 该脚本直接 import `shared/restricted-patterns.ts`，与预填接口共用同一份正则模块——若脚本自带一份正则副本，"过目清单"与"实际写入结果"就可能不一致，那样评审就失去意义。

### 2.3 落库

```bash
curl -X POST https://你的域名/api/novels \
  -H "Authorization: Bearer <管理员token>" \
  -H 'Content-Type: application/json' \
  -d '{"action":"prefill-content-rating"}'
```

**把返回的 `ids` 存下来**（约 202 个），这是回滚凭据。

落库后核对：

```sql
SELECT content_rating, COUNT(*) FROM novels GROUP BY 1;
-- 期望：restricted 202 / unknown 196 / general 0
```

**`general` 必须为 0** —— 这是红线：正则只写 `restricted`，绝不写 `general`。因为正则认不出漏网标签（`肉` 之类），若把"未命中"当成"一般"，等于把漏网永久认证为安全。

### 2.4 修正个别误判

`云端孤岛` 这类可在后台「小说管理」里手工改回 `general`（或 `unknown`）。**人工判定优先于正则**，这正是方案 B 的设计意图——改了就不会被预填覆盖。

---

## 三、回滚（任何时候可用）

### 3.1 回滚预填（推荐，精准）

```bash
curl -X POST https://你的域名/api/novels \
  -H "Authorization: Bearer <管理员token>" \
  -H 'Content-Type: application/json' \
  -d '{"action":"undo-prefill-content-rating","ids":["id1","id2", ...]}'
```

只会把**当前仍为 `restricted`** 的书退回 `unknown`，**不会动**你手工改过的值。

### 3.2 全局回滚（激进）

```sql
UPDATE novels SET content_rating = 'unknown';
```

### 3.3 回滚代码

`content_rating` 列留着不删也无害（多加一列，判定层不看它时就等价于旧行为）。若要彻底回退代码：

```bash
git revert <方案B的提交>
npm ci && npm run build && 重启 API
```

**注意**：不要执行 `DROP COLUMN`（除非确定），否则回滚代码后旧版行映射不受影响、但丢了已标注数据。

---

## 四、已验证的实测记录

在真实库（398 本）上完整跑通：

| 步骤 | 结果 |
|---|---|
| 起始状态 | general=0 restricted=0 unknown=398 |
| 干跑 | 命中 202，**不写库**（计数不变） |
| 落库 | general=0 **restricted=202** unknown=196 |
| **可见性等价校验** | ✓ **398 本逐本一致，零变化** |
| 回滚 | 202 本 → unknown，恢复至起始态 |

代码侧验证：

| 项 | 结果 |
|---|---|
| `npm run typecheck` | 通过（web + api） |
| `npm run lint` | 触及文件 0 error |
| `npm test` | **44 文件 / 393 测试全通过**（含新增 10 条后端契约） |
| `web` 测试 | **28 文件 / 159 测试全通过**（含新增 5 条判定契约） |
| `npm run build` | 通过，迁移已拷入 `dist/migrations` |

---

## 五、上线后建议顺序

1. **先发布、不预填**：字段与判定切换已生效，行为等价，无风险。观察一天。
2. **干跑预填**，看 `matched` 与 `sample` 是否符合预期。
3. **落库预填**，保存 `ids`。
4. **后台核对**：总览页应出现「待标注分级 196」与「限制级 202」两张卡；小说管理按「仅看未标注」筛选，确认列表可用。
5. **逐本消化剩余 `unknown`**：在「确认作品」抓新书时顺手标注，或在小说管理里逐本改。

---

## 附录 A：无法直连 API 时的等价脚本

若生产环境只能碰数据库、不能调 API，用下面脚本（与接口同源、同语义）。**先在测试库跑一遍**。

```bash
# 1) 干跑：只统计不改
psql "$DATABASE_URL" -c "
  SELECT COUNT(*) AS would_be_restricted FROM novels WHERE content_rating='unknown'
    AND (title || ' ' || description || ' ' || categories) ~* '(成人|色情|情色|肉文|限制级)';
"
```

> **警告**：PostgreSQL 正则方言与 JS 不同（`\s`、`(?:)`、前瞻不可移植），**不要**指望把 33 条规则整体搬进 SQL。
> 上例只演示了 5 条最简单规则的近似统计，**不可用于实际写库**。
> 要精确等价，请在能连库的机器上用 Node 跑 `shared/restricted-patterns.ts`（即本仓库的预填实现）。

---

## 附录 B：这套设计为什么不改变现有读者体验

读者端的 R18 体系是**「读者侧的全局开关」**（安全模式/成人模式、18 岁确认、后台总闸），本次**全部保留不动**。变的只有「这本书算不算限制级」的判断来源：

```
之前：正则猜标题/简介/分类
之后：优先读 content_rating 字段；unknown 才回落正则
```

因此发布当天，凡是 `unknown` 的书判定结果与之前**逐本一致**——这就是策略 A（保守回落）的意义：渐进替换，不是大爆炸切换。
