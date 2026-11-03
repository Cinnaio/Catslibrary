# AI 续写与封面生成：第一批执行计划

状态：第一批已按 S0–S6 在两个工作区实施；本地可运行验证已完成，macOS/iOS 运行时验证仍待执行。未提交、未推送、未部署。

## 1. 目标、基线与权限

第一批完成四件事：草稿保存/发布一致、续写上下文正确、封面配置与提示词语义一致、任务能够恢复并精确打开结果。

本计划以以下本地基线为依据，执行前必须重新核对，不能按行号机械修改：

| 仓库 | 绝对路径 | 规划时 HEAD | 规划前工作区 |
| --- | --- | --- | --- |
| iOS | `E:\Developments\Projects\zhi-zhou-ios` | `7749cfa` | 干净 |
| API/Web | `E:\Developments\Projects\zhi-zhou` | `508a4ab` | 干净 |

- 规划阶段授权仅为规划；当前实施授权来自用户要求按本计划执行。本文件的完成项以第 11 节和执行记录为准，不把静态检查当成 iOS 编译或真机通过。
- 用户要求按本计划执行后，实施遵循既定方案，不自行更换产品方案、不扩大到第二批。
- 两仓库独立检查、独立暂存。未获后续授权，不提交、不推送、不部署、不运行生产数据库迁移、不调用真实付费模型、不改版本号。
- 保持现有 SwiftUI 原生页面、AppTheme、共享控件、导航深度控制和危险操作确认机制。此次不做视觉重设计。
- 规划阶段未找到两仓库内或共同父目录中的 `AGENTS.md`；实施时重新检查。
- 当前 Windows 环境未发现 `swift` / `xcodebuild`。iOS 编译与运行验证需要 macOS；不得把 PowerShell 文检查当成编译或真机通过。本计划只把 Windows 静态检查列为源码契约验证。

## 2. 第一批范围已经确定

### 必做

1. 草稿保存后立即显示正确正文；发布包含当前修改；保存失败不得继续发布；关闭保护未保存正文。
2. 服务端保存只允许修改有效草稿，发布在事务内读取实际正文，避免并发把已发布内容降回草稿或发布旧快照。
3. 续写优先保留起点章节结尾；验证起点归属；三类画像带来源，禁止自动注入起点之后或来源不明的画像。
4. 创建续写任务时冻结上下文与选用画像；重试沿用快照；检查已有产物的连续性。
5. 封面区分自动配置与完整提示词；配置变更后不得假装已经改写提示词；请求参数和变体 ID 在提交前冻结。
6. 前台任务查询支持退避恢复、手动继续查询、明确终态；任务结果按真实任务/批次关联。
7. 续写完成直达本次结果；封面采纳/上传后可见成功和当前封面更新。

### 本批不做

- 长期记忆库、向量检索、全书自动摘要、画像历史版本库、人物关系图、逐章规划生成器。
- AI 选段改写、全文版本比较、参考图、局部改图、文字分层排版、封面历史恢复和候选对比工作台。
- 全站表单自动保存。本批仅保护草稿正文，并持久化已经提交的 AI 请求快照以支持恢复。
- 多账号协同编辑的完整版本冲突系统。只修复本批明确的状态竞态；不宣称支持无冲突协作。
- 重构整个管理后台或将 iOS 的所有功能同步重做一遍 Web。Web 仅做共享接口/配置语义必要适配与回归。
- 全书选书搜索分页、批量删除撤销空态等独立问题。见第 12 节。

## 3. 已核实的问题与根因

以下是静态代码证据，不是已复现的线上故障。

| ID | 问题 | 代码位置（相对于所在仓库） | 结论 |
| --- | --- | --- | --- |
| D1 | 保存后清空 `draftText`，显示/再次编辑回到不可变 `item.result` | iOS `AdminAIGenerationsView.swift`：`saveDraft`、`GenerationDetailSheet` | 明确实现缺陷 |
| D2 | 发布不保存正在编辑的 `draftText`；关闭不保护修改 | 同文件：`publish`、关闭按钮和 sheet | 明确实现缺陷 |
| D3 | `updateGenerationResult` 不校验当前状态，还默认写 `status='draft'` | API `services/ai/generations.ts:273`，`routes/ai.ts:882` | 并发发布后迟到的保存可错误降级状态 |
| D4 | 发布事务外读取正文，事务内只抢占状态 | API `routes/ai.ts:905` | 事务等待期间发生保存时，可能发布旧正文 |
| C1 | 最近三章各保留前 4000 字；已生成章节也取前 6000 字追加 | API `services/ai/writing.ts`：`recentNovelContext`、`generateContinuationChapters` | 长章结尾可能丢失 |
| C2 | 指定起点的子查询只按章节 ID 找序号，未验证所属小说 | 同文件：`recentNovelContext`；路由未补验 | 非本书 ID 或不存在 ID 需要明确拒绝 |
| C3 | 风格/关系/情节画像都是按小说全局读取，没有起点约束 | `writing.ts:208–235`，三个 profile/state 服务 | 回到早期章节时可能混入未来信息 |
| C4 | 风格画像实际取最近 5 章且包含角色处境/世界观，并非纯语言样式 | `style-profile.ts` | 不能只给情节画像加边界，风格也需要来源检查 |
| C5 | `chapters_through` 写入 `rows.length`，即样本章数 | `plot-state.ts:107` | 不能把“最近取样 8 章”显示为“梳理到第 8 章” |
| C6 | 重试重新读取最新上下文；已有草稿仅筛 draft，用数量作为恢复索引 | `routes/ai.ts`：`loadResumeDrafts`、`startWritingJob`；`generations.ts:listBatchDrafts` | 重试可改变起点；已发布/缺号结果影响恢复 |
| P1 | 非空 prompt 直接送图像模型，选择器变化不修改 prompt | API `cover.ts:738`；iOS `AdminAICoverView.swift` | 需要明确定义配置何时生效 |
| P2 | 自定义 prompt 的元数据仍由选择器推导，可能标注未实际采用的风格 | `cover.ts:metadataForCustomPrompt` | 元数据不能伪装成实际生效配置 |
| P3 | 封面路由在幂等 payload 建立前随机补 variationId | API `routes/ai.ts`：`/cover/generate` | 同一请求不传变体时，重放指纹可能变化 |
| T1 | 写作/生图轮询一次错误即返回；正常达到次数上限也无恢复说明 | iOS Writing `pollWritingTask`、Cover `pollCoverTask` | 页面可长期显示旧 running 状态 |
| T2 | 写作/生图的已结束轮询句柄没有统一置空；恢复函数以 nil 为门槛 | 同上及 `resume*` | 仅增加重试按钮仍可能无法恢复 |
| T3 | 同一全局 operation key 可复用旧请求 ID，但提交闭包仍读取新表单 | `AITaskCoordinator.start`、Cover `generatePrompt/generateCover` | 恢复必须绑定冻结参数，不能重放另一份表单 |
| T4 | 写作任务完成只显示文字；普通结果列表无任务/批次过滤入口 | Writing `taskProgressSection`；API `/generations` | 不能用“最新一条”替代精确结果关联 |
| T5 | 客户端为 completed 任务也显示重试；服务端只接受 failed/cancelled | `AdminAITasksView.taskRow`、API `/tasks/:id/retry` | 显示规则需要一致 |
| T6 | 封面采纳仅刷新候选，本地上传后也无当前封面更新 | Cover `adopt`、`uploadCover` | 缺少完成反馈 |

