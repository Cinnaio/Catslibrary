# Web / iOS 第二阶段对齐

第一批提交：`2d33da3`（独立 iOS 阅读设置、章节插图、图片段评）。第二阶段按用户要求提交、推送，并核对对应提交的 macOS 构建和下载工件；实际结果以对应 Actions run 和本地 build-run.json 为准。

## 范围

按用户要求排除作品评分和作品评论，不增加对应入口、接口或数据模型。“我的想法”仅汇总已有的阅读段评，沿用第一批的图片段评支持。

| 功能 | 入口与行为 | 接口 |
| --- | --- | --- |
| 登录设备 | 我的 → 账户与安全 → 登录设备；标记当前设备，退出其他设备；退出全部设备需确认，成功后清理本机账号状态 | GET/DELETE `/api/auth/sessions`、POST `/api/auth/logout-all` |
| 书签 | 阅读器更多菜单保存章节，编辑 300 UTF-16 单元内的备注或删除；书架 → 我的书签查看、跳转、编辑 | GET/POST/DELETE `/api/bookmarks` |
| 我的想法 | 书架独立入口；每次读取 50 条，继续加载直到 totals 指定的总数；包含引用、文本和已有图片，点击文字进入所属章节 | GET `/api/bookshelf?limit=50&offset=...` |
| 发现页 | 保留分类与搜索，增加全部/连载中/已完结；更新时间降序、书名升序、章节数降序 | GET `/api/novels` 的 status/sort/order |
| 自动滚动 | 更多菜单选择慢/中/快三档，18/32/52 pt/s；沿用 readerAutoScrollSpeed 设置同步；默认关闭，每次进入章节需主动启动 | 现有 iOS 阅读设置分区 |
| 前情提要 | 服务端开放能力时，第二章起的更多菜单显示；读取上一章的缓存，未缓存需明确点击生成 | GET `/api/ai/status`、GET/POST `/api/ai/recap` |
| 久未阅读回顾 | 详情页按服务端 catchupStaleDays 与阅读进度时间决定是否展示；明确点击生成，处理无进度、不够久、提要不足等响应 | POST `/api/ai/catchup` |

## 行为约束

- 书签按小说/章节单条 upsert 和删除，避免用设备上的局部列表覆盖 Web 或其他设备的书签。备注计数与后端 JS 字符串上限使用同一 UTF-16 口径。
- 书签接口没有正文位置字段；跳转进入对应章节，阅读位置继续服从现有进度机制，不声称提供精确段落书签。“我的想法”也先进入所属章节。
- 已保存记录按当前章节 ID 重新解析目录，避免目录顺序变化后进入错误章节；删除或不可访问的章节提供错误和重试。
- 内容列表用 getReader 保留内容模式和授权隔离；异步结果检查 revision/请求代次，账号变化后拒绝旧结果。图片沿用第一批的本站图片接口和授权保护。
- 设备注销等待服务端成功；退出全部设备复用现有本地账号清理流程。请求绑定启动时的 token。
- 自动滚动使用 CADisplayLink 驱动现有 UIScrollView，不让每帧位移触发 SwiftUI 状态更新；按实际帧间隔计算，单帧最多推进 0.1 秒的距离。用户触摸/拖动、选字、切章、后台、VoiceOver 或图片预览时暂停，章末停止，不自动切到下一章。阅读器设置/目录等面板打开时暂停驱动。
- AI 打开页面只探测能力和读取缓存；生成始终来自用户点击。展示缓存与额度规则，180 秒请求预算；不使用强制重新生成。
- 新操作合并到阅读器更多菜单，避免继续增加顶部常驻按钮。空书架仍能打开书签和想法列表。

## 本地验证

- 既有 PowerShell 检查通过：reader-smoke、reader-settings-sync-smoke、image-cache-smoke、navigation-smoke、content-rating-smoke。
- 服务端既有 bookmarks.validation / bookmarks.crud 共 10 项测试通过，验证单条增删与输入契约；本阶段未修改 Web/API 代码。
- 改动中的 Swift 文件通过语法树检查；Impeccable 检测无命中；git diff --check 通过。这些检查不等同于 Swift 类型检查。
- 新增 Core 用例：60/120Hz 距离一致、长帧限制、底部夹取、负帧间隔和关闭状态。
- 新增 UI 用例：退出其他设备、退出全部设备、书签保存/重读/删除、上一章提要显式生成、久未阅读回顾、51 条想法分页。调整原图片段评用例以从更多菜单进入。VisualAudit 为这些路径提供固定数据。

## 仍需 macOS / 设备验证

当前 Windows 没有 Swift/Xcode，未执行 Core XCTest、原生类型检查、模拟器 UI 用例或真机验收。需执行 `swift test --package-path ZhiZhouCore` 与现有 Native frontend audit，并验证紧凑/常规宽度、Dynamic Type、60/120Hz、自动滚动手势中断及图片预览、分页模式、账号/安全模式切换、网络失败和真实 AI 配额响应。

版本保留 0.1.0 / build 16。构建工作流负责 Core 测试和 Release 未签名 IPA；原生 UI 交互由独立的 Native frontend audit 工作流或设备验收确认。
