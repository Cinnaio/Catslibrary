# 网页会话与浏览器防护（2026-10-10）

## 登录凭据

网页登录、注册、初始化管理员及修改密码只返回用户资料，由服务器设置登录 Cookie，不返回登录 token。HTTPS 使用 `__Host-zz_session`，带 `Secure`、`HttpOnly`、`Path=/`，不设置 Domain；默认 `SameSite=Lax`。本机 HTTP 开发使用 `zz_session`。HTTPS 的判断优先考虑可信部署配置 `SITE_URL`，也支持实际 HTTPS 请求或开启 `TRUST_PROXY` 后的可信转发头。

普通读者服务端有效期保持 30 天／记住登录 180 天；未勾选记住登录时使用会话 Cookie。管理员无论是否勾选记住登录，绝对有效期最多 8 小时，30 分钟没有有效认证请求后失效；后台轮询也属于认证请求，因此仍由 8 小时上限限制。数据库只保存 token 摘要，撤销会话立即生效。

原生 App 及不携带浏览器来源元数据的原生客户端继续使用 Bearer。显式 Authorization 不会回退到另一个账号的 Cookie。浏览器请求根据受浏览器控制的 Origin／Sec-Fetch 元数据或网页客户端标记识别，即使不发送网页客户端标记，也不会返回原生 token 响应。

旧网页凭据仅在启动时用于一次 `/auth/web-session` 迁移：在事务中轮换并撤销旧凭据，设置 Cookie，随后删除 localStorage/sessionStorage 的 `user_session_token`。迁移保留原登录时间和近期认证状态，不延长管理员绝对有效期。浏览器保留的 `user_session_marker` 只是随机缓存版本标记，不具备认证能力；仍保留主题、阅读设置、账号缓存及原始旧版阅读数据。登录、退出、修改密码和迁移操作串行；支持 Web Locks 的浏览器也会跨标签页串行处理 Cookie 变更。

身份启动检查始终查询服务器，不能把本地标记当成登录依据。身份响应、确认和缓存更新仍验证当前账号与请求版本。退出网络失败会保留当前状态并显示失败，不把清除本地标记当成服务端注销成功。修改密码、撤销旧会话和生成新会话在同一事务中完成，创建会话失败会整批回滚。

## 写入防护与管理员确认

浏览器所有非 GET/HEAD/OPTIONS API 请求要求 `X-ZZ-CSRF: 1`，并验证 Origin 是否为 API 自身、配置的 SITE_URL 或精确 CORS 允许来源。Origin 缺省时仅接受浏览器声明的 same-origin 请求。跨站来源、null 来源及缺少自定义头在路由写入前拒绝；CORS 允许表补齐需要的自定义头与 Idempotency-Key。该方案使用[自定义请求头与来源校验](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)，不是把一个公开常量当作秘密。

Cookie 认证的浏览器写入还要求 `X-ZZ-Account` 与服务器当前账号一致。页面尚未确认身份或 Cookie 已切换到其他账号时返回 409，阻止旧页面的数据写入新账号。未确认账号的本地阅读进度不自动上传。JSON、multipart 上传、抓取辅助接口及退出阅读页的 keepalive 写入均适配 Cookie 和请求头。

管理员最近一次密码验证有效十分钟。超过期限后，账号管理写入、备份设置/目标/部署配置/保留策略及 Turnstile 配置写入返回 `reauth_required`；网页弹出当前密码确认框，成功后只重试原操作一次，保留原操作标识。取消、账号变化或验证失败不执行原操作。密码只在内存与认证请求中使用，不写入浏览器存储；验证接口沿用失败次数限制。原有备份回滚的密码确认继续保留。

## 浏览器响应头

API 与内置 Web 服务增加 `X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY` 和 `Referrer-Policy: strict-origin-when-cross-origin`；HTTPS 增加六个月 HSTS，不启用 includeSubDomains 或 preload。

HTML 增加 CSP **报告模式**，允许本站资源、Turnstile、Cloudflare 统计脚本及实际构建产物中的可信启动脚本哈希。不会为动态用户内容中的脚本自动生成允许哈希。现有章节 HTML 清理继续保留，独立 Turnstile 页面已有的强制 CSP 不被替换。本阶段的全站 CSP 还不阻断违规脚本，也未配置远程报告收集端点；先通过浏览器控制台观察兼容性，再评估收紧外部资源及正式强制策略。

若前端由 Nginx 静态提供，API 中间件无法替它添加 HTML 响应头。构建后执行：

```bash
npm run build
npm run security:headers
```

生成 `.tmp/browser-security/nginx-security-headers.conf`，内容与本次构建的启动脚本哈希匹配。发布时在实际 HTTPS server/location 引入，并检查 Nginx add_header 的继承规则，确保最终首页响应包含这些头；每次重新构建都需重新生成。生成器不修改系统 Nginx 配置、不重载服务。

同源部署优先。Web/API 真正跨站且均为 HTTPS 时，可显式设置 `SESSION_COOKIE_SAMESITE=none` 并精确配置 `CORS_ORIGINS`；Cookie 仍是 Secure，CSRF 和账号校验仍生效，浏览器第三方 Cookie 限制可能影响登录。不要把允许来源配置为通配符。

## 部署与验证

迁移 051 新增 `last_seen_at` 和 `reauthenticated_at`，正常 API 启动自动执行。旧管理员会话会受新增绝对/闲置限制，可能需要重新登录或再次验证密码。新前端与新 API 应一起发布，旧前端缺少 CSRF 与账号请求头，不能继续进行浏览器写入。静态资源和 Cookie 认证响应不得被代理缓存成共享用户响应。

新增测试验证 Cookie 属性、网页不返回 token、原生兼容、显式 Bearer 不回退、跨站拒绝、账号绑定、旧凭据事务轮换、退出、管理员限制与近期认证，以及修改密码失败回滚。前端测试验证无凭据存储、旧键清理、无标记恢复、迟到身份响应隔离、失败退出、密码确认和账号变化不重试。

构建后可在隔离 PGlite 与真实 Chromium 浏览器运行：

```bash
BROWSER_SECURITY_CHECK=1 npm test --workspace=@zhi-zhou/api -- src/routes/browser-security.test.ts
```

夹具只监听回环随机端口，验证实际登录、HttpOnly 不可读、刷新恢复及退出，完成后关闭浏览器和服务。普通 API 回归默认跳过这一项需要浏览器与构建产物的测试；它已单独执行。`npm run test:backup-integration` 继续以真实 PostgreSQL/SFTP 验证新增迁移的旧版恢复路径。

本阶段修改项目源码、测试、部署配置生成器和说明；未迁移线上数据库、修改系统代理配置或重启线上服务。
