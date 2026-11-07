# 开发指南

[返回文档导航](README.md)

## 技术栈

- **前端**：React 19 + Vite 7 + Tailwind CSS 4（shadcn/ui + Radix UI），位于 `web/`
- **iOS 客户端**：SwiftUI + iOS 26，XcodeGen 工程与独立 Swift Package，位于 `ios/`
- **后端**：Hono on Node.js（`@hono/node-server`），位于 `api/`
- **数据库**：PostgreSQL（原生 SQL + 版本化迁移，无 ORM）
- **测试**：Vitest；后端用 [pglite](https://pglite.dev/)（WASM PostgreSQL）做端到端测试，无需本地 PG 服务器
- **仓库结构**：`web/` + `api/` + `shared/` + `ios/` 单仓库；npm workspaces 管理 Web/API，iOS 独立构建和发布

## iOS 客户端

原独立的 `zhi-zhou-ios` 已并入本仓库的 `ios/`，完整保留原提交历史。客户端构建、测试与安装见 [iOS 开发说明](../ios/README.md)，跨端开发、CI 路径隔离及迁移来源见 [并仓说明](ios-monorepo.md)。本节记录源码布局；迁移后的原生构建状态以对应提交的 GitHub Actions 为准。

## 快速开始

要求：使用根目录 `.node-version` 指定的 Node.js，PostgreSQL ≥ 14（或先跳过，用安装向导配置）。CI 与发布运行时使用同一固定 Node；升级版本时同时核对内置 Undici 和生产发布策略。

```bash
npm install

# 方式一：复制环境变量模板并填写数据库连接
cp .env.example .env

# 方式二：什么都不配，直接启动后访问 http://localhost:5173/install
# 安装向导会引导完成数据库连接、可选配置与首个管理员创建

npm run dev   # 同时启动 api（8787）与 web（5173），web 将 /api 代理到 api
```

首次连接数据库时迁移自动执行；也可手动执行 `npm run db:migrate`。

开发时可访问 [组件与样式展示页](http://localhost:5173/dev/components)，集中查看通用组件、业务组件及页面专属样式，支持主题、真实视口和状态预览。该入口仅在 Vite 开发环境启用，使用方式与补充示例见 [组件展示页维护说明](component-gallery.md)。

## 常用脚本

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 同时启动 API 与前端开发服务器 |
| `npm run build` | 构建前端（`web/dist`）与后端（`api/dist`） |
| `npm start` | 运行已构建的 API 服务 |
| `npm run typecheck` | 全部 workspace 类型检查 |
| `npm test` | 全部 workspace 测试（后端 pglite 端到端 + 前端组件/单元测试） |
| `npm run test:backup-integration` | 新建临时 PostgreSQL/SFTP 环境，验证真实备份与灾备恢复（要求本机工具） |
| `npm run lint` | ESLint 检查（`--fix` 可自动修复） |
| `npm run format` | Prettier 格式化检查（`format:write` 写入） |
| `npm run db:migrate` | 手动执行数据库迁移 |

## 目录结构

```
api/            Hono API 服务
  src/routes/     路由（auth / novels / chapters / comments / scrape / ai …）
  src/services/   业务服务（抓取引擎、AI、封面、会话 …）
  src/db/         连接池、查询封装、versioned migrations
web/            React 前端
  src/pages/      页面（Home / Novel / Reader / Bookshelf / admin …）
  src/components/ 组件（reader / admin / ui）
  src/lib/        API 客户端与工具
shared/         前后端共享的类型与纯函数（广告清洗、工具函数）
ios/            SwiftUI 原生客户端、Core 模块、测试与 XcodeGen 工程
scripts/        开发编排脚本与发布辅助脚本（zhizhou-release.sh）
data/           运行时数据（runtime-config.json 等，已 gitignore）
```

## 测试

```bash
npm test                            # 全部
npm test --workspace=@zhi-zhou/api  # 仅后端
npm test --workspace=@zhi-zhou/web  # 仅前端
```

后端测试用 pglite 提供真实 PostgreSQL 语义（含 pg_trgm 扩展），覆盖认证、内容、社交、抓取、AI 与迁移等端到端场景。

普通后端测试为每个测试文件建立临时配置目录，不读取项目 `.env`、运行时配置或本地备份主密钥，并清除继承的部署代理配置。需要密钥、账号或代理的用例显式提供测试夹具；真实 PostgreSQL/SFTP 备份集成测试仍需专用测试连接和服务，未配置时跳过。

`npm run test:backup-integration` 自动新建临时 PostgreSQL 集群、测试库和 SFTP 服务，执行完整备份、旧版本升级恢复、补偿恢复、维护保护、部署侧空库灾备恢复及阅读数据修复/恢复的真实并发保护。缺少依赖或有任何测试跳过均报错，结束后停止服务并删除临时目录；不使用已有数据库连接或远程存储账号。以普通用户运行，需安装 PostgreSQL 服务端与同大版本客户端（含 pg_trgm）、rclone、ssh-keygen，并具有私有 IPv4 网卡。可用 `BACKUP_TEST_PG_BIN` 指定 PostgreSQL 工具目录，`BACKUP_TEST_RCLONE_PATH` 指定 rclone。独立 `Backup recovery` 工作流配置为每次 main 推送及 PR 执行，也支持手动运行。细节见[备份恢复与 CI 验证记录](backup-recovery-ci-2026-10-10.md)。
