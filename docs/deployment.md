# 部署指南

[返回文档导航](README.md)

## 部署

生产环境由 GitHub Actions 构建与发布，**不要在服务器上跑 `npm run build`**：生产机内存很小，`vite build` 会撞 V8 堆上限；而且 `vite build` 会先清空 `web/dist` 再打包，构建失败会直接把线上页面删空。

### 按需发布（GitHub Actions）

发布包验收、网站部署和 iOS 构建分别手动选择运行，推送或创建/更新 PR 均不会自动触发它们：

- 发布包验收：进入仓库 **Actions → Verify release package → Run workflow**，选择待验证分支；只构建、验证并保存发布工件，不连接生产服务器，也不需要 `DEPLOY_*` Secrets。
- 网站：进入仓库 **Actions → Deploy → Run workflow**，选择要部署的分支（通常为 `main`）并运行。
- iOS：进入 **Actions → Build and Test iOS (unsigned IPA) → Run workflow**，选择分支并运行；完成后下载 `ZhiZhou-unsigned-ipa` 工件。
- 普通 CI 与备份集成检查继续按各自工作流的现有规则触发。

`.github/workflows/release-verify.yml` 同时支持手动运行与工作流调用。首次使用前须先把工作流推送到仓库默认分支，才能从 Actions 页面手动选择；远程执行使用所选分支的提交，不能验证尚未推送的本地修改。单独验收依次执行：

1. 按根目录 `.node-version` 安装固定 Node，运行类型、Lint 错误检查及认证、同步、就绪和发布失败恢复等关键回归；全量测试由独立 CI 执行
2. 在 Ubuntu 22.04 x64 runner 上构建 Web/API，校验首页引用的资源；API 注入同一源码 SHA、版本、锁文件摘要与必要迁移清单
3. `release:package` 在独立临时目录按原锁文件安装 API 生产依赖，连同固定 Node、Web/API 产物和 SHA-256 文件清单组成完整发布目录；不使用服务器旧 `node_modules`
4. 生成最终 `release.tgz` 和归档 SHA-256，再用生产端相同的 Python 校验器在新目录解包，复核文件清单、平台、源码 SHA、Node 策略与锁文件；使用解出的运行时再次验证依赖和 Sharp
5. 使用解出的发布包启动独立进程，在 CI 临时 PostgreSQL 16 上验证迁移、就绪、首页、入口资源和只读书目接口；确认原始归档未改变后上传工件

成功后的工件名为 `release-<完整 SHA>-<运行尝试次数>`，保留 14 天，包含 `release.tgz`、`release.tgz.sha256` 和 `release-manifest.json`。运行摘要显示源码 SHA、API/Web 版本、平台、Node、归档摘要与工件 ID。验证失败时不发布供部署使用的工件；验收成功不代表已部署或完成真实客户端验收。

`.github/workflows/deploy.yml` 先调用同一提交的验证工作流，全部通过后才启动部署作业。部署按不可变工件 ID 下载**同一次运行中验证过的原包**，核对源码 SHA 与归档 SHA-256 后才加载 SSH 密钥；之后只信任已核对的主机密钥，检查服务器协议 2，上传并执行 `/usr/local/bin/zhizhou-release <完整 SHA>`。部署作业不重新构建，也不根据名称搜索或下载其他运行的工件。单独验收后手动启动 Deploy，会在新的运行里重新构建并验证当前所选提交，不直接沿用之前的验收工件。

`zhizhou-release`（仓库内 `scripts/zhizhou-release.sh`）的行为：

- 在站点所在文件系统内创建独立暂存目录；拒绝越界路径、软硬链接、特殊文件、重复路径、超限包以及清单不符的文件，核对平台、CPU、Node 策略、源码 SHA、完整摘要和锁文件
- 在服务账号下执行随包 Node，验证全部 API 直接依赖都来自包内，并实际运行 Sharp；操作系统／glibc／原生模块不兼容或 systemd 尚未使用新启动器时，在切换前拒绝
- 备份现有产物，停止服务后成组替换 `web/dist`、`api/dist`；依赖和运行时位于 `api/dist` 内，跟随代码一起切换。此流程存在短暂停机，不是零停机发布
- 启动后验证 `/api/ready` 返回的目标 SHA、数据库与迁移就绪状态，以及首页、入口资源和只读书目接口；停止、重启、目录切换或上述检查失败均触发恢复旧目录并重启
- 回滚协议 2 版本时继续验证旧 SHA 和业务就绪；首次迁移若回退旧产物，只能使用旧 `/api/health` 存活检查。数据库迁移不自动降级，发布前仍须核对迁移兼容窗口与备份

