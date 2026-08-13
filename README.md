# 知舟（Zhi Zhou）

自托管的 AI 中文小说阅读站。读者获得干净、沉浸的阅读体验；管理员通过 Web 运营台完成书库管理、多源抓取、内容审核与 AI 创作的全链路工作流。

## 技术栈

- **前端**：React 19 + Vite 7 + Tailwind CSS 4（shadcn/ui + Radix UI），位于 `web/`
- **后端**：Hono on Node.js（`@hono/node-server`），位于 `api/`
- **数据库**：PostgreSQL（原生 SQL + 版本化迁移，无 ORM）
- **测试**：Vitest；后端用 [pglite](https://pglite.dev/)（WASM PostgreSQL）做端到端测试，无需本地 PG 服务器
- **仓库结构**：npm workspaces monorepo（`web/` + `api/` + `shared/`）

## 快速开始

要求：Node.js ≥ 22、PostgreSQL ≥ 14（或先跳过，用安装向导配置）。

```bash
npm install

# 方式一：复制环境变量模板并填写数据库连接
cp .env.example .env

# 方式二：什么都不配，直接启动后访问 http://localhost:5173/install
# 安装向导会引导完成数据库连接、可选配置与首个管理员创建

npm run dev   # 同时启动 api（8787）与 web（5173），web 将 /api 代理到 api
```

首次连接数据库时迁移自动执行；也可手动执行 `npm run db:migrate`。

## 常用脚本

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 同时启动 API 与前端开发服务器 |
| `npm run build` | 构建前端（`web/dist`）与后端（`api/dist`） |
| `npm start` | 运行已构建的 API 服务 |
| `npm run typecheck` | 全部 workspace 类型检查 |
| `npm test` | 全部 workspace 测试（后端 pglite 端到端 + 前端组件/单元测试） |
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
scripts/        开发编排脚本
data/           运行时数据（runtime-config.json 等，已 gitignore）
```

## 部署

自托管 Node + PostgreSQL：

```bash
npm ci
npm run build
DATABASE_URL=postgres://... node api/dist/index.js
```

- 前端产物在 `web/dist`，由任意静态服务器/反代托管，并将 `/api` 反代到 API 端口（默认 8787）。
- **SPA fallback**：前端是单页应用，`/novel/:id`、`/read/:novelId/:chapterId`、`/bookshelf` 等均为前端路由，服务器上只有一份 `index.html`。直接刷新或从外站深链进入非首页路由时，静态服务器找不到对应文件会返回 404。需在静态站点配置中把找不到的路径回退到 `index.html`，交由 React Router 解析：
  - **Nginx / OpenResty**：`location / { try_files $uri $uri/ /index.html; }`
  - **Caddy**：`try_files {path} /index.html`
  - **Cloudflare Pages / Vercel / Netlify**：在平台配置里启用 SPA fallback（将所有非静态资源路由指向 `index.html`）

  此规则只作用于前端静态资源；`/api` 反代不受影响。
- 部署在 Nginx/Caddy/Cloudflare 等反代之后时设置 `TRUST_PROXY=1`，使 IP 限流与登录审计读取转发头。
- 全部环境变量说明见 [.env.example](.env.example)。

## 测试

```bash
npm test                            # 全部
npm test --workspace=@zhi-zhou/api  # 仅后端
npm test --workspace=@zhi-zhou/web  # 仅前端
```

后端测试用 pglite 提供真实 PostgreSQL 语义（含 pg_trgm 扩展），覆盖认证、内容、社交、抓取、AI 与迁移等端到端场景。

## 相关文档

- [PRODUCT.md](PRODUCT.md)：产品定位与能力边界
- [DESIGN.md](DESIGN.md)：设计系统说明
