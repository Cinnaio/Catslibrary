import Foundation
import Observation
import ZhiZhouCore

@Observable @MainActor
final class AdminAIAgentConversationModel {
    let sessionID: String
    let userID: String
    let api: AdminAgentAPI
    private let site: String
    var session: AIAgentSession
    var events: [AIAgentEvent] = []
    var artifacts: [AIAgentArtifact] = []
    var actions: [AIAgentAction] = []
    var tasks: [String: AIAgentTask] = [:]
    var presets: [AIAgentPreset] = []
    var localDraft: AIAgentLocalDraft { didSet { persist() } }
    var selectedAction: AIAgentAction?
    var hasEarlier = false
    var hasLoaded = false
    var isRefreshing = false
    var loadingEarlier = false
    var sending = false
    var working = false
    var loadError: String?
    var operationError: String?
    var presetError: String?
    var streamErrors: [String: String] = [:]
    private var awaitingTaskID: String?
    @ObservationIgnored private var streams: [String: Task<Void, Never>] = [:]
    @ObservationIgnored private var streamIDs: [String: UUID] = [:]
    @ObservationIgnored private var monitoringID: UUID?
    @ObservationIgnored private var dataRevision = 0

    init(session: AIAgentSession, userID: String, token: String) {
        self.session = session
        sessionID = session.id
        self.userID = userID
        api = AdminAgentAPI(token: token)
        site = ServerConfig.shared.baseURL?.absoluteString ?? ""
        localDraft = AIAgentDraftStore().read(site: site, userID: userID, sessionID: session.id)
    }

    var isCurrentAccount: Bool { APIClient.shared.token == api.token }
    var activeTask: AIAgentTask? { tasks[awaitingTaskID ?? session.activeTaskId] }
    var replying: Bool { awaitingTaskID != nil || activeTask?.isRunning == true }
    var canSend: Bool {
        hasLoaded && isCurrentAccount && !sending && !working && !replying && localDraft.pending == nil
            && !localDraft.input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && localDraft.input.utf16.count <= 8_000
    }
    var liveReply: AIAgentTask? {
        guard let task = activeTask, task.status != "completed", task.progress != nil,
              !AIAgentEvent.containsPreview(events, task: task) else { return nil }
        return task
    }

    private func persist() {
        AIAgentDraftStore().save(localDraft, site: site, userID: userID, sessionID: sessionID)
    }

    func monitor() async {
        pause()
        localDraft = AIAgentDraftStore().read(site: site, userID: userID, sessionID: sessionID)
        let run = UUID()
        monitoringID = run
        defer { if monitoringID == run { pause() } }
        await refresh()
        await loadPresets()
        while !Task.isCancelled && isCurrentAccount && monitoringID == run {
            do { try await Task.sleep(nanoseconds: 12_000_000_000) } catch { return }
            guard monitoringID == run, !Task.isCancelled else { return }
            await refresh()
        }
    }

    func pause() {
        monitoringID = nil
        streams.values.forEach { $0.cancel() }
        streams.removeAll()
        streamIDs.removeAll()
    }

    func loadPresets() async {
        do {
            let value = try await api.presets()
            guard isCurrentAccount, !Task.isCancelled else { return }
            presets = value
            presetError = nil
        } catch {
            guard isCurrentAccount, !Task.isCancelled else { return }
            presetError = AppCopy.friendlyError(error)
        }
    }