`/api/health` 保留进程存活语义。新增 `/api/ready` 使用独立、限时的小连接池检查实际数据库、全部必要迁移及目录字段，并在备份维护期间返回 503；探针合并并发请求、短暂缓存结果，不依赖外部 AI 或邮件服务。响应只有就绪状态、API 版本、源码 SHA 与有限原因码，不返回连接串或原始异常。生产入口拒绝使用不匹配的 Node 启动。

### 发布前的一次性准备

**服务器**：从已审核的本次源码更新发布脚本、校验器、Node 策略及启动器。现有协议 1 工具不能直接接收新包；工作流会提前拒绝。以下是待运维执行的准备步骤，本地修改这些文件不代表服务器已更新。

先核对 `zhizhou.service` 的 `User`、`ExecStart`、环境配置与原 Node 路径。脚本默认站点 `/var/www/zhi-zhou`、用户 `cinnaio`、端口 8080；部署不同路径时统一修改脚本常量。启动器遇到旧产物会使用 PATH 中的 `node`，若旧服务使用其他绝对路径，应在启动器的旧版分支保留该命令，保证首次升级失败时可启动旧版本。服务器需具备 Bash、Python 3.10+、curl、tar、flock、runuser 和 systemd。

```bash
systemctl show zhizhou.service -p User -p ExecStart -p WorkingDirectory
sudo install -d -o root -g root -m 0755 /usr/local/lib/zhizhou
sudo install -o root -g root -m 0755 scripts/zhizhou-release.sh /usr/local/bin/zhizhou-release
sudo install -o root -g root -m 0755 scripts/zhizhou-start.sh /usr/local/bin/zhizhou-start
sudo install -o root -g root -m 0644 scripts/validate-release.py /usr/local/lib/zhizhou/validate-release.py
sudo install -o root -g root -m 0644 .node-version /usr/local/lib/zhizhou/node-version
sudo install -d -m 0755 /etc/systemd/system/zhizhou.service.d
printf '[Service]\nExecStart=\nExecStart=/usr/local/bin/zhizhou-start\n' | sudo tee /etc/systemd/system/zhizhou.service.d/release-runtime.conf
sudo systemctl daemon-reload
echo 'cinnaio ALL=(root) NOPASSWD: /usr/local/bin/zhizhou-release' | sudo tee /etc/sudoers.d/zhizhou-release
sudo chmod 0440 /etc/sudoers.d/zhizhou-release
sudo visudo -c
sudo /usr/local/bin/zhizhou-release --protocol-version  # 应输出 2
```

不覆盖原服务的 `User`、环境文件、数据目录和安全配置。新的 Node 与生产依赖由 CI 提供，服务器无需执行 `npm ci`。未来修改 `.node-version` 时也要同步安装该策略文件；旧策略会拒绝新运行时包。生产平台不是 Linux x64 时，应先调整 runner／原生依赖构建平台，不能强行使用不匹配的包。

把 Actions 的公钥追加到该账号的 `~/.ssh/authorized_keys`。可用 `restrict` 关闭转发和 PTY，同时保留工作流需要的上传与远程命令执行：

```
restrict ssh-ed25519 AAAA... github-actions-deploy@zhi-zhou
```

该密钥仍可执行部署账号的普通命令，提权受上述 sudo 规则约束；`restrict` 本身不限制来源 IP。若另行配置强制命令网关，须支持 SFTP 上传、协议查询、发布与只读验证，仓库未提供这样的网关。

**GitHub 仓库 Secrets**：

| Secret | 内容 |
| --- | --- |
| `DEPLOY_SSH_KEY` | 部署私钥（ed25519，OpenSSH 格式） |
| `DEPLOY_HOST` | 服务器地址 |
| `DEPLOY_USER` | 部署账号（需要能 `sudo -n` 执行 `zhizhou-release`） |
| `DEPLOY_KNOWN_HOSTS` | 经服务器控制台或其他可信通道核对指纹的 known_hosts 记录；必须匹配 `DEPLOY_HOST`，不直接信任未验证的网络扫描结果 |

### 手动部署

源码方式部署须使用 `.node-version` 指定的 Node 和匹配锁文件；生产更推荐上述完整发布包：

```bash
npm ci
npm run build          # 建议在内存充足的机器或 CI 上执行
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
- 全部环境变量说明见 [.env.example](../.env.example)。
