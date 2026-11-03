# AI 续写与封面：第二批执行计划

状态：Astra 规划稿；B0–B6 已按本文顺序实施，实施记录与可运行验证见 `docs/ai-phase-2-validation.md`。macOS/真实模型边界仍按本文保留。

## 1. 基线、授权与目标

- iOS：`E:\Developments\Projects\zhi-zhou-ios`，HEAD `bbad69771cf389e0082693dee758577d00814a5d`。
- API/Web：`E:\Developments\Projects\zhi-zhou`，HEAD `9a59b25bd62afbdb331b472b7d1e9f845e4807f2`。
- 第一批远端结果来自本任务已核验记录：API/Web run `34481070215` 成功；iOS run `34481492532` Core tests、Release 与 IPA 打包成功。不能据此推断 AI 交互、弱网恢复或模型质量已验收。
- 第一批计划中的“未提交、未推送、待 Core/Release”是提交前历史记录，以上结果优先；不重写历史验收结论。
- 本轮授权是制定详细计划。后续收到执行指令才修改业务代码；执行默认不提交、不推送、不部署、不做生产迁移、不调用真实付费模型。之前的提交授权不自动延伸到第二批。
- 两仓库独立检查状态；实施前检查父目录及仓库 AGENTS.md、最新 migration 编号和 API 状态。不得机械按本文行号修改。
- 第二批目标：明确创作要求、人工修正画像、可审阅的选段改写、封面对比与历史恢复。保持第一批起点边界、冻结输入、幂等与账号隔离。

## 2. 已核对的现状与范围

当前 writing.ts 使用自由 instruction、outline 和冻结 profileOverrides；iOS 提供自由要求及画像提取入口。三类画像提取直接 upsert 当前画像。新增人工内容必须与自动提取内容分离，不能继续共用覆盖字段。

当前 image.ts 仅封装 images/generations；covers.ts 采纳候选会覆盖当前图片并删除候选，上传调用 storeCover 覆盖。历史恢复必须保存图片字节，不能依赖已删除候选或外部 URL。现有候选列表返回 dataUrl，不能将同样模式直接扩大到整个历史库。

本批不引入：向量库、全书自动摘要、画像历史版本库、人物关系图、自动章节规划器、参考图、局部改图、独立文字排版层、全站自动保存、多人协同编辑系统。选书分页和删除撤销空态作为独立问题保留。Web 只补共享接口必要适配及旧行为回归，不全量复制新增 iOS 页面。

## 3. B0：先核实第一批验收覆盖

交付 `docs/ai-phase-2-validation.md`，逐项映射第一批 D01–D09、C01–C14、P01–P10、T01–T15 到测试文件/用例，状态限定为：自动通过、已实现待运行、待补测试、发现缺陷。测试数量不能替代覆盖映射。

- 优先检查保存失败不发布、响应丢失只查询、关闭保护、旧 observer 不覆盖新任务、章节请求失败与迟到画像、缺 payload 不猜重放、exact 配置语义。
- 已有 Core 协调器测试不能替代 SwiftUI 实际调用链测试。将保存/发布动作顺序和查询恢复分支放进实际被页面使用的小型可注入对象；已有对象足够则扩展，不另造完整框架。
- 轮询测试使用注入 sleep/时钟，不真实等待几分钟。
- 为 AI 页面补 Debug simulator fixture 与真实控件操作断言；不能只截图空列表。先检查 VisualAudit 的已有 mock 路由与隔离开关。
- navigation-smoke 先分别记录 PowerShell 版本、编码和 HEAD 脚本解析结果；若确认为脚本语法/编码错误，最小修复且保留断言含义。不能删除失败断言来获得绿色结果。
- B0 发现的第一批安全恢复/发布缺陷先修复并验收，再进入后续切片。普通类型错误和明确的既定语义遗漏可直接修；需要改变第一批协议时交回 Astra。

