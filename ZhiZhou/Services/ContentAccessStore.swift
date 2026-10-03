import Foundation
import Observation
import ZhiZhouCore

private struct AdultUnlockResponse: Decodable {
    let adultContentEnabled: Bool
    let expiresIn: Double
}

private struct ReaderContentStatusResponse: Decodable {
    let adultContentEnabled: Bool
    let turnstileConfigured: Bool
    let contentMode: String
    let sessionAuthorized: Bool
    let expiresIn: Double
}

/// 同步账号共享偏好；只有服务端确认当前会话已授权，才恢复实际阅读模式。
@Observable
@MainActor
final class ContentAccessStore {
    static let shared = ContentAccessStore()
    private(set) var mode = "safe"
    private(set) var accountMode = "safe"
    private(set) var revision = UUID()
    private(set) var configured = false
    private(set) var hasSyncedStatus = false
    private(set) var adultContentEnabled = false
    private(set) var isBusy = false
    private(set) var needsLockRetry = false
    private(set) var notice: String?
    private var sessionToken: String?
    private var generation = UUID()
    private var expiresAt: Date?
    private var monitor: Task<Void, Never>?

    func activate(token: String?) {
        monitor?.cancel()
        generation = UUID()
        sessionToken = token
        accountMode = "safe"
        expiresAt = nil
        isBusy = false
        needsLockRetry = false
        configured = false
        hasSyncedStatus = false
        adultContentEnabled = false
        notice = nil
        setMode("safe")
        // Even a safe → safe account boundary invalidates all loaded reader views.
        revision = UUID()
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
        accountMode = "adult"
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
            accountMode = "safe"
            notice = nil
            startMonitor()
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
        // 撤销失败时不能从尚未撤销的远程状态重新开启本机阅读。
        guard !needsLockRetry else { return }
        if let expiresAt, expiresAt <= Date() {
            self.expiresAt = nil
            setMode("safe")
        }
        let context = generation
        isBusy = true
        defer { if context == generation { isBusy = false } }
        do {
            let status: ReaderContentStatusResponse = try await APIClient.shared.request(
                "GET", "/api/content-policy/status", auth: true, expectedToken: token
            )
            guard context == generation, token == APIClient.shared.token else { return }
            configured = status.turnstileConfigured
            hasSyncedStatus = true
            adultContentEnabled = status.adultContentEnabled
            accountMode = status.contentMode == "adult" ? "adult" : "safe"
            let authorized = ContentPolicy.canRestoreAdultMode(
                accountMode: accountMode, sessionAuthorized: status.sessionAuthorized,
                adultContentEnabled: adultContentEnabled, configured: configured, expiresIn: status.expiresIn
            )
            expiresAt = authorized ? Date().addingTimeInterval(status.expiresIn) : nil
            notice = accountMode == "adult" && !authorized
                ? "账号已开启 R18 偏好，但此设备尚未授权或授权已过期，请验证后在线阅读。"
                : nil
            setMode(authorized ? "adult" : "safe")
            startMonitor()
        } catch {
            guard context == generation else { return }
            configured = false
            hasSyncedStatus = false
            expiresAt = nil
            setMode("safe")
            if case APIError.http(let status, _) = error, status == 404 {
                notice = "站点尚未部署原生 R18 配套接口，请更新服务端后重试。"
            } else {
                notice = "内容模式同步失败，已保持安全模式。\(AppCopy.friendlyError(error))"
            }
            startMonitor()
        }
    }

    func revoke(message: String? = nil) {
        monitor?.cancel()
        generation = UUID()
        isBusy = false
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
