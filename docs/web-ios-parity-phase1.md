# Web / iOS 第一批对齐

## 实现范围

- iOS 阅读设置 GET/PUT 使用 `device=ios`，保留当前账号的本地设置和未同步改动。服务端首次拆分时从旧 mobile 分区继承，之后 Web mobile 与 iOS 独立进行 LWW 合并。账号内容模式仍走现有授权流程。
- 增加 `readerIllustrations`，默认显示，支持本地保存与同步。
- 在线章节通过 `/api/chapters/:id/illustrations` 读取插图，并校验 contentHash 与当前正文一致。章首、章末及段落位置遵循 Web 锚点规则；正文变化时只接受唯一文本或唯一上下文，无法定位时显示提示。
- 滚动模式按位置插入并使用 width/height 预留图片空间；分页模式在对应正文字符边界增加独立图片页。正文 UTF-16 坐标不增加占位字符，重新分页时优先保留当前图片 ID 或正文字符位置。
- 图片段评增加可选 imageUrl；图片请求根据想法 ID 构造本站接口，不直接信任返回的任意资源 URL。文字段评兼容旧响应。
- 两类图片都支持重试、大图和 1–4 倍缩放；只在当前视图会话内持有解码图片，通过 Bearer 请求，无磁盘缓存或主动离线下载。账号、内容模式或授权 revision 改变后拒绝迟到结果。
- 纯文本段落按每个非空行拆分，与 Web 的基本段落规则一致。复杂 HTML 或 Web 的特殊清洗/长段回退产生不同段落时，失效锚点不猜测位置。

## 回归用例

- Core：章首/章末、重复段落、唯一上下文、索引失效、UTF-16/emoji 哈希、LWW 插图开关、布局分段的完整文字覆盖与顺序。
- 原生 UI：插图查看/隐藏/恢复、大图、失败后重试、图片段评、分页插图前后切换。场景使用 VisualAudit 的 media / media-retry 固定数据。
- 现有本地检查：reader-settings-sync-smoke.ps1、reader-smoke.ps1、image-cache-smoke.ps1。

## 验证边界

本地已通过：阅读设置／阅读器／图片缓存三份 PowerShell 静态检查、Swift 语法树检查、Impeccable 检测和 git diff --check。Web/API 仓库现有 reader-settings、chapter-illustrations、thought-images 共 21 个相关测试通过；它们验证服务端契约，不代替原生客户端测试。

Windows 本地静态检查和 Swift 语法树检查不代表 Swift 类型检查、TextKit 运行或真机验证。新增 Core 用例需在 macOS 上运行 `swift test --package-path ZhiZhouCore`；UI 用例由现有 Native frontend audit 在 iPhone/iPad 模拟器执行。

仍需原生构建及设备验收：中途阅读时隐藏/恢复插图、迟到元数据、不同尺寸图片加载、屏幕旋转、Dynamic Type、切章/退出/关闭 R18 时的图片消失、403 拒绝后禁止继续展示。后端必须已部署 ios 分区与插图/图片段评接口。
