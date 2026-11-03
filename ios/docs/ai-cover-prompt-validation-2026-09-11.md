# 封面提示词整理验证记录（2026-09-11）

本记录对应 `ai-cover-prompt-luna-execution-guide-2026-09-11.md` 的 C0–C6。业务验证上游请求均由 API Vitest 的 `fetch` 桩承接；C6 对照样本的第一次离线尝试曾误触达已配置的文本 provider（返回 401，未得到模型内容），之后已改用纯 renderer，未调用真实图像模型、未产生成功模型调用、付费接口、部署或 Git 提交。

## C0 基线与红测

| 项目 | 记录 |
| --- | --- |
| API 基线 | `35ec374aee954ebd2167b4c90c7bc2fd0d45b2c0`，执行前 API 工作树干净 |
| iOS 基线 | `c973925c0addcf69ce6fe83e49b2f9289ecde6c7`，执行前仅有本指导文档未跟踪 |
| 真实 provider 隔离 | API 测试使用 `https://ai.test/v1`、`https://image.test/v1` 与全局 fetch 桩；未知请求不透传 |
| 入口盘点 | `generateCoverPrompt`、`generateCoverPromptTask`、`generateNovelCover`、cover retry、候选/历史链路均保留；exact 仍只走图像调用 |
| 初始红测 1 | 新增 auto 长度回归：设置 100 字时旧 `generateNovelCover` 未向 `buildImagePrompt` 传上限，任务错误地 completed 并调用图像上游 |
| 初始红测 2 | B6 fixture 检查发现 auto 仍携带非空 prompt，预算实际报封面文本 4 次而非两次文本调用合计 8 次 |
| 初始红测命令 | `npm exec vitest run src/services/ai/phase2-fixtures.test.ts src/routes/ai.test.ts -t "auto 生成必须沿用|固定六组封面需求|预算只记录"` |
| 初始红测结果 | 4 项失败：入口长度用例收到 `completed`；fixture prompt 非空；预算为 `{ cover: { text: 4, image: 6 } }`；长度回归的错误任务还产生了一个候选，证明必须在图像调用前终止 |

## C1 入口与 B6 预算

状态：已完成。

- `generateNovelCover` 将已读取的 `settings.coverPromptMaxChars` 传给 auto `buildImagePrompt`；独立 prompt task 原路径继续从设置读取，retry 使用冻结参数和既有幂等语义。
- `Phase2CoverFixture` 的四组 auto 清空 `prompt`，自然语言移到自写 `description`/`categories`；两个 exact prompt 未改写。
- 四组 auto 各声明并实际验证 text=2/image=1；两个 exact 各为 text=0/image=1；合计 cover text=8/image=6，writing 仍为 text=8/image=0。
- 绿色证据：`phase2-fixtures.test.ts` 3 tests passed；API 路由 B6 六组桩回归实际统计 `textCalls=8`、`imageCalls=6`。

## C2 唯一方向与内部 brief

状态：已完成。

- 新增生产路径使用的纯函数模块 `api/src/services/ai/cover-prompt.ts`，统一上下文、构图、视觉 preset、文字块、约束块和预算渲染；最终 prompt 与流式快照都经过同一 renderer。
- `resolveCoverDirection` 仍是唯一构图选择源；言情 DNA 接收可选 composition，并在 symbolic/environment/duo 等构图下选择兼容 visual concept。
- preset 的视觉描述只保留一套；最终 prompt 不再追加 genre 的 color/light 或 romance 的第二套 palette/lighting。公开 preset/composition 值未变。
- 方向矩阵覆盖所有已公开 preset × composition × renderTitle 组合；no-text 组合不含正向 title/author/font/lettering/typography 指令。

## C3 故事资料与场景

状态：已完成。

- 两次文本调用共用同一份准备后的简介：移除明显 HTML、折叠空白、控制字符归空格，最多 800 个 UTF-16 单元；超限保留头尾完整片段并插入 `[middle omitted]`。
- 分类最多三项，仅用于题材判断/场景输入；最终图像 prompt 不重复整段原始简介和分类清单，必要事实由场景块承载。
- 场景规则按 composition 决定人物数量和可见性，不再强制“人物+背景”；本地 fallback 只使用中性主体/场景骨架并可携带短故事锚点。
- 题材 figure/background 已移除固定西装、凤冠宫殿、机甲武器等强制事实；言情锚点删除单字“信”和情绪中的单字“血”误命中；古代婚约优先 historical，不套现代场所。
- 言情资料没有明确物件时只使用条件性 `one specific object from the premise, if present`，不再按子类型补写合同、戒指、咖啡杯、证物或时代饰物；有明确关键词时才提取对应物件。
- 文本 system/user 均明确元数据只是素材，忽略其中改变任务、输出水印或泄露系统信息的命令。该规则降低注入风险，不宣称完全消除自然语言模型风险。

