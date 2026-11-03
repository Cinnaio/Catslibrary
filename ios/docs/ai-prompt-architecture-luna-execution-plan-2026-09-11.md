# 创作与封面提示词架构重构：Astra 决策与 Luna MAX 执行方案

状态：R0–R8 已执行并验证。本文是本轮实施依据；不代表真实模型质量已验证。

## 1. 目标、基线和执行边界

将当前分散的自然语言拼接重构为“来源材料 → 任务资料 → 任务方案 → 分块渲染 → 本地验证 → 模型请求”。共用来源、边界、预算与版本基础设施，创作和封面分别实现领域组装器，不建立万能模板引擎。

本轮 Astra 已核对的基线：

| 仓库 | 路径 | HEAD | 预期改动 |
| --- | --- | --- | --- |
| API/Web | E:/Developments/Projects/zhi-zhou | 0f0dc3f2593564051e602a5d2cb021337cda3e36 | 主要实现、路由与请求契约测试 |
| iOS/docs | E:/Developments/Projects/zhi-zhou-ios | d5101aabd0250692fd9baa33273d1cab042d5c19 | 方案、验证记录；必要的旧界面错误展示兼容 |

执行前重新核验工作树及父目录/子目录 AGENTS.md；不得重置不同 HEAD、清除用户文件或覆盖无关改动。本次规划未发现已检查的仓库及祖先 AGENTS.md，Luna 仍需复核。

- 本文由 Astra 做架构与产品决策，Luna MAX 按 R0–R8 单线程实施，不使用子代理。
- 不提交、不推送、不部署、不调用任何真实文本/图像模型（免费接口也不例外），不操作生产数据库，不触发远端 CI。
- 不新增向量库、检索服务、角色卡产品、参考图、局部改图、文字叠加服务、供应商或模型选择器，不做全站重构。
- 不更改模型、temperature、max_tokens、图像 size/quality、并发、现有每日额度和普通网络重试次数。调用次数相同不等于 token 费用相同。
- 不自动刷新历史画像，不迁移小说原始书名/分类/简介，不篡改已保存候选和草稿。
- 发现新的预算/架构/产品取舍交回 Astra；普通类型错误、漏传参数、测试隔离问题由 Luna 自行修复。
- 本文对新版本的结构化输出、进度展示和版本分流决定，取代旧 C0–C6 文档中的“不要求 JSON”等限制；旧版本执行兼容仍须保持。

## 2. 现状发现与入口地图

| 编号 | 当前证据 | 重构要求 |
| --- | --- | --- |
| A01 | cover.ts/judgeGenre 第一次调用只输出题材代号 | 改为有来源的紧凑资料提取，题材降为字段 |
| A02 | cover.ts/generateSceneDescription 与 cover-prompt.ts 重复描述画风/场景，romance 另加必需块 | 视觉概念、构图、美术、文字各有唯一负责人 |
| A03 | cover-romance.ts/ANCHOR_RULES 将项链映射婚戒、机场映射火车票、消息映射书信 | 不把关联物件当正文事实；移除新流程对此映射的依赖 |
| A04 | relationship-profile.ts 提取系统预设主导/从属、控制与奖赏 | 改为从证据判断关系，不给所有作品套同一关系结构 |
| A05 | style-profile.ts 同时提取文风和“当前处境与目标” | 稳定文风与动态状态分离 |
| A06 | plot-state.ts 将已埋伏笔与可能回收方向放在一起 | 区分事实、人物认知、未解线索和可选建议 |
| A07 | writing.ts/generateWriting 将画像拼进 system，并要求严格遵循 | system 仅容纳规则；作品资料与画像在有标签的材料层 |
| A08 | routes/ai.ts 的 continuationSnapshot 冻结来源；多章追加正文但最初画像不更新 | 保留快照；标明旧状态时点及批次内新增正文的优先级 |
| A09 | client.ts 可将内容过滤/拒绝当空回复；image.ts 与文本共享相似重试模式 | 识别明确拒绝，禁止进入自动重试和后续生图 |
| A10 | 上轮对照脚本误触达真实 provider 并返回 401 | 本轮测试和样本生成必须使用拒绝未知网络的封闭 mock |

