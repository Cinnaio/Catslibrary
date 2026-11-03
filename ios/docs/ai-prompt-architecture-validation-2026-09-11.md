# 创作与封面提示词架构重构验证记录

日期：2026-09-11<br>
执行依据：[ai-prompt-architecture-luna-execution-plan-2026-09-11.md](./ai-prompt-architecture-luna-execution-plan-2026-09-11.md)<br>
状态：R8 已验证；本轮仅使用封闭网络 mock，尚未调用真实模型、提交、推送或部署。

## R0 基线盘点

### 仓库与平台

- API/Web：`E:/Developments/Projects/zhi-zhou`，基线 `0f0dc3f2593564051e602a5d2cb021337cda3e36`。
- iOS/docs：`E:/Developments/Projects/zhi-zhou-ios`，基线 `d5101aabd0250692fd9baa33273d1cab042d5c19`。
- Windows 本机没有 Swift/Xcode；本轮若不修改 Swift，只运行文档 diff 检查。macOS 原生编译、真机 UI、流式体验均未验证。
- 祖先路径与两个仓库内未发现 `AGENTS.md`；执行期间继续保留用户无关文件，不运行 reset/clean。

### 第一批实际回归覆盖

当前已存在的封面覆盖集中在：

- `cover-prompt.test.ts`：简介 HTML/空白清理、800 UTF-16 头尾省略、代理项安全、分块预算、构图矩阵、无字模式、言情单字误命中、纯函数稳定性。
- `cover.test.ts`：auto/exact 模式校验、文本未配置时的模板 fallback、题材解析、言情 metadata 和显式风格入口。
- `cover-romance.test.ts`：纯函数题材/锚点/构图方向回归。
- `phase2-fixtures.test.ts`：六组 fixture 形状与逻辑预算（四 auto 的两次文本调用、两 exact 的零文本调用，图像各一次）；尚未证明真实路由最终 HTTP 请求。
- `routes/ai.test.ts`：AI 设置、prompt task、auto/exact 生图、幂等、候选和任务恢复等路由级 mock；执行前需完整运行，不能只过滤依赖初始化的单项。

当前创作覆盖集中在：

- `writing.test.ts`：`writingBrief` 校验/排序/长度、尾部上下文、章节标题解析。
- 画像测试与路由测试覆盖来源快照、人工覆盖、起点范围、取消和多章恢复；尚未证明五层编译器的消息边界、旧画像降权、资料注入隔离。
- `style-profile.ts`、`relationship-profile.ts`、`plot-state.ts` 当前提取提示词为自由文本，仍存在职责混合和关系模板预设。

### 当前入口与调用矩阵

| 入口 | 当前路径 | 成功逻辑调用 | 本轮目标 |
| --- | --- | --- | --- |
| 封面 auto 直接生成 | `routes/ai.ts` → `buildImagePrompt` → `judgeGenre` + `generateSceneDescription` → `generateImage` | text 2 / image 1 | 新资料 brief + visual concept，预算不变 |
| 独立封面 prompt | `generateCoverPrompt(Task)` → `buildImagePrompt` | text 2 / image 0 | 新版本 prompt，流式完整 JSON 后发布 |
| 编辑 exact 生图 | `normalizeCoverPrompt` → `generateImage` | text 0 / image 1 | trim 后原样语义 |
| 封面 retry/恢复 | `cover.ts`、`index.ts`、task params | 依源任务 | 冻结 pipeline/template 版本 |
| 单章/大纲创作 | `generateWriting` | text 1 | 五层消息编译，输出契约分流 |
| 多章续写 | `generateContinuationChapters` | text N | 快照固定，批次正文逐章追加 |

### 封闭网络检查

计划使用 Vitest 的 `globalThis.fetch` mock，并让未知 URL 直接抛错；mock 只接受测试域名 `https://ai.test`、`https://image.test` 及本地占位图片响应。禁止 `tsx` 临时脚本加载运行时真实 provider。R0 完成时补充实际运行命令、退出码、请求计数与阻断证据。

### R0 红色回归目标（基线）

1. 通用关系提取提示词不能预设主从/施舍/控制，平等或未知关系可输出。
2. 风格提取不再要求当前处境与目标；情节提取明确区分事实、人物认知、未解线索、可选方向。
3. 封面第二阶段和图像 payload 不得包含原始 R18 标签/露骨无关资料；书名原文与 exact 不得被改写。
4. 上游结构化 `refusal` / `content_filter` 只尝试一次并停止后续阶段，不进入普通重试。

以下各节记录 R0–R8 的实际用例、请求 payload 摘要、调用次数、长度和未验证边界。真实模型质量、真实费用和视觉质量不在本轮结论内。

## R0 执行结果（已验证）

