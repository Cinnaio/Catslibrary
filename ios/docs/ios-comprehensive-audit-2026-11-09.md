# iOS 综合审查 · 2026-11-09

> 后续状态：本报告保留修复前基线及当时的源码行号。12 项问题已进入 `1.1.1 / build 23` 源码候选，具体改动和未完成的原生验收见 [修复记录](ios-reliability-fixes-2026-11-09.md)。以下审查记录不代表修复后的运行验收结果。

本次审查发现 12 项需要处理的问题：3 项 P1、9 项 P2。应先处理授权内容无法读取、iPad 换书状态复用、恢复进度期间写入零进度，再处理离线状态一致性与阅读性能。P1 表示影响核心访问或数据正确性，应优先修复；P2 表示有明确触发条件的功能缺陷、结构性性能风险或发布准备缺口。

这些结论来自源码、调用链与 API 契约核对；下文的触发步骤是用于复验的场景，并非已经完成的真机复现。性能风险没有被表述为已测得的卡顿、内存泄漏或耗电数据。

## 审查基线与范围

| 项目 | 本次状态 |
| --- | --- |
| 仓库 | `E:/Developments/Projects/zhi-zhou` |
| 分支与提交 | `main`，`3fa61922492bed312da01efc095f33f7d4c82ca4` |
| iOS 源码版本 | `1.1.0`，构建号 `22`；来源：[project.yml](E:/Developments/Projects/zhi-zhou/ios/project.yml:34) |
| 支持平台 | 工程声明最低 iOS 26.0，支持 iPhone / iPad |
| 审查环境 | Windows；没有 Swift / Xcode / iOS 模拟器运行环境 |
| 实际验证 | 6 项现有 PowerShell 源码检查，5 项通过，1 项因旧断言失败 |
| 本次交付 | 仅新增审查报告；没有修复应用代码、提交、构建 IPA、部署或真机验收；不涉及版本递增 |

已按 `GEMINI.md` 工作，并参考 `DESIGN.md` 的主题、工作区和 iOS 阅读器约定。工作区有并行修改：审查开始时主要为 Web 阅读器文件，收尾时还出现 `ios/ZhiZhou/Resources/ReaderEdgeRuntime.js`、`DESIGN.md` 和 `CHANGELOG.md` 的改动。本报告以以上提交为基线，不包含这些仍在变化的增量；12 项发现引用的 Swift / API 文件在收尾核对时没有工作区差异。本次仅新增此报告，没有修改或回退并行工作。

| 维度 | 核对范围 | 主要结论 |
| --- | --- | --- |
| 前端与导航 | 首页、书架、详情、阅读器、iPad 分栏、搜索、管理任务列表 | 分栏目的页缺少作品身份；管理列表截断 |
| 阅读状态 | 滚动 / 分页、章节切换、位置恢复、生命周期、阅读统计 | 恢复期间可能写入零进度；普通分页路径抑制统计 |
| 网络与授权 | Bearer、内容模式、目录 / 正文 / 预取 / 下载与服务端可见性 | 安全模式请求遗漏已登录身份 |
| 缓存与离线 | 内存 / 磁盘章节缓存、图片缓存、离线清单、下载与清理 | 本地位置不持久保留；清单刷新有重入覆盖风险 |
| 性能与能耗 | TextKit 分页取消、磁盘扫描、字体启动、插图解码、计时与音频生命周期 | 分页取消未传递；普通缓存写入全量扫描；其他项目需测量 |
| 账号与同步 | 会话激活 / 注销、进度 outbox、设置和统计同步 | 注销被多个网络刷新串行阻塞 |
| 管理工作流 | AI 任务及部分导入、备份、危险操作流程 | AI 列表筛选仅覆盖最近 100 条；其他流程为抽样检查 |
| 发布与可维护性 | 隐私清单、构建配置、现有测试和 CI | 系统运行时间 API 缺少理由声明；源码检查有过期断言 |

未完成逐屏视觉验收、VoiceOver 实际朗读、Dynamic Type 极端字号验收、网络抓包、Instruments 测量、Swift 编译及完整管理业务端到端测试。报告不代表这些项目已通过。

## 问题总览

