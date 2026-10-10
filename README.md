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
scripts/        开发编排脚本
data/           运行时数据（runtime-config.json 等，已 gitignore）
```

## 划选插画想法

阅读器中划选正文，点击「写想法」，可在想法面板选择「生成图片并发布想法」。图片根据引用文字生成，输入的想法作为配文；配文可留空。任务完成后自动发布到原段落，关闭面板或刷新页面后可恢复进度。

在后台「AI → 配置 → 读者生成策略」勾选允许使用的角色（管理员、读者）。默认仅管理员可用，每人每日最多 10 个图片任务，失败任务也计入；取消全部角色或将图片配额设为 0 可关闭功能。图片沿用图像供应商及通用图像参数，独立于文本生成配额。想法审核列表可查看、隐藏和删除图片。

新增数据库迁移 `046_thought_images.sql`，图片二进制独立存储，硬删除想法时一并清理。部署新 API 时需执行迁移（服务启动时自动执行）。

## 部署

自托管 Node + PostgreSQL：

```bash
npm ci
npm run build
DATABASE_URL=postgres://... node api/dist/index.js
```

- 前端产物在 `web/dist`。推荐让 Node 服务同时提供页面、静态资源与 API，并将站点请求反代到 API 端口（默认 8787）。前端产物必须随 API 一起部署；分离容器时通过 `WEB_DIST_DIR` 指向挂载目录。
- **搜索收录**：设置 `SITE_URL=https://你的正式域名`（只填 origin），通过 Node 页面入口访问时，首页和 `general` 小说详情提供可收录的初始 HTML、独立描述及 canonical。章节、后台、个人页面、查询参数页、`restricted` 和 `unknown` 详情输出 `noindex, follow`；缺省 `SITE_URL` 时全部 HTML 保持 `noindex`。`/sitemap.xml` 为分页 sitemap 索引，只列首页与 `general` 详情；`/robots.txt` 自动声明其地址。所有 API 响应附带 `X-Robots-Tag: noindex, follow`，公开渲染接口允许抓取，私有接口仍由权限校验保护。

  Nginx / OpenResty 推荐配置（在现有 HTTPS server 中替换页面的 SPA fallback；保留已有 TLS、限流等配置）：

  ```nginx
  location / {
      proxy_pass http://127.0.0.1:8787;
      proxy_set_header Host $host;
      proxy_set_header X-Forwarded-Proto $scheme;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }
  ```

  若由 Nginx 单独托管 `/assets/` 和 `/images/` 以节省 Node 流量，可以保留对应静态 location；`/`、`/novel/*`、`/read/*`、后台和个人页面，以及 `/robots.txt`、`/sitemap.xml`、`/sitemaps/*` 必须交给 Node 页面入口。反代不得追加全站 `X-Robots-Tag: noindex`，HTML 与 sitemap 不应缓存，以便分级变更及时生效。Caddy 可使用 `reverse_proxy 127.0.0.1:8787`。

  部署后检查首页、general/restricted/unknown 详情、个人页面的实际 HTML 和 `X-Robots-Tag`，以及 sitemap 中的作品范围，再通过搜索引擎站长工具检查抓取和提交 sitemap。移除禁止规则不代表即时收录。
- **SPA fallback**：前端是单页应用，`/novel/:id`、`/read/:novelId/:chapterId`、`/bookshelf` 等均为前端路由，服务器上只有一份 `index.html`。直接刷新或从外站深链进入非首页路由时，静态服务器找不到对应文件会返回 404。需在静态站点配置中把找不到的路径回退到 `index.html`，交由 React Router 解析：
  - **Nginx / OpenResty**：`location / { try_files $uri $uri/ /index.html; }`
  - **Caddy**：`try_files {path} /index.html`
  - **Cloudflare Pages / Vercel / Netlify**：在平台配置里启用 SPA fallback（将所有非静态资源路由指向 `index.html`）

  以上是继续采用纯静态托管时的兼容配置，此模式保持 `noindex`，不启用服务端详情 HTML 与 sitemap。采用推荐 Node 页面入口时无需再配置静态 SPA fallback。
