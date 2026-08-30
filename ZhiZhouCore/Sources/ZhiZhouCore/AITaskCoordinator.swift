import Foundation

public struct AITaskOperationRecord: Codable, Equatable, Identifiable, Sendable {
    public var id: String { key }

    public let key: String
    public let requestID: String
    public let kind: String
    public let resourceID: String?
    public let startedAt: Int64
    public var taskID: String?

    public init(
        key: String,
        requestID: String,
        kind: String,
        resourceID: String? = nil,
        startedAt: Int64,
        taskID: String? = nil
    ) {
        self.key = key
        self.requestID = requestID
        self.kind = kind
        self.resourceID = resourceID
        self.startedAt = startedAt
        self.taskID = taskID
    }
}

public struct AITaskLaunch: Equatable, Sendable {
    public let record: AITaskOperationRecord
    public let reusedExistingOperation: Bool

    public init(record: AITaskOperationRecord, reusedExistingOperation: Bool) {
        self.record = record
        self.reusedExistingOperation = reusedExistingOperation
    }
}

public enum AITaskCoordinationError: LocalizedError, Equatable {
    case inactiveSession
    case emptyTaskID
    case sessionChanged

    public var errorDescription: String? {
        switch self {
        case .inactiveSession:
            return "AI 任务协调器尚未绑定账号"
        case .emptyTaskID:
            return "AI 服务没有返回任务 ID"
        case .sessionChanged:
            return "账号已切换，本次 AI 任务结果已忽略"
        }
    }
}

public struct AITaskLocalStore {
    public let defaults: UserDefaults

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    public func load(userID: String) -> [String: AITaskOperationRecord] {
        guard let data = defaults.data(forKey: recordsKey(userID: userID)) else { return [:] }
        return (try? JSONDecoder().decode([String: AITaskOperationRecord].self, from: data)) ?? [:]
    }

    public func save(_ records: [String: AITaskOperationRecord], userID: String) {
        guard let data = try? JSONEncoder().encode(records) else { return }
        defaults.set(data, forKey: recordsKey(userID: userID))
    }

    private func recordsKey(userID: String) -> String {
        "zhizhou.aiTaskCoordinator.user.\(encodedUserID(userID))"
    }

    private func encodedUserID(_ userID: String) -> String {
        Data(userID.utf8)
            .base64EncodedString()
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "+", with: "-")
    }
}

/// Coordinates quota-bearing AI background jobs across views and app lifecycle.
/// A record is persisted before the POST begins, so an interrupted response can
/// be reconciled later by the stable request ID instead of creating another job.
@MainActor
public final class AITaskCoordinator {
    public typealias Recoverer = (AITaskOperationRecord) async throws -> String?
    public typealias Launcher = (String) async throws -> String

    private struct Session: Equatable {
        let userID: String
        let generation: UUID
    }

    private struct StartOutcome: Sendable {
        let taskID: String
        let recovered: Bool
    }

    private let localStore: AITaskLocalStore
    private let maxPendingAgeMilliseconds: Int64
    private var activeUserID: String?
    private var sessionGeneration = UUID()
    private var recordsByKey: [String: AITaskOperationRecord] = [:]
    private var startsByKey: [String: Task<StartOutcome, Error>] = [:]

    public init(
        localStore: AITaskLocalStore = AITaskLocalStore(),
        maxPendingAge: TimeInterval = 24 * 60 * 60
    ) {
        self.localStore = localStore
        self.maxPendingAgeMilliseconds = Int64(max(60, maxPendingAge) * 1000)
    }

    public var records: [AITaskOperationRecord] {
        recordsByKey.values.sorted { $0.startedAt > $1.startedAt }
    }

    public func activate(userID: String) {
        let trimmed = userID.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            deactivate()
            return
        }
        guard activeUserID != trimmed else { return }

