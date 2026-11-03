# AI 第二批 B0–B6 验证记录

更新时间：2026-09-10

本记录只覆盖 `docs/ai-phase-2-execution-plan-2026-09-10.md` 定义的第二批范围。状态词固定为：`自动通过`、`已实现待运行`、`待补测试`、`发现缺陷`。其中“已实现待运行”表示代码路径或静态检查已存在，但当前 Windows 环境没有 macOS/Xcode，尚未完成 Swift 编译、模拟器 UI 或真机运行；“待补测试”表示第一批没有形成对应的精确回归契约，不能把邻近测试当作覆盖。

## B0 基线与第一批实际覆盖

### 可复现证据

| 检查 | 结果 | 边界 |
| --- | --- | --- |
| API AI 目标测试：`src/routes/ai.test.ts`、`src/services/ai/writing.test.ts`、`src/services/ai/cover.test.ts` | 自动通过，3 个文件、94 tests passed | 只证明 API/服务端契约与 mock provider 路径 |
| iOS `scripts/admin-operation-smoke.ps1` | 自动通过 | 静态入口/操作脚本，不是 XCUITest |
| iOS `scripts/image-cache-smoke.ps1` | 自动通过 | 缓存脚本，不覆盖真实网络与账号切换 |
| iOS `scripts/navigation-smoke.ps1` | 自动通过（修复后） | 只检查源码导航模式 |
| PowerShell | `7.6.5`；另以 `powershell.exe`（Windows PowerShell 5.1）复跑 | 两个解释器均通过；脚本已改为 UTF-8 明确读取，并避免 5.1 对双引号正则的解析差异 |
| Swift/Xcode 命令 | 未发现 `swift`、`swiftc`、`swift-format`、`xcodebuild`、`xcodegen` | 需 macOS 执行 Core/Release/UI 验证 |

导航 smoke 的首次失败是测试脚本自身的 PowerShell 5.1 解析/源码编码问题，不是产品导航断言失败。修复保持原断言语义：正则改用单引号、源码以 UTF-8 读取、失败信息不依赖嵌套插值；修复后两个 PowerShell 版本均通过。

### 第一批覆盖矩阵

