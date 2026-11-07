# 知舟 Passkey 实现契约

日期：2026-10-19

2026-11-07 契约更新：管理员敏感写入取消近期密码／Passkey 二次验证，使用当前有效会话与角色授权；Web 移除验证弹窗，原重新验证接口保留旧客户端兼容。本文管理员十分钟认证及 `reauth_required` 要求已由 [当前账号权限契约](account-security.md) 取代，其他登录、注册、凭证验证及审计要求继续适用。本次变更为未部署的 API/Web `0.11.0` 源码候选。

状态：第一批实现已落地，待生产 HTTPS 域名与真实设备做验收。

## 1. 目标与范围

第一期为知舟 Web 端增加可选的 Passkey（WebAuthn 通行密钥）登录与管理能力：

- 已有账户可以在登录后添加一个或多个 Passkey。
- 用户可以在登录页使用 Passkey 登录。
- Passkey 登录成功后继续复用现有 `user_sessions` 和 HttpOnly Cookie，不创建另一套长期会话令牌。
- 现有用户名密码登录继续保留，作为兼容路径和账户恢复方式。
- Passkey 凭证可以在个人中心查看、命名和撤销。
- 管理员可以在「站点设置 → Passkey」中配置前端展示和启用策略。
- 登录审计能够区分密码登录与 Passkey 登录。

第一期只覆盖 Web。独立 iOS 客户端不在本次实现范围内，但服务端数据模型和验证接口应保持可供后续原生客户端接入。

## 2. 不在第一期范围内

以下内容暂不实现：

- 删除密码或建立没有密码恢复路径的账户；
- 匿名使用 Passkey 创建新账户；
- 多个正式域名之间的 Related Origin Requests；
- iOS 原生 Passkey UI 与 Associated Domains 配置；
- 使用 Passkey 取代所有管理员重新验证流程；
- 自研 WebAuthn assertion 解析和签名验证；
- 把 credential ID、challenge 或 assertion 当作长期登录 token。

## 3. 当前项目基线

当前 Web 认证已经具备适合复用的边界：

- `api/src/services/browser-session.ts` 负责浏览器 Cookie 会话和原生 Bearer 会话的区分；
- `api/src/services/sessions.ts` 负责创建、解析和撤销 `user_sessions`；
- `api/src/routes/auth.ts` 已有登录、修改密码、重新验证、退出和登录设备接口；
- `web/src/lib/api.ts` 已统一使用 `credentials: include`、CSRF 请求头和账号绑定请求头；
- `web/src/pages/Profile.tsx` 已有“账户安全”和“登录设备”标签页；
- `api/src/db/migrations/009_login_audit.sql` 已保存登录结果、原因、IP 和 User-Agent。

Passkey 只负责完成凭证验证。验证成功后，服务端应调用既有的 `createSession()`，并按当前浏览器会话规则设置 Cookie。浏览器请求不得返回可供 JavaScript 保存的真实会话 token。

## 4. 用户体验契约

### 4.1 登录页

登录页保留两条明确路径：

1. `使用 Passkey 登录`；
2. 用户名和密码登录。

用户名输入框增加 `autocomplete="username webauthn"`，在支持 Conditional UI 的浏览器中允许 Passkey 出现在浏览器自动填充列表中。自动填充失败、用户取消、浏览器不支持或当前域名不匹配时，应静默回到普通密码登录，不显示协议错误。

专用按钮触发的登录流程仍应有清晰的状态：

- 正在等待设备验证；
- 用户取消；
- 当前设备没有可用 Passkey；
- Passkey 已被撤销；
- 验证失败，请改用密码登录。

错误文案不能泄露其他账户是否存在，也不能返回 credential ID、challenge 或公钥内容。

### 4.2 个人中心

在现有“账户安全”标签页增加“Passkey”区域，显示：

- 已注册数量；
- Passkey 名称；
- 创建时间；
- 最近使用时间；
- 最近使用的设备或浏览器摘要；
- 撤销按钮。

