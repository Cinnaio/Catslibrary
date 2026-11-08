**纸舟深度审查 · 2026-11-08**

2026-11-08 后续修复：F1、F2、F4 第一批源码修复已完成，功能提交为 `65205de9`、`17d79960`，发布源码 `4030914e` 已于 13:16（Asia/Shanghai）部署为 API/Web `0.11.2`，迁移 077 与线上就绪／版本复核通过。185 项不同的本地 API／Web 定向回归通过（含 18 项独立 PostgreSQL 用例）；远程 iOS 97 项 Core 测试全通过，包含新增 5 项，并生成 `0.4.1 / build 20` 未签名 IPA，真机验收仍待完成。完整交付边界见 [发布记录](../releasing.md#apiweb-0112-正式发布2026-11-08)。下文保留审查时的基线与证据；原探针中的 F1/F2 已停用，对应正确行为由 `api/src/routes/reader-reliability.test.ts` 验证。F3／F5／F6／F7／F8 仍留在后续批次。

当前最值得投入的是跨端同步、任务恢复和调用成本的可靠性。本次确认 8 项可操作问题：2 项 P1、6 项 P2；其中 5 项有隔离复现，另有 1 项 iOS 静态路径缺陷、1 项现有回归测试失效、1 项构建门禁缺口。审查阶段未修改业务实现，后续修复状态以上方说明为准。

这些问题主要出现在模块交界处：HTTP 成功与数据落库之间、额度检查与实际调用之间、任务持久化与进程生命周期之间、界面改版与测试契约之间。现有类型检查和正常路径测试无法覆盖这些故障窗口。

**审查基线与范围**

- 分支 `main`。开始时 HEAD 为 `7ba8509f141eec82615322edcabbf27e623a90da`，工作区已有 PO18 相关修改；审查期间这些修改被提交为 `34c80e3e5c273f8b2ba7dd81fb223d00b02f3c9d`，随后新增仅包含发布文档的 `cc02b35554f377b85dcac166ffacaa7118efd330`。本报告源码位置以最终工作树为准，五项复现已在 PO18 提交后复跑。
- 本轮审查已有实现，不是只审查最后一个提交。下述问题不应全部归因于 PO18 修复；例如 F3 的回收条件在其父提交中已经存在。
- 审查时 API/Web 源码版本均为 `0.11.1`；根包 `0.5.0`，iOS `0.4.0 / build 19`。[正式发布记录](../releasing.md#apiweb-0111-正式发布2026-11-08)记载 API/Web 0.11.1 已部署；本审查没有独立连接生产环境核验，也没有进行部署。
- 检查了身份与权限、浏览器会话、进度与阅读设置、书签、导入与抓取、AI 额度与后台任务、备份恢复、Web 测试、iOS 同步和发布工作流。方法为调用链阅读、定向回归和故障注入。
- 本机验证为 Windows、Node `22.22.0`、npm `10.9.4`。仓库发布要求为 Node `22.23.4`，因此本轮结果不能替代固定运行时的 Linux 发布验收。
- 本轮只新增 `docs/audits/2026-11-08-*` 审查材料；没有改写其他人的修改，没有提交、推送、生产数据库访问或真实 AI 调用。

**问题总表**

P1 表示应优先处理的数据丢失或成本控制问题；P2 表示应安排修复的可靠性或工程质量问题。优先级并非已发生生产事故的声明。

| 编号 | 优先级 | 问题 | 证据级别 |
| --- | --- | --- | --- |
| F1 | P1 | 失效凭据仍收到进度保存／删除成功，iOS 会清除待同步项 | API 已复现，客户端后果经源码追踪 |
| F2 | P1 | 读者 AI 日额度缺少原子预留，并发可超额调用 | 已复现 |
| F3 | P2 | 手动抓取残留任务不被回收，可占满追更容量并阻止恢复 | 调度已复现，恢复阻断经源码追踪 |
| F4 | P2 | iOS 单本永久失败会阻塞其他作品的进度补传 | 静态调用链确认，未执行 Swift |
| F5 | P2 | 未来时间戳使阅读设置持续拒绝正常时间的新写入 | API 已复现，iOS 行为经源码追踪 |
| F6 | P2 | 业务已提交、幂等回执失败时删除幂等键，重试可重复执行 | 故障注入已复现 |
| F7 | P2 | 监控页 10 项既有测试失败，改版后的业务契约缺少有效验证 | 仓库 npm 命令重复复现 |
| F8 | P2 | iOS IPA 构建／上传不依赖 Core 测试成功 | 工作流配置确认 |

**F1 · [P1] 进度写入把失效会话当成匿名成功**

位置：[POST 进度](E:/Developments/Projects/zhi-zhou/api/src/routes/progress.ts:65)、[DELETE 进度](E:/Developments/Projects/zhi-zhou/api/src/routes/progress.ts:178)、[可选会话中间件](E:/Developments/Projects/zhi-zhou/api/src/middlewares/auth.ts:65)。

`optionalUser()` 无法解析出有效用户时继续执行，POST/DELETE 随后直接返回 `200 {success:true}`。匿名兼容行为本身已有注释，但它没有区分“没有凭据的访客”和“携带已过期凭据、正在同步个人数据的客户端”。

隔离用例在数据库中创建真实的过期测试会话：POST 返回成功但没有写入任何进度；预置一条进度后 DELETE 仍返回成功，原记录没有被删除。不是仅凭 HTTP 状态推测落库结果。

[iOS 网络接入](E:/Developments/Projects/zhi-zhou/ios/ZhiZhou/Services/ReaderProgressStore.swift:13)对这两个请求使用 `requestVoid`；[APIClient](E:/Developments/Projects/zhi-zhou/ios/ZhiZhou/Networking/APIClient.swift:480)不读取 `EmptyResponse` 的业务内容；[待同步队列](E:/Developments/Projects/zhi-zhou/ios/ZhiZhouCore/Sources/ZhiZhouCore/ReaderProgressOutbox.swift:159)只要没有抛错就删除待上传项。因此会话过期后的未同步进度可能从重试队列消失。Web 普通上传已有服务端状态确认，但 [Web 删除入口](E:/Developments/Projects/zhi-zhou/web/src/lib/api.ts:776)也仅凭 `success` 确认本地待同步记录。

建议区分无凭据与无效凭据：携带失效会话的写入返回 401；访客兼容响应明确标记未写入。客户端按账号及操作版本验证服务端回执，回执不完整时保留待同步项。

验收：过期 Bearer／Cookie、服务端会话撤销、响应缺少状态三类场景都不能清空队列；重新登录同一账号后能够补传；账号切换隔离保持有效。iOS 队列后果本轮未做真机复现。

**F2 · [P1] 日额度检查与调用记账之间存在并发窗口**

位置：[额度查询](E:/Developments/Projects/zhi-zhou/api/src/services/ai/usage.ts:89)、[章节摘要入口](E:/Developments/Projects/zhi-zhou/api/src/routes/ai.ts:291)、[阅读回顾入口](E:/Developments/Projects/zhi-zhou/api/src/routes/ai.ts:344)、[摘要记账](E:/Developments/Projects/zhi-zhou/api/src/services/ai/summary.ts:147)。

当前流程是先统计已经写入的用量，再调用模型，最后记录本次用量。两个请求可在任一调用完成前都看到剩余额度。已有按内容合并同一次生成的机制，但不同章节或不同请求类型不会因此共享用户额度预留。

隔离用例将普通读者日额度设为 1，同时请求两个不同章节，并在模拟模型中暂停响应。两个上游调用都已开始，释放响应后两个请求均返回 200，最终记录 2 次用量。无需多个 API 实例即可触发。

建议把读者额度预留做成数据库中的原子操作，让 recap/catchup 共享同一用户、同一额度周期的预留与结算规则；缓存命中仍可保持不计费。模型失败、超时及进程退出分别处理，避免简单重试造成重复调用。项目内[选段生图的事务锁路径](E:/Developments/Projects/zhi-zhou/api/src/routes/thoughts.ts:83)可作为已有实现参考。

验收：剩余额度为 1 时并发请求不同章节及 recap/catchup，最多允许一个新的收费调用；完成、取消、失败及重启后预留状态可解释、可回收。真实 PostgreSQL 多连接验证应覆盖最终实现。本轮没有调用真实模型或产生费用。

**F3 · [P2] 手动抓取残留任务绕过回收范围**

位置：[追更回收与容量计算](E:/Developments/Projects/zhi-zhou/api/src/services/novel-followup.ts:234)、[手动任务入口](E:/Developments/Projects/zhi-zhou/api/src/routes/scrape.ts:297)、[进程内执行](E:/Developments/Projects/zhi-zhou/api/src/services/scraper/runtime.ts:25)、[恢复空闲检查](E:/Developments/Projects/zhi-zhou/api/src/services/backups/worker.ts:109)。

超时回收只处理 `novel_followups.last_job_id` 指向且追更结果为 running 的任务，而容量计算统计全部未结束的远程抓取任务。手动开始／重试创建的普通任务不一定具有上述关联。进程中断后，其执行器已消失，数据库记录仍可保持运行中。

隔离用例模拟 3 个长期无心跳的手动任务，以及一个到期的自动追更。执行调度后，3 个任务均未被回收，也没有启动新的追更。由于调度容量上限为 3，这类残留可停止全部自动追更；恢复前检查也会把任意一个残留任务视为“业务仍在执行”。后一个影响由源码确认，本轮没有执行恢复操作。

建议给所有抓取入口使用统一的执行归属、租约和回收机制，并确保旧执行器迟到的结果不能复活已回收任务。保留已提交章节，区分可安全继续的抓取与需要人工重试的外部工作。

验收：手动开始、普通重试、失败章节重试、自动追更在进程中断后都能结束或恢复；健康任务不会误杀；残留清理后追更容量和恢复预检恢复正常。该问题早于本次 PO18 会话修复。

**F4 · [P2] iOS 单本进度失败阻塞整个队列**

位置：[删除队列失败分支](E:/Developments/Projects/zhi-zhou/ios/ZhiZhouCore/Sources/ZhiZhouCore/ReaderProgressOutbox.swift:147)、[上传队列失败分支](E:/Developments/Projects/zhi-zhou/ios/ZhiZhouCore/Sources/ZhiZhouCore/ReaderProgressOutbox.swift:166)。

队列先处理删除，再按时间处理上传；任意一次错误都会直接 `return`。如果最早待上传记录指向已删除或不再可见的章节，[进度接口](E:/Developments/Projects/zhi-zhou/api/src/routes/progress.ts:68)持续返回 404，该条记录保留在队首，其余健康作品始终没有机会补传。

建议区分影响整个会话的错误与单条数据错误。401 应暂停并恢复身份；已删除作品等单条错误应保留可解释的失败记录，同时继续处理其他作品。不要把所有错误都直接丢弃。

验收：队列第一本不存在、第二本有效时，第二本仍能同步；第一本有明确状态和处理入口；网络离线、会话失效与账号切换仍保留原有保护。本项是静态确认，本机没有 Swift/Xcode，未运行原生测试。

**F5 · [P2] 阅读设置直接信任客户端未来时间**

位置：[时间清洗](E:/Developments/Projects/zhi-zhou/api/src/services/reader-settings.ts:142)、[最后写入胜出的比较](E:/Developments/Projects/zhi-zhou/api/src/services/reader-settings.ts:93)、[iOS 本地更新时间](E:/Developments/Projects/zhi-zhou/ios/ZhiZhouCore/Sources/ZhiZhouCore/ReaderSettings.swift:118)、[iOS 上传确认](E:/Developments/Projects/zhi-zhou/ios/ZhiZhou/Services/ReaderSettingsStore.swift:385)。

时间清洗没有校验有限值、安全范围或未来偏差。某台设备时钟偏快后写入的设置，其时间戳会持续胜过其他正常时间的更新。iOS 每次修改使用当前设备时间，上传后又不读取服务端合并结果，会清掉本地脏标记。

隔离用例对 `device=ios` 写入字体大小 5，时间为当前时间加一年；随后以正常时间写入大小 1。第二次请求返回 200，但服务端仍返回大小 5 和未来时间。字体大小属于设备类型分区；不能据此宣称 iOS 字体直接覆盖桌面字体。问题影响同一分区中的后续更新，以及相应的共享字段。

建议限制客户端时间并采用可验证的服务端修订号／回执；同时处理已存储的未来时间，不能只约束新请求。iOS 应消费服务端合并结果，冲突不能仅以 HTTP 成功清除。

验收：时钟快一年、时钟回拨、离线修改后重新联网、旧数据已有异常时间均能恢复正常同步；UI 最终显示与服务端一致。此处描述的是正常时间的新写入被忽略，不是所有客户端永远无法修改。

**F6 · [P2] 幂等回执失败会解除已提交业务的保护**

位置：[处理器与回执更新](E:/Developments/Projects/zhi-zhou/api/src/services/idempotency.ts:127)、[统一异常清理](E:/Developments/Projects/zhi-zhou/api/src/services/idempotency.ts:143)、[实际封面任务调用方](E:/Developments/Projects/zhi-zhou/api/src/routes/ai.ts:1013)。

`handler()` 与幂等记录不在同一个事务中。处理器完成业务写入后，若读取响应或把幂等记录改为 completed 时失败，统一 catch 会删除 pending 键。调用方用同一键重试时，处理器再次执行。该工具被写作、封面等任务创建路径使用，可能形成重复工作及重复成本。

故障注入用例先完成一笔合成业务 INSERT，再只让 completed 回执 UPDATE 抛错：第一次请求失败、幂等键被删除；同一参数与同一键重试后，业务处理器共执行 2 次，数据库出现 2 条业务记录。实际 AI 路由后果经源码追踪，未生成真实内容。

建议尽可能将操作记录、任务创建与结果标识一起事务提交；对无法纳入事务的副作用，保存可恢复的操作 ID 和任务 ID。“业务是否已提交未知”应作为独立状态处理，不应等同于“可以重新执行”。

验收：业务提交后模拟回执写入失败、连接中断及进程退出；相同操作 ID 重试应找到原任务，不能创建第二个任务。单纯保留 pending 而永久返回 409 也不算完成修复。

**F7 · [P2] 监控页测试与当前交互契约脱节**

位置：[监控测试](E:/Developments/Projects/zhi-zhou/web/src/pages/admin/monitoring.test.tsx:129)、[用量趋势默认折叠](E:/Developments/Projects/zhi-zhou/web/src/pages/admin/ai/AiUsagePanel.tsx:70)、[任务筛选组件](E:/Developments/Projects/zhi-zhou/web/src/pages/admin/ai/AiTasksPanel.tsx:271)、[测试证据](E:/Developments/Projects/zhi-zhou/docs/audits/2026-11-08-monitoring-results.json)。

按仓库 npm workspace 命令运行六个 Web 定向文件，结果为 38 通过、10 失败；10 项均来自 `monitoring.test.tsx`。单独重跑该文件仍为 6 通过、10 失败。

可见差异包括：趋势默认折叠且缓存统计位于 Token 视图；任务筛选改为 `SearchSelect`；刷新入口合并；错误文案和错误组件样式变化；Prompt 按钮不再具有旧名称。测试还在查询旧样式类、旧文案及改版前始终可见的节点，部分用例在真正验证业务行为前便停止。

这些结果不能计作 10 个生产功能缺陷。真正的问题是测试已经不能可靠验证成本精度、未知费用、筛选、刷新和错误恢复。普通 [CI](E:/Developments/Projects/zhi-zhou/.github/workflows/ci.yml:39)会运行 `npm test`，而[发布关键回归](E:/Developments/Projects/zhi-zhou/.github/workflows/release-verify.yml:65)没有包含该文件，因此发布验证通过也不能覆盖它。

建议依据当前批准的交互修复测试：先执行展开／切换／筛选操作，再验证业务语义；保留金额精度、未知费用不显示为免费、Prompt 完整性、删除保留审计等断言。不得以删除测试或放宽所有断言使它变绿。

验收：16 项用例按当前交互全部可执行；关键契约有有效断言；在干净依赖和 CI 固定 Node 版本下复验。本轮没有检查远程 CI 状态；也不把本机不同 Vitest 入口造成的 matcher 错误计入这里的 10 项。

**F8 · [P2] iOS 可在 Core 测试失败时上传 IPA**

位置：[iOS 工作流的两个 job](E:/Developments/Projects/zhi-zhou/.github/workflows/build-ios.yml:25)。

`tests` 和 `build` 是独立 job，`build` 没有 `needs: tests`，且打包和上传都位于 build job 内。即使整个工作流最终因测试失败而失败，IPA 仍可能已经构建并上传；“有可下载 IPA”不能说明该源码通过了 Core 测试。

建议让构建依赖测试成功，或保留并行构建但单独设置同时依赖构建与测试的发布产物 job。当前“手动触发 IPA 构建”的设计可以保留，不需要因此开启每次推送都构建 IPA。

验收：人为令一个 Core 测试失败后，不产生可作为交付候选的 IPA；测试与构建成功时按原流程上传。本轮仅核对 YAML，没有触发 GitHub 构建或验证真实 IPA。

**已有基础与覆盖边界**

| 领域 | 本次观察到的已有基础 | 本轮边界 |
| --- | --- | --- |
| 会话与权限 | 浏览器来源／CSRF、账号绑定、角色及作品可见性已有明确边界，相关回归通过 | 可选会话写入的 F1 仍需修复；没有渗透生产环境 |
| 正文显示与出站访问 | 阅读正文使用标签重建过滤；安全抓取逐跳校验 URL 与地址；PO18 会话修复有定向用例 | DNS 校验与实际连接之间的窗口已有源码说明；本轮未做攻击性网络验证 |
| 导入与抓取落库 | ZIP 有大小／文件数等约束；导入和章节落库使用快照、事务及去重机制 | 大文件解压的事件循环影响需要基准，不能仅凭体积限制判定性能合格 |
| AI 后台工作 | 已有任务租约、归属校验和取消保护，任务／取消回归通过 | 不能由此推断读者额度或通用幂等具备原子性，见 F2、F6 |
| 备份恢复与发布 | 有恢复前预检、维护控制、归档验证和故障回退；本轮发布脚本验证通过 | 没有运行实际数据库恢复或生产发布；恢复可能受 F3 的残留任务影响 |
| Web 与 iOS | Web 补传已校验服务端状态并隔离单本失败；iOS 有按用户持久化队列与会话切换保护 | iOS 的确认语义和错误处理仍有差异，见 F1、F4、F5 |

上述观察是对已检查路径的评价，不是“整个项目不存在安全问题”的证明。依赖漏洞情报、真实浏览器交互、Safari／iOS 真机、生产权限与密钥配置、真实模型响应及性能压力不在本轮验证结果内。

**验证记录**

| 检查 | 结果 | 说明 |
| --- | --- | --- |
| `npm run typecheck` | 通过 | API/Web；组件边界检查 108 个组件、279 个源码模块 |
| `npm run lint -- --quiet` | 通过 | 记录错误检查结果，不代表消除了全部 warning |
| 第一组 API 定向回归 | 106 通过、1 跳过 | 浏览器安全、可见性、账号、书签、任务、写作取消、抓取、PO18、安全抓取 |
| 第二组 API 定向回归 | 42 通过、2 跳过 | ZIP、导入解析与关联、备份配置与部署、阅读数据恢复 |
| Web 六文件定向回归 | 38 通过、10 失败 | 失败集中在监控测试；单独复跑仍为 6 通过、10 失败 |
| 本轮隔离缺陷探针 | 5/5 复现 | F1、F2、F3、F5、F6；断言验证缺陷存在 |
| `scripts/test-release.py` | 5 组通过 | 含 14 种成功／故障模式；使用本地桩，未发布服务 |
| 新增探针与配置 ESLint | 通过 | 以 `scripts/*.ts` 虚拟路径套用仓库 TS 规则；Vitest 已加载并执行探针 |

两组 API 合计 148 通过、3 跳过；重复执行的用例不重复计数。跳过的 1 项需要启用真实浏览器检查，另 2 项需要专用 PostgreSQL 阅读数据测试库。仓库已有独立的 PostgreSQL 备份集成工作流；本轮跳过不表示项目从未做过此类验证。

发布脚本首次使用系统默认 `bash.exe` 时遇到 Windows WSL 别名／输出解码问题；改用 `E:\Developments\Git\bin\bash.exe` 后五组全部通过。该环境错误不作为产品缺陷。运行参数仅作用于测试子进程。

数据库复现使用隔离 PGlite，模型使用 mock，配置目录由既有测试 setup 隔离。PGlite 适合本轮数据与状态复现，不能替代真实 PostgreSQL 多连接下的行锁、死锁及进程竞争验证。

复现五项缺陷：

```powershell
node node_modules/vitest/vitest.mjs run --config docs/audits/2026-11-08.vitest.config.ts
```

这份[探针](E:/Developments/Projects/zhi-zhou/docs/audits/2026-11-08-deep-review.test.ts)刻意断言当前错误行为，因此“5 项通过”表示五项问题仍存在。它未加入常规测试配置；修复时应转换为期望正确行为的回归测试，不能把它作为修复完成的绿色门禁。

复查现有监控测试：

```powershell
npm run test --workspace=@zhi-zhou/web -- src/pages/admin/monitoring.test.tsx --maxWorkers=1 --minWorkers=1
```

发布脚本验证结果保留在[本地输出](E:/Developments/Projects/zhi-zhou/docs/audits/2026-11-08-release-output.log)。本轮没有执行全量测试、生产构建、截图、IPA 构建或设备验收。

**下一轮工作的建议顺序**

| 批次 | 工作 | 完成标准 |
| --- | --- | --- |
| 1：保存与成本 | F1 同步回执、F2 额度预留；同步处理 F4 队列隔离 | 会话失效不吞数据；单本失败不影响其他作品；并发不超剩余额度 |
| 2：中断与重试 | F3 全抓取入口回收、F6 幂等恢复、F5 设置版本与时钟处理 | 重启后任务状态可解释；同一操作不重复创建任务；异常时钟可恢复 |
| 3：交付可信度 | F7 恢复有效测试、F8 IPA 测试门禁；为前两批补真实 PostgreSQL／Swift 验证 | 测试真正覆盖当前行为；交付候选必须通过对应验证 |

在这些问题修好后，可以继续做三项直接改善体验的工作：

1. **让同步状态可见。** 在账号／阅读设置中显示最近一次成功同步、待补传数量及单本失败原因，并提供有明确范围的重试或清理操作。这样能让 F1/F4 一类异常从“用户后来发现记录不见了”变成可诊断的状态。
2. **统一 Web、iOS 与 API 的同步契约。** 明确成功回执、冲突、失效会话、已删除资源和任务状态的语义，复用同一组契约样例。现有 shared 类型和 Core 状态机可以承接这项工作。
3. **按职责拆分大模块，并补真实使用规模的性能预算。** 当前 AI 路由 2,878 行、Web API 客户端 2,913 行、AI 写作面板 2,495 行、导入服务 2,185 行、来源同步 1,680 行，均为物理行数。先按稳定业务边界拆出调用与状态逻辑，再测大书目录、导入峰值内存、搜索冷热缓存及移动端等待时间。文件长度只是维护压力信号，不是单独的缺陷，也不需要一次性重写。

当前投入这些工作的收益是：用户操作能得到可靠确认，后台重启后能恢复，费用限制与真实调用一致，测试结果能代表交付质量。新功能可以在这套基础上继续增加。