必读：api/src/services/ai/{writing,cover,cover-prompt,cover-styles,cover-romance,style-profile,relationship-profile,plot-state,profile-source,profile-overrides,client,image,tasks,generations,settings}.ts；api/src/routes/ai.ts；api/src/index.ts；对应测试、phase2-fixtures；iOS ZhiZhou/Models/AdminAIModels.swift 和相关 smoke。

## 3. Astra 已定的数据来源策略

### 3.1 不建立新资料库

“作品资料”是现有材料的任务视图，不是新增一张必须填写的表。

| 任务 | 本轮实际使用 | 本轮不做 |
| --- | --- | --- |
| 封面 auto | 服务端当前书名、作者、最多三项分类、简介；已有构图/风格/文字选择 | 不自动读取章节或创作画像，不引入新的封面 instruction 参数 |
| 续写 continue | 已有服务端起点上下文、有效画像、人工修订及来源、writingBrief、本批已生成正文 | 不读起点之后的已发布章节；不追加未冻结的小说简介 |
| 新写 write_chapter | 已有小说标题、用户大纲/context/instruction/brief、现有允许的画像 | 不把用户提供 context 宣称为已发布正文 |
| 大纲 write_outline | 已有标题、instruction、brief 等请求字段 | 不自动查询最新剧情充当大纲事实 |

此前讨论的“正文补充封面细节”作为以后可扩展能力，不在本轮默默接入；当前封面接口没有选取章节与防剧透契约。创作也不为了凑齐资料字段而扩张现有读取范围。缺失字段显式为空，不编造。

### 3.2 材料边界和优先级

来源类型至少区分 metadata、published_context、user_context、automatic_profile、manual_profile、author_request、batch_draft；每块标注已知的来源和章节时点。没有证据只能标 unknown，不生成虚构章节 ID 或置信度百分比。

- 系统固定规则和输出契约属于指令；章节、简介、画像属于材料，引用的台词和“忽略前文”不升级为指令。
- 作者本次明确改编要求可改变故事走向；普通续写不得自行推断作者要求重写既有事实。
- 人工画像沿用当前人工覆盖自动画像的机制；本次 author_request 明确覆盖的事项优先。
- 最新有效正文/本批新正文描述当前状态；旧画像只作对应时点的摘要。不能把“当时不知情”解释为永远不能知情。
- 风格画像描述表达习惯，不能冻结人物处境；潜在回收建议不能当已经发生的事实。
- 书名和分类主要提供定位，不能独自证明婚姻、年龄、性别、犯罪事实或道具存在。
- 冲突处理是提示词规则，不声称本地代码能自动判断所有自然语言矛盾。显式互斥字段用本地校验；语义效果留给人工评估。

## 4. 内部结构和职责

建议新增以下模块，文件名可做常规调整，职责不可混合：

| 模块 | 责任 | 禁止承担 |
| --- | --- | --- |
| prompt-material.ts | 来源块、规范化、稳定顺序、材料分隔和字符预算 | DB 查询、网络、语义改写 |
| prompt-policy.ts | 任务表达约束、格式化标签处理、明确拒绝识别的辅助类型 | 大型敏感词审查器、规避供应商过滤 |
| writing-prompt.ts | 五层 WritingPromptPlan、纯函数 messages 编译 | 自行读最新章节/设置，额外 chat |
| cover-brief.ts | 封面资料/视觉概念 schema、解析、验证、确定性降级 | image 请求、自动修复模型调用 |
| cover-prompt.ts | 封面最终四层渲染和字符预算（重用改造） | 再次根据关键词虚构人物/物件 |

现有 writing.ts/cover.ts 继续承担编排、调用、任务生命周期、存储、用量。避免同时留下两套“新生产组装器”；旧版本兼容函数须明确 legacy 名称和调用分流。

内部概念示例（不是公开 API，Luna 补齐 TS 判别联合及 runtime 校验）：

```ts
type MaterialBlock = {
  id: string
  kind: 'metadata' | 'published_context' | 'user_context'
      | 'automatic_profile' | 'manual_profile' | 'author_request' | 'batch_draft'
  text: string
  source?: { field?: string; chapterId?: string; revision?: string }
  asOf?: { chapterId?: string; batchIndex?: number }
}

type WritingPromptPlan = {
  version: 2
  kind: 'continue' | 'write_chapter' | 'write_outline'
  facts: MaterialBlock[]
  currentState: MaterialBlock[]
  style: MaterialBlock[]
  chapterTask: MaterialBlock[]
  output: { singleChapter: boolean; targetWords?: number }
}
```