添加 Passkey 前要求用户完成一次较强的现有账户验证：第一期使用当前密码确认。验证通过后才调用 WebAuthn 创建流程。

删除 Passkey 前需要二次确认。删除最后一个 Passkey 可以允许，因为账户仍保留密码登录；如果未来支持无密码账户，需要重新制定“最后凭证”规则。

### 4.3 登录设备

现有“登录设备”仍然表示服务端会话，而不是 Passkey 列表。会话可以增加认证方式字段或徽标，例如“密码”或“Passkey”，但撤销 Passkey 与撤销会话必须保持为两个独立操作。

### 4.4 站点设置中的 Passkey

在现有「站点设置」下增加第三个视图：

```text
/admin/site-settings?view=passkey
```

导航名称建议为“Passkey”，与现有“站点信息”和“安全验证”并列。

第一期允许管理员配置：

- `enabled`：是否启用 Passkey 功能；
- `registrationEnabled`：是否允许已登录用户新增 Passkey；
- `rpName`：浏览器系统确认框中显示的站点名称。

页面同时显示但不允许编辑：

- 当前 RP ID；
- 当前允许的 origin；
- 当前配置来源（本地环境变量、部署环境变量或默认值）；
- 当前 User Verification 策略。

RP ID 和 origin 是认证信任边界，不能作为普通数据库设置让管理员直接编辑。管理员只能看到它们的生效值和来源；修改必须通过部署配置完成。

保存 Passkey 站点设置前要求管理员最近一次重新验证身份。启用、停用或关闭注册都应写入管理员操作审计，记录修改前后值，但不记录 challenge、公钥或 credential ID。

默认值建议为：

```json
{
  "enabled": false,
  "registrationEnabled": true,
  "rpName": "知舟"
}
```

## 5. 数据库设计

新增迁移使用 `061_passkeys.sql`；`062_passkey_schema_repair.sql` 用于修复已经记录过早期 061、但缺少后续列的本地或部署数据库。

### 5.1 `user_passkeys`

建议字段：

```text
id                    TEXT PRIMARY KEY
user_id               TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE
credential_id         TEXT NOT NULL
public_key            TEXT NOT NULL
user_handle           TEXT NOT NULL
name                  TEXT NOT NULL DEFAULT ''
sign_count            BIGINT NOT NULL DEFAULT 0
transports            TEXT NOT NULL DEFAULT '[]'
backup_eligible       BOOLEAN NOT NULL DEFAULT FALSE
backup_state          BOOLEAN NOT NULL DEFAULT FALSE
created_at            BIGINT NOT NULL
last_used_at          BIGINT NOT NULL DEFAULT 0
last_user_agent       TEXT NOT NULL DEFAULT ''
revoked_at            BIGINT NOT NULL DEFAULT 0
```

约束：

- 未撤销的 `credential_id` 必须唯一，使用 WebAuthn 的 base64url 表示保存即可；撤销记录保留后允许同一设备重新注册；
- `public_key` 只保存公钥，不保存任何私钥或可还原私钥的材料；
- `user_handle` 应是稳定、不可猜测的账户关联值，不使用用户输入的用户名作为凭证私有标识；
- `name` 是用户可编辑标签，不参与认证判断；
- 撤销优先使用软撤销或显式删除加审计，不能仅依赖前端隐藏；
- 查询登录凭证时必须同时限定 `user_id`、`revoked_at = 0` 和账户 `status = 'active'`；
- 应限制单个账户的凭证数量，并在接近上限时给出可操作提示。

`backup_eligible` 和 `backup_state` 用于保留同步型 Passkey 与设备绑定型凭证的状态，第一期可以只在服务端记录，不必将技术字段直接暴露给用户。

### 5.2 `webauthn_challenges`

建议字段：

```text
id                    TEXT PRIMARY KEY
challenge             TEXT NOT NULL UNIQUE
user_id               TEXT NOT NULL DEFAULT ''
purpose               TEXT NOT NULL
session_hash          TEXT NOT NULL DEFAULT ''
expires_at             BIGINT NOT NULL
created_at             BIGINT NOT NULL
consumed_at            BIGINT NOT NULL DEFAULT 0
```