## C4 分块预算、流式与版本

状态：已完成。

- 删除全文硬切 `limitGeneratedCoverPrompt`，改为必需块/可选块优先级渲染；先去平台和低权重块，再按完整句压缩场景，必需块仍超限则返回 422 invalid，图像调用为 0。
- 普通 2000 字预算为场景预留 40%（不强行填充）；文本场景请求收到同一计算后的字符预算。流式预览只在收到完整句末标点后更新，未完成句继续显示本地模板。
- 有字模式保留完整书名/作者和中心安全区，并声明只渲染输入文字；无字模式保留 `no text`、`no watermark`、`no logo`，不注入正向文字要求。
- auto metadata 增加可选 `promptTemplateVersion: 2`；exact 继续 `configurationApplied=false`，不增加版本/风格字段。任务 prompt、最终图像请求和候选 prompt 使用同一字符串。

## C5 最终请求与调用契约

状态：已完成。

| 契约 | 证据 |
| --- | --- |
| CP01–CP15 纯函数结构/预算/构图/no-text/锚点回归 | `api/src/services/ai/cover-prompt.test.ts`，17 tests passed（包含 15 个编号契约与方向矩阵） |
| auto 最终请求与真实次数 | `api/src/routes/ai.test.ts` 的“cover：生成后落候选表…”：text=2、image=1，检查 `/images/generations` body prompt/size |
| 100 字入口失败 | `api/src/routes/ai.test.ts` 的“cover：auto 生成必须沿用…”：任务 failed，错误包含 100，imageCalls=0 |
| B6 实际 API | `api/src/routes/ai.test.ts` 的“cover B6…”：六组逐一创建任务，exact body 原样相等，合计 text=8/image=6 |
| no-text 最终 body | “cover：默认渲染书名/作者名…”：第二次 no-text 出图 body 含 `no text` 且无正向文字指令 |
| 幂等/候选/历史 | 原有 `ai.test.ts` 全量回归继续通过；本轮没有改变 operationId、clientRequestId、variationId、候选历史或 retry 语义 |

## C6 收口结果与三组提示词对照

状态：已完成（C0–C6；业务验证仅 mock/local；另有一次误触达文本 provider 的 401 失败记录，未获得模型内容）。

最终收口命令按指导顺序执行，结果如下：

| 顺序 | 命令/范围 | 结果 |
| --- | --- | --- |
| 1 | cover-prompt、cover、cover-styles、cover-romance、phase2-fixtures | 5 个文件、44 tests passed |
| 2 | `src/routes/ai.test.ts` | 1 个文件、75 tests passed |
| 3 | `npm run typecheck`（Web + API） | 通过 |
| 4 | `npm run lint` | 通过；0 errors、87 个既有 warnings，未扩大清理范围 |
| 5 | `npm test`（Web + API） | Web 14 文件/50 tests，API 32 文件/315 tests，全部通过 |
| 6 | `npm run build`（Web + API） | 通过；Vite 仅报告既有大 chunk warning |
| 7 | `git diff --check`（两个仓库） | 通过，无 diff 空白错误 |

本轮新增/重点 API 验证：

```text
cover-prompt.test.ts              17 passed
cover.test.ts                      9 passed
phase2-fixtures.test.ts            3 passed
cover-styles.test.ts              12 passed
cover-romance.test.ts              3 passed
routes/ai.test.ts                 75 passed（包含 B6、入口长度、最终图像 body、流式完整句）
typecheck                          passed
```

三组对照使用本地 fallback 与纯 renderer 组装结果，仅展示工程 prompt，不是实际模型出图。

### 1. 物件言情（symbolic）

旧（基线代表性片段）：`两位人物隔着半开的木窗对望，暖冷光交界，保留人物手部和视线关系。`

新：

```text
Chinese web novel cover design.
Story-specific romance direction (must drive the image): relationship former lovers meeting again with visible history, distance, and the possibility of repair; setting a transit platform where departure creates visible emotional pressure; anchor a single wedding ring as the story-defining object; action one protagonist leaves a single wedding ring in the other's path; concept object.
former lovers meeting again with visible history, distance, and the possibility of repair; a transit platform where departure creates visible emotional pressure; a single wedding ring as the story-defining object; one protagonist leaves a single wedding ring in the other's path.
Composition: one story-defining object or motif in the foreground, with the character or setting implied through layered context.
Genre cue: character-driven romance cover art with editorial emotional realism. Primary visual preset (highest priority): polished commercial Chinese web-novel romance illustration with expressive story-specific gestures, clean linework blended with painterly rendering, carefully designed hair and costume details, and a balanced contemporary palette. Follow the selected preset as the single source for visual treatment.
Professional novel cover artwork, portrait 2:3 ratio, strong thumbnail readability, no text, avoid generic stock cover layouts, avoid repeated composition, no watermark, no logo, no extra text, keep the relationship legible through the story-specific gesture, setting, or object; avoid a generic posed couple.
```