这里的 facts 表示供模型核对的事实材料，不表示本地已经提取、证明了每个命题。旧自由文本画像作为整块材料标记 legacy，不靠正则强行拆解成可靠结构。

## 5. 创作生成结构

### 5.1 五层编译

1. 作品事实：起点范围内已有上下文和有效设定材料。
2. 当前状态：情节/关系摘要及 asOf，本批新增正文和最近衔接尾部。
3. 文风规范：语言、视角、叙述距离、对话和修辞；旧画像提示“可能混有旧剧情”。
4. 本章任务：instruction、brief、仅当前 index 的 chapterGoal；区分已有事实和期望发生的事。
5. 输出规范：章节首行标题、正文、单章停止、长度要求；write_outline 使用独立输出规则，不套章节标题契约。

system 放任务角色、材料边界、冲突规则、内容表达范围和输出契约；保留管理员现有 writingSystemPrompt 作为可配置写作指导，不覆盖数据库设置。固定规则与管理员指导分隔，不把管理员指导当作品资料。正文/画像不再直接成为 system 权威。

user 用序列化结构或明确块边界按固定顺序传入材料，源文本不能通过闭合标签逃出边界（推荐 JSON.stringify 编码材料值）。不依赖仅添加 XML 标签来解决提示注入。

### 5.2 连续写作与预算

- 每章一次 chat；大纲/单章各一次。画像依旧仅在显式提取时各一次，不在写作前隐式刷新。
- 保持现有上下文总量和近期尾部策略（MAX_CONTEXT_CHARS、6000/3000 等按实际常量核验），不新增全书材料。原有字段上限不在本轮降低。
- 长上下文裁剪只作用于可裁剪资料，不剪掉作者必需事实、禁止事件或输出规则；记录每层输入字符数，无“字符数=token”假设。
- 本批每个新章节作为带 batchIndex 的后续进展，不与原画像混成同一时点。新章节追加规则保持既有幂等/恢复机制；不增加逐章状态提取调用。
- 不承诺有限窗口保留任意长批次的所有细节，不新增隐藏摘要调用。验证记录明确这一边界。
- 保留标题解析与草稿写入契约；不要强制所有题材必须反转、加悬念、用同一种结尾。

### 5.3 画像更新与旧数据

- 新 style 提取只输出文风；relationship 输出目标/依赖/信任/冲突/权力来源/变化证据，允许平等、不明确和非恋爱关系；plot 区分确定事实、人物认知、未解线索、可选方向。
- 输出仍为现有可编辑文本，标题格式清晰，不把画像接口整体迁移 JSON。
- 新提取在现有 source_json 中增加可选 extractionPromptVersion: 2；保持 source.version/samplePolicyVersion 及 fingerprint 的现有来源含义。补 parser 对可选字段的往返支持，旧缺失不补造版本。
- 不因新增版本字段改变已有 baseProfileRevision 的旧计算规则；不制造人工覆盖 revision 冲突，不自动覆盖人工层。
- 旧画像继续走原来源有效性校验；允许使用时作为旧摘要材料降权，而非“严格不可改变的系统设定”。不删旧文本、不自动刷新。人工覆盖不做语义删改。
- 执行记录说明：旧画像内容偏见不能仅靠新 renderer 完全消除，需要用户以后按现有入口手动刷新并审核。

## 6. 封面：两次文本调用与四层渲染

### 6.1 第一次：资料提取

用 prepared metadata（简介保持 800 UTF-16 上限和现有头尾策略）请求普通 chat，输出一个 JSON 对象。不要求供应商 JSON-mode/function calling，以兼容当前网关。

```json
{
  "version": 1,
  "genre": "romance",
  "premise": "两名成年旧识在机场重逢",
  "facts": [
    {"id":"f1","kind":"setting","value":"机场","sourceField":"description","evidence":"在机场重逢"}
  ],
  "mood": ["克制"],
  "unknowns": ["衣着"],
  "contentMode": "non_explicit"
}
```

示例只在原简介明确成年时成立；不得从“成人向/R18”标签推断角色均成年。