`purpose` 至少支持：

- `register`：当前已登录账户注册 Passkey；
- `login`：未登录用户使用 Passkey 登录；
- `reauth`：后续管理员或敏感操作重新验证。

challenge 必须是服务端生成的随机值，只能使用一次，建议有效期不超过 5 分钟。验证成功、失败或过期后都不能再次使用。

### 5.3 `site_passkey` 设置

Passkey 的前端开关和显示名称可以复用现有 `app_settings`，使用一个 JSON 设置键：

```text
site_passkey
```

数据库设置只保存体验和策略字段：

```text
enabled
registrationEnabled
rpName
updatedAt
```

不在数据库设置中保存或覆盖：

- `rpId`；
- `origins`；
- challenge；
- WebAuthn 库密钥材料；
- 服务端 session 配置。

这样不需要为“站点设置”额外增加一张表，`061_passkeys.sql` 只负责 Passkey 凭证、challenge、登录审计扩展和必要索引。

## 6. API 契约

建议接口如下：

```text
POST /api/auth/passkeys/register/options
POST /api/auth/passkeys/register/verify

POST /api/auth/passkeys/login/options
POST /api/auth/passkeys/login/verify

POST /api/auth/passkeys/reauth/options
POST /api/auth/passkeys/reauth/verify

GET    /api/auth/passkeys
PATCH  /api/auth/passkeys/:id
DELETE /api/auth/passkeys/:id
```

### 6.1 注册 options

`register/options`：

- 必须要求现有登录会话；
- 必须要求当前密码确认得到的短时注册授权；
- challenge 必须绑定当前用户和当前浏览器会话；
- `rp.id`、`rp.name`、`user.id` 由服务端生成；
- `residentKey` 使用 `required`，因为 Passkey 必须是可发现凭证；
- `userVerification` 使用 `required`；
- 已注册的 credential ID 放入 `excludeCredentials`，避免重复注册；
- 第一阶段使用 `attestation: 'none'`，不采集不必要的硬件证明信息；
- 响应只返回供浏览器调用的创建选项，不返回数据库内部用户资料或会话信息。

### 6.2 注册 verify

服务端必须验证：

- challenge 存在、属于当前目的且未过期；
- challenge 只被消费一次；
- origin 为配置中的精确允许来源；
- RP ID hash 与配置匹配；
- credential ID 尚未被其他账户使用；
- credential 的 user handle 与当前账户一致；
- 公钥格式和算法在允许列表内；
- User Verification 满足 `required`；
- 用户账户仍为 active。

写入凭证和消费 challenge 应在同一事务内完成。成功后记录操作审计，不在响应中回传公钥或敏感验证材料。

### 6.3 login options / verify

Passkey 登录支持两种模式：

- 不带用户名：使用 discoverable credential，让用户从设备中选择账户；
- 带用户名：服务端只为该账户提供允许的 credential ID，作为兼容路径。

`login/verify` 成功后：

1. 根据 credential ID 找到账户；
2. 再验证账户为 active；
3. 验证 challenge、origin、RP ID、签名、user handle 和 User Verification；
4. 按现有逻辑更新 `last_login_at`；
5. 更新 Passkey 的 `sign_count`、`last_used_at` 和 User-Agent；
6. 调用现有 `createSession()`；
7. 对浏览器设置现有 HttpOnly Cookie；
8. 写入 `login_audit`，认证方式标记为 `passkey`。

登录成功不能把 credential ID 作为 token 返回给前端，也不能因为 Passkey 登录而绕过账户状态、管理员时效或内容访问授权。

### 6.4 Passkey 管理接口

`GET /auth/passkeys` 只返回脱敏后的列表：

- `id`：服务端生成的 Passkey 记录 ID，不是 credential ID；
- `name`；
- `createdAt`；
- `lastUsedAt`；
- `deviceName`；
- 必要的状态摘要。

不能返回 credential ID、公钥、user handle 或完整 User-Agent。