## 4. B1：结构化创作要求

### 数据与接口

沿用 writing/continue 请求，新增可选 `writingBrief`：

```json
{
  "version": 1,
  "viewpoint": "第三人称限知，跟随主角",
  "pace": "舒缓",
  "objective": "让主角意识到证词存在矛盾",
  "requiredFacts": "伤势仍未痊愈",
  "forbiddenEvents": "不得揭露幕后人物",
  "chapterGoals": [{ "index": 1, "goal": "发现矛盾" }]
}
```

- 字段均为用户编辑的纯文本，不是自动规划输出。viewpoint/pace 各最多 200 字符；objective 1000；requiredFacts/forbiddenEvents 各 3000；每章 goal 1000；总计最多 12000 Unicode 标量。
- chapterGoals.index 是本次批次的 1-based 编号，不是小说原章号；不得重复、越界或有非法类型。允许未填写某章。减少 chapterCount 时先提示哪些已填目标会被删除，取消保留原值。
- 服务端严格验证 V1 和字段类型，非法请求 422 且不创建任务。客户端同样计数但服务端为准。
- 自由 instruction 保留并作为补充要求；固定拼接順序为结构化要求、该章目标、补充要求。互相矛盾的自然语言不自动裁决，预览全部内容供用户修正。
- 冻结 writingBrief 到 task.params；重试完全沿用原值；旧任务缺字段按原语义运行。它与 continuationSnapshot 并列，客户端仍不可提供可信上下文快照。
- 上游 messages 对每章仅注入对应目标。字数限制、用户要求、画像与正文使用明确分隔，不能被当成系统权限指令。

### iOS 与验收

续写要求区保留简洁默认视图，“更多创作要求”展开详细字段；提交前可展开查看本次起点、要求及将采用的画像状态。不把数据库字段名展示给用户。

测试：旧请求兼容；非法类型/超长/重复与越界目标；第 N 章只含第 N 章目标；重试原要求不漂移；降低章数确认；换书和账号迟到响应保护；最终上游 messages 断言。

## 5. B2：画像查看与人工校正

### 存储决策

新增 `novel_ai_profile_overrides`，不修改三类自动画像的正文用途：

- 主键 `(novel_id, kind)`；kind 限 style/plot/relationship；novel 外键级联删除。
- `content TEXT`、`source_json TEXT`、`revision BIGINT`、`base_profile_revision TEXT`、`updated_by TEXT`、`updated_at BIGINT`。
- base_profile_revision 为服务端对自动画像正文和来源稳定序列化的 SHA-256；不得使用时间戳作为唯一版本。
- 人工保存首次 revision=1，后续递增；请求携带预期 revision（首次为 0），不符返回 409。权限沿用 requireAdmin。
- 每类最多保留一份当前人工校正；不做版本库。正文最多 20000 Unicode 标量，空白拒绝；清除使用独立 DELETE。

### 来源与选择

- 仅允许以有合法 source 且在当前 anchor 下 usable 的自动画像为基础创建校正；保存时由服务端复制来源，客户端不可提交 source_json。
- 人工修改不更新“提取到第几章”，不制造新的采样证据；用户可能自行写入未来信息，页面明确要求只记录所选起点之前的事实。系统只验证来源边界，不能宣称识别所有语义剧透。
- 同样 fingerprint/anchor eligibility 适用于人工校正。源章修改/删除、未来来源、unknown 来源均不自动采用。
- 自动画像刷新与人工校正分开：刷新只更新自动层，保留人工层。当 base_profile_revision 已变化，显示“自动画像已更新，人工校正待确认”，默认排除校正，采用可用的自动画像；用户可重新编辑并确认绑定当前自动来源或清除校正。
- 最终选用顺序：可用且基底一致的人工层 → 可用自动层 → 排除；GET 明确返回 effectiveOrigin/effectiveContent/exclusionReason。任务快照保存最终文本、来源和 revision，重试不重算。