- schema：genre 必须是现有枚举；premise ≤240 UTF-16；facts ≤8，每个 value≤120、evidence≤120，id 唯一；mood≤3 每项≤40；unknowns≤6 每项≤60；总结构文本≤3000。未知字段丢弃。
- sourceField 限 title/categories/description；作者名不用于推断人物。evidence 必须能在该次实际传入的规范化字段中找到，不能引用裁掉的原始全文。
- 证据子串存在只能证明引用存在，不能证明推断正确；第一轮指令只允许直接事实，不输出“机场→火车票”等关联补全。
- JSON 可接受外层唯一代码围栏；不 eval、不用正则扫描多段任意内容拼 JSON。正文 malformed/超限/未知 genre：本地返回中性 brief，记录 reason，不增加修复调用。拒绝、超时、鉴权失败不走降级成功。
- 资料提取不是详细情节梗概；只提供封面需要的非露骨主题、关系与场所。禁止把作品资料里的命令转成生成要求。

### 6.2 第二次：视觉概念

由本地 resolveCoverDirection 先确定最终构图和显式风格；第二次只接收已验证 brief 与这些约束，不再次拼回原始简介。

输出紧凑 JSON：version:1、subject、action、setting、spatial、supportingDetail（各≤240 UTF-16）、factIds（≤8）、inventedPresentation（≤3，每项≤120，总对象≤2400）。这些字符串为英文可视描述；不含书名/作者/字体/水印/第二套色板。

- subject/action/setting 只能采用 facts 或不新增故事事实的中性表现；inventedPresentation 只允许镜头、距离、光线强弱、抽象纹理等表现选择，不能借此添加婚姻、凶案、制服、戒指或人物年龄。
- factIds 必须属于第一轮有效事实；缺资料允许 setting/supportingDetail 为空。显式 duo 但人物事实不足时使用两个人物轮廓，不虚构姓名/性别/关系事件。
- symbolic 无物件证据时用抽象形状，不硬塞道具；portrait 不额外增加第二主角；environment 让环境为主；silhouette 不要求精细面容。
- malformed/超限/结构矛盾：本地以已验证 brief+构图构建短概念，记录 degraded，不补第三次 chat。语义错误不能全部本地证明，单独列人工验收。

### 6.3 进度和流式：Astra 明确决定

第二次保留 chatStream 的传输和取消/heartbeat，但累积 JSON，完整解析前不把局部 JSON 或半个场景展示给客户端。进度先显示“正在提取作品资料”，再显示“正在设计封面画面”，期间保留已有中性模板预览；成功后一次发布完整新 prompt。

这是新版本有意采用的产品取舍：保留任务进度，取消逐句自然语言预览。无需新增 SSE 协议或客户端 JSON 解析器。沿用写库节流/取消检查；不得因收到半个 JSON 就发布候选。

### 6.4 最终四层

顺序固定：故事主体与视觉概念 → 构图及唯一美术方案 → 完整书名作者或无字约束 → 必要交付限制。

- 新路径不再拼独立 romance 必需段，不再让 genre 注入固定人物/道具/光线。保留旧 genre/romance metadata 字段的读取；新 metadata 仅填写实际使用的值，不伪造旧 DNA。
- cover-styles 的显式选择和 auto variation 规则继续沿用；不宣称“避免重复”会自动知道历史图像，不新增历史提示词读取。
- 重用分块预算：总上限仍 coverPromptMaxChars UTF-16 100–10000；姓名完整，必要块不足明确失败；可预检的失败在文本调用前终止。
- 紧缩顺序：平台装饰 → supportingDetail → 次要背景 → 中性完整短概念。不得把 JSON 生硬截断后解析，也不得把必需标题切半。
- 新自动渲染比例由实际 coverImageSize 解析，1024x1536 为 2:3、768x1024 为 3:4、1024x1792 为 4:7、1024x1024 为 1:1；不改变实际 size 配置。方向文字应随实际比例，不能仍把方图描述为 portrait 2:3。exact 不注入比例。
- 无字模式没有正向文字绘制要求；有字模式原样保留经现有规范化后的完整书名作者。禁止自动改名或把 R18 从要渲染的书名中删掉。
- 最终 generateImage payload、任务最终结果、候选 prompt 必须一致。纯 prompt 生成再 exact 生图只做一次文本准备流程。

## 7. R18 资料与拒绝处理

目标是按本次任务最小必要材料生成合适内容，不是绕过上游审核。不得承诺某一供应商一定放行。

### 7.1 本地能做和不能做的事

