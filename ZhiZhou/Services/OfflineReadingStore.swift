import CryptoKit
import Foundation
import Observation
import ZhiZhouCore

/// 离线阅读下载目录：记录用户主动保存的章节，并协调章节缓存的下载与删除。
@Observable
@MainActor
final class OfflineReadingStore {
    static let shared = OfflineReadingStore()

    struct DownloadedBook: Codable, Equatable, Identifiable {
        var novel: Novel
        var chapters: [ChapterMeta]
        var updatedAt: Int64

        var id: String { novel.id }
    }

    // 旧版本没有账号维度，无法安全迁移到某一个用户；新版本只读取按用户拆分的键。
    private static let storageKeyPrefix = "zhizhou.offlineReading.user.v2."
    private static let lastUserKey = "zhizhou.offlineReading.lastUser.v2"
    private static let lastTokenFingerprintKey = "zhizhou.offlineReading.lastTokenFingerprint.v2"

    private struct Session: Equatable {
        let userID: String
        let generation: UUID
    }

    private let defaults: UserDefaults
    private var sessionGeneration = UUID()
    private(set) var activeUserID: String?
    private(set) var books: [DownloadedBook]
    private(set) var downloadingChapterIDs: Set<String> = []
    private(set) var batchNovelID: String?
    private(set) var batchCompleted = 0
    private(set) var batchTotal = 0
    private(set) var lastBatchWasCancelled = false
    var lastError: String?
    private var batchCancellationRequested = false

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        self.books = []
    }

    var totalChapterCount: Int {
        books.reduce(0) { $0 + $1.chapters.count }
    }

    var isBatchDownloading: Bool { batchNovelID != nil }

    var batchProgress: Double {
        guard batchTotal > 0 else { return 0 }
        return Double(batchCompleted) / Double(batchTotal)
    }

    /// 激活一个账号的离线目录。目录按用户持久化，切换账号只改变当前可见命名空间。
    func activate(userID: String, token: String? = nil) {
        guard let userID = normalizedUserID(userID) else {
            deactivate()
            return
        }

        if activeUserID == userID {
            defaults.set(userID, forKey: Self.lastUserKey)
            if let token = normalizedUserID(token ?? "") {
                defaults.set(tokenFingerprint(token), forKey: Self.lastTokenFingerprintKey)
            }
            return
        }

        batchCancellationRequested = true
        persist()
        sessionGeneration = UUID()
        activeUserID = userID
        books = loadBooks(userID: userID)
        resetTransientState()
        defaults.set(userID, forKey: Self.lastUserKey)
        if let token = normalizedUserID(token ?? "") {
            defaults.set(tokenFingerprint(token), forKey: Self.lastTokenFingerprintKey)
        }
    }

    /// 仅在会话恢复失败时使用：恢复最近一次成功登录的离线命名空间。
    /// 这不会恢复 AppState.user，因此调用方仍应把应用视为未登录状态。
    @discardableResult
    func activateLastKnownAccountForOffline(token: String) -> String? {
        guard let normalizedToken = normalizedUserID(token),
              defaults.string(forKey: Self.lastTokenFingerprintKey) == tokenFingerprint(normalizedToken),
              let userID = defaults.string(forKey: Self.lastUserKey),
              let normalized = normalizedUserID(userID)
        else { return nil }
        activate(userID: normalized)
        return activeUserID
    }

    /// 结束当前本地会话，使旧任务无法向新会话回写。
    /// 显式登出或 401 时同时清除冷启动离线入口；账号自己的离线数据仍保留，便于重新登录后继续阅读。
    func deactivate(clearOfflineFallback: Bool = false) {
        batchCancellationRequested = true
        persist()
        sessionGeneration = UUID()
        activeUserID = nil
        books = []
        resetTransientState()
        if clearOfflineFallback {
            defaults.removeObject(forKey: Self.lastUserKey)
            defaults.removeObject(forKey: Self.lastTokenFingerprintKey)
        }
    }

    func downloadedCount(for novelID: String) -> Int {
        books.first(where: { $0.novel.id == novelID })?.chapters.count ?? 0
    }

    func chapters(for novelID: String) -> [ChapterMeta] {
        books.first(where: { $0.novel.id == novelID })?.chapters ?? []
    }

    func isDownloaded(_ chapterID: String) -> Bool {
        books.contains { book in
            book.chapters.contains { $0.id == chapterID }
        }
    }

    func isDownloading(_ chapterID: String) -> Bool {
        downloadingChapterIDs.contains(chapterID)
    }

    func clearError() {
        lastError = nil
    }

    func download(novel: Novel, chapter: ChapterMeta) async {
        guard let session = currentSession else { return }
        lastError = nil
        _ = await performDownload(novel: novel, chapter: chapter, session: session)
    }

    func downloadAll(novel: Novel, chapters: [ChapterMeta]) async {
        guard let session = currentSession, batchNovelID == nil else { return }

        batchNovelID = novel.id
        batchCompleted = 0
        batchTotal = chapters.count
        batchCancellationRequested = false
        lastBatchWasCancelled = false
        lastError = nil
        defer { finishBatch(session) }

        var hadFailure = false
        var wasCancelled = false
        for chapter in chapters {
            guard isCurrent(session), !batchCancellationRequested, !Task.isCancelled else {
                wasCancelled = true
                break
            }

            if !isDownloaded(chapter.id) {
                let success = await performDownload(novel: novel, chapter: chapter, session: session)
                guard isCurrent(session) else { return }
                if !success, !Task.isCancelled, !batchCancellationRequested {
                    hadFailure = true
                }
            }

            guard isCurrent(session) else { return }
            batchCompleted += 1
        }

        guard isCurrent(session) else { return }
        lastBatchWasCancelled = wasCancelled || batchCancellationRequested || Task.isCancelled
        AppObservability.shared.track(
            "offline_download_batch",
            properties: [
                "requested": String(chapters.count),
                "completed": String(batchCompleted),
                "failed": hadFailure ? "true" : "false",
                "cancelled": lastBatchWasCancelled ? "true" : "false",
            ]
        )
        await refresh(session: session)
        guard isCurrent(session) else { return }
        if !hadFailure {
            lastError = nil
        }
    }

    func cancelBatch() {
        batchCancellationRequested = true
    }

    func remove(novelID: String, chapterID: String) async {
        guard let session = currentSession else { return }
        await APIClient.shared.removeCachedChapter(id: chapterID, userID: session.userID)
        guard isCurrent(session) else { return }
        guard let bookIndex = books.firstIndex(where: { $0.novel.id == novelID }) else { return }

        books[bookIndex].chapters.removeAll { $0.id == chapterID }
        if books[bookIndex].chapters.isEmpty {
            books.remove(at: bookIndex)
        }
        persist()
    }

    /// 删除选中的离线书籍及其全部章节缓存。
    func removeBooks(novelIDs: Set<String>) async {
        guard let session = currentSession, !novelIDs.isEmpty else { return }

        let chapterIDs = Set(
            books
                .filter { novelIDs.contains($0.novel.id) }
                .flatMap { $0.chapters.map(\.id) }
        )
        for chapterID in chapterIDs {
            await APIClient.shared.removeCachedChapter(id: chapterID, userID: session.userID)
            guard isCurrent(session) else { return }
        }

        guard isCurrent(session) else { return }
        books.removeAll { novelIDs.contains($0.novel.id) }
        persist()
        AppObservability.shared.track("offline_books_removed", properties: ["count": String(novelIDs.count)])
    }

    /// 删除离线目录中的全部章节；不影响尚未登记的普通阅读缓存。
    func removeAll() async {
        guard let session = currentSession else { return }
        let chapterIDs = books.flatMap { $0.chapters.map(\.id) }
        for chapterID in chapterIDs {
            await APIClient.shared.removeCachedChapter(id: chapterID, userID: session.userID)
            guard isCurrent(session) else { return }
        }
        guard isCurrent(session) else { return }
        books = []
        persist()
        AppObservability.shared.track("offline_books_removed_all")
    }

    /// 存储管理清空全局章节缓存后，同步丢弃已失效的离线目录。
    func forgetAll() {
        books = []
        persist()
    }

    /// 清理因缓存容量淘汰或全局清理而失效的离线记录。
    func refresh() async {
        guard let session = currentSession else { return }
        await refresh(session: session)
    }

    private func refresh(session: Session) async {
        guard isCurrent(session) else { return }

        var refreshed: [DownloadedBook] = []
        for book in books {
            var validChapters: [ChapterMeta] = []
            for chapter in book.chapters {
                guard isCurrent(session) else { return }
                if await APIClient.shared.hasCachedChapter(id: chapter.id, userID: session.userID) {
                    validChapters.append(chapter)
                }
            }
            guard isCurrent(session) else { return }
            guard !validChapters.isEmpty else { continue }

            var copy = book
            copy.chapters = validChapters
            refreshed.append(copy)
        }

        guard isCurrent(session) else { return }
        if refreshed != books {
            books = refreshed
            persist()
        }
    }

    private func performDownload(novel: Novel, chapter: ChapterMeta, session: Session) async -> Bool {
        guard isCurrent(session), !chapter.id.isEmpty, !isDownloading(chapter.id) else { return false }
        downloadingChapterIDs.insert(chapter.id)
        defer {
            if isCurrent(session) {
                downloadingChapterIDs.remove(chapter.id)
            }
        }

        do {
            let _: ChapterResponse = try await APIClient.shared.get(
                ContentPolicy.safePath("/api/chapters/\(chapter.id)")
            )
            guard isCurrent(session), !Task.isCancelled else { return false }
            guard await APIClient.shared.hasCachedChapter(id: chapter.id, userID: session.userID) else {
                if isCurrent(session) {
                    lastError = "《\(novel.title)》第 \(chapter.order) 章无法保存到本机。"
                }
                return false
            }
            guard isCurrent(session) else { return false }
            upsert(novel: novel, chapter: chapter)
            return true
        } catch is CancellationError {
            return false
        } catch {
            if isCurrent(session) {
                lastError = "《\(novel.title)》第 \(chapter.order) 章下载失败：\(AppCopy.friendlyError(error))"
                AppObservability.shared.capture(error: error, context: "offline.download")
            }
            return false
        }
    }

    private func upsert(novel: Novel, chapter: ChapterMeta) {
        guard activeUserID != nil else { return }
        if let bookIndex = books.firstIndex(where: { $0.novel.id == novel.id }) {
            books[bookIndex].novel = novel
            books[bookIndex].chapters.removeAll { $0.id == chapter.id }
            books[bookIndex].chapters.append(chapter)
            books[bookIndex].chapters.sort { $0.order < $1.order }
            books[bookIndex].updatedAt = nowMilliseconds()
        } else {
            books.append(
                DownloadedBook(
                    novel: novel,
                    chapters: [chapter],
                    updatedAt: nowMilliseconds()
                )
            )
        }
        persist()
    }

    private var currentSession: Session? {
        guard let activeUserID else { return nil }
        return Session(userID: activeUserID, generation: sessionGeneration)
    }

    private func isCurrent(_ session: Session) -> Bool {
        activeUserID == session.userID && sessionGeneration == session.generation
    }

    private func finishBatch(_ session: Session) {
        guard isCurrent(session) else { return }
        batchNovelID = nil
        batchCompleted = 0
        batchTotal = 0
        batchCancellationRequested = false
    }

    private func resetTransientState() {
        downloadingChapterIDs = []
        batchNovelID = nil
        batchCompleted = 0
        batchTotal = 0
        lastBatchWasCancelled = false
        lastError = nil
        batchCancellationRequested = false
    }

    private func normalizedUserID(_ userID: String) -> String? {
        let normalized = userID.trimmingCharacters(in: .whitespacesAndNewlines)
        return normalized.isEmpty ? nil : normalized
    }

    private func loadBooks(userID: String) -> [DownloadedBook] {
        guard let data = defaults.data(forKey: storageKey(userID: userID)),
              let saved = try? JSONDecoder().decode([DownloadedBook].self, from: data)
        else { return [] }
        return saved
    }

    private func storageKey(userID: String) -> String {
        let encoded = Data(userID.utf8)
            .base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
        return Self.storageKeyPrefix + encoded
    }

    private func tokenFingerprint(_ token: String) -> String {
        Data(SHA256.hash(data: Data(token.utf8))).base64EncodedString()
    }

    private func persist() {
        guard let activeUserID,
              let data = try? JSONEncoder().encode(books)
        else { return }
        defaults.set(data, forKey: storageKey(userID: activeUserID))
    }

    private func nowMilliseconds() -> Int64 {
        Int64(Date().timeIntervalSince1970 * 1000)
    }
}