## 4. 架构与行为决策：Luna 按此落实

### 4.1 草稿：先保存，再发布；统一当前正文

不新增一个同时保存和发布的全新接口。沿用 `PUT /writing/drafts/:id` 和 `POST /writing/drafts/:id/publish`，修正服务端竞态和客户端调用顺序，保持旧客户端可用。

详情页至少区分：

- `savedText`：最近一次服务端确认的正文。
- `editorText`：用户当前编辑内容。
- `isEditing`、`isDirty`、`hasServerChanges`、正在执行的动作。
- 不再将 `nil` 同时作为“退出编辑”和“回到原始数据”的信号。

具体行为：

1. 初次进入从 `item.result` 初始化；以后预览、编辑和 AI 标题生成都使用当前正文。
2. 保存成功必须采用接口返回的规范化正文更新 `savedText/editorText`，退出编辑后仍显示新正文。
3. 点击发布冻结正文和标题，禁用编辑/重复操作。若正文变更，先 PUT，成功才 POST；PUT 失败保留输入并停止。
4. POST 明确被业务错误拒绝时，已保存修改不回滚；提示“修改已保存，发布未完成”。POST 超时/断网属于结果未知，显示“修改已保存，正在确认发布状态”，通过下面的单条 GET 重新核对：已 published 则按成功处理；仍 draft 才允许再次发布；查询也失败则保留“状态待确认”，不能断言发布失败或自动重复 POST。
5. 关闭有未保存正文时提供“保存并关闭 / 放弃修改 / 继续编辑”；保存失败不关闭。编辑有修改或请求执行中禁止 sheet 手势直接关闭。
6. 任何成功保存都使父列表刷新，即使最后用户只是关闭；不能只有发布成功才刷新。无修改关闭不必请求刷新。
7. 大纲可以编辑保存，但不提供章节发布按钮。
8. 本批标题输入是发布元数据，明确不会由正文保存接口持久化；不声称标题自动保存。

服务端修复：

- `updateGenerationResult` 仅执行条件更新：`id` 匹配、`status='draft'`、`deleted_at=0`、允许的创作 kind；不修改 status。检查 affected rows，0 行返回明确 404/409，不得返回假成功。
- 单条发布继续使用现有小说行锁串行化序号，但草稿的状态、正文、kind、deleted_at 必须在事务内重新读取并锁定。锁顺序统一为小说行 → 草稿行，避免与整批发布反向加锁。
- 从锁定的最新正文解析标题/正文，再插章节、更新状态和小说计数；事务外旧 `row.result` 不能作为发布内容。
- 整批发布复用同样的“事务内读取实际正文”规则，保持 batchIndex 顺序；不得让修复只覆盖单条而遗留同类竞态。
- 保持既有首行标题剥离、重复发布防重、软删除和撤销发布语义。正文保存与并发发布交错时，合法结果只能是“保存先成功，发布新文”或“发布先成功，后续保存被拒绝”。
- 新增管理端只读 `GET /api/ai/generations/:id`，返回 `{item: GenerationDetail}`，排除软删除、权限与原列表一致。供详情刷新和发布响应丢失后的核对；复用同一详情映射，不复制不同版本的字段解析。不存在返回 404，不能用列表最新一条代替。

建议将正文编辑状态/保存后发布顺序封装成小型可测试的 Core 状态对象与注入式动作；SwiftUI 负责展示。不要仅抽一个 `isDirty` 布尔值然后用文本搜索充当发布顺序测试。

### 4.2 续写：有限上下文、来源可验证、任务输入冻结

#### A. 起点与正文

- 没有传 `afterChapterId` 时，服务端将“最新章节”解析为一个实际本书章节 ID；本批新续写任务不保留浮动 latest。
- 有 ID 时验证 `chapters.id` 和 `novel_id` 同时匹配；不存在或属于其他书都返回 404，不回落到最新。
- 无章节返回 422，引导使用新写。iOS 同时区分章节加载失败、加载中、确实为空，不吞错成空数组。
- 当前 `StartWritingResult` 的状态联合类型也需包含 422。
- 用实际 `sort_order` 排序，必要时以 ID 作稳定次序，不假定序号从 1 连续递增。