变化：焦点从默认双人姿势改为一个故事物件；关系动作仍作为辅助线索；色彩/光线只由选择的 preset 提供。

### 2. 环境古言（environment）

旧（基线代表性片段）：`黄昏山城与长桥，远景层叠，人物只作小比例剪影，画面保留纵深。`

新：

```text
Chinese web novel cover design.
a premise-grounded location carries the narrative while a small readable subject gives the frame scale and direction; story material anchor: 主人公沿着旧地图回到山城，长桥和河面保存着一段家族迁徙的记忆。
Composition: wide environmental storytelling, a small but readable character placed inside a memorable world or location.
Genre cue: ancient Chinese romance and classical drama, elegant restrained beauty. Primary visual preset (highest priority): refined Chinese guochao ancient-romance illustration with expressive hanfu costume and period architecture, controlled vermilion, jade, ink, and muted gold accents, decorative brush-calligraphy energy, layered ornamental detail, and a clear readable silhouette. Follow the selected preset as the single source for visual treatment.
Title text '山河旧梦' at top center in elegant golden traditional Kai script with ornate decoration; use only this exact title and no additional wording. Author name '青简' at bottom center in small elegant dark red traditional text inside a thin golden rectangular border frame with corner decorations; use only this exact author name.
Professional novel cover artwork, portrait 2:3 ratio, strong thumbnail readability, keep title and author name inside the central safe area away from edges (inner ~85%), avoid generic stock cover layouts, avoid repeated composition, no watermark, no logo, no extra text.
```

变化：地点成为主体，人物只在资料支持时出现；移除自动凤冠、帝王、宫殿等固定事实和多地点备选。

### 3. 无字极简（minimal_typographic + renderTitle=false）

旧（基线代表性片段）：`quiet minimalist literary cover ... a large elegant Chinese title as the primary graphic, and a small restrained author line ... no text`

新：

```text
Chinese web novel cover design.
Story-specific romance direction (must drive the image): relationship two distinct protagonists connected by a specific unresolved choice rather than a generic romantic pose; setting a story-specific location drawn from the premise, never a generic café, garden, or sunset beach; anchor an opened letter as the story-defining object; action one protagonist leaves an opened letter in the other's path; concept object.
two distinct protagonists connected by a specific unresolved choice rather than a generic romantic pose; a story-specific location drawn from the premise, never a generic café, garden, or sunset beach; an opened letter as the story-defining object; one protagonist leaves an opened letter in the other's path.
Composition: one story-defining object or motif in the foreground, with the character or setting implied through layered context.
Genre cue: character-driven romance cover art with editorial emotional realism. Primary visual preset (highest priority): quiet minimalist literary cover with an ivory, white, or single pale-tint field, one subtle watercolor wash or symbolic texture, extremely generous negative space, and one restrained visual mark. Follow the selected preset as the single source for visual treatment.
Professional novel cover artwork, portrait 2:3 ratio, strong thumbnail readability, no text, avoid generic stock cover layouts, avoid repeated composition, no watermark, no logo, no extra text, keep the relationship legible through the story-specific gesture, setting, or object; avoid a generic posed couple.
```

变化：删除正向书名/作者/字体指令；保留极简象征图形、留白和 no-text 限制，最终图像请求仍只有一次。

### 完整收口边界

- 本轮未获得真实模型产物，不评价自然语言/视觉质量均分，不声称费用不变。
- 事故记录：生成三组对照的第一次一次性脚本未完全隔离进程环境，命中已配置的 `https://api.deepseek.com/v1/chat/completions`，返回 401；没有模型内容、图像请求或成功计费。发现后立即停止该路径，改由不导入 provider 调用的 `assembleCoverPrompt` 纯函数生成对照，后续命令均未触达真实模型。
- Windows 工作区没有 macOS/Xcode 原生环境；iOS 本轮仅修改验证/规划文档，未做 Swift 原生编译、Simulator、真实设备或原生 UI 验证。
- lint、全仓测试、构建和两个仓库的 diff 检查均已完成；静态/桩验证不能替代 macOS 原生运行时结论。