    func refresh() async {
        guard isCurrentAccount, !isRefreshing, !Task.isCancelled else { return }
        isRefreshing = true
        let revision = dataRevision
        defer { isRefreshing = false }
        do {
            let value = try await api.detail(sessionID)
            let waiting = awaitingTaskID
            let acknowledged: AIAgentTask?
            if let waiting, value.activeTask?.id != waiting {
                acknowledged = try await api.task(waiting)
            } else { acknowledged = nil }
            guard isCurrentAccount, !Task.isCancelled, revision == dataRevision else { return }
            let oldIDs = Set(events.map(\.id))
            // A long absence may exceed the server's recent-event window. Reset its cursor rather than silently hide a gap.
            let separateWindow = value.hasEarlier && !events.isEmpty && !value.events.isEmpty
                && oldIDs.isDisjoint(with: value.events.map(\.id))
            if !hasLoaded || separateWindow { hasEarlier = value.hasEarlier }
            if value.session.updatedAt >= session.updatedAt { session = value.session }
            events = separateWindow ? value.events : AIAgentEvent.merged(events, value.events)
            if let task = value.activeTask { receive(task) }
            if let acknowledged { receive(acknowledged) }
            if let waiting = awaitingTaskID, value.activeTask?.id == waiting { awaitingTaskID = nil }
            // The session endpoint deliberately omits child task.result. Keep live previews separately.
            for artifact in value.artifacts { receive(artifact.task, snapshot: true) }
            let latestIDs = Set(value.artifacts.map(\.id))
            artifacts = value.artifacts + artifacts.filter { !latestIDs.contains($0.id) }
            actions = value.actions
            if let selected = selectedAction, let latest = actions.first(where: { $0.id == selected.id }) {
                selectedAction = latest
            }
            hasLoaded = true
            loadError = nil
            reconcileStreams()
        } catch {
            guard isCurrentAccount, !Task.isCancelled, revision == dataRevision else { return }
            loadError = AppCopy.friendlyError(error)
        }
    }

    private func receive(_ value: AIAgentTask, snapshot: Bool = false) {
        let previous = tasks[value.id]
        // A read started before completion must not resurrect a finished task.
        if previous?.isRunning == false && value.isRunning { return }
        var next = value.preservingNewerPreview(from: previous)
        if snapshot && next.result == nil && next.status != "completed" { next.result = previous?.result }
        tasks[next.id] = next
        if awaitingTaskID == next.id && !next.isRunning { awaitingTaskID = nil }
    }

    private func reconcileStreams() {
        guard monitoringID != nil, isCurrentAccount else { return }
        for (id, task) in tasks where !task.isRunning {
            streams.removeValue(forKey: id)?.cancel()
            streamIDs.removeValue(forKey: id)
            streamErrors.removeValue(forKey: id)
        }
        for task in tasks.values where task.isRunning && streams[task.id] == nil {
            let id = task.id
            let subscription = UUID()
            streamIDs[id] = subscription
            streams[id] = Task { [weak self] in
                await self?.watch(id, subscription: subscription)
            }
        }
    }

    private func watch(_ id: String, subscription: UUID) async {
        defer {
            if streamIDs[id] == subscription {
                streams.removeValue(forKey: id)
                streamIDs.removeValue(forKey: id)
            }
        }
        var failures = 0
        while !Task.isCancelled && isCurrentAccount && streamIDs[id] == subscription {
            do {
                for try await value in api.taskStream(id) {
                    guard !Task.isCancelled, isCurrentAccount, streamIDs[id] == subscription else { return }
                    let previous = tasks[id]
                    receive(value)
                    failures = 0
                    streamErrors.removeValue(forKey: id)
                    if !value.isRunning || previous?.step != value.step || previous?.progress?.round != value.progress?.round {
                        await refresh()
                    }
                    if !value.isRunning { return }
                }
            } catch {
                guard !Task.isCancelled, isCurrentAccount, streamIDs[id] == subscription else { return }
                streamErrors[id] = "连接中断，正在恢复任务进度"
                failures += 1
            }
            // Reconcile persisted status after a disconnect; never replay the generating POST.
            do {
                let value = try await api.task(id)
                guard !Task.isCancelled, isCurrentAccount, streamIDs[id] == subscription else { return }
                receive(value)
                if !value.isRunning { await refresh(); return }
            } catch {
                guard !Task.isCancelled, isCurrentAccount else { return }
                streamErrors[id] = AppCopy.friendlyError(error)
                if case APIError.http(let status, _) = error, [401, 403, 404].contains(status) { return }
            }
            do { try await Task.sleep(nanoseconds: UInt64(min(15, 2 + failures * 2)) * 1_000_000_000) }
            catch { return }
        }
    }

    func loadEarlier() async {
        guard !loadingEarlier, let first = events.first, hasEarlier else { return }
        loadingEarlier = true
        defer { loadingEarlier = false }
        do {
            let value = try await api.events(sessionID, before: first.id)
            guard isCurrentAccount, !Task.isCancelled, events.first?.id == first.id else { return }
            events = AIAgentEvent.merged(value.events, events)
            hasEarlier = value.hasEarlier
        } catch { report(error) }
    }