正文预算固定为现有 12000 字符，不新增一次摘要模型调用：

1. 起点章节优先保留清洗后末尾最多 6000 字符。
2. 剩余预算分配给前两章，各最多 3000 字符，优先保留尾部；按时间顺序拼接。
3. 标题、分隔符也计入总预算；超限从最早正文削减，不裁掉起点尾部，不留下半个章节标题。
4. 添加单独的 continuation 清洗/截取帮助函数，保留原 `cleanWritingText` 对其他功能的兼容性。
5. 多章迭代同样保留最近生成章的尾部最多 6000 字符，再加剩余旧上下文；不能继续使用 `cleanWritingText(result, 6000)` 的前缀。
6. 明确这是确定性节选，UI 不称为“前文摘要”。真正的自动摘要放第二批。

#### B. 画像来源

第一批继续每本书每类画像一行，只补充来源，不建设版本历史表。

新增一个增量 SQL 迁移（当前最后为 028，执行时确认编号）：给三张表增加 `source_json TEXT NOT NULL DEFAULT ''`：

- `novel_style_profiles`
- `novel_plot_states`
- `novel_relationship_profiles`

`source_json` 的 V1 内容统一为：

```ts
type ProfileSource = {
  version: 1
  chapterId: string           // 此次提取的最后一章
  chapterTitle: string
  sortOrder: number
  chapterOrdinal: number     // 提取时本书 <= 起点的章节数，不等同 sort_order
  sampleCount: number        // 实际取样章数
  samplePolicyVersion: 1
  fingerprint: string        // 对实际有序样本的 ID、顺序、标题、清洗正文计算 SHA-256
}
```

来源构造与验证抽到 `api/src/services/ai/profile-source.ts`（拟新增），三个提取服务共用，避免三种算法漂移。

- 三类画像 POST 都接受可选 `afterChapterId`，省略表示提取到当前最新章节；只选择本书且不晚于该起点的样本。
- 继续使用已有默认采样数：风格 5、情节 8、关系 10。风格接口不必顺便新增采样数 UI。
- 取样时记录实际来源；不要在长模型调用完成后再读最新章节替代来源。来源来自此次真正输入模型的样本。
- GET/POST 增加可选 `source`、`updatedAt`；GET 增加 `afterChapterId` 查询参数以计算本次续写的 `eligibility`。
- `eligibility` 为 `usable | missing | legacy_unknown | beyond_anchor | stale | source_changed`。
- `source_json` 缺失/损坏：原画像保留可查看，状态为 legacy_unknown，续写不自动注入；不能用更新时间猜来源。
- 来源章节不存在、所属书不符、样本 fingerprint 不再匹配：source_changed，不注入。
- 来源晚于续写起点：beyond_anchor，不注入。此规则覆盖风格、关系、情节三者。
- 来源等于起点且 fingerprint 有效：usable。
- 来源早于起点：风格/关系允许复用但显示“来源较早”；情节按 stale 排除，避免把旧处境当成当前状态。可在 envelope 增加 `isOlderThanAnchor`，不要让 usable 与 stale 的含义混淆。
- 新提取的情节 `chapters_through` 写正确的 chapterOrdinal；旧值不做推测性回填，旧数据 UI 显示“来源未记录”。主要展示章节标题和 sampleCount。
- 首批升级后旧画像需要管理员手动按起点刷新；不在打开页面或开始续写时偷偷触发三次模型调用。
- 在 iOS 当前起点下显示“用于本次 / 来源较早 / 需重新提取”的摘要及全文查看入口。手动刷新按钮说明会替换该书当前画像。自动编辑画像属于第二批。
- 切换起点重新读取画像适用性，使用 `(novelId, afterChapterId)` 的请求身份防止迟到数据覆盖。

#### C. 冻结续写输入与恢复

复用 `ai_tasks.params` TEXT(JSON)，不新增任务快照表。在开始任务前生成服务端内部字段：

```ts
type ContinuationSnapshotV1 = {
  version: 1
  contextPolicyVersion: 1
  anchor: { chapterId: string; title: string; sortOrder: number }
  context: string
  profiles: { style: string; relationship: string; plot: string }
  profileSources: { style?: ProfileSource; relationship?: ProfileSource; plot?: ProfileSource }
  excludedProfiles: Array<{ kind: 'style' | 'relationship' | 'plot'; reason: string }>
}
```

- 冻结上下文、起点、已选用的画像文本与来源；只存必要信息，不复制全书正文。
- `continuationSnapshot` 是内部字段，普通创建请求中同名客户端输入一律忽略；只能由服务端构建，或从服务端旧任务恢复。
- `generateWriting` 接受显式 profile override；续写即使 override 是空串，也不得回退到全局画像。新写保持现有行为。
- 每章执行都用同一份基础画像快照，正文上下文按已生成章节递进。本批不宣称画像会随生成自动更新。
- 重试有 V1 快照的任务时，不重新解析 latest、不重新读取全局画像作为输入。
- 无快照的旧续写任务返回明确 422：“旧任务未保存续写上下文，请重新创建任务”；不静默以最新内容重跑。其他旧任务的既有重试保留。
- 已有同批结果读取 draft 和 published，按 batchIndex 检查 1...k 连续、无重复、未删除，再从 k+1 开始。不能用“剩余 draft 的数量”当恢复索引。
- 已发布的批次章节仍算已生成，不能重复产出。中间存在已删除/缺失/重复编号、rejected 等不确定情况返回 409，保留现有内容，引导查看结果并新建任务。
- 同批已全部生成则不再调用模型，返回可理解的 409 “本批内容已全部生成”，UI 提供查看结果。
- 不在模型网络调用期间持有数据库锁。

