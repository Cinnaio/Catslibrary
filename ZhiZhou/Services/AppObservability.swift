import Foundation
import MetricKit
import Observation
import UIKit

/// 第一方、可关闭的移动端可观测性。
///
/// 默认不发送任何遥测。用户在“我的 → 隐私与诊断”主动开启后，才会把
/// 匿名事件和 MetricKit 诊断批量发送到服务端；事件中禁止放入正文、搜索词、
/// 密码、用户名或用户 ID。
@MainActor
@Observable
final class AppObservability {
    static let shared = AppObservability()

    struct TelemetryEvent: Codable, Identifiable {
        let id: String
        let type: String
        let name: String
        let severity: String
        let properties: [String: String]
        let createdAt: Int64
    }

    private struct TelemetryBatch: Encodable {
        let installId: String
        let sessionId: String
        let appVersion: String
        let buildVersion: String
        let osVersion: String
        let deviceModel: String
        let events: [TelemetryEvent]
    }

    private struct IngestResponse: Decodable {
        let accepted: Int
    }

    private static let consentKey = "zhizhou.telemetry.consent.v1"
    private static let installIDKey = "zhizhou.telemetry.install-id.v1"
    private static let queueKey = "zhizhou.telemetry.queue.v1"
    private static let queueLimit = 100
    private static let diagnosticLimit = 56 * 1024

    private let defaults: UserDefaults
    private let installID: String
    private let sessionID: String
    private(set) var isDiagnosticsEnabled: Bool
    private var queue: [TelemetryEvent]
    private var flushTask: Task<Void, Never>?
    private var isFlushing = false
    private var hasStarted = false
    private var metricKitCollector: MetricKitCollector?