        persistCurrent()
        cancelLocalStarts()
        sessionGeneration = UUID()
        activeUserID = trimmed
        recordsByKey = localStore.load(userID: trimmed)
        pruneExpiredPendingRecords()
        persistCurrent()
    }

    public func deactivate() {
        persistCurrent()
        cancelLocalStarts()
        sessionGeneration = UUID()
        activeUserID = nil
        recordsByKey = [:]
    }

    public func record(for key: String) -> AITaskOperationRecord? {
        recordsByKey[key]
    }

    public func records(withPrefix prefix: String) -> [AITaskOperationRecord] {
        records.filter { $0.key.hasPrefix(prefix) }
    }

    public func register(_ record: AITaskOperationRecord) {
        guard activeUserID != nil, !record.key.isEmpty, !record.requestID.isEmpty else { return }
        if let current = recordsByKey[record.key], current.startedAt > record.startedAt {
            return
        }
        recordsByKey[record.key] = record
        persistCurrent()
    }

    /// Resolve a persisted operation without creating a new server task.
    public func recover(key: String, using recoverer: @escaping Recoverer) async throws -> AITaskOperationRecord? {
        guard let session = currentSession else { throw AITaskCoordinationError.inactiveSession }
        guard var record = recordsByKey[key] else { return nil }
        if record.taskID?.isEmpty == false { return record }

        guard let taskID = try await recoverer(record), !taskID.isEmpty else {
            guard isCurrent(session) else { throw AITaskCoordinationError.sessionChanged }
            return record
        }
        guard isCurrent(session), recordsByKey[key]?.requestID == record.requestID else {
            throw AITaskCoordinationError.sessionChanged
        }
        record.taskID = taskID
        recordsByKey[key] = record
        persistCurrent()
        return record
    }

    /// Join an existing launch for the same logical key, recover an interrupted
    /// launch by request ID, or create exactly one new server task.
    public func start(
        key: String,
        kind: String,
        resourceID: String? = nil,
        recover: @escaping Recoverer,
        launch: @escaping Launcher
    ) async throws -> AITaskLaunch {
        let normalizedKey = key.trimmingCharacters(in: .whitespacesAndNewlines)
        let normalizedKind = kind.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedKey.isEmpty, !normalizedKind.isEmpty else {
            throw AITaskCoordinationError.emptyTaskID
        }
        guard let session = currentSession else { throw AITaskCoordinationError.inactiveSession }

        if let record = recordsByKey[normalizedKey], record.taskID?.isEmpty == false {
            return AITaskLaunch(record: record, reusedExistingOperation: true)
        }

        if let inFlight = startsByKey[normalizedKey] {
            let outcome = try await inFlight.value
            return try apply(
                outcome,
                key: normalizedKey,
                session: session,
                reusedExistingOperation: true
            )
        }

        let existingRecord = recordsByKey[normalizedKey]
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        let record = existingRecord ?? AITaskOperationRecord(
            key: normalizedKey,
            requestID: UUID().uuidString.lowercased(),
            kind: normalizedKind,
            resourceID: resourceID,
            startedAt: now
        )
        recordsByKey[normalizedKey] = record
        persistCurrent()

        let startTask = Task { () throws -> StartOutcome in
            if existingRecord != nil,
               let recoveredTaskID = try await recover(record),
               !recoveredTaskID.isEmpty {
                return StartOutcome(taskID: recoveredTaskID, recovered: true)
            }

            let launchedTaskID = try await launch(record.requestID)
            let normalizedTaskID = launchedTaskID.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !normalizedTaskID.isEmpty else { throw AITaskCoordinationError.emptyTaskID }
            return StartOutcome(taskID: normalizedTaskID, recovered: false)
        }
        startsByKey[normalizedKey] = startTask

        do {
            let outcome = try await startTask.value
            startsByKey.removeValue(forKey: normalizedKey)
            return try apply(
                outcome,
                key: normalizedKey,
                session: session,
                reusedExistingOperation: existingRecord != nil || outcome.recovered
            )
        } catch {
            if isCurrent(session) {
                startsByKey.removeValue(forKey: normalizedKey)
            }
            throw error
        }
    }

    public func finish(key: String, expectedTaskID: String? = nil) {
        guard let record = recordsByKey[key] else { return }
        if let expectedTaskID, record.taskID != expectedTaskID { return }
        startsByKey[key]?.cancel()
        startsByKey.removeValue(forKey: key)
        recordsByKey.removeValue(forKey: key)
        persistCurrent()
    }

    public func finish(taskID: String) {
        let keys = recordsByKey
            .filter { $0.value.taskID == taskID }
            .map(\.key)
        for key in keys {
            finish(key: key, expectedTaskID: taskID)
        }
    }

    public func isCurrent(key: String, taskID: String) -> Bool {
        recordsByKey[key]?.taskID == taskID
    }

    private func apply(
        _ outcome: StartOutcome,
        key: String,
        session: Session,
        reusedExistingOperation: Bool
    ) throws -> AITaskLaunch {
        guard isCurrent(session), var record = recordsByKey[key] else {
            throw AITaskCoordinationError.sessionChanged
        }
        record.taskID = outcome.taskID
        recordsByKey[key] = record
        persistCurrent()
        return AITaskLaunch(record: record, reusedExistingOperation: reusedExistingOperation)
    }

    private var currentSession: Session? {
        guard let activeUserID else { return nil }
        return Session(userID: activeUserID, generation: sessionGeneration)
    }

    private func isCurrent(_ session: Session) -> Bool {
        activeUserID == session.userID && sessionGeneration == session.generation
    }

    private func pruneExpiredPendingRecords() {
        let cutoff = Int64(Date().timeIntervalSince1970 * 1000) - maxPendingAgeMilliseconds
        recordsByKey = recordsByKey.filter { _, record in
            record.taskID?.isEmpty == false || record.startedAt >= cutoff
        }
    }

    private func persistCurrent() {
        guard let activeUserID else { return }
        localStore.save(recordsByKey, userID: activeUserID)
    }

    private func cancelLocalStarts() {
        startsByKey.values.forEach { $0.cancel() }
        startsByKey.removeAll(keepingCapacity: false)
    }
}