### 4.3 封面：保留完整提示词，配置变化明确失效

第一批不尝试用正则从自然语言提示词中删除书名/换风格，也不把新配置机械追加到旧提示词后面。那会产生互相矛盾的画面要求。

服务端添加可选 `promptMode: 'auto' | 'exact'`：

| 请求 | 解释 | 处理 |
| --- | --- | --- |
| 未传 mode，prompt 空 | 兼容旧自动模式 | 沿用配置生成描述词后生图 |
| 未传 mode，prompt 非空 | 兼容旧完整提示词 | 原样采用规范化后的 prompt |
| auto，prompt 空 | 使用配置 | renderTitle/platform/style/composition 生效 |
| auto，prompt 非空 | 参数自相矛盾 | 422，生成任务前拒绝 |
| exact，prompt 非空 | 使用完整提示词 | 不额外注入文字层、风格或构图 |
| exact，prompt 空或未知 mode | 无效 | 422，生成任务前拒绝 |

- mode 必须贯穿 AdminAPI、路由校验、幂等指纹、任务 params、`generateNovelCover`、重试与候选元数据。
- exact 候选记录 `promptMode:'exact'`、`configurationApplied:false`；其 style/composition 不由当前选择器凭空推导。将候选类型中相关字段改成可选；旧候选缺新字段按 legacy 展示，不修改历史图片。
- exact 模式不调用文本模型；auto 保留现有模板和流式描述词能力。
- 图像模型实际接收的提示词和候选保存的 prompt 必须一致。

客户端表单使用明确的来源状态：

| 状态 | 生成封面 | 选择器变化 | 文案/操作 |
| --- | --- | --- | --- |
| 空描述词 | auto 可生成 | 立即用于下一次 auto | “按当前配置生成” |
| AI 描述词已完成且配置未变 | exact 可生成 | 标为配置已变、描述词待更新 | “描述词已生成” |
| AI 来源描述词对应配置已变 | 禁止直接生图 | 保留旧正文，不自动清空 | “配置已更改，请更新描述词”，操作“按新配置重新生成”或“使用现有描述词” |
| 用户选择使用完整描述词 | exact 可生成 | 渲染书名/平台/风格/构图控件禁用 | “画面以描述词为准”；提供“返回配置生成” |
| 正在生成描述词/封面 | 按任务状态禁用提交 | 锁定本次生成配置和选书 | 显示本次任务所属书籍 |

- AI 完成描述词时记录配置快照；手动修改正文保留其来源追踪，配置变化后仍要处理失配。
- “使用现有描述词”是明确选择 exact 模式，不声称新配置已生效。
- “返回配置生成/按新配置重新生成”前保护用户修改；取消保持原文，生成失败保留旧文，成功才替换最终稿。部分 SSE 内容显示为生成预览，不先销毁用户正文。
- 点击生成前冻结 novelId、prompt、mode、renderTitle、platform、stylePreset、composition、variationId。闭包只能读冻结值。
- variationId 在首次提交前生成并随操作持久化。相同请求重放不再产生新 UUID。
- 服务端幂等指纹对请求显式值做稳定规范化：随机默认值只能在首次 handler 内产生并保存。不能在每次重放之前随机补字段，也不能让可变运行设置改变相同请求的指纹。
- Web 的 `AiCoverPanel.tsx` 只同步上述失配提示、mode 传递和候选标签含义；不改整体布局、不引入第二批功能。

### 4.4 查询恢复与请求身份：保留现有协调器

保留 `AITaskCoordinator` 管理账号隔离、请求身份和持久化的职责。轮询是另一层，不把所有网络/视图状态塞进协调器。

#### 请求快照

- `AITaskOperationRecord` 增加可选 `requestPayloadJSON` 和 `requestFingerprint`。使用确定性 JSON 排序，fingerprint 不包含 clientRequestId 本身。
- 可持久化的内容仅为本次业务参数，不含 token、Authorization、供应商密钥。保持 UserDefaults 按账号隔离。
- first launch 之前保存 payload；重放只能用记录中的 payload 和 requestID。
- 同一 operation key 已有未解决任务时，新表单不覆盖记录。先恢复既有任务，并展示它的书籍；绝不使用旧 requestID 提交另一份参数。
- 旧记录有 taskID 则正常查询；无 taskID 且无 payload 的旧记录只恢复，不拿当前表单代替旧 payload 重发。显示无法安全恢复的明确状态。
- 账号切换、页面销毁、用户选择变化后，迟到响应不得写回新页面。沿用 core session generation，并在 observer/view 层增加自己的 generation token。

#### 查询层

建议新增 Core `AITaskPollingController.swift` 和 App `AdminAITaskMonitor.swift`。Core 使用注入的 fetch、sleep/clock、terminal 判断和 current 身份校验，不依赖 App 的 `AiTaskInfo`；App 适配类型及错误分类。

- 写作、封面图像使用同一查询策略；描述词 SSE 保留，断流后转入同策略轮询。
- 正常前台间隔 3 秒；没有 100/200 次后静默退出的限制，长任务仍可查询。
- 暂时网络错误、HTTP 408/429/5xx：按 2、4、8、15、30 秒退避重试，连续 5 次恢复尝试仍失败则显示“查询已暂停”；成功一次重置连续失败计数。
- 暂停查询不把服务器任务标记 failed、不清除 taskID、不创建新任务；显示最近成功查询时间和“继续查询”。
- 401/403 停止自动重试并显示登录/权限提示；404 显示“任务记录不存在”；解码/非法状态错误显示无法读取状态，保留诊断。
- CancellationError 不弹错误、不重试；页面消失和后台挂起仅停止本地观察。
- 回到前台立即 GET 原任务；恢复操作幂等，同一观察器最多一条活动查询链。
- 轮询/SSE 结束统一清理句柄，但必须比对 generation token，旧任务 defer 不得清空后来启动的新任务句柄。
- 每次请求前后检查取消与身份。晚到响应不能覆盖另一本书、另一个任务或另一个账号。
- 终态只有 completed/failed/cancelled；先将终态结果交给页面，再释放对应协调记录。不能 finish 后再用 isCurrent 把终态结果丢掉。