重命名只修改用户标签。删除必须由服务端按当前用户和记录 ID 执行，不能接受前端传入任意 `user_id`。

### 6.5 站点设置接口

建议增加：

```text
GET /api/site-settings/passkey
GET /api/admin/site-settings/passkey
PUT /api/admin/site-settings/passkey
```

公开接口只返回登录页和前端需要的安全子集：

```json
{
  "enabled": false,
  "registrationEnabled": true,
  "rpName": "知舟"
}
```

管理员接口额外返回只读诊断信息：

```json
{
  "rpId": "localhost",
  "origins": ["http://localhost:5173"],
  "sources": {
    "rpId": "environment",
    "origins": "environment",
    "rpName": "database"
  },
  "userVerification": "required"
}
```

`PUT` 只能修改 `enabled`、`registrationEnabled` 和 `rpName`。服务端应拒绝未知字段、非法长度、控制字符和空名称。

### 6.6 管理员重新验证接口

管理员重新验证复用现有会话的 `reauthenticated_at`，不创建新登录会话：

```text
POST /api/auth/passkeys/reauth/options
POST /api/auth/passkeys/reauth/verify
```

两条接口都要求当前会话属于管理员。`options` 只为当前账号的未撤销凭证生成允许列表，并把 challenge 绑定到当前用户、当前会话摘要和 `reauth` purpose；没有可用凭证时返回 `passkey_unavailable`。`verify` 必须再次匹配这些绑定，校验 origin、RP ID、签名、user handle 和 `User Verification`，成功后只更新当前 `user_sessions.reauthenticated_at`，同时更新该凭证的计数和最近使用信息。

密码重新验证接口 `/api/auth/reauthenticate` 保持不变，继续作为 Passkey 不可用、浏览器不支持或用户取消设备验证时的回退。两种方式最终都由现有管理员敏感写入中间件按十分钟有效期判断，不绕过原有权限检查。

## 7. 安全规则

### 7.1 域名和 origin

必须使用显式配置，不从请求 `Host` 动态推导：

```text
PASSKEY_RP_ID=正式站点域名
PASSKEY_ORIGINS=https://正式站点域名
```

RP 显示名称 `rpName` 由「站点设置 → Passkey」保存到站点设置，不作为部署环境变量。

正式配置前需要确认当前部署的 canonical origin。仓库目前没有可用的生产 `SITE_URL` 或 `CORS_ORIGINS` 值，因此不能在代码中预设 RP ID。

同源部署优先。如果 Web 与 API 分离，Passkey 的 origin 应以用户实际打开的 Web 页面 origin 为准，API 只验证配置中的允许来源。不能接受任意请求来源。

生产环境必须为 HTTPS。开发环境可以使用 localhost，但开发环境创建的凭证不应被当作生产凭证验收。

### 7.2 challenge 与重放

- challenge 必须由服务端随机生成；
- 只能使用一次；
- 验证成功和失败都应该消费或废弃；
- 过期 challenge 不能用于登录或注册；
- challenge 不能只放在客户端或仅依赖可伪造的隐藏字段；
- 注册 challenge 绑定当前用户和当前会话；
- 登录 challenge 不泄露账户存在性。

### 7.3 用户验证和签名计数

第一期要求 User Verification。普通登录、注册和后续敏感操作都不能只因为设备拥有某个凭证就视为完成高强度验证。

`sign_count` 要按 WebAuthn 库的规范处理。检测到异常回退时，不能粗暴地立刻锁死整个账户；应记录风险事件，并根据库提供的计数器语义决定是否拒绝当前凭证或要求密码登录。

### 7.4 账户状态与权限

- disabled 用户不能使用 Passkey 登录；
- 删除用户时级联删除 Passkey；
- 修改密码不应默认删除用户主动注册的 Passkey；
- 管理员强制重置其他用户密码时，应提供“同时撤销全部 Passkey”的安全策略，默认建议执行；
- 退出所有设备只撤销现有会话，不自动删除 Passkey；
- 删除 Passkey 立即阻止后续使用，但不会自动伪造或修改历史登录审计；
- Passkey 不改变小说可见性、内容分级、管理员权限和私有内容授权逻辑。