| 编号 | 第一批实际回归覆盖 | 状态 | 仍需补齐或运行 |
| --- | --- | --- | --- |
| D01 | AI 生成大纲/章节任务、草稿与发布 API | 自动通过 | iOS AI 任务页实际点击链路 |
| D02 | 草稿编辑/保存相关 API 响应 | 自动通过 | iOS 编辑后重载与发布 UI |
| D03 | 章节草稿与正式章节分离的服务端契约 | 自动通过 | 跨页面状态回归 |
| D04 | 发布事务错误响应由 API 返回 | 自动通过 | iOS 失败提示与重试显示 |
| D05 | 关闭/离开页面不等于发布未覆盖 | 已实现待运行 | 模拟器生命周期操作 |
| D06 | 保存后返回列表的 API 基础路径 | 已实现待运行 | UI 导航与列表刷新 |
| D07 | 发布事务化 | 自动通过 | 真实数据库事务回归仍需 macOS/CI 以外的 PGlite 增量测试确认 |
| D08 | 重复发布、软删除、取消发布及大纲发布限制 | 自动通过 | UI 权限态 |
| D09 | 发布结果与章节状态关联 | 自动通过 | 端到端页面重进 |
| C01 | `cleanWritingTail` 与续写锚点处理 | 自动通过 | 长文本 Unicode 边界样本 |
| C02 | 多章上下文拼接 | 自动通过 | 真实模型输出质量未验证 |
| C03 | 续写起点快照/冻结参数 | 自动通过 | 重试 UI |
| C04 | 画像来源快照与调用链 | 自动通过 | 人工画像第二批改动前的覆盖 |
| C05 | 源章缺失/损坏 | 待补测试 | 需要精确错误契约 |
| C06 | 采样序号连续性与排序间隙 | 待补测试 | 需要固定章节夹具 |
| C07 | 锚点越界、空章、无章节 | 自动通过 | UI 禁止启动 |
| C08 | 新增章节不污染已冻结快照 | 待补测试 | 需要并发/重载夹具 |
| C09 | 来源修改/删除后的任务行为 | 待补测试 | 需要明确错误码矩阵 |
| C10 | 按原参数重试 | 自动通过 | UI 入口未在模拟器执行 |
| C11 | 断点恢复 | 自动通过 | macOS 任务生命周期 |
| C12 | 已删除结果不回写当前数据 | 自动通过 | 跨账号运行 |
| C13 | iOS 章节加载失败时禁止启动 | 已实现待运行 | XCUITest 网络失败注入 |
| C14 | 过期画像响应不覆盖新请求 | 自动通过（Web stale-style 测试及 Core 请求守卫） | iOS UI 实际请求序列 |
| P01 | 纯故事封面不注入正文 | 自动通过 | UI prompt 模式切换 |
| P02 | 封面元数据随候选保存 | 自动通过 | 真实图片渲染未验证 |
| P03 | prompt mode 归一化 | 自动通过 | 组合控件 UI |
| P04 | 非法 prompt mode 拒绝 | 自动通过 | 客户端错误提示 |
| P05 | exact 模式字段约束 | 已实现待运行 | 模拟器完整编辑流程 |
| P06 | 无文字模式的负向约束 | 已实现待运行 | 图片视觉验收 |
| P07 | exact 元数据保持 | 自动通过 | 预览与保存的一致性 |
| P08 | variation 幂等 | 自动通过 | 网络重放夹具仍需加强 |
| P09 | 通用幂等冲突 | 待补测试 | 需要跨动作 scope 样本 |
| P10 | 失败重试保持 mode/prompt/variation | 待补测试 | 需要任务重试夹具 |
| T01 | iOS 任务提交后后台刷新 | 已实现待运行 | SwiftUI 运行时 |
| T02 | SSE 优先、轮询回退 | 已实现待运行 | 断网/后台恢复 |
| T03 | 状态终态停止刷新 | 已实现待运行 | 运行时计时断言 |
| T04 | 账号隔离 | 自动通过 | Core coordinator 单测 |
| T05 | 会话失效清理 | 自动通过 | UI 登出链路 |
| T06 | 旧回调不能清新任务 | 自动通过 | Core coordinator 单测 |
| T07 | 中断任务恢复 | 自动通过 | 模拟器杀进程 |
| T08 | 旧 pending 无 payload 不猜重放 | 自动通过 | Core coordinator 单测 |
| T09 | SSE 失败回退 | 已实现待运行 | 真实网络故障注入 |
| T10 | 任务列表与终态展示 | 自动通过 | iOS 任务页运行 |
| T11 | generation 列表/详情 | 待补测试 | 需要固定响应夹具 |
| T12 | 旧服务端缺新端点 | 待补测试 | 需要 404 兼容样本 |
| T13 | 封面更新反馈 | 自动通过（API） | UI 刷新/错误提示 |
| T14 | 封面候选采纳 | 自动通过（API） | UI 预览与采纳 |
| T15 | 取消任务 | 已实现待运行 | API、Core、UI 三段联测 |

第一批关键 Core 覆盖集中在 `AITaskCoordinatorTests.swift`：同 key 合并、参数变化隔离、中断恢复、账号隔离、旧回调保护、失效清理，以及旧 pending 无 payload 不猜重放。Web 当前只有 AI 写作 stale-style 精确测试；`VisualAudit.swift` 提供固定 fixture/scenario 开关，但没有覆盖第二批 AI 写作/封面完整交互。以上缺口在后续 B1–B6 中只补与本批契约直接对应的测试，不扩展到向量库、参考图、局部改图或全站重构。

## B0 结论

- 第一批 API 关键回归当前为自动通过，未发现需要改变来源信任、幂等架构或预算策略的产品/架构缺陷。
- 已发现并修复一个可执行验证缺陷：导航 smoke 在 Windows PowerShell 5.1 下因脚本解析与 UTF-8 读取方式失败；修复后通过。
- macOS Core、unsigned Release、XCUITest、真机与真实网络/后台恢复仍未验证；第二批各片完成后继续在本记录追加证据。

