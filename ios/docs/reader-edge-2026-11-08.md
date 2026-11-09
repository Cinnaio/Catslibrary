# iOS 阅读器节拍指令

历史已构建版本：`1.1.0 / build 22`，功能源码 `950f549a`，编译修复及构建源码 `0443b21cc4662eb3038ec1efb95d1866c8256a22`。该未签名 IPA 已下载核对，尚未签名安装或真机验收；不包含下述 2026-11-09 新玩法。

## 玩法补齐（2026-11-09，未发布源码）

基于玩法提交 `35c5ef33`，原生面板补齐三幕／冲刺、时间银行、申报时机三项规则，支持两档申报和银行三项兑现。设置开局后锁定，声音与显示仍可调整；加时范围统一为 45–300 秒，旧值通过共享归一化处理。兑现理由直接显示在操作行内，申报操作在窄屏时纵向排列；状态条补充当前幕、银行余额与时机提示。

`ReaderEdgeSession` 接收共享引擎计算的 `feedback`，包含时机提示、冲刺标识及兑现条件；点击仍由共享 reducer 推进时间后重新判定。豁免不跳过等待或冲刺，无效操作不扣点；缩短立即重算冲刺，银行只累积绿／黄阶段。关闭时机规则时不显示提示和第二档申报，恢复固定 +5% 奖励。提前兑现许可的倒计时使用实际许可窗口，暂停时保持。

本机设置保留三个规则开关的明确 `false`，记录新增 `grinds`、`spent` 并展示六项汇总。旧记录通过共享读取器补齐 0 后再进入 Swift Codable，存储目录、账号／站点隔离与 30 条上限不变。桥接 catalog 共享标签、说明和加时范围，Swift 不复制规则算法。

本地已通过 29 项共享引擎／Web 定向回归及 Web 类型检查；Node 桥接检查覆盖三项银行操作、开关与加时归一化、反馈和历史汇总，与共享引擎逐步对照一致。生成资源 `--check`、Python 摘要和 Git 差异检查通过。这些结果验证 JavaScript 规则和资源，未执行 Swift 原生代码。

本轮只完成源码及本地检查，不生成 IPA；当前版本来源仍为 `ios/project.yml` 的既有 `1.1.1 / build 23` 候选，新功能正式交付前另按发布规则调整版本。此前 build 22 的成功记录不能作为本轮 Swift 编译证据。新增原生测试覆盖开关持久化、旧加时／记录兼容、银行操作及汇总，仍需在 macOS 的 `ZhiZhouReaderTests` scheme 中定向运行 `ReaderEdgeRuntimeTests`。设备验收还需包含小屏／大字号两档申报、银行原因说明与提前许可倒计时。

## 云构建跟进