### 7.5 站点设置的安全边界

- `enabled = false` 时，登录页隐藏 Passkey 入口，注册 options、登录 options 和 verify 都失败关闭；密码登录不受影响；
- `registrationEnabled = false` 时，已注册的 Passkey 仍可登录，但个人中心不允许新增；
- 关闭功能不会删除已有凭证，重新启用后可以继续使用；
- 停用或重新启用都不应自动删除用户会话；如需紧急处置，应由管理员明确执行退出全部设备或撤销凭证；
- `rpName` 只影响浏览器确认框和前端文案，不影响认证判断；
- `rpId`、origin 和 User Verification 不能由公开设置接口覆盖；
- 管理员设置变更需要复用现有 `requireAdmin()` 和近期重新验证保护。

## 8. 审计契约

`login_audit` 建议新增：

```text
auth_method TEXT NOT NULL DEFAULT 'password'
passkey_id  TEXT NOT NULL DEFAULT ''
```

审计内容只保留必要元数据：

- 成功、失败或限流；
- `password` 或 `passkey`；
- 失败原因；
- 账户 ID 和用户名摘要；
- IP、User-Agent、时间；
- 关联的 Passkey 记录 ID，而不是 credential ID。

日志、异常信息和前端错误中都不能出现完整 credential ID、公钥、challenge 或 assertion。

## 9. 推荐实现顺序

### 阶段 A：基础设施

- 选定并锁定 WebAuthn 服务端/浏览器库；
- 增加显式 Passkey 配置项；
- 新增迁移 `061_passkeys.sql`；
- 扩展认证类型和登录审计类型；
- 实现 challenge 存储和一次性消费；
- 增加 origin、RP ID 和 User Verification 验证。
- 增加 `site_passkey` 设置读取、校验和来源合并；
- 增加公开设置接口与管理员设置接口。

### 阶段 B：Web 登录与个人中心

- 实现注册 options/verify；
- 实现登录 options/verify；
- 复用现有 Cookie session；
- 登录页加入按钮和 Conditional UI；
- 个人中心加入列表、命名、删除；
- 「站点设置 → Passkey」加入启用开关、注册开关、RP 名称和只读运行诊断；
- 登录页与个人中心按公开设置即时隐藏或显示 Passkey 功能；
- 增加浏览器和 API 测试。

### 阶段 C：管理员重新验证

- 将现有管理员密码 reauthentication 抽象为验证器；
- Passkey 只有在 User Verification 成功时才能满足管理员重新验证；
- 保留密码验证回退；
- 覆盖账户管理、备份、安全设置等敏感写入。

### 阶段 D：iOS

- 独立 iOS 仓库接入系统 Passkey API；
- 配置原生关联域名；
- 复用服务端 credential 表和验证契约；
- 分别完成真实设备登录、退出、撤销和会话恢复验收。

## 10. 测试与验收

### API / 数据库

至少覆盖：

- 所有迁移按顺序执行；
- 重复 credential ID 被拒绝；
- challenge 过期被拒绝；
- challenge 重放被拒绝；
- 错误 origin 被拒绝；
- 错误 RP ID 被拒绝；
- credential 与 user handle 不匹配被拒绝；
- disabled 用户无法登录；
- 已撤销 Passkey 无法登录；
- Passkey 登录创建的是普通 `user_sessions`；
- 浏览器响应不包含真实 session token；
- 原生 Bearer 登录行为不被改变；
- 账号切换和 CSRF 保护仍然生效；
- 登录审计记录认证方式但不记录敏感凭证数据；
- 删除、退出所有设备和密码修改的边界符合契约。
- 未登录用户只能读取公开 Passkey 设置，不能读取 RP ID 来源诊断或修改设置；
- 普通读者不能读写管理员 Passkey 站点设置；
- 未完成管理员近期重新验证时，修改 Passkey 站点设置返回 `reauth_required`；
- 关闭 Passkey 后密码登录仍可用，已有凭证和用户数据不被删除；
- `rpId`、origin 和 User Verification 不会被前端 PUT 覆盖；
- 设置响应不泄露环境变量、密钥、challenge、公钥或 credential ID。

