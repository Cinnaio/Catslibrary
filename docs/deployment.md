# 部署指南

[返回文档导航](README.md)

## 部署

生产环境由 GitHub Actions 构建与发布，**不要在服务器上跑 `npm run build`**：生产机内存很小，`vite build` 会撞 V8 堆上限；而且 `vite build` 会先清空 `web/dist` 再打包，构建失败会直接把线上页面删空。

### 按需发布（GitHub Actions）

网站部署和 iOS 构建分别手动选择运行，推送或创建/更新 PR 均不会自动触发它们：

- 网站：进入仓库 **Actions → Deploy → Run workflow**，选择要部署的分支（通常为 `main`）并运行。
- iOS：进入 **Actions → Build and Test iOS (unsigned IPA) → Run workflow**，选择分支并运行；完成后下载 `ZhiZhou-unsigned-ipa` 工件。
- 普通 CI 与备份集成检查继续按各自工作流的现有规则触发。

手动运行 `.github/workflows/deploy.yml` 后会依次执行：

1. 安装依赖并运行类型检查；全量测试由独立 CI 执行
2. 在 GitHub 托管的 runner 上清空旧产物后 `npm run build`，校验 `index.html` 引用的每个 `/assets/*` 都真实存在
3. 打包 `web/dist` + `api/dist`（排除 sourcemap）为 `release.tgz`
4. 通过 SSH 上传到 `/tmp`，再执行服务器上的 `/usr/local/bin/zhizhou-release <sha>` 完成原子切换

`zhizhou-release`（仓库内 `scripts/zhizhou-release.sh`）的行为：

- 解包到 `/tmp` 临时目录，缺失 `web/dist/index.html`、`api/dist/index.js` 或 `api/dist/migrations` 直接拒绝，**不碰线上目录**
- 先把当前 `web/dist`、`api/dist` 改名保留，再用目录改名完成切换
- 重启 `zhizhou.service` 后轮询 `/api/health`，连续失败则把两个目录换回旧版并重启

### 发布前的一次性准备

**服务器**：安装发布脚本与最小化 sudo 规则（只允许执行该脚本，不开放通用 root）：

```bash
sudo install -m 0755 scripts/zhizhou-release.sh /usr/local/bin/zhizhou-release
echo 'cinnaio ALL=(root) NOPASSWD: /usr/local/bin/zhizhou-release' | sudo tee /etc/sudoers.d/zhizhou-release
sudo chmod 0440 /etc/sudoers.d/zhizhou-release
sudo visudo -c
```

把 Actions 的公钥追加到该账号的 `~/.ssh/authorized_keys`。建议给它加限制（仅允许从 GitHub 出口访问，且不可转发）：

```
restrict,command="/usr/local/bin/zhizhou-release-gate" ssh-ed25519 AAAA... github-actions-deploy@zhi-zhou
```

不加上面的 `command=` 限制时，该密钥等同于一个可登录的普通账号（能否提权仍受上面的 sudo 规则约束）。

**GitHub 仓库 Secrets**：

| Secret | 内容 |
| --- | --- |
| `DEPLOY_SSH_KEY` | 部署私钥（ed25519，OpenSSH 格式） |
| `DEPLOY_HOST` | 服务器地址 |
| `DEPLOY_USER` | 部署账号（需要能 `sudo -n` 执行 `zhizhou-release`） |
| `DEPLOY_KNOWN_HOSTS` | `ssh-keyscan -t ed25519,rsa <host>` 的输出，用于固定主机指纹 |

### 手动部署

自托管 Node + PostgreSQL：

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