| 编号 | 优先级 | 问题 | 主要影响 |
| --- | --- | --- | --- |
| F01 | P1 | 安全模式读取书库 / 正文 / 下载时丢失登录凭证 | 有权访问的非公开作品被当作匿名访问 |
| F02 | P1 | iPad 同一分栏切书复用旧页面状态 | B 作品页面保留 A 的目录、正文或操作状态 |
| F03 | P1 | 进度恢复未完成时允许保存初始零值 | 已有云端阅读位置可能被覆盖 |
| F04 | P2 | 上传成功即删除唯一的本地进度快照 | 离线重启后无法恢复已同步位置 |
| F05 | P2 | 普通分页路径未完成恢复标记 | 分页阅读时长可能持续不计入统计 |
| F06 | P2 | 显式离线阅读仍等待网络进度 | 弱网下本地正文首屏 / 翻章被网络拖延 |
| F07 | P2 | 离线刷新以旧快照覆盖新清单 | 并行下载丢失索引，删除记录可能重现 |
| F08 | P2 | 分页 detached 任务没有接收取消 | 连续重排积累已过时的 CPU / 内存工作 |
| F09 | P2 | 普通章节缓存每次写入都遍历全部文件 | 大缓存下写入和正文返回成本增长 |
| F10 | P2 | 注销等待多个同步队列和网络请求 | 弱网下账号迟迟无法本地退出 |
| F11 | P2 | AI 任务列表最多实际加载 100 条且不分页 | 历史任务和较早的运行任务不可见 |
| F12 | P2 | 未声明 SystemBootTime 必需理由 API | App Store 提交前需要补齐清单 |

## 详细发现

### F01 · P1：安全模式请求遗漏登录凭证

**证据。** [APIClient.swift](E:/Developments/Projects/zhi-zhou/ios/ZhiZhou/Networking/APIClient.swift:535) 的 `getReader` 默认 `auth = false`，随后以 `auth || mode == "adult"` 决定鉴权；[请求构造](E:/Developments/Projects/zhi-zhou/ios/ZhiZhou/Networking/APIClient.swift:347) 只在 `auth` 为真时附加 Bearer，且该 session 已禁用 Cookie。首页列表、详情 / 目录和正文调用均未传入 `auth: true`，见 [HomeView.swift](E:/Developments/Projects/zhi-zhou/ios/ZhiZhou/Views/HomeView.swift:536)、[NovelDetailView.swift](E:/Developments/Projects/zhi-zhou/ios/ZhiZhou/Views/NovelDetailView.swift:1007)、[ReaderView.swift](E:/Developments/Projects/zhi-zhou/ios/ZhiZhou/Views/ReaderView.swift:1487)。[预取和下载](E:/Developments/Projects/zhi-zhou/ios/ZhiZhou/Networking/APIClient.swift:593) 直接请求时也省略鉴权。

服务端的[作品可见性条件](E:/Developments/Projects/zhi-zhou/api/src/services/novel-visibility.ts:14) 要求活动管理员身份或指定用户授权。安全模式只应控制内容分级，不能代替身份鉴权。

**触发与影响。** 为已登录用户授权一部安全分级、指定用户可见的作品，在安全模式、冷缓存下打开书库 / 目录 / 正文，服务端将请求视为匿名访问。书架使用认证接口，因而可能出现“书架能看到，打开读不了”；管理员可见作品也受影响。已有缓存可能暂时遮蔽问题。

**修复方向。** 将“携带登录身份”与“允许限制级内容”拆开：在线阅读、预取和下载携带发起时捕获的账号 token，并继续明确传递 `contentMode=safe`。保留会话切换和内容权限 revision 的过期结果保护。

**复验。** 覆盖游客、获授权用户、未获授权用户、管理员，分别检查安全 / 成人模式下的列表、详情、章节、预取和下载；确认安全模式仍不能获取限制级正文。

### F02 · P1：iPad 分栏切换作品缺少视图身份

**证据。** [HomeView.swift](E:/Developments/Projects/zhi-zhou/ios/ZhiZhou/Views/HomeView.swift:64) 的 detail 列直接替换 `ReaderView` / `NovelDetailView` 的入参，没有按作品或路由建立身份；[BookshelfView.swift](E:/Developments/Projects/zhi-zhou/ios/ZhiZhou/Views/BookshelfView.swift:266) 采用同类结构。详情保存目录、书架状态、进度和 `displayNovel` 到 `@State`，而[加载任务](E:/Developments/Projects/zhi-zhou/ios/ZhiZhou/Views/NovelDetailView.swift:110) 仅以内容模式为键。阅读器[初始章节](E:/Developments/Projects/zhi-zhou/ios/ZhiZhou/Views/ReaderView.swift:166) 写入 `State(initialValue:)`，其[加载任务](E:/Developments/Projects/zhi-zhou/ios/ZhiZhou/Views/ReaderView.swift:409) 也没有作品 ID。