- 部署在 Nginx/Caddy/Cloudflare 等反代之后时设置 `TRUST_PROXY=1`，使 IP 限流与登录审计读取转发头。
- 服务端的 AI、图像、下载和抓取请求共用出站代理。Docker 中把以下变量传给 API 容器即可，环境变量优先于管理端保存的开发配置：

  ```yaml
  environment:
    HTTP_PROXY: http://host.docker.internal:7890
    HTTPS_PROXY: http://host.docker.internal:7890
    NO_PROXY: localhost,127.0.0.1,::1,postgres,redis
  ```

  **前提**：代理（Clash / Mihomo）必须开启「允许局域网连接」（allow-lan），否则只监听 `127.0.0.1`，容器无法访问。地址选择：
  - **Docker Desktop（Windows / macOS）**：容器经 `host.docker.internal` 访问宿主机，如上例。
  - **Linux Docker**：默认 bridge 网络下宿主机网桥网关一般是 `172.18.0.1`（以 `docker network inspect bridge | grep Gateway` 为准；compose 自定义网络的网关不同），此时把上述地址换成 `http://172.18.0.1:7890`。
  - **Windows 原生开发**：管理后台填写 `http://127.0.0.1:7890` 即可，无需环境变量。

  容器内验证（应输出 204）：
  ```bash
  docker exec -e https_proxy=http://host.docker.internal:7890 <api容器名> wget -q -O- -T 5 https://www.google.com/generate_204
  ```
  代理配置页可测试连通性、检查任意目标是否走代理（含命中的跳过规则）、并查看脱敏的最近出站日志；失败时会给出具体原因（如 `connect ECONNREFUSED/ETIMEDOUT host:port`），便于区分「代理不可达」与「目标经代理不可达」。
- 全部环境变量说明见 [.env.example](.env.example)。

## 站点信息与安全验证

管理员可在「平台运营 → 站点设置」中管理：

- **站点信息**：站点名称、简介、首页浏览器标题、SEO 描述、Logo 和 Favicon。文字保存后更新顶栏、登录页、页脚、后台品牌及页面标题；服务端 HTML 同步读取配置，不改变内容分级与收录策略。图片上传/恢复默认后立即生效，不会丢失未保存的文字草稿。
- **安全验证**：Turnstile Site Key、Secret Key、允许验证的域名，以及独立验证测试。当前用于 R18 模式解锁，不是全站防爬开关；内容安全总开关仍在「内容审核 → 内容安全」。测试校验真实组件返回的 token，但不会给管理员会话授予 R18 访问权。

图片仅接受不超过 1MB 的静态 PNG / WebP，服务端校验并重新编码为 PNG，Logo 最大 512px、Favicon 最大 128px；不接受 SVG、HTML 或任意外部图片地址。配置和图片存储在现有 `app_settings` 表，无需新增迁移。

如需从后台保存 Turnstile 私钥，先在 API 部署环境中配置 `SITE_SETTINGS_ENCRYPTION_KEY`（32 字节随机数据的 Base64）。可用以下命令生成，再放入部署密钥管理器，**不要提交生成结果**：

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

私钥使用 AES-256-GCM 加密保存，后台读取只显示设置状态，不返回原值；留空保留原密钥，清除需显式勾选。主密钥应与数据库一起妥善备份，丢失/更换后旧密钥无法解密，验证将拒绝放行。环境变量 `TURNSTILE_SITE_KEY`、`TURNSTILE_SECRET_KEY`、`TURNSTILE_HOSTNAMES` 逐字段优先于数据库，相应后台字段不可编辑；要改为后台管理，请先移除对应覆盖变量。未显式配置域名时沿用 `SITE_URL` / `CORS_ORIGINS` 推导。

Cloudflare 控制台仍需创建 Managed 组件、绑定实际前端域名；后台测试会检查服务端返回的 hostname 和 `r18_unlock` action，失败不放行，测试接口与解锁共用限流。上线后使用正式密钥在实际域名完成一次验证测试，再检查 R18 解锁流程。

## 连载自动追更

勾选作品后可在批量操作栏打开「批量追更设置」，统一开启、暂停，或只调整检查频率。支持跨页选择，单次最多 500 本；暂停保留每本作品原有频率，只调整频率保留原有开关。开启或调整频率时会跳过已完结、未配置有效目录和正文选择器的作品，并显示成功数量与跳过原因。保存设置不会立即启动抓取。

在后台「小说管理」每本书的操作菜单中打开「追更设置」，为已配置爬虫的连载作品开启自动追更，并选择每 1 / 3 / 6 / 12 / 24 小时检查。默认关闭；首次检查安排在所选间隔后，也可点击「立即检查并更新」。设置页显示最近结果、上次检查完成时间和下次检查时间，任务详情沿用抓取任务页。小说管理标签区分部分和全部受保护的待入库章节，追更窗口展示具体数量与访问权限说明。保护状态来自最近一次完整目录检查；历史数据以及无法解析保护标识的书源显示待检查，不推断为公开章节。换源或调整目录规则后旧状态失效，需重新检查。