### 浏览器

在真实 HTTPS origin 上验收：

- Chrome / Edge 桌面端；
- Safari iOS 或 macOS；
- 浏览器不支持 WebAuthn 时仍可正常密码登录；
- 用户取消设备确认时可回退；
- 刷新页面后 Cookie 会话保持；
- 退出后旧会话失效；
- 撤销 Passkey 后重新登录失败；
- 删除一个 Passkey 不影响其他 Passkey；
- 移动端账户安全布局不溢出；
- 深色主题、键盘焦点和错误提示可用。

### 发布

Passkey 迁移、API 和 Web 前端必须一起发布。发布前确认：

1. 正式域名和 `PASSKEY_RP_ID` 一致；
2. HTTPS 和 Cookie 配置有效；
3. 数据库迁移已执行；
4. Web/API 使用同一份 origin 配置；
5. 登录审计可看出 Passkey 登录；
6. 仍可使用密码登录和账户恢复；
7. 旧用户、旧会话和 iOS Bearer 客户端未被破坏。

## 11. 当前待确认事项

本地开发阶段不需要等待正式域名。生产发布前仍需要确认正式站点的 canonical origin，届时再设置生产环境的 RP ID 和 origin 白名单。

本地阶段按以下默认值推进：

- Web 第一阶段，不修改 iOS；
- 密码继续保留；
- 注册 Passkey 需要当前密码确认；
- Passkey 登录要求 User Verification；
- 使用 `attestation: 'none'`；
- 复用现有 HttpOnly Cookie 会话；
- 迁移编号使用 `061_passkeys.sql`；
- 第一阶段不支持多正式域名共享凭证。

## 12. 本地开发建议

当前开发编排固定为：

- Vite Web：`http://localhost:5173`；
- API：`http://127.0.0.1:8787`；
- 浏览器通过 Vite 的 `/api` 代理访问 API，浏览器看到的仍是 `localhost:5173`。

本地 Passkey 配置建议为：

```text
PASSKEY_RP_ID=localhost
PASSKEY_ORIGINS=http://localhost:5173
```

Passkey 显示名称不走环境变量，进入「站点设置 → Passkey」后通过 `rpName` 配置；本地默认值为 `知舟`。

本地进入「站点设置 → Passkey」后可以打开 `enabled`，然后用当前管理员账号测试登录页和个人中心；生产默认仍保持关闭，直到正式域名和 HTTPS 配置完成。

注意事项：

- 浏览器验收统一打开 `http://localhost:5173`，不要在同一套本地数据中混用 `localhost` 和 `127.0.0.1`；
- `127.0.0.1:8787` 只是 Vite 的代理目标，不应作为 Passkey 的 RP ID 或前端 origin；
- 本地浏览器通常将 `localhost` 和回环地址视为潜在可信来源，因此可以用于开发 WebAuthn；生产环境仍必须使用 HTTPS；
- 本地数据库重置后，操作系统或浏览器里的旧 Passkey 仍然存在，但服务端已经没有对应的公钥记录，会表现为“凭证不存在”，这不是认证逻辑自动恢复失败；
- 建议使用单独的浏览器开发配置文件，并给本地凭证命名为“知舟本地开发”；
- 手机无法把自己的 `localhost` 解析为开发电脑。需要在手机上测试时，应使用独立的 HTTPS 测试环境或已经在设备上信任的本地 HTTPS 域名，不要直接把手机浏览器指向 `localhost:5173`；
- 本地 Passkey 与生产 Passkey 天然隔离，因为 RP ID 分别为 `localhost` 和正式站点域名。

本地阶段不建议设置生产 `SITE_URL` 来“模拟”正式域名。Passkey 只需要显式读取本地 `PASSKEY_RP_ID` 和 `PASSKEY_ORIGINS`；这样不会额外改变 SEO、站点 canonical 或生产 Cookie 判断。