明确区分三个操作：

1. “继续查询”：只有 GET/SSE，绝不调用 create/retry POST。
2. “重试生成”：仅服务端 failed/cancelled 且 kind 可重试时展示；走既有重试接口及稳定 requestID。
3. “取消任务”：走现有 `AdminDangerousOperation` 的冻结 taskID 与 operationId，不直接复用本地 Task.cancel。

completed 任务显示查看结果；需要重新生成时回到表单发起新任务，不调用重试接口。取消文案改为“停止后续生成，已产出内容保留，已产生用量不会撤销”，与后端支持从已生成位置重试的事实一致。

### 4.5 精确打开结果与封面完成反馈

#### 创作结果

- 新的 write_outline/write_chapter/continue 产物在 `ai_generations.params_json` 写入实际 `taskId`；继续保留 batchId/batchIndex/batchCount。
- 不另加任务结果映射表，也不把时间接近当成关联依据。
- 新增管理端只读 `GET /api/ai/tasks/:id/generations`：返回 `{ items, total, linkage }`，其中 `linkage='exact'|'legacy_batch'|'unavailable'`。
- 查询先读取真实 task 并校验管理员权限。continue 有 batchId 时按真实批次精确关联，包含重试前后已生成内容；单章/大纲按 taskId。
- 复用 `generations.ts` 的 JSON 解析和 GenerationDetail 映射。若用 SQL LIKE 做 TEXT 粗筛，必须转义 LIKE 特殊字符，且在 JSON 精确比对、novelId/kind 检查和排序之后才统计/分页，不能先 limit 再过滤。
- 本入口每个正常任务最多 20 章，第一批返回整个任务结果即可；普通 `/generations` 的分页行为不变。不要为了此入口把普通结果列表改成全量拉取。
- 关联结果包含 draft/published/rejected，排除软删除；continue 按 batchIndex 升序，其他按 createdAt/id 稳定排序。
- 旧 continue 可以用 batchId；旧单章/大纲无 taskId 时 linkage=unavailable，显示“旧任务未记录精确关联”，提供普通已生成内容入口，不猜结果。
- `AdminAIGenerationsView` 增加可选 taskID 作用域，原无参入口不变。作用域页可复用详情编辑/发布；不显示会逃逸到全局的无关筛选。页内刷新始终保留该 taskID。
- Writing 进度区和任务列表均添加查看结果入口。完成显示“查看本次草稿”；失败/取消有部分产物时显示“查看已生成内容”，不统一说全部完成。

#### 封面反馈

- 目标小说区显示当前封面小图，复用 `CachedAsyncImage` 与 `APIClient.coverURL(novelId:updatedAt:)`，不新增另一套缓存。
- 采纳/上传成功后按冻结 novelId 刷新书目 updatedAt 与候选/当前封面，显示一次成功反馈。
- 已核实服务端采纳和上传均会 bump `novels.updated_at`，直接复用，不重写现有覆盖/幂等逻辑。
- UI 使用服务端新的 updatedAt 作为版本参数，不能仅给旧 URL 加 `.id(UUID())` 假装破缓存，也不清全站图片缓存。
- mutation 已成功但刷新失败时显示“封面已更新，预览暂未刷新”并提供刷新；不能显示替换失败诱导重复覆盖。
- 生成另一书/切换书籍期间来的旧结果只能更新对应缓存，不能把旧书封面显示到当前书。

## 5. API 兼容约定

| 接口/字段 | 改动 | 旧客户端策略 |
| --- | --- | --- |
| PUT 草稿 | 保持 `{result}`；错误时返回明确状态 | 正常请求不变，不再允许竞争中的错误状态更新 |
| POST 发布 | 请求体保持 `{novelId,title}` | 正常行为不变，事务内读取正文 |
| GET generations/:id | 新增只读详情端点 | 原列表不变；用于新客户端精确核对发布结果 |
| 三类画像 POST | 新增可选 afterChapterId | 省略仍表示最新 |
| 三类画像 GET | 新增可选 afterChapterId 与 source/eligibility/updatedAt 字段 | 原 profile/state 字段保留 |
| 创作 task.params | 内部 continuationSnapshot V1 | 历史数据可读取；旧续写安全重试受限并明确解释 |
| 封面生成 | 新增可选 promptMode | 省略按 prompt 是否为空决定，保持既有语义 |
| 封面 metadata | 新增 promptMode/configurationApplied，exact 不伪造风格 | 旧字段允许缺省，旧候选仍可查看/采纳 |
| GET task generations | 新增只读端点 | 原 `/generations` 不变 |
| 本地任务记录 | 新增可选 payload/fingerprint | 旧记录可解码，禁止猜旧提交参数 |

发布顺序为后端含迁移先行，再 iOS。没有新后端时，新 iOS 的精确结果端点若 404 应退回普通内容入口并说明；旧画像无来源时按保守路径显示。兼容降级不能宣称已获得起点保护。

## 6. 实施切片与文件清单

文件以下以仓库相对路径表示，仓库根目录见第 1 节；“拟新增”文件名可沿用，若本地已有同职责实现则优先扩展它。

