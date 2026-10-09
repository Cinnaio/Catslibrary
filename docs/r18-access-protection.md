# R18 访问保护与 Turnstile 部署

## 权限契约

- R18 仍严格等于 `contentRating = restricted`。`unknown` 继续采用既有待审核策略，不宣称安全。
- 游客不能开启 R18；普通读者必须有有效登录会话、站点开关开启和服务端确认的账号成人模式；同账号新设备无需再次验证。
- 首次开启账号模式需要成年自我确认及 Cloudflare Turnstile。Turnstile 不验证真实年龄。
- 图片访问 Cookie 最多 24 小时且不长于登录会话；账号模式不再依赖逐会话的 24 小时授权。刷新可用有效登录沿用远程账号模式。
- 旧 `v1` 匿名 Cookie / `X-Content-Access` 凭证失效。`v2` 凭证绑定数据库会话，注销、撤销会话、账号禁用或切回安全模式后不能继续使用。
- 带 Bearer 的请求以该会话为准，无效或未授权 Bearer 不回退到其他账号/会话的 Cookie。图片 Cookie 只用于内容权限，不替代写入接口的 Bearer 登录认证。
- 普通阅读设置接口拒绝直接写入 `adult`。开启必须走受控端点；切回 `safe` 撤销账号下所有会话的 R18 授权，但不删除收藏、书签或进度。
- 管理员仍可使用有效会话进行内容审核。这个管理权限不是普通读者解锁旁路。

## Cloudflare 配置

1. 在 Cloudflare Turnstile 创建 **Managed** 组件，添加实际前端 hostname（不含协议或路径）。无需部署额外 Worker。
2. 通过部署环境变量 / 密钥管理器设置：

   ```text
   TURNSTILE_SITE_KEY=<公开 site key>
   TURNSTILE_SECRET_KEY=<仅后端使用的 secret key>
   TURNSTILE_HOSTNAMES=read.example.com
   ```

   多 hostname 用逗号分隔。未显式设置 hostname 时从 `SITE_URL` 和 `CORS_ORIGINS` 推导；推导失败同样视为未配置。不要在生产使用 Cloudflare 的测试密钥，不要把 secret 写进前端、Git 或日志。
3. 重启 API。`GET /api/content-policy` 仅返回公开 site key 和配置是否完整，不返回 secret。
4. 服务端调用官方 Siteverify，要求 `success = true`、允许的 hostname、`action = r18_unlock`。缺配置、网络/超时、过期或重复令牌都拒绝新授权。
5. CSP 若启用，允许 `script-src` / `frame-src` 访问 `https://challenges.cloudflare.com`，并按官方 CSP 文档核对其他指令。

缺少配置时非 R18 阅读仍正常，读者不能首次开启账号 R18 模式；已有账号模式仍可恢复；管理员审核不受影响。不要添加整页 Challenge 到所有 JSON API，否则 SPA/原生客户端可能收到 HTML 而非预期 JSON。

## API / 客户端协议

- `POST /api/content-policy/unlock`：Bearer 必填，JSON `{ confirmed: true, turnstileToken: "..." }`；成功后签发 HttpOnly 成人访问 Cookie。
- `POST /api/content-policy/refresh`：Bearer 必填，按有效登录恢复账号已开启的模式并设置图片 Cookie；账号未开启返回 `403 restricted_content`。
- `POST /api/content-policy/lock`：登录用户关闭账号成人模式并撤销该账号所有会话授权；匿名请求只清 Cookie。
- 内容拒绝沿用 `403 restricted_content`，`reason` 区分 `login_required` / `not_unlocked` / `site_disabled`。解锁接口未登录返回 401。
- 验证未配置返回 `503 turnstile_not_configured`；验证失败返回 `403 turnstile_failed`；普通设置直接开启返回 `403 adult_unlock_required`。
- Web 默认安全模式，验证开启账号模式或从服务端恢复已有账号模式后放行；注销/换账号清当前展示和章节内存缓存。每分钟、窗口重新聚焦及网络恢复时检查授权。首次恢复期间显示等待状态；网络、超时或服务端临时错误不撤销此前确认的模式，保留已读取的站点配置，提示检查失败并在 15 秒后重试。首次配置或授权尚未确认时不放行，并提供重试入口。服务端明确拒绝授权或返回站点关闭时立即收起内容；后续正文请求始终由服务端校验。其他设备关闭或后台撤销后的内容请求立即拦截，当前 Web 已显示内容在下一次成功确认撤销时收起。小说信息网络失败显示独立加载失败与重试入口，不误显示 R18 阻挡。
- 独立 iOS 等客户端可通过 `/api/content-policy/status` 确认共享账号模式；账号已开启时无需设备首次验证。首次开启账号模式仍须提交确认及 Turnstile 令牌；不能仅靠客户端类型 / User-Agent 授权。iOS 配套源码在独立仓库。
- 已经交付给客户端的内容、截图和外部离线副本无法远程追回。这一机制控制后续访问，不是 DRM。

## 限流与源站边界

- 正文 `GET /api/chapters/:id` 默认每账号每分钟 120 次、每可信 IP 每分钟 240 次。`CHAPTER_READ_LIMIT_PER_MINUTE` 可配置正整数；IP 上限为两倍。有效管理员 Bearer 读取用于管理，免正文限流。
- R18 解锁默认每账号每分钟 5 次、每可信 IP 每分钟 20 次；失败验证也计数。
- PostgreSQL 原子固定窗口计数，多个 API 实例共享；超限返回 `429 content_rate_limited` 和 `Retry-After`。不能保证固定窗口边界没有突发；如需更强防爬应结合边缘 WAF 和行为监控。
- `TRUST_PROXY=1` 只用于已限制可信反代入口的部署。IP 取不到时不信任客户端伪造的转发头；账号限流仍有效。生产需核验 Cloudflare Tunnel 或防火墙限制源站入口，避免绕过边缘防护与伪造代理头。
- Cloudflare / 反代不能公共缓存正文、受限封面及权限相关 API；按既有部署说明绕过缓存。权限响应使用 `private, no-store`，封面使用 `private, max-age=604800, must-revalidate`，允许客户端本地缓存；封面网络请求及条件请求仍先验证访问权。
- 新迁移 `043_content_access_sessions.sql` 会由 API 启动迁移器应用；迁移保留兼容会话字段，当前访问依据已登录账号的共享 adult 模式，不再要求旧字段非零。全站关闭会清除账号模式，重新开放不恢复旧授权。

## 上线验证

在真实域名核验：游客及旧 Cookie 被拒绝、真人登录验证可开启、图片能加载、刷新及同账号新设备不重复验证、登录过期后需重新登录、退出后旧 Cookie 无效、切回 safe 保留但隐藏书签、限流返回 429、CDN 无缓存命中泄露。仓库测试使用受控的 Siteverify 响应桩，不代表真实 Cloudflare 网络/域名配置已验证。
