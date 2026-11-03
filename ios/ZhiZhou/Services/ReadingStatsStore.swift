import Foundation
import Observation
import Network
import ZhiZhouCore

struct ReadingStats: Decodable {
    let start: Int64
    let end: Int64
    let recordedSince: Int64?
    let milliseconds: Int64
    let sessions: Int
    let chapters: Int
    let days: Int
    let novels: [Book]
    let trend: [Bucket]
    struct Book: Decodable, Identifiable {
        let id: String
        let title: String
        let available: Bool
        let milliseconds: Int64
        let chapters: Int
        let lastReadAt: Int64
    }
    struct Bucket: Decodable, Identifiable {
        var id: String { date }
        let date: String
        let milliseconds: Int64
        let sessions: Int
    }
    static func duration(_ milliseconds: Int64) -> String {
        let minutes = milliseconds / 60_000
        if minutes == 0 { return milliseconds > 0 ? "不足 1 分钟" : "0 分钟" }
        if minutes < 60 { return "\(minutes) 分钟" }
        return "\(minutes / 60) 小时 \(minutes % 60) 分钟"
    }
}

/// Owns one foreground reader at a time. Persisted short events retain their IDs
/// until acknowledgement, making retries safe across process and account changes.
@Observable @MainActor
final class ReadingStatsStore {
    static let shared = ReadingStatsStore()
    private(set) var pendingCount = 0
    private(set) var lastSyncError: String?
    private struct Queued: Codable {
        var event: ReadingStatEvent
        let mode: String
    }
    private struct Snapshot: Codable {
        var queue: [Queued] = []
        var sessionID = UUID().uuidString
        var lastActive: Int64 = 0
    }
    private struct Body: Encodable { let userId: String; let events: [ReadingStatEvent] }
    private var snapshot = Snapshot()
    private var key: String?
    private var userID: String?
    private var generation = UUID()
    private var sending = false
    private var owner: UUID?
    private var target: (novel: String, chapter: String, mode: String)?
    private var clock: ReadingActivityClock?
    private var pending: Queued?
    private let networkMonitor = NWPathMonitor()
    private static var now: Int64 { Int64(Date().timeIntervalSince1970 * 1000) }

    private init() {
        networkMonitor.pathUpdateHandler = { [weak self] path in
            guard path.status == .satisfied else { return }
            Task { @MainActor [weak self] in await self?.flush() }
        }
        networkMonitor.start(queue: DispatchQueue(label: "zhizhou.reading-stats.network"))
    }

    func activate(userID: String) {
        deactivate()
        self.userID = userID
        // Include the configured server, preventing records from crossing servers.
        let server = ServerConfig.shared.baseURL?.absoluteString ?? "unconfigured"
        key = "zhizhou.reading-stats.v1:\(server):\(userID)"
        if let key, let data = UserDefaults.standard.data(forKey: key),
           let saved = try? JSONDecoder().decode(Snapshot.self, from: data) { snapshot = saved }
        prune(); persist()
    }

    func deactivate() {
        if let owner { pause(owner: owner) }
        generation = UUID(); userID = nil; key = nil
        snapshot = Snapshot(); pending = nil; clock = nil; owner = nil; target = nil
        pendingCount = 0; lastSyncError = nil
    }

    func activity(owner: UUID) {
        guard self.owner == owner else { return }
        clock?.activity(at: ProcessInfo.processInfo.systemUptime)
    }

    func update(owner: UUID, novel: String, chapter: String?, mode: String, visible: Bool) {
        guard userID != nil else { return }
        // An inactive window cannot pause or steal another window's active reader.
        guard self.owner == nil || self.owner == owner else { return }
        let now = Self.now
        let uptime = ProcessInfo.processInfo.systemUptime
        if clock == nil {
            guard visible, chapter != nil else { return }
            self.owner = owner
            clock = ReadingActivityClock(wall: now, uptime: uptime)
        }
        if let interval = clock?.sample(wall: now, uptime: uptime, visible: visible && chapter != nil), let target {
            if now - snapshot.lastActive >= 300_000 {
                enqueue(); snapshot.sessionID = UUID().uuidString
            }
            snapshot.lastActive = now
            if var item = pending, item.event.end == interval.start,
               item.event.end - item.event.start + interval.end - interval.start <= 30_000 {
                item.event.end = interval.end; pending = item
            } else {
                enqueue()
                pending = Queued(event: ReadingStatEvent(sessionId: snapshot.sessionID, novelId: target.novel,
                    chapterId: target.chapter, start: interval.start, end: interval.end), mode: target.mode)
            }
        } else { enqueue() }
        if target?.chapter != chapter || target?.mode != mode || target?.novel != novel { enqueue() }
        target = chapter.map { (novel, $0, mode) }
        pendingCount = snapshot.queue.count + (pending == nil ? 0 : 1)
        if let pending, pending.event.end - pending.event.start >= 29_000 {
            enqueue(); Task { await flush() }
        }
    }

    func pause(owner: UUID) {
        guard self.owner == owner else { return }
        if let target { update(owner: owner, novel: target.novel, chapter: target.chapter, mode: target.mode, visible: false) }
        enqueue(); clock = nil; target = nil; self.owner = nil
        Task { await flush() }
    }

    func flush() async {
        guard !sending, let userID, let token = APIClient.shared.token else { return }
        enqueue(); prune(); persist()
        let context = generation
        sending = true
        defer { sending = false }
        // Bound the number of requests per flush; foreground timer retries remaining work.
        for _ in 0..<20 {
            guard generation == context, APIClient.shared.token == token else { return }
            let allowedMode = ContentAccessStore.shared.mode
            let eligible = snapshot.queue.filter { $0.mode == "safe" || allowedMode == "adult" }
            guard let first = eligible.first else { return }
            let batch = Array(eligible.filter { $0.mode == first.mode }.prefix(60))
            let ids = Set(batch.map { $0.event.id })
            do {
                let _: EmptyResponse = try await APIClient.shared.request("POST",
                    "/api/reading-stats/events?contentMode=\(first.mode)",
                    body: try APIClient.shared.jsonBody(Body(userId: userID, events: batch.map(\.event))),
                    auth: true, expectedToken: token)
                guard generation == context else { return }
                snapshot.queue.removeAll { ids.contains($0.event.id) }
                lastSyncError = nil; persist()
            } catch {
                guard generation == context else { return }
                if case APIError.http(let status, _) = error, status == 400 {
                    snapshot.queue.removeAll { ids.contains($0.event.id) }; persist()
                } else { lastSyncError = error.localizedDescription; return }
            }
        }
    }

    private func enqueue() {
        guard let pending else { return }
        snapshot.queue.append(pending); self.pending = nil
        prune(); persist()
    }
    private func prune() {
        snapshot.queue = Array(snapshot.queue.filter { $0.event.start > Self.now - 7 * 86_400_000 }.suffix(20_200))
    }
    private func persist() {
        pendingCount = snapshot.queue.count + (pending == nil ? 0 : 1)
        guard let key else { return }
        var saved = snapshot
        if let pending { saved.queue.append(pending) }
        if let data = try? JSONEncoder().encode(saved) { UserDefaults.standard.set(data, forKey: key) }
    }
}