- 在 auto 的题材分析副本中，可忽略独立格式化年龄分级标签（如单独的 [R18]、（18+）、分类项“成人向”）；只影响分类提示，不修改数据库、不修改标题文字层、不裁掉整段简介。严格边界匹配，不误删 R180、编号、正文数字。
- 自由文本中的成人主题不是本地正则能可靠分类的对象。本轮不新增一长串“敏感词替换”，不删除可能决定人物年龄、关系或案件性质的句子，不以替换同义词获取相同露骨结果。
- 第一轮分析看到必要原材料，指令要求提取非露骨主题和事实；仍可能被上游拒绝。不能声称所有原始表达在第一次调用前都已可靠去除。
- 创作保留必要因果和人物边界，针对本章要求约束为非露骨叙述；成年恋爱、日常、调查不因标签整单拒绝。明确露骨生成要求不得隐蔽执行或静默把替代稿当满足原请求。
- 年龄未知保持未知，不从题材推断成年；涉及未成年人性化要求不得继续生成，不通过删除年龄重新请求。
- exact 保持 trim 后原样语义；适用内容边界时明确失败，不偷偷修改内容送图。

### 7.2 明确上游拒绝

- client.ts JSON/SSE/非流式回退均识别 message.refusal、delta.refusal、finish_reason=content_filter 等结构化信号；image.ts 识别响应中的明确 policy/safety/content_filter 错误 code。
- 将确定拒绝映射到现有 AiError('invalid', 简洁中文说明, 422)，可增加内部 reason='content_refused'，不新增必须由旧客户端认识的公共错误枚举。
- 不把所有 400/403/空文本判断为内容拒绝：鉴权、参数、截断、连接故障继续原类别。HTTP 明确内容拒绝即使在 5xx 也不可重试；普通网络故障保持既有规则。
- 未结构化的自然语言拒绝不承诺自动识别完备；不得依靠“抱歉”单词判断正文拒绝。新封面 schema 无法解析时的降级和真实拒绝要分别记录，不把明确拒绝变成中性生图成功。
- 拒绝后不换模型、不改词重试、不进入图像阶段、不把已流出的部分正文/JSON保存成成功草稿或候选。
- UI 说明：“本次生成要求被上游拒绝。可调整为非露骨表达后重新发起。”有字封面可提示选择现有无字模式；不能替用户自动切换。沿用现有错误展示，不增加弹窗选择器。
- 拒绝流程不能伪造零成本：前一步成功调用与拒绝响应返回的 usage 都可能代表已发生费用。当前 cover.ts 在两个文本阶段结束后才合并 textUsage，早期中断可能缺少完整的持久化用量。Astra 本轮决定不顺带重构失败用量账务；保留现有记账行为，在 mock 验证记录明确“实际请求数”与“已落库用量”的差异，不称拒绝免费或预算完整。这是已知账务限制，不作为 R0 反复等待决策的阻塞；如新代码进一步丢失原本会记录的用量则必须修复。

## 8. 版本、恢复与历史兼容

版本字段分工：

| 字段 | 新值 | 用途 |
| --- | --- | --- |
| 创作 promptPipelineVersion | 2 | 新创作编译器选择，task params/新 generation params 可选字段 |
| 封面 promptPipelineVersion | 3 | task params 中冻结编译流程 |
| 封面 promptTemplateVersion | 3 | 自动结果 metadata 标识最终渲染版本 |
| 画像 extractionPromptVersion | 2 | 来源元数据中的提取指令版本 |

- 不改 continuationSnapshot.version/contextPolicyVersion；快照来源策略未变。新可选执行版本在 task params，重试/恢复显式透传；generation 现有 params version:6 不因新增可选字段强行重编号。
- 版本由服务端赋值，不能让外部请求任意指定 legacy 分支。任务创建前确定，持久化后不因重启漂移。
- 缺 promptPipelineVersion 的历史未完成任务走原编译器：创作 legacy、封面 v2。保留最小旧 renderer/提取协议，禁止中途把旧 JSON/纯文本预期混用。
- 新任务重试沿用源任务版本；封面已保存 prompt 的 exact 重试继续原样。启动恢复 index.ts 必须透传；unknown version 明确失败，不猜版本。
- 原有 operation/clientRequestId/request hash 判重输入保持不变；重复请求命中原任务，不因部署后模板升级产生第二个任务。内部版本不从客户端加入 hash。
- 本轮不扩张封面已有的元数据/设置冻结范围；相同输入及同一版本可保证纯函数结果确定，不承诺跨模型响应或跨设置变化可复现。
- 历史候选/草稿不回填新 metadata；旧客户端可忽略新增字段；version、来源摘要和降级 reason 只放既有授权可读 params/metadata，不在普通日志额外复制整段原始资料。