## B1–B6 实施记录

| 切片 | 状态 | 实现/验证记录 |
| --- | --- | --- |
| B0 | 自动通过 | 覆盖矩阵建立；API 94 tests、admin/image/navigation smoke 通过；导航脚本兼容性修复见上文 |
| B1 | 自动通过（API）/已实现待运行（iOS） | writingBrief V1 校验、任务 params 冻结、每章目标注入及旧请求兼容已由 API 目标测试与 writingBrief 单测覆盖；iOS 已接入折叠式详细要求、Unicode 计数、降章确认和稳定请求 payload，待 macOS Swift/UI 运行 |
| B2 | 自动通过（API）/已实现待运行（iOS） | 迁移 030、新人工画像服务、三类 getter 的最终选择、PUT/DELETE revision 与 base fingerprint 冲突保护已由 PGlite API 测试覆盖；续写快照冻结最终画像、来源、人工 revision 与基底 revision；iOS 已显示自动/人工/最终来源并提供独立编辑/清除 sheet，待 macOS Swift/UI 运行 |
| B3 | 自动通过（API）/已实现待运行（iOS） | `rewrite_selection` 冻结 UTF-16 选段、建议/应用分离、版本冲突和同 operationId 重放已由 API 路由/服务单测覆盖；iOS 详情页已接入真实 NSRange 选择、建议预览、复制、不可应用状态提示、应用和网络重试，待 macOS Swift/UI 运行 |
| B4 | 自动通过（静态）/已实现待运行（iOS） | iOS 封面对比固定当前封面、最多两张候选、2:3 aspectFit、exact 元数据和完整提示词编辑已实现；`ai-cover-phase2-smoke.ps1` 在 PowerShell 7.6.5 与 Windows PowerShell 5.1 均通过，待 macOS 小屏/iPad UI 运行 |
| B5 | 自动通过（API）/已实现待运行（iOS） | 迁移 031、采纳/上传/恢复统一事务、外部旧图物化与失败/换源 409、历史鉴权图片、同图去重、回滚、跨书访问、恢复幂等、10 条/50 MiB 清理和删除级联已由 PGlite 路由回归覆盖；iOS 历史预览/确认/版本恢复已实现，待 macOS Swift/UI 运行 |
| B6 | 自动通过（夹具）/已实现待运行（质量） | 固定 6 组续写与 6 组封面需求、声明调用预算和盲评记录模板已建立；质量评分、真实 token/耗时/费用保持未验证，不调用真实付费模型 |

所有验证均在本地进行，当前不提交、不推送、不部署，也未调用真实付费模型。macOS 缺失，因此 Swift 编译、Core 单测、unsigned Release、XCUITest、模拟器/iPad/真机交互仍未验证；Windows 静态 smoke 不能替代这些运行时结论。

## 收口证据（2026-09-10）

| 检查 | 结果 |
| --- | --- |
| API/Web `npm test` | 自动通过：Web 14 个测试文件 / 50 tests，API 31 个测试文件 / 294 tests |
| API/Web `npm run typecheck` | 自动通过（Web 与 API） |
| API/Web `npm run build` | 自动通过；仅保留既有 Vite 大 chunk warning |
| API/Web `npm run lint` | 自动通过，0 errors / 87 warnings；warning 数与本批前收口基线一致，未新增本批 error |
| 两仓库 `git diff --check` | 自动通过；仅有 Windows 换行格式提示 |
| iOS `admin-operation-smoke.ps1`、`ai-cover-phase2-smoke.ps1`、`image-cache-smoke.ps1`、`navigation-smoke.ps1` | PowerShell 7.6.5 与 Windows PowerShell 5.1 均自动通过 |

以上命令均只在本地工作树运行；工作树保留未提交改动，没有执行 commit、push、deploy、生产迁移或真实文本/图像模型调用。
