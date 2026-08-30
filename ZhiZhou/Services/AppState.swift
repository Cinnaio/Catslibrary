import Foundation
import Observation

/// 应用全局状态：登录会话 + 启动引导。
@Observable
@MainActor
final class AppState {
    static let shared = AppState()

    var user: User?
    var isBooting = true
    /// 启动时恢复会话因网络/服务器问题失败（token 仍在），提示用户稍后重试。
    var sessionRestoreFailed = false

    private init() {
        // 任意 401（含运行中 token 过期）集中处理：清 token + 登出
        APIClient.shared.onUnauthorized = { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self, !APIClient.shared.isAuthenticated else { return }
                await self.deactivateLocalAccount(clearOfflineFallback: true)
                self.user = nil
                self.sessionRestoreFailed = false
                self.isBooting = false
            }
        }
        Task { await bootstrap() }
    }

    /// 启动时用 Keychain 中的 token 恢复会话。
    /// 仅鉴权失败（401/403）清 token；瞬时网络错误保留会话，标记恢复失败。
    func bootstrap() async {
        guard let restoreToken = APIClient.shared.token, !restoreToken.isEmpty else {
            await deactivateLocalAccount(clearOfflineFallback: true)
            isBooting = false
            return
        }
        do {
            let r: MeResponse = try await APIClient.shared.get("/api/auth/me", auth: true)
            // 如果恢复请求期间已经登录/登出了另一个会话，丢弃旧 token 的响应。
            guard APIClient.shared.token == restoreToken else {
                isBooting = false
                return
            }
            await activateAccount(r.user)
            AppObservability.shared.track("auth_restore_succeeded")
            sessionRestoreFailed = false
            await ReaderSettingsStore.shared.syncFromServer()
            await ReaderProgressStore.shared.flush()
        } catch let error as APIError {
            AppObservability.shared.capture(error: error, context: "auth.bootstrap")
            if APIClient.shared.token != restoreToken {
                if !APIClient.shared.isAuthenticated {
                    await deactivateLocalAccount(clearOfflineFallback: true)
                    sessionRestoreFailed = false
                }
                isBooting = false
                return
            }
            switch error {
            case .unauthorized:
                APIClient.shared.invalidateSession(expectedToken: restoreToken)
                await deactivateLocalAccount(clearOfflineFallback: true)
                sessionRestoreFailed = false
            case .http(let status, _) where status == 401 || status == 403:
                APIClient.shared.invalidateSession(expectedToken: restoreToken)
                await deactivateLocalAccount(clearOfflineFallback: true)
                sessionRestoreFailed = false
            default:
                // 网络/服务器暂时不可用：保留 token，标记恢复失败
                sessionRestoreFailed = APIClient.shared.isAuthenticated
                if sessionRestoreFailed {
                    await activateOfflineFallbackIfAvailable()
                }
            }
        } catch {
            AppObservability.shared.capture(error: error, context: "auth.bootstrap")
            if APIClient.shared.token != restoreToken {
                if !APIClient.shared.isAuthenticated {
                    await deactivateLocalAccount(clearOfflineFallback: true)
                    sessionRestoreFailed = false
                }
                isBooting = false
                return
            }
            sessionRestoreFailed = APIClient.shared.isAuthenticated
            if sessionRestoreFailed {
                await activateOfflineFallbackIfAvailable()
            }
        }
        isBooting = false
    }

    func login(username: String, password: String) async throws {
        do {
            let body = try APIClient.shared.jsonBody(["username": username, "password": password])
            let r: LoginResponse = try await APIClient.shared.post("/api/auth/login", body: body)
            APIClient.shared.token = r.token
            await activateAccount(r.user)
            sessionRestoreFailed = false
            await ReaderSettingsStore.shared.syncFromServer()
            await ReaderProgressStore.shared.flush()
            AppObservability.shared.track("auth_login_succeeded")
        } catch {
            AppObservability.shared.capture(error: error, context: "auth.login")
            throw error
        }
    }

    func register(username: String, password: String, invite: String) async throws {
        do {
            var payload: [String: String] = ["username": username, "password": password]
            if !invite.isEmpty { payload["invite"] = invite }
            let body = try APIClient.shared.jsonBody(payload)
            let r: LoginResponse = try await APIClient.shared.post("/api/auth/register", body: body)
            APIClient.shared.token = r.token
            await activateAccount(r.user)
            sessionRestoreFailed = false
            await ReaderSettingsStore.shared.syncFromServer()
            await ReaderProgressStore.shared.flush()
            AppObservability.shared.track("auth_register_succeeded")
        } catch {
            AppObservability.shared.capture(error: error, context: "auth.register")
            throw error
        }
    }

    func logout() async {
        // 先尽力写回最新阅读状态；网络不可用时本地 outbox 仍会按账号保留。
        let tokenAtStart = APIClient.shared.token
        await ReaderSettingsStore.shared.flush()
        await ReaderProgressStore.shared.flush()
        try? await APIClient.shared.requestVoid("POST", "/api/auth/logout", auth: true)
        // 登录操作若在登出请求期间完成，不能让旧登出流程清掉新账号。
        guard APIClient.shared.token == tokenAtStart else { return }
        APIClient.shared.token = nil
        await deactivateLocalAccount(clearOfflineFallback: true)
        user = nil
        sessionRestoreFailed = false
        AppObservability.shared.track("auth_logout")
    }

    private func activateAccount(_ user: User) async {
        await APIClient.shared.setChapterCacheScope(userID: user.id)
        OfflineReadingStore.shared.activate(userID: user.id, token: APIClient.shared.token)
        ReaderSettingsStore.shared.activate(userID: user.id)
        ReaderProgressStore.shared.activate(userID: user.id)
        AdminAITaskCoordinator.shared.activate(userID: user.id)
        self.user = user
    }

    private func deactivateLocalAccount(clearOfflineFallback: Bool) async {
        await APIClient.shared.setChapterCacheScope(userID: nil)
        OfflineReadingStore.shared.deactivate(clearOfflineFallback: clearOfflineFallback)
        ReaderSettingsStore.shared.deactivate()
        ReaderProgressStore.shared.deactivate()
        AdminAITaskCoordinator.shared.deactivate()
    }

    private func activateOfflineFallbackIfAvailable() async {
        guard let token = APIClient.shared.token,
              let userID = OfflineReadingStore.shared.activateLastKnownAccountForOffline(token: token)
        else {
            await deactivateLocalAccount(clearOfflineFallback: false)
            return
        }
        await APIClient.shared.setChapterCacheScope(userID: userID)
        ReaderSettingsStore.shared.activate(userID: userID)
        ReaderProgressStore.shared.activate(userID: userID)
        AdminAITaskCoordinator.shared.activate(userID: userID)
    }
}