| 切片 | 修改范围 | 必须交付的结果 | 依赖 |
| --- | --- | --- | --- |
| S0 | 两仓库状态、相关基线测试、本文 checklist | 确认 HEAD/既有失败，记录不属于本批的变化 | 无 |
| S1 | API `generations.ts`、`routes/ai.ts`；iOS `AdminAIGenerationsView.swift`、AdminAPI、详情模型、小型 Core 草稿状态/流程 | D1–D4 修复，保存/发布/关闭及响应丢失可回归 | S0 |
| S2 | API `writing.ts`、三类 profile/state 服务、`profile-source.ts`、增量迁移、路由；iOS Writing/API/models | 起点、尾部上下文、画像来源、任务快照和续写恢复 | S0 |
| S3 | API `cover.ts`、routes、covers metadata；iOS Cover/API/models/Core 表单状态；Web AiCoverPanel/API 类型 | 配置/提示词状态及幂等参数明确 | S0 |
| S4 | Core `AITaskCoordinator`、`AITaskPollingController`；App coordinator/monitor、三个 AI 页面 | 请求快照和查询恢复，不重复生成 | S2/S3 的数据约定 |
| S5 | API generations/task结果端点；iOS Generations/Writing/Tasks/Cover/fixtures | 精确结果入口与封面完成反馈 | S1/S2/S4 |
| S6 | 回归测试、静态检查、交付记录 | 验收矩阵逐项结论、待 macOS 项目明确 | S1–S5 |

Luna 推荐按 S0 → S1 → S2 → S3 → S4 → S5 → S6 串行推进，不先把所有文件改一遍再统一找错。

每片完成后更新本文末尾 checklist，记录实际文件和已运行测试。获得提交授权后，建议按这些边界拆小提交，而非一个大提交；未获授权只保留工作区修改。

重点现有文件：

- iOS：`ZhiZhou/Views/Admin/AdminAIWritingView.swift`、`AdminAICoverView.swift`、`AdminAIGenerationsView.swift`、`AdminAITasksView.swift`、`AdminAITaskProgressView.swift`。
- iOS：`ZhiZhou/Networking/AdminAPI.swift`、`ZhiZhou/Models/AdminAIModels.swift`、`ZhiZhou/Services/AdminAITaskCoordinator.swift`。
- Core：`ZhiZhouCore/Sources/ZhiZhouCore/AITaskCoordinator.swift` 及其现有测试。
- API：`api/src/routes/ai.ts`、`api/src/services/ai/{writing,style-profile,plot-state,relationship-profile,cover,generations,tasks}.ts`、`api/src/services/covers.ts`。
- Web 最小适配：`web/src/pages/admin/ai/AiCoverPanel.tsx`、对应 `aiApi` 类型/请求封装、已有封面测试。
- 原生测试基础：`ZhiZhou/Support/VisualAudit.swift`、`ZhiZhouUITests/FrontendAuditTests.swift`，所有 fixture 保持 Debug simulator gate。

## 7. 回归测试清单：先让症状测试失败，再修复

### S1：正文与发布

| 编号 | 场景 | 必须断言 |
| --- | --- | --- |
| D01 | 初始 A → 编辑 B → 保存 | 预览、再次编辑、生成标题的输入都是 B |
| D02 | 编辑 B 直接发布 | PUT(B) 成功后才 POST；实际章节为 B |
| D03 | PUT 失败 | 不调用 POST，B 留在编辑区，可重试 |
| D04 | PUT 成功、POST 业务失败或响应丢失 | B 不回退；业务失败明确提示，网络未知先 GET 精确核对，不自动重复 POST |
| D05 | 未保存关闭/下滑 | 不静默丢失；保存失败仍留在详情 |
| D06 | 保存后仅关闭 | 父列表重新打开结果为 B |
| D07 | 保存与发布交错 | 不出现 status 从 published 降回 draft；章节与锁定正文一致 |
| D08 | 重复发布/软删除后保存/大纲发布 | 无重复章节；无软删除复活；大纲不可发布 |
| D09 | 等待小说锁时正文已更新 | 单条和整批发布使用锁内最新正文 |

Core 用注入式保存/发布闭包测试顺序和失败分支；API 用 PGlite 实际落库断言；UI fixture 负责确认视图确实接上状态对象。

### S2：起点与画像

| 编号 | 场景 | 必须断言 |
| --- | --- | --- |
| C01 | 上一章 >8000 字，最后一句为唯一哨兵 | 最终上游 messages 包含末句，不只检查 helper 返回值 |
| C02 | 连续生成第一章 >6000 字 | 第二章上下文包含第一章末句 |
| C03 | 指定历史起点，后面章节有未来哨兵 | 最终 system/user 均不含未来哨兵 |
| C04 | 三类画像分别来源于未来 | 三种都排除，风格不能例外 |
| C05 | 旧画像 source_json 空/损坏 | 不推断来源、不自动调用提取模型；显示需重新提取 |
| C06 | 取样 8 章，实际到第 100 章，sort_order 不连续 | sampleCount=8，chapterOrdinal 正确，标题对应实际最后章节 |
| C07 | 别书 ID / 不存在 ID / 无章节 | 明确 404/422，未创建生成任务、未调用上游 |
| C08 | 提取期间书籍新增后文 | 记录仍对应真正输入模型的来源，不漂移到新最新章 |
| C09 | 提取后样本正文修改/源章删除 | fingerprint 校验失败，不自动采用过时来源 |
| C10 | 任务失败后新增章节/刷新画像再重试 | 使用原 anchor/context/profiles 快照 |
| C11 | 前两章已生成，其中一章已发布 | 跳过已有连续产物，从正确下一章开始 |
| C12 | 同批缺号/删除/重复编号/旧任务无快照 | 拒绝静默续跑，不覆盖已有结果 |
| C13 | 章节请求失败但有选书 | iOS 显示可重试错误，不当空书启动 |
| C14 | 起点切换后旧请求晚到 | 不覆盖当前起点画像 |