## 9. R0–R8 执行切片

每片更新 docs/ai-prompt-architecture-validation-2026-09-11.md；状态只能写未开始/进行中/已验证/受阻。失败证据保留实际命令、退出码、用例名和简洁错误，不粘贴密钥或真实私有作品。

### R0：基线、隔离与真实覆盖盘点

1. 核对两个仓库 HEAD/status/规则；阅读前述入口与旧 C0–C6 验证记录。
2. 盘点 auto、exact、prompt task、直接生图、同步 prompt、retry、启动恢复，以及三种 writing kind 的调用路径。
3. 检查 runtime config、outboundFetch、Vitest mocks。测试进程在导入生产 AI 模块前安装封闭网络桩，未知 URL 立即 throw；脚本不得加载真实运行时密钥。不能仅删除两个 env 就认定已隔离。
4. 先证明未知 provider URL 被阻断，再运行既有目标测试和完整 routes/ai.test.ts（该文件有准备数据依赖，不能随意 -t 单测过滤）。
5. 为 A03/A04/A05/A09、旧任务恢复和零新增调用建立可失败的行为契约；旧断言描述现状不等于覆盖新语义。
6. 记录用量失败路径现状。关键幂等/安全/来源缺陷先修复或交回，不能绕过后继续批量修改。

出口：覆盖矩阵、隔离验证、实际失败复现和已知边界均落文档。

### R1：领域类型、版本分流和纯函数边界

1. 增加 MaterialBlock、WritingPromptPlan、CoverStoryBrief、CoverVisualConcept 与严格 runtime 校验。
2. 给现有生产 renderer 提取最小 legacy 包装；新增版本选择，贯通路由创建/retry/index 恢复。
3. 新编译器尚未就绪前保持当前新任务使用旧版本；直到对应 R3/R6 通过再切服务端默认值，禁止中间提交状态跑到半成品分支。
4. 测缺字段/已知新值/未知值、老 params、revision、request hash 与客户端新增字段容忍。

出口：调用链可分流；没有丢失旧任务/新字段，尚无新增模型调用。

### R2：画像职责与创作编译器

1. 修改三个提取提示词，保留人工覆盖与有效性算法。
2. 新 writing-prompt.ts 构建五层 messages；正文与画像搬到材料块，管理员 writingSystemPrompt 保留。
3. 明确单章/大纲不同输出规则；brief 不重复注入其他章节目标。
4. 增加 extractionPromptVersion 的 parse/存储往返，不自动重算历史源 hash。
5. 测平等伙伴、非恋爱对手、控制关系有正文依据、旧状态变化、未知关系；这些 mock 只证明请求约束，不证明模型一定理解。

出口：三个画像协议与创作纯函数接入；旧人工修订不被覆盖。

### R3：创作任务端到端接入

1. 三个 writing kind 使用新编译器，服务端新任务默认 promptPipelineVersion=2。
2. continuation 使用被冻结来源；批次新增正文带明确阶段，恢复不再读新画像替换旧快照。
3. 保留草稿标题解析、写库前活动任务检查、batch 顺序、取消和 usage。
4. 完整路由 mock 验证一章一次、多章 N 次、从 k 恢复只调用剩余章数、起点之后的正文不进入 messages。

出口：单章/多章/恢复最终 messages 和数据库结果均可验证。

### R4：任务表达边界与上游拒绝

1. 实现独立标签分类副本处理；原始字段、姓名渲染和 exact 不被更改。
2. 为新创作与封面分析注入任务范围与非露骨表达规则，禁止把材料标签当指令。
3. client.ts/image.ts 覆盖明确拒绝，包括 SSE 先输出内容再拒绝、HTTP 错误中的结构化 code。
4. 确认 invalid 不重试，不进入下游，不保存部分成功；不要扩大普通超时重试行为。
5. 检查 Web/iOS 现有错误页能展示简洁说明，只有证据证明需要时改兼容代码。

出口：标签不会单独拦截；明确拒绝只尝试一次对应调用，后续阶段为零。

### R5：封面资料与视觉概念协议

