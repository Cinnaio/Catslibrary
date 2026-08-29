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
        APIClient.shared.onUnauthorized = { [weak self] in
            Task { @MainActor in
                ReaderSettingsStore.shared.deactivate()
                ReaderProgressStore.shared.deactivate()
                self?.user = nil
                self?.sessionRestoreFailed = false
                self?.isBooting = false
            }
        }
        Task { await bootstrap() }
    }

    /// 启动时用 Keychain 中的 token 恢复会话。
    /// 仅鉴权失败（401/403）清 token；瞬时网络错误保留会话，标记恢复失败。
    func bootstrap() async {
        guard APIClient.shared.isAuthenticated else {
            isBooting = false
            return
        }
        do {
            let r: MeResponse = try await APIClient.shared.get("/api/auth/me", auth: true)
            user = r.user
            sessionRestoreFailed = false
            ReaderSettingsStore.shared.activate(userID: r.user.id)
            ReaderProgressStore.shared.activate(userID: r.user.id)
            await ReaderSettingsStore.shared.syncFromServer()
            await ReaderProgressStore.shared.flush()
        } catch let error as APIError {
            switch error {
            case .unauthorized:
                // APIClient 已清 token
                sessionRestoreFailed = false
            case .http(let status, _) where status == 401 || status == 403:
                APIClient.shared.invalidateSession()
                sessionRestoreFailed = false
            default:
                // 网络/服务器暂时不可用：保留 token，标记恢复失败
                sessionRestoreFailed = APIClient.shared.isAuthenticated
            }
        } catch {
            sessionRestoreFailed = APIClient.shared.isAuthenticated
        }
        isBooting = false
    }

    func login(username: String, password: String) async throws {
        let body = try APIClient.shared.jsonBody(["username": username, "password": password])
        let r: LoginResponse = try await APIClient.shared.post("/api/auth/login", body: body)
        APIClient.shared.token = r.token
        user = r.user
        sessionRestoreFailed = false
        ReaderSettingsStore.shared.activate(userID: r.user.id)
        ReaderProgressStore.shared.activate(userID: r.user.id)
        await ReaderSettingsStore.shared.syncFromServer()
        await ReaderProgressStore.shared.flush()
    }

    func register(username: String, password: String, invite: String) async throws {
        var payload: [String: String] = ["username": username, "password": password]
        if !invite.isEmpty { payload["invite"] = invite }
        let body = try APIClient.shared.jsonBody(payload)
        let r: LoginResponse = try await APIClient.shared.post("/api/auth/register", body: body)
        APIClient.shared.token = r.token
        user = r.user
        sessionRestoreFailed = false
        ReaderSettingsStore.shared.activate(userID: r.user.id)
        ReaderProgressStore.shared.activate(userID: r.user.id)
        await ReaderSettingsStore.shared.syncFromServer()
        await ReaderProgressStore.shared.flush()
    }

    func logout() async {
        // 先尽力写回最新阅读状态；网络不可用时本地 outbox 仍会按账号保留。
        await ReaderSettingsStore.shared.flush()
        await ReaderProgressStore.shared.flush()
        try? await APIClient.shared.requestVoid("POST", "/api/auth/logout", auth: true)
        APIClient.shared.token = nil
        ReaderSettingsStore.shared.deactivate()
        ReaderProgressStore.shared.deactivate()
        user = nil
    }
}
