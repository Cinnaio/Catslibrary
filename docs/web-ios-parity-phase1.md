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

## 插图列表 404 编码回归修复

ReaderMediaAPI 会先编码章节及插图 ID，旧 APIClient.makeURL 再用 appendingPathComponent 组合路径，导致 `%5F` / `%2D` 再次变为 `%255F` / `%252D`。服务端解码一次后得到错误 ID，插图列表返回 404，阅读器显示“插图暂时无法加载，正文可继续阅读”。图片二进制请求使用同一构造入口，也受影响。

APIRequestURL 现在用 URLComponents 的 percentEncodedPath / percentEncodedQuery 分别组合基址、路径与查询，保留编码一次的 ID，同时保留服务端基址子路径和现有内容模式参数。未调整章节权限、授权检查、缓存策略或插图开关。

线上普通章节只读探测：原始 ID 和编码一次的 ID 返回 200，重复编码的 ID 返回 404。新增 Core 用例覆盖插图列表经 ContentPolicy 后的完整 URL、二进制图片、保留字符、中文、查询编码和服务器子路径。VisualAudit 的插图列表必须匹配真实章节 ID，避免通配响应再次掩盖错误 URL。Windows 无 Swift/Xcode，这些 XCTest 和原生 UI 用例仍需在 macOS 执行。

## 段评定位和波浪线回归修复

旧 iOS 仅按 paragraphIndex 分组，未检查已保存的 paragraphHash；正文插入段落或两端段落序号不同时，段评会被挂到错误段落，selectedText 在错误段落内匹配失败，引用高亮也随之消失。

现在先验证原索引的指纹，再按唯一指纹重定位；没有指纹的历史数据只接受有效索引。旧 CR-only 整章源锚点在全文指纹仍匹配时按唯一引用定位。指纹失效或重复且无法消歧的数据进入“原段落已变更的想法”查看入口，不猜测位置。加载/发布时计算定位缓存，不在滚动过程中重复计算全文哈希。

引用匹配采用与 Web 一致的空白规范化，并映射回原文 UTF-16 范围，覆盖连续空格、全角空格、换行和 emoji；没有具体引用的段评标记整个段落。滚动与分页都使用 ThoughtWaveLayoutManager 的逐行波浪下划线绘制，保留原生 UITextView 选字、复制与编辑菜单。

新增 7 个 Core 用例和一个移动段评的 UI/截图用例。既有静态检查及 Swift 语法树检查通过；Web 对照的 thought-anchors / reader-utils 共 23 项测试通过。这些不代替新增 iOS XCTest、原生编译及波浪线的设备视觉验收。复杂 HTML 或 Web 广告清洗使正文文本不同的记录仍可能进入无法定位分组，避免错误挂载。

## 阅读页闪退：TextKit 根对象持有修复

13cfeac 引入的文本视图初始化把 NSTextStorage 和自定义 NSLayoutManager 放在 if 块内，离开该作用域后才将 NSTextContainer 交给 UITextView。Apple 的 UIKit 声明中，NSTextContainer.layoutManager 和 NSLayoutManager.textStorage 都是 unowned(unsafe) 反向引用；只保留 container 无法保活整个对象链。优化编译允许局部根对象提前释放，UITextView 初始化可能接收到悬空的布局管理器。这一缺陷可影响没有段评的普通正文，与插图网络请求是否成功无关。

ThoughtSelectableTextView 现在在调用 super.init 之前把根 NSTextStorage 保存为强引用属性，并保持到文本视图销毁；外部传入的文本系统及 coder 初始化保持原有路径。保留插图 URL、段评锚点和波浪线功能。

新增 ZhiZhouTests 原生测试目标及 4 项测试：默认初始化后的正文布局、多尺寸测量、初始化局部变量退出后的波浪线绘制、外部文本系统保持、视图销毁后对象链释放（前两项合并在同一测试方法）。Native frontend audit 在交互测试前以 -O 运行这些测试，覆盖仅在优化编译中出现的对象生命周期问题。

当前 Windows 无 UIKit / Xcode，尚未原生执行修复前的崩溃复现及修复后的测试；这是基于源码与官方对象持有契约确认的生命周期缺陷，不替代具体设备崩溃堆栈及修复包验收。