### S3：封面语义

| 编号 | 场景 | 必须断言 |
| --- | --- | --- |
| P01 | auto renderTitle true/false | 实际上游 prompt 按现有模板正确含文字要求/no text |
| P02 | exact prompt 非空 | 不额外改词，不调用文本模型，存下实际 prompt |
| P03 | mode 省略 | 空/非空 prompt 保持旧请求行为 |
| P04 | mode 非法/auto 非空/exact 空 | 422 且不计费、不创建任务 |
| P05 | AI 描述词后改配置 | 显示待更新并阻止误生图；选择使用现有词后明确 exact |
| P06 | 用户修改后更新描述词失败 | 原稿仍在，没有被流式中间值破坏 |
| P07 | exact 候选 | 不把当前选择器推断的风格当成生效事实 |
| P08 | 同 requestID，未显式 variationId，重复 POST | 同 taskID，只有一次上游，不因随机默认值冲突 |
| P09 | 同 requestID，业务参数改变 | 明确冲突，不创建第二个任务 |
| P10 | 重试封面任务 | mode/prompt/variation 和原操作一致 |

### S4/S5：恢复、身份与结果

| 编号 | 场景 | 必须断言 |
| --- | --- | --- |
| T01 | running → 一次超时 → completed | 自动恢复，显示完成，零额外生成 POST |
| T02 | 连续失败达到阈值 | 显示查询暂停，保留 ID/最近更新时间；手动继续只有 GET |
| T03 | 超过原 100/200 次查询窗口 | 不静默退出、不假失败 |
| T04 | 后台/前台多次切换 | 同时最多一个 observer；原任务恢复 |
| T05 | 旧 observer 的 await/defer 晚到 | 不写新任务、不清新句柄 |
| T06 | 账号切换/换书 | 旧结果不覆盖新账号/新书 |
| T07 | POST 已到服务器但响应丢失 | 恢复原 requestID/taskID；即使表单已改也不提交新参数 |
| T08 | 老本地记录缺 payload | 解码兼容；不猜原请求重发 |
| T09 | SSE 断开 | 回落同一任务轮询且不双订阅 |
| T10 | completed/failed/cancelled | completed 无重试接口按钮，失败/取消可重试，部分结果可查看 |
| T11 | 同书两任务、跨书同名、两批并存 | task 结果入口只返回正确 task/batch，按章序 |
| T12 | 旧单章无关联 | 显示 unavailable，不拿最近生成内容冒充 |
| T13 | 采纳/上传成功 | 使用新 updatedAt URL 显示新封面，保留现有确认/operationId |
| T14 | mutation 成功但 refresh 失败 | 提示预览刷新失败，不误报覆盖失败 |
| T15 | 关闭/取消本地任务 | 不发服务器取消 POST，CancellationError 不弹失败 |

测试约束：

- API 沿用现有 `api/src/routes/ai.test.ts` 的 PGlite + fetch mock，不发送真实模型请求。新增大块可拆独立测试文件，避免多个文件共享 DB 全局同时运行造成互相污染。
- 轮询测试用 fake clock/注入 sleep，无需真实等待数分钟。
- Core 测试不能只验证自己写的布尔公式，要覆盖真实采用的状态/调用顺序。
- 新 fixture 必须能验证保存前后正文和调用顺序；目前 VisualAudit 的 AI 覆盖不足，需要补实际请求分支，不靠空列表“通过”。
- 本轮重点症状建立有效回归，不要求顺便给所有普通控件写镜像测试。

## 8. 验证命令与环境边界

在 API/Web 仓库根目录执行：

```powershell
npm run test --workspace=@zhi-zhou/api -- src/services/ai/writing.test.ts src/services/ai/cover.test.ts src/routes/ai.test.ts
npm run typecheck
npm run lint
npm test
npm run build
git diff --check
```

新增测试文件需要加入局部验证命令。先跑局部，再在最终收口跑一次完整工作区 checks。若环境依赖缺失，按 lockfile 安装；不得为了通过测试任意升级依赖。

iOS Windows 可运行：

```powershell
powershell -NoProfile -File scripts/admin-operation-smoke.ps1
powershell -NoProfile -File scripts/navigation-smoke.ps1
git diff --check
```

这些只检查源码契约。若变更涉及封面缓存路径，再运行现有 `scripts/image-cache-smoke.ps1`；无需重复无关 reader 测试。

macOS 必须验证：

```text
swift test --package-path ZhiZhouCore
xcodegen generate
xcodebuild -project ZhiZhou.xcodeproj -scheme ZhiZhou -configuration Release -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO build
xcodebuild test -project ZhiZhou.xcodeproj -scheme ZhiZhouAudit -destination 'platform=iOS Simulator,id=<已存在且兼容的 simulator UDID>' -parallel-testing-enabled NO CODE_SIGNING_ALLOWED=NO
```

- 复用现有 `.github/workflows/build-ios.yml`、`frontend-audit.yml`，不为了本批更换 CI 架构。
- 没有推送授权/macOS 环境时，完成所有本地可做的实现与检查，明确列为“待 macOS 编译/模拟器验证”，不能写“全部验收通过”。
- 推送是独立后续授权；获授权后核对准确 SHA 对应 CI。不要为触发 CI 擅自推送。
- 模拟器最少覆盖小屏手机与 iPad、普通字号与辅助功能字号，检查新增状态/按钮可见可点。
- 真机/测试服务的实际生成质量、弱网与后台恢复另列验收；自动化只证明输入与流程正确，不证明模型一定写得好或图片一定符合要求。

## 9. 交付与回滚