1. 新第一次调用替换题材代号协议，来源证据对实际 prepared metadata 验证。
2. 新第二次调用输出 JSON 视觉概念；沿用原 temperature/token/timeouts，不引入 response_format 依赖。
3. 实现 malformed 的确定性降级，和拒绝/网络失败严格区分。
4. 测字段缺失/类型错误/超长/围栏/错误引用/材料注入/年龄未知。
5. 确保图像阶段看不到原始简介里的无关露骨细节或标签；不宣称第一轮也一定不会看到必要原材料。

出口：两次调用输入输出契约确定，schema 失败无额外“纠错”调用。

### R6：封面渲染、进度、入口接入

1. 新四层 renderer 替换重复 romance/genre 拼接；新路径不调用旧关键词物件映射。
2. 实际 size 对应比例；文字开关、构图、风格和 UTF-16 分块预算统一。
3. 进度保留模板直到 JSON 完整校验，通过后一次更新成品 prompt，取消时不写迟到数据。
4. 同步/异步 prompt、直接 auto、retry、启动恢复都接入；新任务默认 pipeline=3，metadata template=3。
5. exact 零文本调用，编辑后的 prompt 不重新分析；final payload/task/candidate 一致。

出口：请求级验证覆盖所有封面入口；旧任务 v2 仍可恢复。

### R7：跨链路回归与对照样本

1. 完整执行下一节矩阵，保留旧 B6 六个 fixture ID，新协议调整 mock 响应，不偷改 auto 为 exact。
2. 新增自写素材样本：机场重逢、平等调查搭档、无人物环境、象征封面、旧画像冲突、仅 R18 标签、非露骨成年恋爱、明确拒绝。
3. 输出六组新旧对照：三组封面最终图像 payload，三组创作最终 messages（续写、新章、大纲）。原始样本/来源块/降级/版本/长度/逻辑与实际请求数一并记录。
4. 对照由纯函数和 mock 生成，显著注明非真实模型产物；禁止运行会调用真实 provider 的 tsx 临时脚本。

出口：每项验收对应实际用例名；没有只对常量求和的预算证明。

### R8：收口与执行交付

1. 按第 11 节执行可运行验证，修复本轮引入的错误。
2. 检查 diff，仅本轮文件；版本分流/旧数据/错误语义/费用边界逐项自审。
3. 更新验证记录和本文状态（仅完成后更新），旧历史文档只追加链接/勘误，不覆盖过去结果。
4. 提交给用户的报告列完成片、命令结果、未验证项、已定决策偏差；不得写“上线可用/质量提升已证明”。

## 10. 验收矩阵和调用预算

| ID | 契约 | 必须观察的证据 |
| --- | --- | --- |
| PA01 | 来源边界 | 注入字符串仍在序列化资料值，系统规则不被改写 |
| PA02 | 来源范围 | 续写起点之后章节不进入新请求，重试用冻结画像 |
| PA03 | 关系去偏见 | 通用 prompt 无预设从属/施舍，允许平等或未知；有证据的控制关系不被强制美化 |
| PA04 | 风格/状态分离 | 当前处境不再是风格提取目标；旧画像带时点与低于新正文的约束 |
| PA05 | 单章任务 | 只当前 chapterGoal；不追加下一章标题；outline 不套章节要求 |
| PA06 | 道具证据 | 项链不成婚戒，机场不成火车票，消息不成书信；无资料不造成人年龄 |
| PA07 | schema | malformed/超限/错误 factIds 降级可解释；无第三次文本调用 |
| PA08 | 构图和美术 | preset×composition×renderTitle 参数化，不产生两套强制主视觉 |
| PA09 | 长度和尺寸 | 100/800/2000/10000，emoji/长姓名，实际比例与 prompt 一致 |
| PA10 | exact | trim 后完全相同，文本调用=0，不添加版本/风格/安全改写文字 |
| PA11 | R18 标签 | 独立标签不整单拒绝；R180 不误删；原标题/作者和 exact 不变 |
| PA12 | 拒绝 | text JSON/SSE/image 明确拒绝一次尝试，后续零调用，无成功候选/部分草稿 |
| PA13 | 错误区分 | 401/普通400/超时/length/空响应不全归为内容拒绝 |
| PA14 | 进度 | 半 JSON 不显示成品；取消后无迟到 candidate/result |
| PA15 | 版本 | 老任务缺字段跑旧协议，新任务冻结版本，unknown fail，旧 metadata 可读 |
| PA16 | 幂等 | 同 operation/clientRequestId 不新增调用与候选，恢复不重写已完成章 |
| PA17 | 最终一致 | image payload.prompt=最终任务prompt=候选prompt |
| PA18 | 画像持久化 | 新字段往返、旧 source 可读、人工 revision/base hash 原契约不变 |
| PA19 | 测试隔离 | 故意请求未知外部 URL 被桩拒绝，执行期间零真实出站 |
| PA20 | 配置兼容 | 管理员自定义 writingSystemPrompt 保留，模型/token/温度/size 原值不变 |

