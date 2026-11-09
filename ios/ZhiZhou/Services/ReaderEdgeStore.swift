import AVFoundation
import Foundation
import Observation
import UIKit

/// Owned by the reader, not by its chapter or sheet. Only timer views observe ticks.
@MainActor
@Observable
final class ReaderEdgeStore {
    private(set) var catalog: ReaderEdgeCatalog?
    private(set) var data: ReaderEdgeData?
    private(set) var session: ReaderEdgeSession?
    private(set) var storageNotice: String?
    private(set) var runtimeNotice: String?
    private(set) var audioNotice: String?

    private var context: ReaderEdgeContext?
    @ObservationIgnored private var runtime: ReaderEdgeRuntime?
    @ObservationIgnored private let localStore = ReaderEdgeLocalStore()
    @ObservationIgnored private let audio = ReaderEdgeAudio()
    @ObservationIgnored private var ticker: Task<Void, Never>?
    @ObservationIgnored private var observers: [NSObjectProtocol] = []
    @ObservationIgnored private var foreground = false
    @ObservationIgnored private var recordedID: String?
    @ObservationIgnored private var readBlocked = false
    @ObservationIgnored private var hasLocalEdits = false
    @ObservationIgnored private var pendingClearHistory = false

    init() {
        for name in [UIApplication.willResignActiveNotification, AVAudioSession.interruptionNotification,
                     AVAudioSession.mediaServicesWereResetNotification] {
            observers.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                Task { @MainActor [weak self] in self?.pauseForInterruption() }
            })
        }
        observers.append(NotificationCenter.default.addObserver(
            forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main
        ) { [weak self] note in
            let reason = (note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? NSNumber)?.uintValue
            guard reason == AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue
                    || reason == AVAudioSession.RouteChangeReason.newDeviceAvailable.rawValue else { return }
            Task { @MainActor [weak self] in self?.pauseForInterruption() }
        })
    }

    deinit {
        ticker?.cancel()
        observers.forEach { NotificationCenter.default.removeObserver($0) }
    }

    var authorized: Bool {
        guard let context else { return false }
        return ContentAccessStore.shared.mode == "adult"
            && ContentAccessStore.shared.accountRevision == context.accountRevision
            && ReaderSettingsStore.shared.activeUserID == context.userID
            && APIClient.shared.isAuthenticated
    }

    var active: Bool { session?.isActive == true }
    var ready: Bool { authorized && runtime != nil && data != nil && runtimeNotice == nil }
    var canClearHistory: Bool { authorized && !readBlocked }
    var historyTotals: ReaderEdgeTotals? {
        guard authorized, let runtime, let data else { return nil }
        return try? runtime.summarize(data.history)
    }

    func activate(_ next: ReaderEdgeContext?, foreground: Bool) {
        guard next != context else { setForeground(foreground); return }
        deactivate()
        context = next
        self.foreground = foreground
        guard next != nil, authorized else { context = nil; return }
        do {
            let engine = try ReaderEdgeRuntime()
            let catalog = try engine.catalog()
            runtime = engine
            self.catalog = catalog
            data = ReaderEdgeData(settings: catalog.defaults, history: [])
            loadStoredData()
        } catch {
            runtimeNotice = ReaderEdgeRuntime.RuntimeError.unavailable.localizedDescription
        }
    }

    func setForeground(_ value: Bool) {
        foreground = value
        if !value { pauseForInterruption() }
        // Foregrounding deliberately leaves a paused session paused.
    }

    func deactivate() {
        ticker?.cancel()
        ticker = nil
        audio.stop()
        runtime = nil
        context = nil
        session = nil
        catalog = nil
        data = nil
        recordedID = nil
        foreground = false
        readBlocked = false
        hasLocalEdits = false
        pendingClearHistory = false
        storageNotice = nil
        runtimeNotice = nil
        audioNotice = nil
    }

    func start() {
        guard ready, foreground, !active, let settings = data?.settings else { return }
        do {
            let value = try JSONSerialization.jsonObject(with: JSONEncoder().encode(settings))
            hasLocalEdits = true
            persist()
            perform(["type": "start", "id": UUID().uuidString, "settings": value, "now": now])
        } catch { failRuntime() }
    }

    func pause() { perform(["type": "pause", "now": now, "reason": "manual"]) }
    func resume() { perform(["type": "resume", "now": now]) }
    func declareEdge(_ declaration: ReaderEdgeDeclaration = .hold) {
        guard session?.canDeclare == true else { return }
        perform(["type": "edge", "declare": declaration.rawValue, "now": now])
    }
    func spend(_ kind: ReaderEdgeSpendKind) {
        // The reducer rechecks eligibility after advancing to the current timestamp.
        perform(["type": "spend", "kind": kind.rawValue, "now": now])
    }
    func reportCompletion() {
        guard session?.canDeclare == true || session?.status == .permit else { return }
        perform(["type": "came", "now": now])
    }
    func quit() { perform(["type": "quit", "now": now]) }
    func reset() { perform(["type": "reset"]) }

    func update<Value>(_ key: WritableKeyPath<ReaderEdgeSettings, Value>, _ value: Value, rule: Bool = true) {
        guard ready, foreground, (!rule || !active), var current = data, let runtime else { return }
        current.settings[keyPath: key] = value
        do {
            current.settings = try runtime.normalize(current.settings)
            data = current
            hasLocalEdits = true
            persist()
            syncAudio()
        } catch { failRuntime() }
    }

    func updateCategory(_ id: String, enabled: Bool) {
        guard var categories = data?.settings.categories else { return }
        categories[id] = enabled
        update(\.categories, categories)
    }

    func clearHistory() {
        guard authorized, foreground, !readBlocked, var current = data else { return }
        current.history = []
        data = current
        pendingClearHistory = true
        hasLocalEdits = true
        persist()
    }

    func retryStorage() {
        guard authorized, foreground else { return }
        if readBlocked { loadStoredData() }
        if !readBlocked && hasLocalEdits { persist() }
    }

    private var now: Double { ProcessInfo.processInfo.systemUptime * 1000 }

    private func pauseForInterruption() {
        audio.stop()
        if session?.isAdvancing == true {
            perform(["type": "pause", "now": now, "reason": "background"], allowBackground: true)
        }
        // A finish at the pause boundary must not start a final announcement in the background.
        audio.stop()
    }

    private func perform(_ action: [String: Any], allowBackground: Bool = false) {
        guard authorized else { deactivate(); return }
        guard (foreground || allowBackground), let runtime else { return }
        do {
            session = try runtime.dispatch(action)
            if let session, session.status == .finished, recordedID != session.id, var current = data {
                recordedID = session.id
                current.history = merged([ReaderEdgeRecord(session: session)] + current.history)
                data = current
                hasLocalEdits = true
                persist()
            }
            if !allowBackground { syncAudio() }
            if session?.isAdvancing == true && foreground {
                startTicker()
            } else {
                ticker?.cancel()
                ticker = nil
            }
        } catch { failRuntime() }
    }

    private func startTicker() {
        guard ticker == nil else { return }
        ticker = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                do { try await Task.sleep(for: .milliseconds(200)) } catch { return }
                guard !Task.isCancelled, let self else { return }
                self.perform(["type": "tick", "now": self.now])
            }
        }
    }

    private func syncAudio() {
        guard authorized, foreground else { audio.stop(); return }
        audioNotice = audio.sync(session: session, settings: data?.settings,
                                 endingLabel: catalog?.endings[session?.ending ?? ""])
    }

    private func failRuntime() {
        ticker?.cancel()
        ticker = nil
        audio.stop()
        runtime = nil
        session = nil
        runtimeNotice = ReaderEdgeRuntime.RuntimeError.unavailable.localizedDescription
    }

    private func loadStoredData() {
        guard let context, let runtime else { return }
        do {
            let loaded = try runtime.loadData(localStore.read(context))
            guard loaded.error == nil else {
                readBlocked = true
                storageNotice = loaded.error
                return
            }
            if hasLocalEdits, var current = data {
                if !pendingClearHistory { current.history = merged(current.history + loaded.data.history) }
                data = current
            } else {
                data = loaded.data
            }
            readBlocked = false
            storageNotice = nil
        } catch {
            readBlocked = true
            storageNotice = "暂时无法读取本机设置和记录，当前使用默认设置。重试前不会覆盖原记录。"
        }
    }

    private func persist() {
        guard authorized, let context, let runtime, var current = data else { return }
        guard !readBlocked else {
            storageNotice = "本机记录读取失败，当前更改尚未保存。请重试读取。"
            return
        }
        do {
            // Merge other reader windows' completed records before writing this small snapshot.
            let existing = try runtime.loadData(localStore.read(context))
            guard existing.error == nil else {
                readBlocked = true
                storageNotice = "本机记录读取失败，当前更改尚未保存。请重试读取。"
                return
            }
            if !pendingClearHistory { current.history = merged(current.history + existing.data.history) }
            try localStore.write(current, context: context)
            data = current
            storageNotice = nil
            pendingClearHistory = false
            hasLocalEdits = false
        } catch {
            storageNotice = "本机设置和记录尚未保存，请重试。当前会话仍可使用。"
        }
    }

    private func merged(_ records: [ReaderEdgeRecord]) -> [ReaderEdgeRecord] {
        var seen = Set<String>()
        return Array(records.filter { seen.insert($0.id).inserted }
            .sorted { $0.finishedAt > $1.finishedAt }.prefix(catalog?.historyLimit ?? 30))
    }
}
