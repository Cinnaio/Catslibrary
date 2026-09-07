import Foundation
import Observation
import ZhiZhouCore

/// 应用全局状态：登录会话 + 启动引导。
@Observable
@MainActor
final class AppState {
    static let shared = AppState()

    var user: User?
    var isBooting = true
    /// 启动时恢复会话因网络/服务器问题失败（token 仍在），提示用户稍后重试。
    var sessionRestoreFailed = false
    private(set) var isUpdatingAccount = false

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
        #if DEBUG && targetEnvironment(simulator)
        if VisualAudit.enabled {
            APIClient.shared.token = VisualAudit.scenario == "login" ? nil : "audit-token"
            Task {
                if VisualAudit.scenario == "restore-error" {
                    sessionRestoreFailed = true
                } else if VisualAudit.scenario != "login" {
                    await activateAccount(VisualAudit.user)
                }
                isBooting = false
            }
            return
        }
        #endif
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
            // 本地账号已恢复即可进入主界面；非关键同步放到首屏之后，避免慢网阻塞启动。
            isBooting = false
            syncAccountStateInBackground()
            return
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
            syncAccountStateInBackground()
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
            syncAccountStateInBackground()
            AppObservability.shared.track("auth_register_succeeded")
        } catch {
            AppObservability.shared.capture(error: error, context: "auth.register")
            throw error
        }
    }

    func updateProfile(displayName: String, bio: String) async throws {
        if let error = AccountPolicy.profileError(displayName: displayName, bio: bio) {
            throw APIError.http(status: 400, message: error)
        }
        let body = try APIClient.shared.jsonBody([
            "displayName": displayName.trimmingCharacters(in: .whitespacesAndNewlines),
            "bio": bio.trimmingCharacters(in: .whitespacesAndNewlines),
        ])
        try await updateAccount("PUT", "/api/auth/me", body: body)
    }

    func updateAvatar(_ imageData: Data) async throws {
        guard !imageData.isEmpty, imageData.count <= 1_024 * 1_024 else {
            throw APIError.http(status: 400, message: "头像不能超过 1MB")
        }
        let boundary = "Boundary-\(UUID().uuidString)"
        var body = Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"avatar\"; filename=\"avatar.jpg\"\r\nContent-Type: image/jpeg\r\n\r\n".utf8)
        body.append(imageData)
        body.append(Data("\r\n--\(boundary)--\r\n".utf8))
        try await updateAccount(
            "PUT", "/api/auth/avatar", body: body,
            contentType: "multipart/form-data; boundary=\(boundary)"
        )
    }

    func removeAvatar() async throws {
        try await updateAccount("DELETE", "/api/auth/avatar")
    }

    private func updateAccount(_ method: String, _ path: String, body: Data? = nil, contentType: String? = nil) async throws {
        guard !isUpdatingAccount, let userID = user?.id, let token = APIClient.shared.token else {
            throw CancellationError()
        }
        isUpdatingAccount = true
        defer { isUpdatingAccount = false }
        let response: MeResponse = try await APIClient.shared.request(
            method, path, body: body, auth: true, contentType: contentType, expectedToken: token
        )
        guard APIClient.shared.token == token, user?.id == userID, response.user.id == userID else {
            throw CancellationError()
        }
        user = response.user
    }

    func changePassword(current: String, new: String, confirmation: String) async throws {
        if let error = AccountPolicy.passwordError(current: current, new: new, confirmation: confirmation) {
            throw APIError.http(status: 400, message: error)
        }
        guard !isUpdatingAccount, let userID = user?.id, let token = APIClient.shared.token else {
            throw CancellationError()
        }
        isUpdatingAccount = true
        defer { isUpdatingAccount = false }
        await ReaderSettingsStore.shared.flush()
        await ReaderProgressStore.shared.flush()
        guard APIClient.shared.beginTokenRotation(expectedToken: token) else { throw CancellationError() }
        defer { APIClient.shared.finishTokenRotation(expectedToken: token) }
        let body = try APIClient.shared.jsonBody(["currentPassword": current, "newPassword": new])
        let response: LoginResponse = try await APIClient.shared.request(
            "POST", "/api/auth/change-password", body: body, auth: true, expectedToken: token
        )
        guard APIClient.shared.token == token, user?.id == userID, response.user.id == userID else {
            throw CancellationError()
        }
        guard !response.token.isEmpty else { throw APIError.invalidResponse }
        APIClient.shared.token = response.token
        user = response.user
        OfflineReadingStore.shared.activate(userID: userID, token: response.token)
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

    /// 账号已经可用后再同步非关键数据，避免认证冷启动和登录按钮被网络延迟拖住。
    private func syncAccountStateInBackground() {
        Task { @MainActor in
            await ReaderSettingsStore.shared.syncFromServer()
            await ReaderProgressStore.shared.flush()
        }
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