### API 与页面

- 三个现有 GET 保留旧 profile/state 字段为自动层，新增 `manualOverride`、`effectiveContent`、`effectiveOrigin`，不给旧 Web 偷换字段含义。
- 新增 `PUT /api/ai/writing/profiles/:kind/:novelId/override`，body 为 content、expectedRevision、baseProfileRevision、afterChapterId。
- 新增同路径 DELETE，携带 expectedRevision；不存在且首次删除允许幂等成功，存在版本不符 409。
- 共用服务实现校验、来源判定和有效内容映射；三类 getter 与快照 builder 均调用，避免页面显示和实际注入不同。
- iOS 显示自动/人工/最终使用层、来源章节和失效原因。编辑器保护未保存内容；刷新结果不覆盖编辑区；409 保留用户文本并提供重新读取，禁止自动最后写入获胜。

测试：三类画像相同行为；旧数据兼容；伪造来源拒绝；未来/被删/被改样本排除；刷新保留人工层但使旧基底待确认；两个管理员冲突；快照与页面选择一致；画像失败不静默显示成功。

## 6. B3：草稿选段改写

### 范围与请求

仅对有效 write_chapter/continue 草稿；不支持已发布正文与大纲。本批不改变章节发布接口。

- 为 generation 详情添加 `contentRevision`：SHA-256(服务端实际存储正文 UTF-8)。不依赖 updatedAt。
- 新增 `POST /api/ai/writing/drafts/:id/rewrite`，body 为 clientRequestId、baseRevision、startUTF16、endUTF16、selectedText、mode、instruction。
- mode 为 polish/expand/shorten/custom；custom 要求非空 instruction。选段最多 6000 Unicode 标量，instruction 最多 2000；上下文选段前后各最多 2000，优先取靠近选段部分。使用已有文本供应商和超时/记账机制。
- 坐标统一 UTF-16 半开区间，与 JS 字符串/NSRange 一致。服务器验证边界整数、范围、代理对边界和所选文本完全相等；iOS 从实际文本选择转换，不使用按 Swift Character 数量的偏移。覆盖 emoji、组合字符与 CRLF 测试。
- 只对已保存正文发起改写。存在未保存编辑时先保存成功并采用服务端正文，再要求用户重新确认选段；不得沿用规范化前旧偏移。
- 新 task kind `rewrite_selection`；参数由服务端冻结基底正文、范围、instruction 与有限上下文。生成建议存 task.result，不产生可发布 generation，不修改原文。响应沿用 taskId；补 kind 展示、并发限制、超时回收、取消与 retry 分支，不遗漏 tasks.ts 的 kind 白名单。
- 重试只对 failed/cancelled，重新生成同份冻结请求。若草稿已发布/删除则拒绝；正文已变化可返回原建议但必须标为不可应用，且提示需要新选段。禁止额外自动计费调用。

### 应用与恢复

- 新增 `POST /api/ai/writing/drafts/:id/rewrite/:taskId/apply`，携带 operationId/baseRevision；建议必须属于该草稿且 task completed。
- 服务端事务锁草稿，验证 draft/未删除/baseRevision/原选段；只将固定区间替换为已持久化建议，条件不符 409。幂等重放返回同一结果，绝不再次替换。
- 结果为空或超过输出上限按失败处理，不应用；本批输出最多 12000 Unicode 标量，不能静默裁切。
- UI 展示原段与建议分区预览，允许取消、复制建议、应用；无需完整 diff 算法。应用成功后用服务器正文重置 saved/editor state，并标记父列表刷新。
- 应用响应丢失通过 operation/精确详情核对；不能仅凭正文碰巧相同认定本次请求成功。沿用现有幂等响应重放机制，重试相同 operationId。
- 本批不新增改写撤销接口或全文版本库；应用前明确这是保存到草稿的动作，未应用可直接关闭。需要多步撤销/自由编辑建议时交回 Astra，不顺便加入。

