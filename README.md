# 知舟 iOS（SwiftUI 原生客户端）

知舟（[zhi-zhou](https://github.com/your-org/zhi-zhou)）的 SwiftUI 原生 iOS 客户端，对接知舟自托管实例的 REST API。**独立于 web/api 仓库**，可在 Windows 上开发，用 GitHub Actions 云端构建，再通过自签（sideload）安装到 iPhone。

## 技术要点

- **SwiftUI + iOS 26+（Liquid Glass 液态玻璃）**，XcodeGen 描述工程（`project.yml` → `xcodegen generate` 生成 `.xcodeproj`，无需本地 Mac 也能被 CI 构建）
- **固定服务器地址**：应用内置硬编码 `https://novel.mscraft.uk`，无需用户配置
- **API 对接**：复用知舟 REST API（`/api/novels`、`/api/chapters`、`/api/auth`、`/api/progress`、`/api/bookshelf`、`/api/auth/reader-settings` 等），字段与仓库 `shared/types.ts` 一一对应
- **鉴权**：Bearer Token 存 Keychain（`ZhiZhou/Networking/Keychain.swift`），登录用 `remember` 长会话
- **阅读设置同步**：与 Web 端互通（LWW 合并，`/api/auth/reader-settings`），键值表与后端 `reader-settings.ts` 完全一致
- **进度同步**：滚动百分比 → `/api/progress`，进入章节自动恢复上次位置
- **设计系统**：`ZhiZhou/Theme/Theme.swift` —— 语义色跟随系统浅/深外观（无强制浅色），阅读器纸面独立主题（跟随系统/护眼/羊皮/夜间）

## 目录结构

```
project.yml                        XcodeGen 工程描述
ZhiZhou/
  ZhiZhouApp.swift                 App 入口
  Support/Info.plist               （含 ATS：开发期允许 HTTP 明文）
  Assets.xcassets/AppIcon.appiconset   App 图标（1024 单尺寸，可替换）
  Models/Models.swift              服务端模型（对齐 shared/types.ts）
  Models/AdminModels.swift         管理后台模型（admin.ts / admin-users.ts / site.ts 返回结构）
  Networking/
    APIClient.swift                类型化 fetch 封装（Bearer token / 超时 / 分页）
    AdminAPI.swift                 管理后台 API（/api/admin*，需管理员身份）
    ServerConfig.swift             服务器地址配置（自托管必配）
    Keychain.swift                 token 安全存储
  Services/
    AppState.swift                 登录会话 + 启动引导
    ReaderSettingsStore.swift      阅读设置（本地 + LWW 同步）
    AdminFormat.swift              管理后台展示格式化（任务状态/举报理由/时间/字节）
  Theme/Theme.swift                设计 token + Liquid Glass 背景
  Views/
    RootView / MainTabView         启动路由 / 三个 Tab（iOS 26 玻璃 Tab 栏）
    LoginView                      登录 / 注册（液态玻璃卡片）
    HomeView / NovelCardView       发现页（搜索/分类/分页，玻璃卡片）
    NovelDetailView                详情 + 章节目录
    ReaderView                     阅读器（核心）
    ChapterListView / ReaderSettingsView
    BookshelfView / ProfileView
    Admin/                         管理后台（原生 SwiftUI，入口在「我的」页，仅管理员可见）
      AdminRootView                管理首页（模块入口）
      AdminDashboardView           总览（内容规模 / 任务状态 / 最近任务 / 最近更新）
      AdminModerationView          内容审核（评论 / 举报 / 想法）
      AdminUsersView               用户与邀请码（注册模式 / 邀请码 / 用户管理）
      AdminPolicyView              内容安全（成人内容开关）
      AdminAnnouncementView        站点公告编辑
      AdminJobsView                任务管理（抓取任务 + 下载日志）
      AdminNovelsView              小说管理（搜索 / 编辑 / 新建 / 删除 / 增量更新）
      AdminChaptersView            章节管理（选书 / 章节 CRUD）
.github/workflows/build-ios.yml    macOS 构建 → 未签名 .ipa
```

> 服务器地址已固定为 `https://novel.mscraft.uk`（`ZhiZhou/Networking/ServerConfig.swift`），不再提供填写/修改入口。

## 开发流程（Windows + GitHub Actions + 自签）

```
1. git init / push 到 GitHub（建议公开仓库：macOS 构建免费）
2. push 触发 Actions（或手动 workflow_dispatch）→ 下载 ZhiZhou-unsigned-ipa artifact
3. Windows 上安装 Sideloadly（或 AltStore）→ 输入 Apple ID 签名 → USB 安装到 iPhone
```

### 自签的三种方式

| 方式 | 费用 | 有效期 | 限制 | 建议 |
|---|---|---|---|---|
| 免费 Apple ID（Sideloadly/AltStore） | 免费 | ⚠️ **7 天**重签重装 | 3 个 App 上限、仅自己设备 | 零成本验证闭环 |
| 开发者账号（$99/年） | $99/年 | 证书 1 年、TestFlight 90 天 | Ad Hoc 限 100 台注册设备 | ✅ 推荐，省心 |
| 企业签名（$299/年） | $299/年 | 1 年 | 需公司资质，监管严格 | 公司内部分发 |

> **免费账号 7 天限制缓解**：用 AltStore（手机与电脑同一网络时自动后台续签，基本无感）；Sideloadly 需要手动重签。
> 换用 $99 账号后建议直接走 TestFlight，彻底摆脱侧载。

### 自签安装步骤（免费 Apple ID 为例）

1. iPhone 上安装 **AltStore**（电脑装 AltServer，手机同网络自动续签）或直接用 **Sideloadly**（Windows 版）
2. 下载 Actions 产出的 `ZhiZhou-unsigned.ipa`
3. Sideloadly：选择 ipa → 填 Apple ID → 安装（首次需在 iPhone 设置里信任证书：设置 → 通用 → VPN 与设备管理）
4. 每 7 天重签一次（AltStore 自动 / Sideloadly 手动）

## 首次使用 App

1. 打开 App（服务器地址已内置为 `https://novel.mscraft.uk`）→ 登录 / 注册（注册模式随服务端 `register-status` 自动切换，邀请制需要邀请码）
2. 发现页浏览/搜索 → 详情页 → 阅读器

## 自托管 HTTPS 证书（TLS 错误排查）

> 本 App 固定连接公网 `https://novel.mscraft.uk`，正常情况无需处理证书。若你替换为自签名证书的服务器，按以下排查：

知舟服务器若使用**自签名证书**（mkcert/openssl 自签）或证书过期/域名不匹配，iOS 会直接拒绝，登录时报
`网络错误：TLS错误导致安全连接失败`。解决：

- **开发期**：在「我的 → 高级」打开 **“信任无效证书（开发用）”** 开关，App 会跳过证书校验。注意这会使连接可被中间人攻击，仅限自用/开发。
- **生产**：请关闭该开关，为域名配置受信任的正式证书（Let's Encrypt / 云厂商证书），并移除
  Info.plist 中的 `NSAllowsArbitraryLoads`。

## 已知限制与后续路线

- [x] 管理后台核心模块（原生 SwiftUI，见下）
- [ ] 离线阅读（SwiftData/Core Data 章节缓存 + 自动下载下一章）
- [ ] 评论 / 段评 / 评分页（API 已就绪，UI 未做）
- [ ] 推送通知（新章节提醒，需自建推送服务，如 APNs + 你的服务器）
- [ ] CI 签名（$99 账号 + GitHub Secrets + fastlane match → 出签名 ipa / TestFlight）

### 管理后台（入口：「我的」→ 管理后台，仅 `role == admin` 可见）

- [x] 总览（内容规模 / 任务状态 / 最近任务 / 最近更新）
- [x] 内容审核（评论 / 举报 / 想法：隐藏、恢复、删除、处理举报）
- [x] 用户与邀请码（注册模式 / 生成·禁用·清理邀请码 / 角色·禁用·重置密码·删除用户）
- [x] 内容安全（成人内容开关）
- [x] 站点公告（编辑并保存，最长 240 字）
- [x] 小说 / 章节管理（列表编辑）
- [x] 任务管理（抓取任务列表操作）
- [ ] 爬虫抓取中心（采集向导 / 发现 / 代理 / 源管理）
- [ ] AI 服务（配置 / 任务 / 用量 / 审计等子面板）

## App Store 上架注意事项（重要）

知舟服务端支持 PO18 站点预设与 `contentMode: adult`。**App Store 严禁成人内容**，上架前必须：
1. 客户端固定 `contentMode = "safe"`，不展示/不跳转成人内容
2. 移除 ATS 的 `NSAllowsArbitraryLoads`（强制 HTTPS）
3. 或在自签/TestFlight/企业分发场景内使用

## 构建细节

- 生成工程：`xcodegen generate`（需 XcodeGen，CI 已装）
- 本地有 Mac 时：`open ZhiZhou.xcodeproj` 后直接 ⌘R 运行模拟器
- 修改 Info.plist 后需在 `project.yml` 保持 `INFOPLIST_FILE` 指向不变

---

*接口字段如有变动，以知舟仓库 `shared/types.ts` 为准，同步更新 `Models/Models.swift`。*