    func send(retry: Bool = false) async {
        guard isCurrentAccount, !sending, !working else { return }
        if !retry {
            guard canSend else { return }
            localDraft.pending = AIAgentPendingMessage(content: localDraft.input.trimmingCharacters(in: .whitespacesAndNewlines),
                                                       providerPresetId: localDraft.providerPresetId)
            localDraft.input = ""
        }
        guard let pending = localDraft.pending else { return }
        sending = true
        dataRevision &+= 1
        operationError = nil
        defer { sending = false }
        do {
            let result = try await api.message(sessionID, pending: pending)
            guard isCurrentAccount else { return }
            dataRevision &+= 1
            awaitingTaskID = result.taskId
            localDraft.pending = nil
            await refresh()
        } catch { report(error) }
    }

    func discardPending() {
        guard !sending, let pending = localDraft.pending else { return }
        localDraft.input = localDraft.input.isEmpty ? pending.content : pending.content + "\n\n" + localDraft.input
        localDraft.pending = nil
        operationError = nil
    }

    func stop(_ taskID: String) async {
        guard beginWork() else { return }
        defer { working = false }
        do {
            try await api.stop(sessionID, taskID: taskID)
            guard isCurrentAccount else { return }
            dataRevision &+= 1
            await refresh()
        }
        catch { report(error) }
    }

    func openArtifact(_ id: String) async -> AIAgentArtifact? {
        guard beginWork() else { return nil }
        defer { working = false }
        do {
            let artifact = try await api.artifact(sessionID, taskID: id)
            guard isCurrentAccount else { return nil }
            dataRevision &+= 1
            receive(artifact.task, snapshot: true)
            artifacts.removeAll { $0.id == id }
            artifacts.append(artifact)
            reconcileStreams()
            return artifact
        } catch { report(error); return nil }
    }

    func openAction(_ id: String) async {
        guard beginWork() else { return }
        defer { working = false }
        do {
            let value = try await api.action(sessionID, actionID: id)
            guard isCurrentAccount else { return }
            dataRevision &+= 1
            selectedAction = value
        } catch { report(error) }
    }

    func prepare(_ kind: AIAgentActionKind, targetID: String, title: String = "") async {
        guard beginWork() else { return }
        defer { working = false }
        do {
            let value = try await api.prepare(sessionID, kind: kind, targetID: targetID, title: title)
            guard isCurrentAccount else { return }
            dataRevision &+= 1
            selectedAction = value
            await refresh()
        } catch { report(error) }
    }

    func confirm(_ action: AIAgentAction) async {
        guard action.canConfirm, beginWork() else { return }
        defer { working = false }
        do {
            let value = try await api.confirm(sessionID, actionID: action.id)
            guard isCurrentAccount else { return }
            dataRevision &+= 1
            selectedAction = value
            await refresh()
        } catch {
            // A timeout may have occurred after the write. Read its saved ID before offering another action.
            if let latest = try? await api.action(sessionID, actionID: action.id), isCurrentAccount {
                dataRevision &+= 1
                selectedAction = latest
            }
            report(error)
            await refresh()
        }
    }

    func reject(_ action: AIAgentAction) async {
        guard action.status == "pending", beginWork() else { return }
        defer { working = false }
        do {
            try await api.reject(sessionID, actionID: action.id)
            let value = try await api.action(sessionID, actionID: action.id)
            guard isCurrentAccount else { return }
            dataRevision &+= 1
            selectedAction = value
            await refresh()
        } catch { report(error) }
    }

    func saveSettings(brief: String, preferences: AIAgentPreferences, updatedAt: Int64) async throws {
        guard isCurrentAccount, !replying, !sending, !working else { throw CancellationError() }
        working = true
        dataRevision &+= 1
        defer { working = false }
        let value = try await api.save(sessionID, brief: brief, preferences: preferences, updatedAt: updatedAt)
        guard isCurrentAccount else { throw CancellationError() }
        dataRevision &+= 1
        session = value
    }

    private func beginWork() -> Bool {
        guard isCurrentAccount, !working else { return false }
        working = true
        dataRevision &+= 1
        operationError = nil
        return true
    }
    private func report(_ error: Error) {
        guard isCurrentAccount, !(error is CancellationError) else { return }
        operationError = AppCopy.friendlyError(error)
    }
}
