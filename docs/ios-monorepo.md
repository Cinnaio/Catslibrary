# iOS 并仓与跨端开发

自 2026-11-03 起，iOS 客户端源码统一在 `Cinnaio/zhi-zhou` 的 `ios/` 中维护。Web/API 继续使用 npm workspaces；iOS 继续使用 SwiftUI、Swift Package 和 XcodeGen，不加入 npm workspaces。

## 目录与历史

```text
api/                         Hono 服务端
web/                         React 网页端
shared/                      TypeScript 类型与纯函数
ios/
  ZhiZhou/                   SwiftUI 客户端
  ZhiZhouCore/               独立 Swift Package 与核心测试
  ZhiZhouTests/              原生单元测试
  ZhiZhouUITests/            iPhone / iPad UI 测试
  project.yml                XcodeGen 工程描述
  scripts/                   iOS 检查与构建辅助脚本
  docs/                      原 iOS 项目的设计与验收记录
  font-dist/                 客户端远程字体分发源文件
.github/workflows/
  build-ios.yml              Core 测试与未签名 IPA 构建
  frontend-audit.yml          手动原生 UI 验证
```

导入来源为 `Cinnaio/zhi-zhou-ios` 的 `main`，提交 `0387cbeaffad5a3f8e41110e8723e323e270564b`。使用未 squash 的 Git subtree 导入，原始提交 ID、作者、时间和完整祖先历史仍可访问；没有嵌套 `.git`，也不需要初始化 submodule。

```bash
git show 0387cbeaffad5a3f8e41110e8723e323e270564b
git log 0387cbeaffad5a3f8e41110e8723e323e270564b -- ZhiZhou/Views/ReaderView.swift
```

导入前的提交保留原仓库根路径，查阅旧文件历史时使用上面的来源提交和原路径；导入后的改动使用 `ios/` 路径。原 iOS 文档中的旧仓库名、绝对路径及“双仓库”验证描述是当时的历史记录。今后的修改统一使用本仓库 `ios/`；不继续向旧仓库同步代码，也不使用 `git subtree pull/push` 维持两个开发入口。

## 本地开发

Web/API 的开发、构建和测试命令保持在仓库根目录运行。iOS 的 Xcode/Swift 命令在 `ios/` 中运行：

```bash
cd ios
swift test --package-path ZhiZhouCore
xcodegen generate
open ZhiZhou.xcodeproj
```

Windows 可从仓库根目录运行已有源码检查，例如：

```powershell
pwsh -File ios/scripts/navigation-smoke.ps1
pwsh -File ios/scripts/admin-operation-smoke.ps1
```

这些脚本通过自身位置定位 `ios/`，无需切换当前目录。SwiftUI 编译、Core 测试和模拟器验收仍需 macOS/Xcode；源码检查不能替代原生构建。

涉及 API 返回字段、权限或任务状态的变更，在同一分支中同步检查 `api/`、`shared/`、`web/` 和 `ios/ZhiZhou/Models/`、`ios/ZhiZhou/Networking/`。TypeScript 类型不会自动生成 Swift 模型。

根目录 ESLint/Prettier 不扫描 `ios/`，避免把 Swift、原生资源和历史 HTML 文档纳入 Node 工具链；iOS 构建产物、缓存、审计输出和下载工件由 `ios/.gitignore` 排除。

## CI 与发布

- `build-ios.yml`：仅通过 `workflow_dispatch` 手动运行 Core 测试和未签名 Release 构建。在 Actions 中选择 **Build and Test iOS (unsigned IPA) → Run workflow**，选择分支后启动；推送和 PR 均不自动构建。
- `frontend-audit.yml`：继续手动触发，验证 iPhone/iPad，工件名保持 `frontend-audit-phone` / `frontend-audit-tablet`。
- `deploy.yml`：仅通过 `workflow_dispatch` 手动部署网站。在 Actions 中选择 **Deploy → Run workflow**，选择要部署的分支；推送和 PR 均不自动部署。
- `ci.yml`、`backup-recovery.yml`：保留现有自动检查与手动入口；仅 iOS 目录或 iOS 工作流变更时跳过，同时修改 Web/API 时按原有规则检查。
- 工作流的 shell 命令默认在 `ios/` 执行；cache/upload 等 action 的路径以仓库根目录为准，显式使用 `ios/` 前缀。缓存采用新版本 key，避免复用旧仓库布局。
- IPA 工件名继续为 `ZhiZhou-unsigned-ipa`，内部文件名为 `ZhiZhou-unsigned.ipa`。在 **Cinnaio/zhi-zhou → Actions → Build and Test iOS** 下载对应提交的工件；本地自动下载脚本如有旧仓库默认值，应改为 `Cinnaio/zhi-zhou`。
- Web/API 与 iOS 版本号、构建和发布节奏保持独立。只有服务器部署流程会发布 Web/API，构建 IPA 不会安装到设备。

需要发布网站或生成 IPA 时分别手动启动对应工作流；推送 `main` 只更新源码，不自动发布网站或构建 iOS。

## 旧仓库收尾

旧仓库和原本地目录保留为历史参考，不删除。待迁移进入新仓库 `main` 且新路径的 macOS 构建通过后，再在旧仓库 README 标注迁移地址并归档旧仓库。归档前若旧仓库出现更新，先核对是否需要补入；不要让两处持续独立开发。

本说明不代表迁移已经推送、服务器已部署、IPA 已构建或旧仓库已归档；实际交付状态以迁移验证记录和 GitHub Actions 为准。

## 本地迁移验证（2026-11-03）

- 导入树与来源提交完全一致，来源的 252 个提交仍是本仓库提交的祖先；来源远端 `main` 与导入提交一致。
- 导入 187 个受版本控制的文件；除 6 个迁移需要修改/移动的文件外，其余 181 个文件内容一致（文本仅容许 Windows 检出的行尾转换），包含所有 Swift 源码、测试、原生资源、字体和工程描述。
- 11 份现有 PowerShell smoke 从仓库根目录运行通过，证明相对路径迁移后仍能定位源码。
- 5 份工作流通过 actionlint 1.7.12 检查（未运行 shellcheck/pyflakes）；13 组路径场景验证原生、Web/API、文档和混合变更的触发隔离。
- XcodeGen 源码与 plist/entitlements 路径、plist 解析、缓存输入及 action 工件路径检查通过；146 个构建输入的时间戳保存/恢复通过，并验证了实际时间戳恢复及根目录/`ios/` 两种调用位置。
- 工作流格式检查、ESLint 配置检查和 `git diff --check` 通过；ESLint/Prettier 对 `ios/` 的隔离及原生生成产物的忽略规则已核对。
- 迁移分支已切回原项目工作目录；原有 10 个未提交文件已核对，网页文件保持原样，README 的组件展示页说明仍单独留在未暂存区。
- 本机为 Windows，没有 Swift/Xcode；尚未执行迁移后 macOS Core 测试、Release 构建、模拟器或真机验收。需要新仓库对应提交的 GitHub Actions 结果后才能确认 IPA 构建成功并归档旧仓库。