测试：选区错位、重复文本、Unicode、保存规范化、并发改文、发布/软删后应用、建议跨草稿盗用、重复应用、响应丢失、取消只停止观察与服务端取消的区别、任务结果不混进可发布列表。

## 7. B4：封面候选对比与提示词编辑

- 当前封面作为固定参考，最多选两张候选；手机竖向排列，宽屏三列。全部同一容器比例、aspectFit，不能裁切构图来获得整齐外观。
- 每项保留原图放大、来源和生成提示词；exact 只标“完整描述词”，不把当前选择器误报为已采用风格。
- 选中仅是本地比较状态，不采纳、不弃用；候选被删除或换书时清理无效选择。迟到响应不能跨书写回。
- 对比区使用已有候选数据，不新增自动生成/重采样请求；不能为比较偷偷调用模型。
- 长提示词改为可滚动完整编辑 sheet，支持大字号、键盘避让、关闭保护。生成失败保留原词；流式预览与用户稿分离。页面摘要不再承担完整编辑。
- 沿用 AppTheme 与现有确认机制，不做全后台视觉重设计。Web 只补新增 metadata 兼容，新增对比 UI 限 iOS。

测试：0/1/2 张候选、候选缺失、不同宽高比、旧 metadata、换书迟到响应、无图片状态、长词关闭保护。模拟器覆盖小屏/iPad、深浅色、辅助字号；检查可见且可点击，不以截图生成等同验收。

## 8. B5：封面历史与恢复

### 数据与保留

新增 `novel_cover_history`：id、novel_id 外键、data BYTEA、content_type、source、prompt、metadata、image_hash、created_at、reason、actor_id。novel_covers 新增 prompt/metadata 缺省字段，保存当前 AI 来源信息；旧图片留空，不能编造历史提示词。

- 每书最多保留最近 10 个被替换版本；单图沿用 5 MiB 上限，单书历史字节最多 50 MiB。确定性排序 created_at DESC,id DESC；写入成功的同一事务中清理超限历史。不做自动时间到期或全库清扫。
- 保存真实字节，不以远程 URL 充当快照。已有外部封面但尚无本地缓存：替换前走既有安全下载将图片物化；下载失败 409，提示无法备份旧封面。本批不提供跳过备份选项。不在数据库锁内做网络请求。
- 默认占位图/原本无封面不建立历史；在新功能上线前已被覆盖的图不能恢复。
- 原图与新图 image_hash 相同的替换不新增历史。metadata 更新语义保留，但不能伪造额外图片版本。

### 替换事务与并发

- 提取“管理员替换当前封面”的专用事务服务，采纳/上传/恢复统一走它；storeCover 的爬虫/懒缓存用途不自动产生历史，先清点全部调用点。
- 先在锁外准备图片字节，事务中锁 novels 行，再重读当前封面和候选/历史，检查前置版本，保存旧图、替换当前图、递增缓存时间、消费候选、裁剪历史。任一步失败全部回滚。
- prepared 外部旧图必须绑定读取时的 cover_url/版本；获得锁后发现变化则拒绝并重读，不能把旧下载当成当前图。
- 新客户端传 `expectedCoverVersion`，缺省兼容旧客户端按锁内最新状态执行；恢复接口强制要求该字段。版本由当前图 hash+元数据稳定摘要提供，不用毫秒时间戳冲突检测。
- cache updatedAt 使用 max(Date.now(), priorUpdatedAt+1)，并同步 novels.updated_at，避免同毫秒恢复命中旧 URL。
- 幂等 scope 绑定用户、小说和动作。网络重放不得重复建历史；不同请求并发以小说锁和预期版本控制。
- 恢复时目标历史保留，当前图入历史；返回恢复后的详情与新版本。历史裁剪可能删除较早目标，但不能影响已经读取并恢复的图。

### API 与 UI

