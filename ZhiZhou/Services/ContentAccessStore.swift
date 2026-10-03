import Foundation
import Observation
import ZhiZhouCore

struct ReaderContentPolicyResponse: Decodable {
    let adultContentEnabled: Bool
    let turnstileConfigured: Bool
}

private struct AdultUnlockResponse: Decodable {
    let adultContentEnabled: Bool
    let expiresIn: Double
}

/// 只信任当前登录会话的服务端授权，不从阅读偏好恢复权限。
@Observable
@MainActor
final class ContentAccessStore {
    static let shared = ContentAccessStore()
    private(set) var mode = "safe"
    private(set) var revision = UUID()
    private(set) var configured = false
    private(set) var adultContentEnabled = false
    private(set) var isBusy = false
    private(set) var needsLockRetry = false
    private(set) var notice: String?
    private var sessionToken: String?
    private var generation = UUID()
    private var wantsAdult = false
    private var expiresAt: Date?
    private var monitor: Task<Void, Never>?

    func activate(token: String?) {
        monitor?.cancel()
        generation = UUID()
        sessionToken = token
        wantsAdult = false
        expiresAt = nil
        isBusy = false
        needsLockRetry = false
        configured = false
        adultContentEnabled = false
        notice = nil
        setMode("safe")
        // Even a safe → safe account boundary invalidates all loaded reader views.
        revision = UUID()
    }

    func refreshPolicy() async throws {
        let context = generation
        let policy: ReaderContentPolicyResponse = try await APIClient.shared.get("/api/content-policy")
        guard context == generation else { throw CancellationError() }
        configured = policy.turnstileConfigured
        adultContentEnabled = policy.adultContentEnabled
        if !configured || !adultContentEnabled {
            revoke(message: wantsAdult ? "站点已关闭成人内容或验证不可用，已切回安全模式。" : nil)
        }
    }

    func unlock(challengeToken: String, confirmed: Bool) async throws {
        guard confirmed, !challengeToken.isEmpty, !isBusy,
              let token = sessionToken, token == APIClient.shared.token else { throw CancellationError() }
        generation = UUID()
        let context = generation
        isBusy = true
        defer { if context == generation { isBusy = false } }
        let response: AdultUnlockResponse = try await APIClient.shared.request(
            "POST", "/api/content-policy/unlock",
            body: try JSONSerialization.data(withJSONObject: ["confirmed": confirmed, "turnstileToken": challengeToken] as [String: Any]),
            auth: true, expectedToken: token
        )
        guard context == generation, token == APIClient.shared.token else { throw CancellationError() }
        guard response.adultContentEnabled, response.expiresIn > 0 else { throw APIError.invalidResponse }
        wantsAdult = true
        expiresAt = Date().addingTimeInterval(response.expiresIn)
        notice = nil
        setMode("adult")
        startMonitor()
    }

    func lock() async throws {
        guard !isBusy, let token = sessionToken else { return }
        revoke()
        let context = generation
        isBusy = true
        defer { if context == generation { isBusy = false } }
        needsLockRetry = true
        do {
            let _: EmptyResponse = try await APIClient.shared.request("POST", "/api/content-policy/lock", auth: true, expectedToken: token)
            guard context == generation else { throw CancellationError() }
            needsLockRetry = false
            notice = nil
        } catch {
            if context == generation {
                notice = "本机已切回安全模式，服务端授权尚未撤销，请联网后重试。"
                AppFeedback.warning(notice)
            }
            throw error
        }
    }

    /// 后台立即移除受限正文；回到前台后先复核，再恢复展示。
    func suspend() {
        monitor?.cancel()
        generation = UUID()
        isBusy = false
        setMode("safe")
    }

    func revalidate() async {
        guard !isBusy, let token = sessionToken, token == APIClient.shared.token else { return }
        if wantsAdult, (expiresAt?.timeIntervalSinceNow ?? 0) <= 0 {
            revoke(message: "成人模式授权已过期，请重新验证。")
            return
        }
        let context = generation
        isBusy = true
        defer { if context == generation { isBusy = false } }
        do {
            try await refreshPolicy()
            guard wantsAdult, context == generation else { return }
            guard let expiresAt, expiresAt > Date() else {
                revoke(message: "成人模式授权已过期，请重新验证。")
                return
            }
            let _: EmptyResponse = try await APIClient.shared.request("POST", "/api/content-policy/refresh", auth: true, expectedToken: token)
            guard context == generation, token == APIClient.shared.token else { return }
            setMode("adult")
            startMonitor()
        } catch {
            guard context == generation else { return }
            configured = false
            revoke(message: wantsAdult ? "成人模式授权暂不可用，请联网后重新开启。" : nil)
        }
    }

    func revoke(message: String? = nil) {
        monitor?.cancel()
        generation = UUID()
        isBusy = false
        wantsAdult = false
        expiresAt = nil
        if let message {
            notice = message
            AppFeedback.warning(message)
        }
        setMode("safe")
    }

    private func setMode(_ value: String) {
        guard mode != value else { return }
        mode = value
        revision = UUID()
        APIClient.shared.clearMemoryCaches()
    }

    private func startMonitor() {
        monitor?.cancel()
        monitor = Task { [weak self] in
            guard let self else { return }
            let delay = min(60, max(0.1, self.expiresAt?.timeIntervalSinceNow ?? 60))
            do { try await Task.sleep(for: .seconds(delay)) } catch { return }
            guard !Task.isCancelled else { return }
            await self.revalidate()
        }
    }
}