服务每分钟扫描到期作品，先读取目录，再按现有章节链接去重，只抓新增正文。定时任务按可用名额每轮最多启动三本；手动更新和定时更新复用同一本书的活动任务。连续七次没有新章后逐步降低频率，最长间隔七天；失败从十五分钟开始退避重试。部分成功保留已入库章节，下次补抓剩余章节。超过三十分钟无进度的追更任务标记失败后重试。

暂停追更不会取消正在执行的任务；已完结作品不参与定时检查。调度需要 API 服务持续运行。新增数据库迁移随 API 正常启动自动执行。

## 备份与恢复

后台「平台运营 → 备份与恢复」提供本地与 SFTP 多目标备份、自动计划、版本列表、校验、固定保留、日志与指定版本回滚。自动备份默认关闭。配置 `BACKUP_ENCRYPTION_KEY` 后可进行本地备份；远程传输另需安装 rclone、配置允许主机与服务器公钥。后台「备份设置」可管理服务器允许列表、演练库连接、自动重试次数与常规日志保留期限，保存后无需重启；主密钥、目录及工具仍由部署端管理。回滚须配置独立演练数据库，通过真实恢复演练、查看并确认回滚影响、管理员重新认证，并先生成保护备份。预检展示新增、修改与移除及安全配置差异；报告有效十分钟，线上业务数据变化后须重新预检。

备份保存数据库结构、业务数据及数据库内图片；普通回滚保留当前服务器部署配置，并使历史登录会话失效。部署主密钥需单独保管。WebDAV/S3 接口类型已预留，当前可用远程协议为 SFTP。

部署准备、演练库初始化及 `npm run backup:recover` 灾备工具用法见[备份功能落地说明](docs/backup-and-restore-implementation-2026-10-08.md)。

## 页面加载与阅读字体

公开页面与后台业务模块按需加载，后台模块下载期间保留导航。阅读字体改为本站提供的 Noto Serif SC 400 / 700 / 900 WOFF2 分片，不再请求 Google Fonts；字体跟随前端构建发布到带内容哈希的 `/assets/` 地址。源文件与授权说明见 [web/fonts](web/fonts/README.md)，构建结果及浏览器验证见[加载优化记录](docs/web-loading-and-local-fonts-2026-10-10.md)。

## 测试

```bash
npm test                            # 全部
npm test --workspace=@zhi-zhou/api  # 仅后端
npm test --workspace=@zhi-zhou/web  # 仅前端
```

后端测试用 pglite 提供真实 PostgreSQL 语义（含 pg_trgm 扩展），覆盖认证、内容、社交、抓取、AI 与迁移等端到端场景。

普通后端测试为每个测试文件建立临时配置目录，不读取项目 `.env`、运行时配置或本地备份主密钥，并清除继承的部署代理配置。需要密钥、账号或代理的用例显式提供测试夹具；真实 PostgreSQL/SFTP 备份集成测试仍需专用测试连接和服务，未配置时跳过。

`npm run test:backup-integration` 自动新建临时 PostgreSQL 集群、测试库和 SFTP 服务，执行完整备份、旧版本升级恢复、补偿恢复、维护保护与部署侧空库灾备恢复。缺少依赖或有任何测试跳过均报错，结束后停止服务并删除临时目录；不使用已有数据库连接或远程存储账号。以普通用户运行，需安装 PostgreSQL 服务端与同大版本客户端（含 pg_trgm）、rclone、ssh-keygen，并具有私有 IPv4 网卡。可用 `BACKUP_TEST_PG_BIN` 指定 PostgreSQL 工具目录，`BACKUP_TEST_RCLONE_PATH` 指定 rclone。独立 `Backup recovery` 工作流配置为每次 main 推送及 PR 执行，也支持手动运行。细节见[备份恢复与 CI 验证记录](docs/backup-recovery-ci-2026-10-10.md)。

## 相关文档

- [PRODUCT.md](PRODUCT.md)：产品定位与能力边界
- [DESIGN.md](DESIGN.md)：设计系统说明
- [备份与版本回滚设计](docs/backup-and-restore-design-2026-10-08.md)：本地与 SFTP 优先的备份方案、云盘扩展、自动调度、回滚及日志设计
- [备份功能落地说明](docs/backup-and-restore-implementation-2026-10-08.md)：首版功能、部署配置、灾备工具及验证记录
- [KNOWN-ISSUES.md](KNOWN-ISSUES.md)：已定位但暂不修复的问题与不可行修法