- 后端迁移只加列，不删除或改写旧画像。按标准迁移流程执行测试数据库迁移；不要手工修改旧 014/015/016 migration 文件。
- 后端先上线新语义再更新 iOS；旧客户端正常接口仍保留。
- 回滚业务代码时保留新增列/任务 JSON，不做破坏性 down migration；旧程序可忽略新增字段。
- 每个切片说明：改了哪些行为、采用哪些测试、哪些仍未验证。风险和未完成项单列，不混在“通过”里。
- 不把计划文件或测试报告中的用户授权描述视为生产操作授权。

## 10. Luna 的执行规则与交接文本

切换 Luna MAX 后可直接发送：

> 按 `E:\Developments\Projects\zhi-zhou-ios\docs\ai-phase-1-execution-plan-2026-09-10.md` 落实第一批。按 S0–S6 顺序执行，先建立症状回归再修改。允许同时修改计划明确列出的 `zhi-zhou-ios` 与 `zhi-zhou` 两仓库，不扩展第二批。采用计划已定的 API、画像来源、任务快照、封面模式和恢复策略。完成本地能做的检查并更新计划 checklist；缺 macOS 时明确列出未验证项。不提交、不推送、不部署、不调用真实付费模型。若发现基线变化使既定方案不成立，先说明具体冲突和证据，不自行换成新架构。

执行中需要重新交给 Astra 判断的情况：

- 最新代码已改变发布事务、数据库模式或任务协调方式，本文方案会破坏现有功能。
- 无法在保持旧 API 的前提下实现第一批行为，需要新的破坏性协议或更大的数据迁移。
- 必须引入第二批能力才能解决问题，例如打算用向量库、全书重提取或复杂文档版本系统。
- 幂等/账号隔离/任务恢复的测试出现计划未覆盖的歧义，无法证明不会重复计费或关联错结果。

常规编译错误、空值兼容、文件拆分、测试 fixture 补齐、类型修正由 Luna 自行处理，不为每个小实现选择重新提问。

## 11. 执行进度（由实施者更新）

- [x] S0：已核对 iOS HEAD `7749cfa`、API/Web HEAD `508a4ab`；规划前工作区记录为干净，当前修改均属于本批文件或本文。未发现新的 `AGENTS.md`。现有导航 smoke 脚本在本批执行前即存在 PowerShell 解析错误，脚本本身未修改。
- [x] S1：已完成草稿正文状态、保存后发布顺序、事务内最新正文读取、条件保存、详情核对和关闭刷新；涉及 `generations.ts`、`routes/ai.ts`、iOS 详情页/模型/API 与 Core 协调测试。API 相关回归包含在 route 测试中。
- [x] S2：已完成尾部优先续写上下文、起点归属校验、三类画像来源迁移与 eligibility、续写快照和连续批次恢复；新增 `029_ai_profile_sources.sql` 与 `profile-source.ts`。API route/writing 回归已覆盖起点、来源和恢复主路径。
- [x] S3：已完成封面 `auto|exact` 语义、配置失配提示、请求参数/变体冻结、候选元数据和 Web 最小适配；封面服务 9 项测试、API route 测试及 Web 类型检查通过。
- [x] S4：已完成本地任务 payload/fingerprint 持久化、请求变化拒绝、轮询退避/暂停/手动继续、SSE 降级、token 生命周期和终态处理；Core 测试已补齐，但因当前 Windows 无 Swift 工具链尚未执行。
- [x] S5：已完成按真实 task/batch 的结果端点和 iOS 精确结果入口，以及采纳/上传后的封面更新反馈与刷新失败提示；相关 API route 回归通过。
- [x] S6：已完成 API/Web 完整 checks、局部 AI 回归、iOS Windows smoke 和两仓库差异检查；结果见下方执行记录。
- [ ] macOS Core tests / Release build。
- [ ] 模拟器交互、辅助功能字号及小屏/iPad 检查。
- [ ] 实际测试服务/真机验收（需要独立环境与后续授权）。

执行记录（2026-09-10，工作区未提交）：

- API 局部：`npm run test --workspace=@zhi-zhou/api -- --run src/routes/ai.test.ts src/services/ai/writing.test.ts src/services/ai/cover.test.ts`，3 个文件、94 个测试通过。
- API/Web 全量：`npm test`，29 个测试文件、279 个测试通过；`npm run typecheck` 通过。
- 静态/构建：`npm run lint` 退出码 0，87 条既有 warning、0 error；`npm run build` 通过，Vite 仍提示部分 chunk 超过 500 kB；两仓库 `git diff --check` 通过。
- iOS Windows smoke：`scripts/admin-operation-smoke.ps1` 与 `scripts/image-cache-smoke.ps1` 通过；`scripts/navigation-smoke.ps1` 因既有 PowerShell parser error 失败，未修改该脚本，不能据此判定本批导航实现失败。
- 环境边界：`swift`、`swiftc`、`swift-format`、`xcodebuild`、`xcodegen` 当前均不可用，因此 Core 测试、Release build、模拟器交互和真实服务/真机验收保持未验证。未调用真实付费模型，未运行生产迁移。

## 12. 本次额外发现，留待单独处理

1. 选书只加载前 200 本，搜索只是本地过滤，可能找不到后面的书。
2. 生成内容批量删除后若列表变空，撤销入口被空态分支隐藏。
3. 封面提示词编辑器高度固定 96pt，超长输入被截断，适合后续单独改善。
4. 人物关系提取模板预设较强的主从/控制关系，适合第二批评估不同题材下的提取中立性，本批不顺便调整模型创作偏好。
5. 当前实际写作风格/图片质量未调用线上模型验证；应在输入与状态正确后做固定样本 A/B 评估。

这些发现不是第一批未完成项，不得因为看见它们而扩大实施范围。