- GET `/api/ai/cover/history/:novelId`：仅元数据与认证图片路径，不返回 base64 数组；最多 10 项。
- GET `/api/ai/cover/history/:novelId/:id/image`：管理员权限、小说归属检查、正确 MIME、private 缓存策略。
- POST `/api/ai/cover/history/:novelId/:id/restore`：operationId/expectedCoverVersion，返回当前封面状态；404 表示历史已清理，409 表示当前封面变化。
- iOS 图片用认证 API 加载，不把 bearer token 放 URL。账号切换清理历史图状态；不能直接用无认证公共图片加载路径。
- 历史入口说明“最多保留最近 10 个旧版本”；恢复先确认并显示目标预览。刷新失败明确表示恢复已完成但预览待刷新。

测试：采纳/上传/恢复三条入口；外部图未缓存/失败/下载期间版本变化；同图去重；第 11 版裁剪；同毫秒缓存更新；幂等重放；并发覆盖；事务回滚保留候选；历史跨书访问；删除小说级联；旧客户端接口回归。

## 9. B6：固定样本与验收

- 使用仓库自写/明确可用的短篇样本，不调用生产小说或真实账号数据。固定 6 组续写（历史起点、长章末尾、多人关系、时间线、低冲突节奏、多章目标）和 6 组封面需求（文字开关、exact、不同构图及长描述）。
- 自动验证只证明输入/状态/来源/调用次数：记录最终 messages、模型请求参数、结果关联、估算预算配置，不将 mock 文本当成质量证据。
- 真实模型 A/B 单独授权后运行：固定供应商/模型/参数/样本，记录调用次数、token/图像用量、耗时与可得的实际费用；拿不到费用标 unknown，不伪造统一估价。预先批准总调用与预算上限，禁止失败无限重试。
- 写作按人物事实、时间线、起点衔接、要求遵循、语言自然度各 1–5 分；封面按需求符合、构图、视觉一致、文字可读（仅要求文字时）各 1–5 分。保留盲评顺序及原始输出。
- 硬约束：来源泄漏、错误覆盖、重复应用、重复计费调用、错书结果一项即不通过；主观质量不给无样本保证。无真实调用授权时 B6 标“框架完成，质量未验证”。

## 10. 文件与执行顺序

| 切片 | 主要文件/模块 | 完成条件 |
| --- | --- | --- |
| B0 | 第一批测试；Core；VisualAudit.swift；FrontendAuditTests.swift；smoke | 覆盖矩阵与缺陷证据；关键回归先红后绿 |
| B1 | writing.ts、routes/ai.ts、AdminAPI/Models、AdminAIWritingView | brief 贯通快照/重试/实际 messages |
| B2 | 三类 profile 服务、profile-source.ts、新 override 服务和迁移、iOS 画像编辑页 | 人工层与自动层分离；来源和冲突保护 |
| B3 | 新 rewrite 服务、tasks/usage 路径、routes、Core 选段流程、详情 sheet | 建议与应用分离；原文版本校验 |
| B4 | AdminAICoverView 与拆出的编辑/比较组件 | 对比、完整词编辑、模拟器交互 |
| B5 | covers.ts、cover routes、迁移、iOS 历史页 | 替换事务和恢复、保留限制 |
| B6 | fixtures、验收矩阵、质量评估说明 | 所有可执行 checks 与剩余边界 |

按 B0 → B1 → B2 → B3 → B4 → B5 → B6 串行推进。不要求开子代理。迁移在当前 029 后顺次追加（建议 030 override、031 cover history），已有占用则顺延，不能改旧 migration。

## 11. 验证命令与交付约束

API/Web：先运行受影响 Vitest 文件，再在收口执行 `npm run typecheck`、`npm run lint`、`npm test`、`npm run build`、`git diff --check`。新增数据库测试用 PGlite，走全部迁移；不要用 mock SQL 代替事务结果。注意历史记录将 API 的 29 文件/279 测试误称两工作区总量；新的报告分别记录 Web 与 API 实际输出。

