# iOS 阅读器节拍指令

源码候选：`1.1.0 / build 22`，基线 `021d4c42`。此记录不表示已构建或发布 IPA。

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

已通过短时 Node 桥接检查：同种子同操作与 Web 引擎逐步一致，覆盖五种结局、等待／许可暂停恢复、运行中断暂停、丢弃、独立实例和记录验证；资源源码一致性、摘要以及差异检查通过。未运行完整测试套件、截图、浏览器自动化或远程构建。

已补充 `ZhiZhouTests/ReaderEdgeRuntimeTests.swift`，检查原生资源加载、Codable、暂停阶段、本机账号／站点隔离及异常时长格式化。当前 Windows 环境未执行这些 XCTest，也未验证 Swift 编译。后续在 Xcode 中使用 `ZhiZhouReaderTests` scheme，并仅选择 `ReaderEdgeRuntimeTests` 即可定向运行。

真机仍需确认：小屏和辅助功能字号的工具栏／状态条布局、滚动和分页切章、收起面板后继续、权限失效即时清理、锁屏／来电／耳机切换后的暂停、静音与语音、记录保存和清空。未构建新 IPA、未部署或发布，也不代表已完成设备验收。