    private init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        self.installID = Self.loadOrCreateInstallID(defaults: defaults)
        self.sessionID = UUID().uuidString.lowercased()
        self.isDiagnosticsEnabled = defaults.bool(forKey: Self.consentKey)
        if let data = defaults.data(forKey: Self.queueKey),
           let saved = try? JSONDecoder().decode([TelemetryEvent].self, from: data) {
            self.queue = Array(saved.suffix(Self.queueLimit))
        } else {
            self.queue = []
        }
    }

    /// 在应用启动时调用一次，注册 MetricKit，并记录一次匿名启动事件。
    func start() {
        guard !hasStarted else { return }
        hasStarted = true
        metricKitCollector = MetricKitCollector()
        track("app_launch", properties: ["page": "root"])
    }

    func setDiagnosticsEnabled(_ enabled: Bool) {
        isDiagnosticsEnabled = enabled
        defaults.set(enabled, forKey: Self.consentKey)
        flushTask?.cancel()
        flushTask = nil

        if enabled {
            track("diagnostics_enabled")
            scheduleFlush()
        } else {
            // 关闭开关时一并清除尚未发送的本地队列，避免用户以为数据仍会上传。
            queue.removeAll(keepingCapacity: false)
            persistQueue()
        }
    }

    /// 记录不含内容的功能事件。仅使用白名单事件名和短属性。
    func track(_ name: String, type: String = "event", severity: String = "info", properties: [String: String] = [:]) {
        guard isDiagnosticsEnabled else { return }
        guard Self.validEventName(name), ["event", "error", "metric", "diagnostic"].contains(type) else { return }

        let safeProperties = properties.reduce(into: [String: String]()) { result, item in
            guard Self.validPropertyKey(item.key) else { return }
            result[item.key] = Self.capped(item.value, bytes: item.key == "json" || item.key == "diagnosticJSON" ? Self.diagnosticLimit : 240)
        }
        queue.append(
            TelemetryEvent(
                id: UUID().uuidString.lowercased(),
                type: type,
                name: name,
                severity: ["info", "warning", "error"].contains(severity) ? severity : "info",
                properties: safeProperties,
                createdAt: Int64(Date().timeIntervalSince1970 * 1000)
            )
        )
        if queue.count > Self.queueLimit {
            queue.removeFirst(queue.count - Self.queueLimit)
        }
        persistQueue()
        scheduleFlush()
    }

    /// 只上传错误类别和上下文，不上传 localizedDescription，避免服务端收到正文或账号信息。
    func capture(error: Error, context: String) {
        var properties: [String: String] = [
            "context": Self.capped(context, bytes: 80),
            "errorKind": String(reflecting: type(of: error)),
        ]
        if let apiError = error as? APIError {
            switch apiError {
            case .http(let status, _):
                properties["httpStatus"] = String(status)
            case .network:
                properties["network"] = "true"
            case .unauthorized:
                properties["auth"] = "unauthorized"
            case .notConfigured:
                properties["config"] = "missing"
            case .invalidResponse:
                properties["response"] = "invalid"
            }
        }
        track("request_failed", type: "error", severity: "error", properties: properties)
    }

    /// MetricKit 回调只传 Data 到主线程；不在这里解析或上传原始对象。
    func recordMetricKitPayload(_ data: Data, kind: String) {
        guard let json = String(data: data, encoding: .utf8) else { return }
        track(
            kind == "diagnostic" ? "metric_diagnostic" : "metric_payload",
            type: kind,
            properties: ["json": Self.capped(json, bytes: Self.diagnosticLimit)]
        )
    }

    /// 在应用回到前台或场景切换时尽力发送；失败会保留队列等待下一次机会。
    func flush() async {
        guard isDiagnosticsEnabled, !queue.isEmpty, !isFlushing else { return }
        isFlushing = true
        let pending = queue
        defer { isFlushing = false }

        do {
            let body = try JSONEncoder().encode(
                TelemetryBatch(
                    installId: installID,
                    sessionId: sessionID,
                    appVersion: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "",
                    buildVersion: Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "",
                    osVersion: UIDevice.current.systemVersion,
                    deviceModel: UIDevice.current.model,
                    events: pending
                )
            )
            let _: IngestResponse = try await APIClient.shared.post("/api/mobile/telemetry", body: body)
            let sentIDs = Set(pending.map(\.id))
            queue.removeAll { sentIDs.contains($0.id) }
            persistQueue()
        } catch {
            // 遥测不得影响主业务；保留待发送队列，下一次 active 时重试。
        }
    }

    private func scheduleFlush() {
        flushTask?.cancel()
        flushTask = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            guard !Task.isCancelled else { return }
            await self?.flush()
        }
    }

    private func persistQueue() {
        guard let data = try? JSONEncoder().encode(queue) else { return }
        defaults.set(data, forKey: Self.queueKey)
    }

    private static func loadOrCreateInstallID(defaults: UserDefaults) -> String {
        if let saved = defaults.string(forKey: installIDKey), validAnonymousID(saved) {
            return saved
        }
        let generated = UUID().uuidString.lowercased()
        defaults.set(generated, forKey: installIDKey)
        return generated
    }

    private static func validAnonymousID(_ value: String) -> Bool {
        value.range(of: "^[A-Za-z0-9_-]{16,80}$", options: .regularExpression) != nil
    }

    private static func validEventName(_ value: String) -> Bool {
        value.range(of: "^[a-z][a-z0-9_.-]{1,63}$", options: .regularExpression) != nil
    }

    private static func validPropertyKey(_ value: String) -> Bool {
        value.range(of: "^[A-Za-z][A-Za-z0-9_.-]{0,63}$", options: .regularExpression) != nil
    }

    private static func capped(_ value: String, bytes: Int) -> String {
        let data = Data(value.utf8)
        guard data.count > bytes else { return value }
        return String(data: data.prefix(bytes), encoding: .utf8) ?? ""
    }
}

/// MetricKit 使用系统回调线程；回调中只做 Data 转换，再交回应用主线程统一入队。
private final class MetricKitCollector: NSObject, MXMetricManagerSubscriber {
    override init() {
        super.init()
        MXMetricManager.shared.add(self)
    }

    func didReceive(_ payloads: [MXMetricPayload]) {
        let data = payloads.map { $0.jsonRepresentation() }
        Task { @MainActor in
            for payload in data {
                AppObservability.shared.recordMetricKitPayload(payload, kind: "metric")
            }
        }
    }

    func didReceive(_ payloads: [MXDiagnosticPayload]) {
        let data = payloads.map { $0.jsonRepresentation() }
        Task { @MainActor in
            for payload in data {
                AppObservability.shared.recordMetricKitPayload(payload, kind: "diagnostic")
            }
        }
    }
}