**触发与影响。** 在 iPad 常规宽度分栏中，从 A 详情切到 B 详情，或从 A 阅读器直接选择 B 的继续阅读，同一结构位置的状态会被保留。页面可能仍显示 A 的目录、封面或正文，但新的 `novel` 入参已经是 B。[书架操作](E:/Developments/Projects/zhi-zhou/ios/ZhiZhou/Views/NovelDetailView.swift:961) 使用新 `novel.id`，因此可能对用户当前并未正确看到的作品操作。

服务端[进度接口](E:/Developments/Projects/zhi-zhou/api/src/routes/progress.ts:68) 校验章节归属，不能据此推断跨书错误进度一定能写入云端。

**修复方向。** 按账号、作品和目的页类型建立稳定的导航身份；或在作品变化时完整取消旧任务、重置派生状态并重新加载。只在 `.task(id:)` 补一个字段不足以清理详情页全部旧状态；身份也不应随普通翻页变化而无意重建整部阅读器。

**复验。** iPad A→B→A；两本书使用相同章号及不同阅读进度；同时检查目录、正文、书架按钮、搜索结果、计时会话和慢请求返回后的状态。

### F03 · P1：离开恢复中的阅读器会保存零进度

**证据。** [章节状态重置](E:/Developments/Projects/zhi-zhou/ios/ZhiZhou/Views/ReaderView.swift:1388) 将进度置为 0；[loadContent](E:/Developments/Projects/zhi-zhou/ios/ZhiZhou/Views/ReaderView.swift:1501) 先安装章节和段落，再等待远端进度。在此期间，[进入后台和离开页面](E:/Developments/Projects/zhi-zhou/ios/ZhiZhou/Views/ReaderView.swift:440) 都调用 `saveProgressNow`。[progressBody](E:/Developments/Projects/zhi-zhou/ios/ZhiZhou/Views/ReaderView.swift:1759) 只核对章节和章号，不检查恢复是否完成，并使用当前时间戳。

服务端[进度写入](E:/Developments/Projects/zhi-zhou/api/src/routes/progress.ts:74) 采用客户端时间戳比较，新时间戳的 0 是有效更新。

**触发与影响。** 云端同章已有 80% 进度；正文先返回，进度 GET 被延迟；此时返回上一页、锁屏或切后台。保存函数可将初始化的 0 作为更新上传，覆盖原有位置。

**修复方向。** 为每次章节加载建立明确的恢复完成状态。恢复完成前不生成保存快照；保存的数据应来自已恢复 / 已显示的阅读位置。继续允许用户实际回到章首时保存合法的 0，不能简单屏蔽所有零值。

**复验。** 注入慢进度响应，在恢复前分别退出、锁屏和切章；验证 outbox 与服务端位置均不倒退，并检查取消的旧响应不能改变新章节状态。

### F04 · P2：成功同步后不再保留本地阅读位置

**证据。** [ReaderProgressOutbox.swift](E:/Developments/Projects/zhi-zhou/ios/ZhiZhouCore/Sources/ZhiZhouCore/ReaderProgressOutbox.swift:159) 在上传成功后删除 pending 条目并保存剩余队列。[ReaderLocalStore.swift](E:/Developments/Projects/zhi-zhou/ios/ZhiZhouCore/Sources/ZhiZhouCore/ReaderLocalStore.swift:21) 的进度持久化即该字典；当前恢复路径仅读取[远端进度与 pending 快照](E:/Developments/Projects/zhi-zhou/ios/ZhiZhou/Views/ReaderView.swift:1507)，没有独立的已确认本地位置。

**触发与影响。** 同章读到 80%，等待同步成功，结束应用后断网，再从离线目录打开同章。队列已清空、远端不可用，恢复值回到 0；此后生成的新快照还可能在恢复网络后同步该回退位置。

**修复方向。** 将“本机最新阅读位置”与“待送达同步队列”分开持久化。确认送达只移除待发标记，保留位置、时间戳和章节身份；删除历史的 tombstone 应同时约束本地快照和远端合并。

**复验。** 成功同步后强制结束应用并离线重开同章；再覆盖未同步位置、跨设备较新位置、删除历史后重开和账号切换。

### F05 · P2：分页阅读的恢复标记未清除，阅读统计被抑制