iOS Windows：运行 admin-operation/image-cache/navigation smoke 与 diff check；记录实际 PowerShell 版本，失败不得称通过。

macOS：`swift test --package-path ZhiZhouCore`；`xcodegen generate`；沿用 build-ios.yml 的 unsigned Release 命令；沿用 frontend-audit.yml 的 ZhiZhouAudit scheme，在小屏手机和 iPad 执行 UI tests。缺 macOS 时列未验证项，不改 CI 架构或擅自推送。

交付每片：实现文件、行为变化、验证用例、失败原因/剩余边界。既有 lint warning 不要求全站清理，但必须确认本批没有新增未说明警告。生产发布需要另行授权，顺序后端含增量迁移先于 iOS；旧服务端返回新增端点 404 时隐藏相关动作并说明需要更新服务端，不伪造成功。

以下交回 Astra：必须改变来源信任规则；需要用户绕过封面备份；供应商不支持既定任务输出；原有幂等架构无法支持原子应用；需要新增协作/版本库/自动规划；费用预算或保留策略需要改变。普通类型错误、合理组件拆分、测试 fixture 补齐由 Luna 自行完成。

## 12. 实施 checklist 与交接

- [x] B0 覆盖盘点与第一批关键回归
- [x] B1 创作要求
- [x] B2 人工画像
- [x] B3 选段改写
- [x] B4 封面对比与提示词编辑
- [x] B5 封面历史恢复
- [x] B6 自动验证与质量评估框架
- [ ] macOS Core/Release/UI 验证
- [ ] 经独立授权的真实模型评估与真机验收

## 13. 实施记录

- [x] B0：已完成第一批实际覆盖盘点；API AI 目标测试 3 个文件/94 tests 通过，iOS admin-operation、image-cache、navigation smoke 通过。导航 smoke 的 Windows PowerShell 5.1 解析与 UTF-8 读取缺陷已做最小修复，详见 `docs/ai-phase-2-validation.md`。
- [x] B1：已完成 API writingBrief 校验、任务快照/重试与每章消息注入；iOS 已接入折叠式详细要求、Unicode 计数和降章确认，运行记录见 `docs/ai-phase-2-validation.md`。
- [x] B2：已完成迁移 030、人工画像服务、三类最终内容选择和 revision/base fingerprint 冲突保护；续写快照冻结最终画像、来源、人工 revision 与基底 revision；iOS 已加入独立人工校正编辑/清除入口，验证记录见 `docs/ai-phase-2-validation.md`。
- [x] B3：已完成 API 版本化选段改写、建议/应用分离、幂等应用与 iOS 详情页（含复制及正文变更后的不可应用提示）；Swift 编译/UI 仍待 macOS
- [x] B4：已完成 iOS 固定当前封面对比、最多两张候选、aspectFit 与完整提示词编辑；静态 smoke 已通过，Swift/UI 仍待 macOS
- [x] B5：已完成迁移 031、统一封面替换事务、历史鉴权读取/恢复/保留限制与 iOS 历史预览；API PGlite 回归已通过，Swift/UI 仍待 macOS
- [x] B6：已完成固定 6 组续写/6 组封面夹具、自动验收和盲评记录模板；不调用真实付费模型，主观质量未验证

交给 Luna MAX：

> 按 docs/ai-phase-2-execution-plan-2026-09-10.md 的 B0–B6 顺序实施两个仓库的第二批，采用本文已定的数据、来源、版本与幂等策略。先盘点第一批实际回归覆盖，发现关键缺陷先修复。每片完成更新验证记录；不扩大到向量库、参考图、局部改图或全站重构。不提交、不推送、不部署、不调用真实付费模型。缺 macOS 时完成可运行检查并明确未验证项。新的架构、产品或预算取舍交回 Astra，常规实现错误自行修复。
