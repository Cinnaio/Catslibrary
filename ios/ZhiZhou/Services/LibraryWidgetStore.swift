import Foundation
import Observation
import CryptoKit
import WidgetKit

struct LibraryWidgetRoute: Identifiable {
    let id = UUID()
    let kind: String
    let itemID: String
    let scope: String
}

@Observable @MainActor
final class LibraryWidgetStore {
    static let shared = LibraryWidgetStore()
    var route: LibraryWidgetRoute?
    private(set) var scope = ""
    private(set) var sharingAvailable = LibraryWidgetStorage.fileURL != nil
    private var pendingURL: URL?
    private var lastRefresh = Date.distantPast
    private(set) var updatedAt: Date?
    private(set) var lastError: String?
    var isRefreshing: Bool { refreshTask != nil }
    private var refreshTask: Task<Void, Never>?
    private var generation = 0

    func activate(userID: String) {
        let next = SHA256.hash(data: Data("\(ServerConfig.serverURL)|\(userID)".utf8)).map { String(format: "%02x", $0) }.joined()
        if scope != next {
            generation += 1; refreshTask?.cancel(); refreshTask = nil
            if LibraryWidgetStorage.read()?.scope != next { LibraryWidgetStorage.clear(); reload() }
            route = nil; lastRefresh = .distantPast; scope = next
        }
        sharingAvailable = LibraryWidgetStorage.fileURL != nil
        updatedAt = LibraryWidgetStorage.read()?.savedAt
        if let pending = pendingURL { pendingURL = nil; receive(pending) }
        refresh(force: true)
    }
    func deactivate() {
        generation += 1; refreshTask?.cancel(); refreshTask = nil
        scope = ""; route = nil; pendingURL = nil; lastRefresh = .distantPast; updatedAt = nil; lastError = nil
        LibraryWidgetStorage.clear(); reload()
    }
    func refresh(force: Bool = false) {
        guard !scope.isEmpty, let token = APIClient.shared.token, sharingAvailable,
              refreshTask == nil, force || Date().timeIntervalSince(lastRefresh) > 60 else { return }
        lastError = nil
        let captured = scope, request = generation
        refreshTask = Task { @MainActor in
            defer { if request == generation { refreshTask = nil } }
            do {
                let content: LibraryWidgetContent = try await APIClient.shared.get("/api/bookshelf/widgets", auth: true)
                guard !Task.isCancelled, request == generation, captured == scope, token == APIClient.shared.token else { return }
                try LibraryWidgetStorage.write(LibraryWidgetSnapshot(scope: captured, savedAt: Date(), content: content))
                lastRefresh = Date(); updatedAt = lastRefresh; reload()
            } catch {
                // The previous bounded snapshot remains usable offline; authentication teardown clears it.
                guard request == generation, captured == scope else { return }
                lastError = AppCopy.friendlyError(error)
                if let apiError = error as? APIError, case .http(let status, _) = apiError, status == 403 {
                    LibraryWidgetStorage.clear(); reload()
                }
            }
        }
    }
    func invalidateReading(novelID: String) {
        guard let old = LibraryWidgetStorage.read(), old.scope == scope,
              old.content.reading?.novelId == novelID else { return }
        generation += 1; refreshTask?.cancel(); refreshTask = nil
        let clean = LibraryWidgetSnapshot(scope: scope, savedAt: old.savedAt,
            content: LibraryWidgetContent(reading: nil, quotes: old.content.quotes))
        do { try LibraryWidgetStorage.write(clean) } catch { LibraryWidgetStorage.clear() }
        reload(); refresh(force: true)
    }
    func invalidateQuotes() {
        generation += 1; refreshTask?.cancel(); refreshTask = nil
        if let old = LibraryWidgetStorage.read(), old.scope == scope {
            let clean = LibraryWidgetSnapshot(scope: scope, savedAt: old.savedAt,
                content: LibraryWidgetContent(reading: old.content.reading, quotes: []))
            do { try LibraryWidgetStorage.write(clean) } catch { LibraryWidgetStorage.clear() }
        } else { LibraryWidgetStorage.clear() }
        reload(); refresh(force: true)
    }
    func receive(_ url: URL) {
        guard let link = LibraryWidgetLink(url: url) else { return }
        guard !scope.isEmpty else { pendingURL = url; return }
        guard link.scope == scope else { return }
        route = LibraryWidgetRoute(kind: link.kind, itemID: link.itemID, scope: link.scope)
    }

    private func reload() {
        WidgetCenter.shared.reloadTimelines(ofKind: LibraryWidgetStorage.continueKind)
        WidgetCenter.shared.reloadTimelines(ofKind: LibraryWidgetStorage.quoteKind)
    }
}