**证据。** [statisticsVisible](E:/Developments/Projects/zhi-zhou/ios/ZhiZhou/Views/ReaderView.swift:141) 要求 `pendingScrollRestore == nil`。章节加载[总会设置该标记](E:/Developments/Projects/zhi-zhou/ios/ZhiZhou/Views/ReaderView.swift:1538)，不区分页模式。[rebuildPages](E:/Developments/Projects/zhi-zhou/ios/ZhiZhou/Views/ReaderView.swift:1288) 只在搜索命中分支清除它，普通页码恢复分支没有清除；另一个完成恢复的路径位于滚动视图。统计 modifier 在 [visible 为 false 时暂停](E:/Developments/Projects/zhi-zhou/ios/ZhiZhou/Views/ReaderStatisticsModifier.swift:20)。

**触发与影响。** 默认分页模式打开或切换普通章节，没有搜索定位，页面显示后标记仍非空，阅读时长可能一直处于暂停状态。从已经完成恢复的滚动模式再切到分页不一定触发同样结果。

**修复方向。** 分页与滚动模式都在正确位置应用后明确完成恢复，并统一清理恢复标记。重排字体 / 视口时仍需保持锚点，不能通过提前清标记引入新的进度写回竞态。

**复验。** 分页模式分别从章首、已有进度和搜索结果进入，持续阅读并翻页；核对统计增加，打开设置、目录和计时面板时仍正确暂停。

### F06 · P2：离线阅读的加载关键路径仍有网络等待

**证据。** [正文读取](E:/Developments/Projects/zhi-zhou/ios/ZhiZhou/Views/ReaderView.swift:1487) 正确传入 `offline: offlineOnly`，但紧随其后的[进度 GET](E:/Developments/Projects/zhi-zhou/ios/ZhiZhou/Views/ReaderView.swift:1508) 只检查登录状态，没有排除离线模式。[load](E:/Developments/Projects/zhi-zhou/ios/ZhiZhou/Views/ReaderView.swift:1421) 等这段工作完成才结束加载，而[分页构建](E:/Developments/Projects/zhi-zhou/ios/ZhiZhou/Views/ReaderView.swift:1240) 在 `isLoading` 时直接退出。

**触发与影响。** 通过离线入口打开已下载章节，但网络处于连接存在、请求无响应的状态。正文已经在本机，页面仍会等待远端进度成功或失败。默认请求超时为 30 秒；这不代表所有离线打开都会固定等待 30 秒。

**修复方向。** 显式离线路径立即使用本地最新位置完成正文布局。在线模式可异步刷新远端进度，但不得在用户开始阅读后把较晚响应强行应用到当前位置。此项依赖 F04 的持久本地位置。

**复验。** 区分飞行模式的快速失败与黑洞网络的慢失败，检查离线首屏、切章和进度恢复都不等待网络。

### F07 · P2：离线清单刷新覆盖并发下载或删除

**证据。** [OfflineReadingStore.refresh](E:/Developments/Projects/zhi-zhou/ios/ZhiZhou/Services/OfflineReadingStore.swift:279) 从当前 `books` 遍历构建 `refreshed`，逐章 `await` 文件检查后，整体赋值 `books = refreshed`。其保护只验证账号 session，未验证清单的变更版本。同一期间，[下载完成的 upsert](E:/Developments/Projects/zhi-zhou/ios/ZhiZhou/Services/OfflineReadingStore.swift:348) 可以更新并持久化 `books`。`@MainActor` 不会使跨越这些 `await` 的整段流程成为不可交错事务。

**触发与影响。** 下载进行中进入[离线页面或下拉刷新](E:/Developments/Projects/zhi-zhou/ios/ZhiZhou/Views/OfflineReadingView.swift:159)。刷新先持有旧快照，下载随后追加章节，刷新末尾再覆盖清单，新章节索引消失但文件仍存在。若删除发生在对应文件检查之后，也可能由旧快照重新加入已删除记录。

**修复方向。** 对清单变更增加 revision，刷新只提交同一版本的校验结果；或将文件校验结果按 ID 合并回最新清单，并尊重期间的删除。也可串行化清单事务，但不应通过长时间锁住 UI 解决。

**复验。** 在文件检查的挂起点交错新增下载、单章删除、整书删除和再次刷新，验证最终索引与磁盘一致；继续保留换账号取消保护。

### F08 · P2：取消外层重排没有取消 detached 分页工作

