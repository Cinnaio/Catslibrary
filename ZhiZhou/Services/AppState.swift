import Foundation

/// 应用全局状态：登录会话 + 启动引导。
final class AppState: ObservableObject {
    static let shared = AppState()

    @Published var user: User?
    @Published var isBooting = true

    private init() {
        Task { await bootstrap() }
    }

    /// 启动时用 Keychain 中的 token 恢复会话（失败则清除 token）
    func bootstrap() async {
        guard APIClient.shared.isAuthenticated else {
            isBooting = false
            return
        }
        do {
            let r: MeResponse = try await APIClient.shared.get("/api/auth/me", auth: true)
            user = r.user
            await ReaderSettingsStore.shared.syncFromServer()
        } catch {
            APIClient.shared.token = nil
        }
        isBooting = false
    }

    func login(username: String, password: String) async throws {
        let body = try APIClient.shared.jsonBody(["username": username, "password": password])
        let r: LoginResponse = try await APIClient.shared.post("/api/auth/login", body: body)
        APIClient.shared.token = r.token
        user = r.user
        await ReaderSettingsStore.shared.syncFromServer()
    }

    func register(username: String, password: String, invite: String) async throws {
        var payload: [String: String] = ["username": username, "password": password]
        if !invite.isEmpty { payload["invite"] = invite }
        let body = try APIClient.shared.jsonBody(payload)
        let r: LoginResponse = try await APIClient.shared.post("/api/auth/register", body: body)
        APIClient.shared.token = r.token
        user = r.user
        await ReaderSettingsStore.shared.syncFromServer()
    }

    func logout() async {
        try? await APIClient.shared.requestVoid("POST", "/api/auth/logout", auth: true)
        APIClient.shared.token = nil
        user = nil
    }
}