- 已重新核对两个仓库的基线、工作树和祖先路径规则；未发现 `AGENTS.md`。API/Web 基线仍为 `0f0dc3f2593564051e602a5d2cb021337cda3e36`，iOS/docs 基线仍为 `d5101aabd0250692fd9baa33273d1cab042d5c19`。本轮没有 reset/clean，也没有触碰无关文件。
- 真实覆盖盘点已落在上面的矩阵：auto、exact、独立 prompt、异步任务、retry、启动恢复、候选历史、幂等、三种 writing kind 和多章断点恢复均有入口级 mock；第一批只证明了旧 renderer/fixture，未把结构化协议误记为旧覆盖。
- 封闭网络先行契约已通过：Vitest fetch 桩只接受 `https://ai.test`、`https://image.test` 和测试图片地址，未知 provider URL 立即抛错；目标服务测试和路由测试均在桩内完成。没有加载真实运行时密钥或执行会探测真实 provider 的脚本。
- 盘点中确认并处理的关键缺陷：普通写作入口未显式传入新 pipeline 时曾落到错误的旧分支，已改为服务端固定版本 2；未知版本曾被错误降级，已改为明确 `422 invalid`；结构化拒绝曾可能进入普通失败/重试路径，已改为 `422` 且阻断后续阶段。
- 费用边界保持原样：mock 只统计请求次数；拒绝响应可能已经产生上游 usage，失败用量的既有账务限制未被假称为零成本。

## R1 执行结果（已验证）

- 新增 `prompt-material.ts`、`prompt-policy.ts`、`prompt-version.ts` 及领域类型/运行时校验；创作流水线版本为 2，封面流水线/模板版本为 3，画像提取版本为 2。旧任务缺字段分别解析为创作 legacy 1、封面 legacy 2；显式未知版本失败，不猜测。
- `prompt-version.test.ts` 2 个用例覆盖缺省、当前、legacy 和未知值；版本字段贯通写作/封面任务创建、重试和启动恢复。generation 现有 `params.version=6` 未被无关重编号。
- `npm run typecheck --workspace=@zhi-zhou/api` 已通过；未引入新依赖或额外模型调用。

## R2 执行结果（已验证）

- `style-profile.ts` 只提取稳定表达习惯；`relationship-profile.ts` 改为证据驱动并允许平等、非恋爱或未知关系；`plot-state.ts` 分开已确认事实、人物认知、未解线索和可选方向。三者仍使用现有可编辑文本和人工覆盖机制，并在来源快照中保留可选 `extractionPromptVersion: 2`。
- `writing-prompt.ts` 已接入五层编译：`facts`、`currentState`、`style`、`chapterTask`、`output`。材料用 JSON 边界传递，管理员 `writingSystemPrompt` 仍是规则层；旧画像带来源和时点，不自动刷新或覆盖人工层。
- `prompt-material.test.ts` 3、`prompt-policy.test.ts` 2、`writing-prompt.test.ts` 3、`profile-source.test.ts` 2 共 10 个纯函数/往返用例通过；注入文本只保留为材料值，未升级为系统指令。

## R3 执行结果（已验证）

- 单章、大纲各一次文本调用；多章续写按章节一次调用。续写使用冻结的 `continuationSnapshot`，本批正文以带 `batchIndex` 的 `batch_draft` 材料追加，不读取起点之后的新画像或已发布章节替换快照。
- 完整 `src/routes/ai.test.ts` 通过 76/76。覆盖结构化写作任务、标题解析、批次顺序、取消、失败重试、从中途恢复只生成剩余章节、幂等和 usage；多章恢复没有重复已完成草稿。
- 仍保留旧编译器供历史任务；新任务由服务端写入 pipeline 2。字符裁剪和窗口限制沿用既有常量，没有新增隐式摘要调用。

## R4 执行结果（已验证）

- 独立 `[R18]`、`（18+）`、成人向分类只在分析副本中过滤；原始书名、作者、简介和 exact prompt 不改写，`R180` 等相邻文本不误删。成年/年龄未知不会由标签推断。
- 文本客户端覆盖 HTTP JSON、非流式回退、SSE `delta.refusal`/`finish_reason=content_filter`；图像客户端覆盖结构化 policy/content-filter 错误。确定拒绝映射为 `422 invalid`，不触发普通重试。
- 路由用例“`cover：结构化内容拒绝只尝试一次并阻断图像阶段与候选写入`”通过：一次文本拒绝、图像请求 0、候选写入 0。已经流出的局部 JSON 不会被保存为成功结果；普通鉴权、参数、截断和连接错误仍保持原分类。

## R5 执行结果（已验证）

- `cover-brief.ts` 将当前书名、作者、最多三项分类和 800 UTF-16 简介整理为 prepared metadata。第一阶段解析 `CoverStoryBrief`，验证 genre、证据字段、长度、来源字段和未知字段；第二阶段解析 `CoverVisualConcept`，验证 factIds、表现字段和长度。
- `cover-brief.test.ts` 4 个用例通过，覆盖证据缺失、围栏 JSON、超限、错误 factId、材料注入、年龄未知和确定性降级。schema 失败只走本地中性 brief/concept，不增加第三次文本调用；网络/鉴权/明确拒绝不伪装成降级成功。
- 两次文本调用共享同一份清洗后的资料块，第二阶段不重新拼回原始简介；资料内的“忽略规则”等文本仍是材料。第一阶段仍会看到完成任务所需的原始必要材料，这是已记录的边界。

