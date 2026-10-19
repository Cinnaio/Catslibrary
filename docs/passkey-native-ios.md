# iOS 原生 Passkey 阶段说明

本阶段把 iOS 客户端接入服务端现有 Passkey 契约，不新增另一套账号或凭据存储：

- 原生登录使用 `ASAuthorizationPlatformPublicKeyCredentialProvider`，调用 `/api/auth/passkeys/login/options` 与 `/api/auth/passkeys/login/verify`。
- 原生注册使用 `/api/auth/passkeys/register/options` 与 `/api/auth/passkeys/register/verify`，注册前由服务端要求当前密码确认。
- 登录成功后仍由服务端返回 Bearer token，继续写入现有 Keychain，并沿用 `AppState.bootstrap()` 的会话恢复逻辑。
- 账户与安全页支持列出、重命名、撤销 Passkey；撤销服务端凭据不会主动清理当前 Bearer 会话。

## Associated Domains 发布门槛

工程已加入：

```text
webcredentials:catrr.uk
```

正式域名必须提供 `https://catrr.uk/.well-known/apple-app-site-association`，且不能发生 HTTP 重定向。发布前要把 Apple Developer Team ID 替换到下面的真实文件中：

```json
{
  "webcredentials": {
    "apps": ["<APPLE_TEAM_ID>.com.zhizhou.app"]
  }
}
```

仓库不提交 `<APPLE_TEAM_ID>` 占位文件，避免把一个看似完整但无法被系统信任的 AASA 配置部署到线上。上线前还要确认服务端运行配置与原生客户端使用同一 RP：

```text
PASSKEY_RP_ID=catrr.uk
PASSKEY_ORIGINS=https://catrr.uk
```

如果未来使用 staging 域名，需要同步调整 `project.yml` 的 Associated Domains、AASA 文件、服务端 RP ID/Origin 和 `ServerConfig`，不能只改其中一项。iOS 真机不能把开发机的 `localhost` 当作服务端，因此本地 Web Passkey 与原生真机验证应使用 HTTPS staging 或正式域名。

## 验收边界

Windows 本地可以检查 Swift 源码、XcodeGen 配置、entitlements XML 和 API 路径；不能在没有 Xcode 的环境证明 AuthenticationServices 编译、Associated Domains 生效或系统钥匙串弹窗行为。

macOS CI 必须至少完成：

1. XcodeGen 生成工程并通过 Release build。
2. 真机注册一个 Passkey，退出后使用原生登录。
3. 冷启动恢复 Bearer 会话，验证退出登录后 token 行为不变。
4. 在 iOS 端撤销凭据，再确认该凭据无法登录；密码登录仍可用。
5. 在 Web 端注册或撤销后刷新 iOS 管理页，确认列表与服务端一致。