成功路径逻辑预算：

| 流程 | 文本 | 图像 |
| --- | --- | --- |
| auto 直接封面 | 2 | 1 |
| 独立 prompt | 2 | 0 |
| 预生成后 exact | 前半程2，后半程0 | 后半程1 |
| 无文本配置的 auto 模板 | 0 | 1（仍需图像已配置） |
| 单章/大纲 | 1 | 0 |
| N 章续写 | N | 0 |
| 各类画像显式提取 | 每类1 | 0 |
| B6 四 auto+两 exact | 8 | 6 |

计数必须在最终 HTTP mock 层统计 method+URL，区分 chat/chatStream、图像与图片下载；同一逻辑调用因普通网络重试产生的请求另列 attempt 数。明确拒绝不得触发普通网络重试。调用上限不意味着此次获得真实调用授权。

## 11. 可执行验证命令与平台边界

API/Web 仓库根目录，每条独立执行，检查实际退出码，不用后项成功覆盖前项失败：

```powershell
npm run test --workspace=@zhi-zhou/api -- --run src/services/ai/writing.test.ts src/services/ai/cover.test.ts src/services/ai/cover-prompt.test.ts src/services/ai/cover-styles.test.ts src/services/ai/cover-romance.test.ts src/services/ai/phase2-fixtures.test.ts
npm run test --workspace=@zhi-zhou/api -- --run src/routes/ai.test.ts
npm run typecheck
npm run lint
npm test
npm run build
git diff --check
```

新增 prompt-material/prompt-policy/writing-prompt/cover-brief/client/image/画像测试加入目标命令；先确认文件存在与 workspace 脚本，不照抄不存在路径。全测试保留实际 Web/API 用例数，不引用旧轮数量充当新结果。

iOS 仓库只新增文档时运行 git diff --check。若改 Swift/模型/error 展示，则按脚本实际参数运行 scripts/admin-operation-smoke.ps1、ai-cover-phase2-smoke.ps1、image-cache-smoke.ps1、navigation-smoke.ps1 中相关项，记录 PowerShell 版本。无 macOS/Xcode 明确原生编译、真机 UI 和流式体验未验证，不用静态 smoke 替代。

文档引用的三方协议若需要核实，仅查官方资料；不进行真实模型探测。优先现有依赖，不为 schema 引入新库；若现有工具无法满足兼容要求，交回 Astra。

## 12. 完成定义及交接指令

完成必须同时满足：新创作五层和封面两阶段四层接生产；版本与旧任务恢复覆盖；R18 标签和真实拒绝区分；mock 最终请求及预算证明；六组新旧对照；每片独立验证记录；无真实模型访问；无提交/推送/部署。

真实质量验证另行授权后做固定作品/参数的盲评，评价事实准确、人设连续、文风、章节推进、封面贴题、构图、文字与缩略图表现。本轮不申请、执行或预支该预算。

可交给 Luna MAX 的指令：

> 按 docs/ai-prompt-architecture-luna-execution-plan-2026-09-11.md 的 R0–R8 顺序落实创作与封面提示词架构重构。以本文 Astra 已定的数据来源、分层、两次封面文本调用、结构化输出、进度展示、版本兼容和 R18 素材/拒绝处理为准。先完成封闭网络 mock 与真实覆盖盘点，关键缺陷先处理；每片更新独立验证记录，交付六组新旧对照。保留 exact 原样语义、现有幂等、候选历史和来源快照；不自动刷新旧画像。不使用子代理，不调用任何真实模型，不提交、不推送、不部署，不扩展向量库、章节检索、参考图、局部改图、角色卡或全站重构。新的架构、产品和预算取舍交回 Astra，常规实现错误自行修复。缺 macOS 时完成可运行验证并明确原生未验证项。