## R6 执行结果（已验证）

- 新封面路径采用“故事主体与视觉概念 → 构图及唯一美术方案 → 书名/作者或无字 → 必要限制”四层 renderer，不再调用旧 romance 物件映射。`cover-prompt.ts` 模板版本 3；legacy 任务继续模板 2。
- `cover.test.ts`、`cover-prompt.test.ts`、`cover-styles.test.ts`、`cover-romance.test.ts`、`phase2-fixtures.test.ts` 及新增 brief/client/image 测试均通过。`cover-prompt` 保持 UTF-16 100–10000 上限、完整姓名和显式无字语义；实际 `imageSize` 映射 2:3、3:4、4:7、1:1，exact 不注入比例。
- 第二阶段沿用 `chatStream`、取消和 heartbeat，但只在完整 JSON 校验后一次发布成品 prompt；中间只保留进度和中性预览。`generateNovelCover` 写入的任务 prompt、最终图像 payload 和候选 prompt 一致。
- B6 路由 mock 通过：4 个 auto 各为文本 2 / 图像 1，2 个 exact 各为文本 0 / 图像 1，总计文本 8、图像 6；没有真实模型或付费请求。

## R7 执行结果（已验证）

- `prompt-architecture-comparison.test.ts` 2 个用例通过并打印六组新旧对照；所有 `calls` 均为 `text: 0, image: 0`，对照由纯函数生成，不能解释为真实模型成品。

| 对照 ID | 类型 | 旧版本/长度 | 新版本/长度 | 观察到的结构变化 |
| --- | --- | ---: | ---: | --- |
| `cover-airport-reunion` | 封面最终 payload | v2 / 1610 | v3 / 1076 | 固定恋爱方向与机场关联道具移除，改为有证据的主体/场景/构图；size `1024x1536` 保留 2:3 |
| `cover-symbolic-rating-label` | 封面最终 payload | v2 / 1278 | v3 / 1389 | 仅成人向标签不再触发露骨材料或固定道具，象征物由实际简介主题承载；size `1024x1024` 保留 1:1 |
| `cover-environment-wide-ratio` | 封面最终 payload | v2 / 864 | v3 / 960 | 环境为主且主体保持小比例；size `1024x1792` 使用 4:7，不把竖长画幅写成 2:3 |
| `writing-continuation` | 创作 messages | legacy / 423 | v2 / 1832 | 规则、事实、当前状态、文风、章节任务和输出契约分层，批次正文单独标记 |
| `writing-chapter` | 创作 messages | legacy / 360 | v2 / 1634 | 单章目标只注入当前任务；资料值 JSON 编码，管理员规则不与作品事实混层 |
| `writing-outline` | 创作 messages | legacy / 218 | v2 / 1132 | 大纲使用独立输出契约，不套单章标题/停止规则 |

对照日志同时确认没有客户端调用、没有临时脚本出网；长度是 UTF-16 字符长度，不当作 token 费用。六组样本涵盖机场重逢、仅标签、环境构图、续写、新章和大纲；旧画像冲突、非恋爱关系和明确拒绝由 R2/R4 路由/纯函数用例分别覆盖。

## R8 执行结果（已验证）

- 目标服务测试：15 个文件、91 个测试通过；完整路由 `src/routes/ai.test.ts`：76/76 通过。根级 `npm run typecheck`：Web 与 API 均通过。
- 根级 `npm test`：41 个文件、342 个测试通过；根级 `npm run lint`：退出码 0，0 errors，保留仓库既有 Web 规则的 87 条 warning。
- 根级 `npm run build`：Web Vite 生产构建和 API tsup/migrations 构建均通过；仅有既有的大 chunk warning。两个仓库最终 `git diff --check` 均通过。
- 最后一次定向检查 `client.test.ts`、`image.test.ts`、`prompt-architecture-comparison.test.ts` 为 3 个文件/10 个测试通过；未知 provider URL 仍在 mock 层被阻断，六组对照使用固定 variation ID 后可重复。
- 最终工作树只保留本轮 API 实现/测试和 iOS/docs 文档改动；没有提交、推送、部署或真实模型请求。执行方案与本文状态同步为完成。

### 未验证边界

- 本轮没有调用任何真实文本/图像模型，不代表真实模型会接受所有成人主题，也不代表视觉贴题、构图、文字渲染或缩略图质量已经提升；真实费用和拒绝响应 usage 仍需另行授权评估。
- Windows 本机没有 Swift/Xcode；本轮未修改 Swift，因此只做 docs 仓库 `git diff --check`。macOS 原生编译、真机 UI、流式体验和 iOS smoke 未验证，不能由静态文档检查替代。
- 不自动刷新旧画像、候选或草稿；历史旧画像中的偏见只能在用户以后手动刷新并审核时更新。没有接入向量库、章节检索、参考图、局部改图、角色卡或全站重构。
