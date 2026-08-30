import Foundation
import ZhiZhouCore

/// App-facing bridge for the account-scoped core coordinator.
/// Views own presentation and polling; this service owns launch identity,
/// deduplication, persistence, and recovery across view/app lifecycle.
@MainActor
final class AdminAITaskCoordinator {
    static let shared = AdminAITaskCoordinator()

    enum OperationKey {
        static let coverPrompt = "admin.ai.cover.prompt"
        static let coverImage = "admin.ai.cover.image"
        static let writing = "admin.ai.writing.generate"
        static let retryPrefix = "admin.ai.retry."

        static func retry(taskID: String) -> String {
            "\(retryPrefix)\(taskID)"
        }
    }

    struct Launch {
        let taskID: String
        let snapshot: AiTaskInfo?
        let reusedExistingOperation: Bool
    }

    private let coordinator: AITaskCoordinator
    private let defaults: UserDefaults

    init(
        coordinator: AITaskCoordinator? = nil,
        defaults: UserDefaults = .standard
    ) {
        self.coordinator = coordinator ?? AITaskCoordinator()
        self.defaults = defaults
    }

    func activate(userID: String) {
        coordinator.activate(userID: userID)
        migrateLegacyCoverPromptIfNeeded()
    }

    func deactivate() {
        coordinator.deactivate()
    }

    func start(
        key: String,
        kind: String,
        resourceID: String? = nil,
        launch: @escaping (String) async throws -> String
    ) async throws -> Launch {
        if coordinator.record(for: key) != nil,
           let existing = try await resume(key: key, recoveryAttempts: 2) {
            return Launch(
                taskID: existing.id,
                snapshot: existing,
                reusedExistingOperation: true
            )
        }

        let result = try await coordinator.start(
            key: key,
            kind: kind,
            resourceID: resourceID,
            recover: { record in
                try await AdminAPI.recoverAiTask(
                    clientRequestID: record.requestID,
                    kind: record.kind,
                    resourceID: record.resourceID,
                    startedAt: record.startedAt
                )?.id
            },
            launch: launch
        )
        let taskID = result.record.taskID ?? ""
        guard !taskID.isEmpty else { throw AITaskCoordinationError.emptyTaskID }
        let snapshot = try? await AdminAPI.aiTask(id: taskID).task
        return Launch(
            taskID: taskID,
            snapshot: snapshot,
            reusedExistingOperation: result.reusedExistingOperation
        )
    }

    /// Reconnect a persisted operation to its server task without launching a replacement.
    func resume(key: String, recoveryAttempts: Int = 1) async throws -> AiTaskInfo? {
        guard coordinator.record(for: key) != nil else { return nil }
        let attempts = max(1, recoveryAttempts)
        var resolved = coordinator.record(for: key)

        if resolved?.taskID?.isEmpty != false {
            for attempt in 0..<attempts {
                resolved = try await coordinator.recover(key: key) { record in
                    try await AdminAPI.recoverAiTask(
                        clientRequestID: record.requestID,
                        kind: record.kind,
                        resourceID: record.resourceID,
                        startedAt: record.startedAt
                    )?.id
                }
                if resolved?.taskID?.isEmpty == false { break }
                if attempt + 1 < attempts {
                    try await Task.sleep(nanoseconds: 1_000_000_000)
                }
            }
        }

        guard let taskID = resolved?.taskID, !taskID.isEmpty else { return nil }
        do {
            let task = try await AdminAPI.aiTask(id: taskID).task
            if !task.isRunning {
                coordinator.finish(key: key, expectedTaskID: taskID)
            }
            return task
        } catch {
            if case APIError.http(status: 404, message: _) = error {
                coordinator.finish(key: key, expectedTaskID: taskID)
                return nil
            }
            throw error
        }
    }

    func finish(key: String, taskID: String) {
        coordinator.finish(key: key, expectedTaskID: taskID)
    }

    func finish(taskID: String) {
        coordinator.finish(taskID: taskID)
    }

    func isCurrent(key: String, taskID: String) -> Bool {
        coordinator.isCurrent(key: key, taskID: taskID)
    }

    func reconcile(_ tasks: [AiTaskInfo]) {
        let terminalIDs = Set(tasks.filter { !$0.isRunning }.map(\.id))
        for record in coordinator.records(withPrefix: OperationKey.retryPrefix) {
            guard let taskID = record.taskID, terminalIDs.contains(taskID) else { continue }
            coordinator.finish(key: record.key, expectedTaskID: taskID)
        }
    }

    private func migrateLegacyCoverPromptIfNeeded() {
        guard coordinator.record(for: OperationKey.coverPrompt) == nil else { return }

        let taskID = defaults.string(forKey: "zhizhou.ai.coverPromptTaskId") ?? ""
        let requestID = defaults.string(forKey: "zhizhou.ai.coverPromptRequestId") ?? ""
        let novelID = defaults.string(forKey: "zhizhou.ai.coverPromptNovelId") ?? ""
        let startedAt = defaults.object(forKey: "zhizhou.ai.coverPromptStartedAt") as? Int ?? 0
        guard !taskID.isEmpty || !requestID.isEmpty else { return }

        coordinator.register(AITaskOperationRecord(
            key: OperationKey.coverPrompt,
            requestID: requestID.isEmpty ? UUID().uuidString.lowercased() : requestID,
            kind: "cover_prompt",
            resourceID: novelID.isEmpty ? nil : novelID,
            startedAt: Int64(startedAt),
            taskID: taskID.isEmpty ? nil : taskID
        ))
        defaults.removeObject(forKey: "zhizhou.ai.coverPromptTaskId")
        defaults.removeObject(forKey: "zhizhou.ai.coverPromptRequestId")
        defaults.removeObject(forKey: "zhizhou.ai.coverPromptNovelId")
        defaults.removeObject(forKey: "zhizhou.ai.coverPromptStartedAt")
    }
}