**证据。** [ReaderView.rebuildPages](E:/Developments/Projects/zhi-zhou/ios/ZhiZhou/Views/ReaderView.swift:1269) 直接等待 `Task.detached { ... }.value`，未保留句柄或转发取消。[ChapterPaginator](E:/Developments/Projects/zhi-zhou/ios/ZhiZhou/Services/ChapterPaginator.swift:118) 虽然循环检查取消，但收到的 `Task.isCancelled` 属于 detached 任务，外层视图任务取消不会自动改变它。

Apple 的 [detached 任务说明](https://developer.apple.com/documentation/swift/task/detached%28name%3Apriority%3Aoperation%3A%29-9xki7) 明确要求自行处理取消及保留任务引用。

**触发与影响。** 长章节连续调整字号、字体或窗口尺寸，旧 TextKit 排版可能继续跑到完成，多次过时工作重叠。已有结果发布前的取消 / 章节检查仍有价值，因此本项不声称旧分页结果必然覆盖新页面，也没有已测得的掉帧数。

**修复方向。** 为分页保留工作任务句柄，使用取消处理器把外层取消传递进去，或建立有明确生命周期的串行排版 worker；保留分页循环的协作取消检查和结果身份验证。

**复验。** 在长章节反复改变字号后离开阅读器，观察过时任务是否很快停止。用 Time Profiler / Allocations 对比工作数量、CPU 持续时间和峰值内存。

### F09 · P2：普通缓存写入触发全目录扫描，并阻塞正文返回

**证据。** [ChapterDiskCache.store](E:/Developments/Projects/zhi-zhou/ios/ZhiZhouCore/Sources/ZhiZhouCore/ChapterDiskCache.swift:63) 写入普通缓存后总调用 `evictIfNeeded`；[清理函数](E:/Developments/Projects/zhi-zhou/ios/ZhiZhouCore/Sources/ZhiZhouCore/ChapterDiskCache.swift:175) 枚举所有账号目录及文件，读取大小和修改时间，完成这些工作后才判断是否超额。[APIClient](E:/Developments/Projects/zhi-zhou/ios/ZhiZhou/Networking/APIClient.swift:424) 等待存储完成再返回解码后的章节。

**触发与影响。** 多账号、大量已缓存章节下，每次普通写入都有与缓存文件数相关的元数据开销。逐章填充、尚未达到淘汰容量时，累计扫描工作呈二次增长。这是源码复杂度判断，实际耗时尚未测量；已有持久离线副本的更新可提前返回，不属于这条全扫描路径。

**修复方向。** 用增量字节计数 / 淘汰索引维护预算，合并清理工作，并将非必要清理移出正文返回关键路径。保持原有账号隔离、容量约束和离线副本保护。

**复验。** 分别准备小、中、大文件数的缓存，比较新增章节返回耗时与文件枚举次数；验证超额淘汰正确、清缓存不删离线下载。

### F10 · P2：注销被同步积压和弱网串行阻塞

**证据。** [AppState.logout](E:/Developments/Projects/zhi-zhou/ios/ZhiZhou/Services/AppState.swift:217) 依次等待设置、进度、统计 flush，再请求服务端 logout，最后才清 token 和本地账号。[统计 flush](E:/Developments/Projects/zhi-zhou/ios/ZhiZhou/Services/ReadingStatsStore.swift:138) 一次最多发送 20 批。普通网络请求有超时，但整个注销流程没有统一的时间预算。

**触发与影响。** 待同步内容较多、网络慢或请求不响应时，用户点击退出后仍长时间停留在已登录状态。耗时取决于各队列及请求结果，不能简单按固定倍数推断。

**修复方向。** 先可靠持久化待发数据，尽快完成本地会话停用；远端撤销和最终同步采用有限时间预算，并绑定发起时身份。明确处理本地注销后待发队列的再次送达规则，不应通过丢弃队列加速退出。

**复验。** 有未发进度 / 统计的正常网、慢网和断网注销；检查本地退出及时、记录仍保留、后续旧任务不会使用新账号 token。

### F11 · P2：AI 任务筛选只覆盖最近 100 条

**证据。** [AdminAITasksView](E:/Developments/Projects/zhi-zhou/ios/ZhiZhou/Views/Admin/AdminAITasksView.swift:226) 始终请求 `status: "all", limit: 200, offset: 0`，只读取 `items`，没有依据 `total` 翻页。服务端 [listAiTasks](E:/Developments/Projects/zhi-zhou/api/src/services/ai/tasks.ts:245) 将 limit 上限设为 **100**，按创建时间倒序返回。页面的[状态筛选](E:/Developments/Projects/zhi-zhou/ios/ZhiZhou/Views/Admin/AdminAITasksView.swift:117) 仅筛选已经收到的这批数据。

**触发与影响。** 任务超过 100 条后，较旧任务不会出现。若一条仍在运行的任务创建较早，它也会消失，“排队 / 运行”筛选可能错误呈现空列表。聚焦某个任务 ID 的详情请求不受这一历史列表截断影响。

**修复方向。** 将筛选交给服务端并使用实际分页参数；运行中任务刷新与历史列表分页分开管理。对 UI 合并的多个状态，使用明确的接口契约，不能只对首页结果做本地筛选。

**复验。** 准备超过 100 条任务，让一条较早任务保持运行；验证筛选、翻页、取消及刷新后仍能访问该任务，数量与服务端总数一致。

### F12 · P2：隐私清单缺少系统运行时间 API 理由

**证据。** 应用在 [ReadingStatsStore](E:/Developments/Projects/zhi-zhou/ios/ZhiZhou/Services/ReadingStatsStore.swift:95)、[ReaderEdgeStore](E:/Developments/Projects/zhi-zhou/ios/ZhiZhou/Services/ReaderEdgeStore.swift:162) 和 [ReaderView](E:/Developments/Projects/zhi-zhou/ios/ZhiZhou/Views/ReaderView.swift:806) 使用 `ProcessInfo.processInfo.systemUptime`。当前 [PrivacyInfo.xcprivacy](E:/Developments/Projects/zhi-zhou/ios/ZhiZhou/Support/PrivacyInfo.xcprivacy:34) 的访问 API 类别仅含 UserDefaults 和 FileTimestamp。

Apple 将 [systemUptime](https://developer.apple.com/documentation/foundation/processinfo/systemuptime) 列为必须声明用途的 API；类别为 `NSPrivacyAccessedAPICategorySystemBootTime`。其[理由说明](https://developer.apple.com/documentation/bundleresources/app-privacy-configuration/nsprivacyaccessedapitypes/nsprivacyaccessedapitype) 中，`35F9.1` 覆盖应用内事件的时间间隔测量与计时计算，需要结合实际数据流核对适用性。

**影响与修复方向。** 在发布前补齐匹配实际用途的类别与理由，确认归档产物带上更新后的清单。本次没有提交 App Store，因此没有观察到上传拒绝，不将源码缺项写成已经发生的审核结果。

**复验。** 在 Xcode 生成并检查归档的隐私报告与最终 App bundle；确认声明与所有 uptime 调用用途一致。

## 其他性能与前端验收项

以下项目有源码上的成本来源或验收缺口，暂不计入上面的 12 项缺陷。先采样再决定优化，避免没有数据的结构重写。

| 项目 | 证据与风险 | 建议验证 |
| --- | --- | --- |
| 字体冷启动 | [App 初始化](E:/Developments/Projects/zhi-zhou/ios/ZhiZhou/ZhiZhouApp.swift:19) 在主 actor 调用字体注册；[FontStore](E:/Developments/Projects/zhi-zhou/ios/ZhiZhou/Services/FontStore.swift:133) 对已下载文件验证完整 SHA256，随后又启动用量扫描。当前字体资产约为 2.8 MB 和 2.9 MB，不能据此夸大成数十 MB 阻塞 | 测冷 / 热启动主线程时间；检查是否可将校验移出首屏、按文件版本复用校验结果 |
| 存储用量重复扫描 | [FontStore.refresh](E:/Developments/Projects/zhi-zhou/ios/ZhiZhou/Services/FontStore.swift:108) 取消外层任务但未取消 detached 扫描；存储页及字体注册会多次触发 | 快速进入 / 退出存储页，观察重复遍历次数；合并请求、缓存用量快照 |
| 每次账号激活都迁移旧下载 | [activateAccount](E:/Developments/Projects/zhi-zhou/ios/ZhiZhou/Services/AppState.swift:254) 等待 [migrateLegacyDownloads](E:/Developments/Projects/zhi-zhou/ios/ZhiZhou/Services/OfflineReadingStore.swift:256)，后者枚举所有账号离线记录，未见迁移完成版本标记 | 多账号、千章下载下测登录恢复耗时；考虑版本化的一次迁移与后台补偿 |
| 大批量离线清单持久化 | [upsert](E:/Developments/Projects/zhi-zhou/ios/ZhiZhou/Services/OfflineReadingStore.swift:348) 每下载一章排序并在主 actor [编码整个 books](E:/Developments/Projects/zhi-zhou/ios/ZhiZhou/Services/OfflineReadingStore.swift:422) | 测数千章下载时主线程与写入成本；考虑批量提交或增量存储 |
| 正文插图内存 | [ReaderMediaView.decode](E:/Developments/Projects/zhi-zhou/ios/ZhiZhou/Views/ReaderMediaView.swift:110) 固定按最长边最多 2400 像素解码，图片未复用封面共享缓存 | 对多插图章节测峰值与页面离开后的回落；若按展示尺寸降采样，应保持权限与账号隔离 |
| 无障碍与触摸区域 | 预览[关闭图标](E:/Developments/Projects/zhi-zhou/ios/ZhiZhou/Views/ReaderMediaView.swift:321) 的显式视觉尺寸为 32pt；原生 toolbar 可能提供更大命中区域，不能仅凭 frame 判失败 | 真机核对最终命中区域、VoiceOver、最大辅助字号、横屏和 iPad 分屏；同时复查阅读器计时面板的隐藏时间与减少动态设置 |

视觉层面本次只核对源码与设计约定，没有截图或设备效果作为证据，因此不评价“所有页面已符合设计稿”、色彩对比度数值或动画实际流畅度。导航正确性、空态是否真实、离线加载是否及时，比进一步调整装饰更值得先处理。

建议真机性能样本包括：正常章节与超长章节、有 / 无插图、小 / 大缓存、iPhone 与 iPad、低电量模式。记录首屏正文可见耗时、切章耗时、分页 CPU、峰值内存、缓存读写次数以及进入后台后的任务存活情况；当前报告未给这些指标虚构基线或提升百分比。

## 已有且应保留的保护

- **章节与会话隔离。** [APIClient](E:/Developments/Projects/zhi-zhou/ios/ZhiZhou/Networking/APIClient.swift:315) 的章节缓存及返回结果有账号 scope / generation 检查；内容模式进入章节路径。修复 F01 时应保留这些限制。
- **离线文件独立保存。** [ChapterDiskCache](E:/Developments/Projects/zhi-zhou/ios/ZhiZhouCore/Sources/ZhiZhouCore/ChapterDiskCache.swift:25) 将持久离线正文放在 Application Support，而普通缓存放在 Caches；[离线文件](E:/Developments/Projects/zhi-zhou/ios/ZhiZhouCore/Sources/ZhiZhouCore/ChapterDiskCache.swift:110) 排除备份。缓存淘汰不应连带删除下载内容。
- **封面缓存有基础约束。** [CachedAsyncImage](E:/Developments/Projects/zhi-zhou/ios/ZhiZhou/Networking/CachedAsyncImage.swift:11) 使用带成本预算的 NSCache、磁盘 URLCache、按目标尺寸降采样和请求合并；预取并发已有约束。不能把所有图片加载都视为无缓存重复下载。
- **服务端封面区分授权响应。** [cover.ts](E:/Developments/Projects/zhi-zhou/api/src/routes/cover.ts:59) 的 `Vary` 包含 Cookie、Authorization 和 X-Content-Access。没有证据支持仅凭共享 URLCache 就判定跨账号封面泄漏；仍应保留授权切换的验收场景。
- **同步队列并非纯内存。** 进度 outbox 已有持久化、删除 tombstone 和会话检查，问题在于确认后不保留独立位置，以及部分调用时序；不需要推倒整个同步机制。
- **认证和发布配置有边界。** token 使用 [Keychain](E:/Developments/Projects/zhi-zhou/ios/ZhiZhou/Networking/Keychain.swift:18)；TLS 特例在 [APIClient 的 DEBUG 条件](E:/Developments/Projects/zhi-zhou/ios/ZhiZhou/Networking/APIClient.swift:190) 下，不能把该调试路径描述成 Release 默认跳过证书验证。
- **计时功能有生命周期处理。** 阅读器计时 tick 与大正文观察拆开，后台 / 音频中断暂停，本机设置与历史有上下文隔离。仍需真机确认后台无持续音频、界面销毁后无计时残留。

这些是源码中实际存在的措施，不表示本次完成了渗透测试或真机安全认证。

## 实际验证与覆盖缺口

本次已运行以下现有短脚本，没有运行完整单元测试 / E2E 套件：

| 脚本 | 实际结果 | 解释 |
| --- | --- | --- |
| `ios/scripts/image-cache-smoke.ps1` | 通过 | 图片缓存源码约束 |
| `ios/scripts/navigation-smoke.ps1` | 通过 | 导航源码约束 |
| `ios/scripts/content-rating-smoke.ps1` | 通过 | 分级 / 内容访问源码约束 |
| `ios/scripts/admin-operation-smoke.ps1` | 通过 | 管理操作源码约束 |
| `ios/scripts/reader-settings-sync-smoke.ps1` | 通过 | 设置同步源码约束 |
| `ios/scripts/reader-smoke.ps1` | 失败 | `chapter loading is keyed and cancellable` 的字符串断言过期 |

[失败断言](E:/Developments/Projects/zhi-zhou/ios/scripts/reader-smoke.ps1:46) 精确匹配旧任务键 `chapterOrder + mode`；[当前源码](E:/Developments/Projects/zhi-zhou/ios/ZhiZhou/Views/ReaderView.swift:409) 已加入 `requestedChapterID`。因此该失败不是“章节加载没有取消能力”的运行证据，与 F08 的 detached 分页取消问题也不是同一件事。后续应更新断言并增加少量针对真实行为的回归覆盖，不能为了全绿只放宽字符串匹配。

这 6 项属于正则 / 字符串检查，不证明视图身份、actor 重入、进度恢复或网络黑洞场景通过。尤其 F01、F02、F03、F07 应补行为级验证。

CI 配置中，[常规 CI](E:/Developments/Projects/zhi-zhou/.github/workflows/ci.yml:6) 忽略仅 iOS 的路径变化，[iOS 构建工作流](E:/Developments/Projects/zhi-zhou/.github/workflows/build-ios.yml:11) 由手动触发并包含 Core 测试。此次没有触发远端工作流；源码版本、某次历史 IPA 构建和当前提交真机通过不能互相替代。

## 修复顺序与最小验收

建议分四批，避免把授权、状态恢复和性能重构混成一次不可定位的改动：

1. **先保访问与进度正确性：F01、F02、F03。** 先稳定身份、目的页生命周期和进度恢复边界。
2. **补齐离线与统计闭环：F04、F05、F06、F07。** 本地最新位置与投递队列分离，修正两种阅读模式的恢复完成时机及离线清单事务。
3. **消除无效工作和等待：F08、F09、F10。** 传递分页取消，减少缓存枚举，给注销制定网络预算；再依据采样结果决定字体和清单存储优化。
4. **补管理列表与发布检查：F11、F12。** 分页与服务端筛选、隐私清单、过期源码断言；发布前再核对版本、实际构建和设备验收状态。

| 验收场景（尚未执行） | 预期结果 |
| --- | --- |
| 安全模式访问指定用户 / 管理员可见作品，含首次下载 | 授权用户正常访问，未授权用户继续拒绝 |
| iPad 从 A→B→A，保持相同章号，混入慢响应 | 每个目的页展示与操作对象一致，旧请求不串书 |
| 延迟进度响应后立即返回 / 锁屏 / 切章 | 原有云端进度不被初始化零值覆盖 |
| 同步成功、结束应用、断网重开同章 | 恢复本机已确认位置 |
| 普通分页、滚动、搜索跳转及设置 / 目录弹层 | 正文阅读才计时，恢复完成后统计能启动 |
| 已下载正文配合黑洞网络切章 | 正文布局与恢复不等待远端请求 |
| 下载与清单刷新 / 删除交错 | 索引、磁盘文件与 UI 一致 |
| 长章快速调字号 / 旋转 / 退出 | 过时分页尽快终止，不持续堆积工作 |
| 大缓存写新章与清缓存 | 返回成本可控，淘汰不损坏离线下载 |
| 未发队列积压、弱网注销并随后登录另一账号 | 本地及时退出，数据不丢，旧任务不串会话 |
| 超过 100 条 AI 任务，旧任务仍运行 | 可分页找到，运行筛选不遗漏 |
| Release 归档、隐私报告和真机无障碍检查 | 清单随包交付，实际交互和发布状态有独立记录 |

修复后应在 macOS / Xcode 环境执行有针对性的 Core / UI 回归，再做真机阅读与性能采样。只有取得这些结果后，才能给出当前候选版本的运行质量和发布验收结论。