源码 `950f549a` 已提交并推送。2026-11-08 23:11（Asia/Shanghai），首轮 [iOS 构建 42493216217](https://github.com/Cinnaio/zhi-zhou/actions/runs/42493216217) 在 `ReaderView.body` 遇到 Swift 类型推断超时；Core 测试和资源摘要检查已通过，未产出 IPA。修复提交 `0443b21c` 将阅读器布局、弹层和生命周期拆成独立的 opaque View 表达式，保留既有状态拥有者与修饰顺序；首轮没有交付安装包，因此继续使用同一 `1.1.0 / build 22` 候选重建。

[iOS 重建 42493817400](https://github.com/Cinnaio/zhi-zhou/actions/runs/42493817400) 于 23:23:07 成功完成。macOS 15、Xcode `26.3 / 17C529` 下 97 项 Core 测试全部通过，Release 构建、规则资源摘要和隐私清单检查通过。工件 `ZhiZhou-unsigned-ipa`（ID `13623110799`）已下载，ZIP 完整性、版本／构建号、最低系统 26.0、隐私清单及网络传输配置正确；随包规则与源码在统一换行后完全一致。产物摘要及配套 Web `1.2.0` 部署结果见 [交付记录](../../docs/releasing.md#阅读器节拍功能交付2026-11-08)。

## 入口与会话

- 在线阅读且成人内容权限确认后，阅读器顶部计时图标直接打开 SwiftUI 面板；普通计时不再提供。没有独立网页登录或远程脚本。
- `ReaderView` 持有 `ReaderEdgeStore`，章节与面板不拥有会话。同书切章、加载章节、收起面板继续计时；换书、换账号、撤销权限及退出阅读器清理会话和声音，不记录未结束的结果。
- `ReaderEdgeBar` 在正文前占位，不覆盖滚动或分页正文。节拍子视图观察 tick，正文不订阅 session。面板展开时阅读统计和自动滚动暂停，收起后恢复原阅读流程。
- 使用单调时间累计前台时长；后台、音频中断、耳机插拔或超过两秒的运行间隔暂停，回来手动继续。暂停保留等待或许可阶段。
- 声音默认关闭；合成节拍与状态语音由 AVFoundation 提供，遵守静音，不申请后台音频。语音不朗读整条指令。隐藏剩余时间同时作用于面板、状态条和无障碍读数，减少动态时只保留静态相位指示。

## 规则维护

规则与既有内容只维护 `web/src/lib/edge.ts`。`ios/scripts/reader-edge-adapter.js` 仅封装 JSON 桥接和内存读取适配，`ReaderEdgeRuntime` 使用 JavaScriptCore 执行随包纯逻辑。不要手改生成的 `ZhiZhou/Resources/ReaderEdgeRuntime.js`。

在仓库根目录运行：

```powershell
node ios/scripts/sync-reader-edge.mjs
node ios/scripts/sync-reader-edge.mjs --check
node ios/scripts/check-reader-edge.mjs
python ios/scripts/check-reader-edge-resource.py
```

生成步骤使用仓库现有 TypeScript 依赖；资源提交后，Xcode 构建不需要 Node。`project.yml` 将资源显式列入 resources，手动构建工作流使用 Python 标准库校验源码与资源摘要，避免打包过期或被手改的规则。桥接接口返回 JSON，Swift 不重新实现随机算法、规则或指令池。

## 本机数据

`Application Support/reader-edge-v1/` 下的文件名由站点地址和账号 ID 的 JSON 元组做 SHA-256 得到，同账号不同作品共享设置和记录。文件只包含 settings 与最多 30 条已结束记录，不包含令牌或进行中的会话；目录排除系统备份，文件采用原子写入和完整文件保护。

读取复用共享引擎的验证、归一化、去重与数量限制。损坏或不可读文件保留原样，当前会话可继续，未保存更改在内存中保留并可重试；清空记录需确认，保留设置，不触及阅读数据。不跨账号、站点或设备同步。

## 已做检查与待验收项

2026-11-08 初版源码通过短时 Node 桥接检查：同种子同操作与 Web 引擎逐步一致，覆盖五种结局、等待／许可暂停恢复、运行中断暂停、丢弃、独立实例和记录验证；资源源码一致性、摘要以及差异检查通过。初版远程构建和产物核对已完成，未追加完整测试套件、截图或浏览器自动化。

已补充 `ZhiZhouTests/ReaderEdgeRuntimeTests.swift`，检查原生资源加载、Codable、暂停阶段、本机账号／站点隔离及异常时长格式化。云端已完成应用 Swift 编译，但标准构建工作流仅运行 `ZhiZhouCore`，未执行这些 XCTest。后续在 Xcode 中使用 `ZhiZhouReaderTests` scheme，并仅选择 `ReaderEdgeRuntimeTests` 即可定向运行。

真机仍需确认：小屏和辅助功能字号的工具栏／状态条布局、滚动和分页切章、收起面板后继续、权限失效即时清理、锁屏／来电／耳机切换后的暂停、静音与语音、记录保存和清空。IPA 未签名，未执行 App Store／TestFlight 上架；构建与包内容检查不代表设备验收。
