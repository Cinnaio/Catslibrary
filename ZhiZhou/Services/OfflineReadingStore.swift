import Foundation
import Observation

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

    private static let storageKey = "zhizhou.offlineReading.v1"

    private let defaults: UserDefaults
    private(set) var books: [DownloadedBook]
    private(set) var downloadingChapterIDs: Set<String> = []
    private(set) var batchNovelID: String?
    private(set) var batchCompleted = 0
    private(set) var batchTotal = 0
    var lastError: String?
    private var batchCancellationRequested = false

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        if let data = defaults.data(forKey: Self.storageKey),
           let saved = try? JSONDecoder().decode([DownloadedBook].self, from: data) {
            books = saved
        } else {
            books = []
        }
    }

    var totalChapterCount: Int {
        books.reduce(0) { $0 + $1.chapters.count }
    }

    var isBatchDownloading: Bool { batchNovelID != nil }

    var batchProgress: Double {
        guard batchTotal > 0 else { return 0 }
        return Double(batchCompleted) / Double(batchTotal)
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
        lastError = nil
        _ = await performDownload(novel: novel, chapter: chapter)
    }

    func downloadAll(novel: Novel, chapters: [ChapterMeta]) async {
        guard batchNovelID == nil else { return }

        batchNovelID = novel.id
        batchCompleted = 0
        batchTotal = chapters.count
        batchCancellationRequested = false
        lastError = nil
        defer {
            batchNovelID = nil
            batchCompleted = 0
            batchTotal = 0
            batchCancellationRequested = false
        }

        var hadFailure = false
        for chapter in chapters {
            guard !batchCancellationRequested, !Task.isCancelled else { break }

            if !isDownloaded(chapter.id) {
                let success = await performDownload(novel: novel, chapter: chapter)
                if !success, !Task.isCancelled, !batchCancellationRequested {
                    hadFailure = true
                }
            }
            batchCompleted += 1
        }

        await refresh()
        if !hadFailure {
            lastError = nil
        }
    }

    func cancelBatch() {
        batchCancellationRequested = true
    }

    func remove(novelID: String, chapterID: String) async {
        await APIClient.shared.removeCachedChapter(id: chapterID)
        guard let bookIndex = books.firstIndex(where: { $0.novel.id == novelID }) else { return }

        books[bookIndex].chapters.removeAll { $0.id == chapterID }
        if books[bookIndex].chapters.isEmpty {
            books.remove(at: bookIndex)
        }
        persist()
    }

    /// 删除离线目录中的全部章节；不影响尚未登记的普通阅读缓存。
    func removeAll() async {
        let chapterIDs = books.flatMap { $0.chapters.map(\.id) }
        for chapterID in chapterIDs {
            await APIClient.shared.removeCachedChapter(id: chapterID)
        }
        books = []
        persist()
    }

    /// 存储管理清空全局章节缓存后，同步丢弃已失效的离线目录。
    func forgetAll() {
        books = []
        persist()
    }

    /// 清理因缓存容量淘汰或全局清理而失效的离线记录。
    func refresh() async {
        var refreshed: [DownloadedBook] = []
        for book in books {
            var validChapters: [ChapterMeta] = []
            for chapter in book.chapters {
                if await APIClient.shared.hasCachedChapter(id: chapter.id) {
                    validChapters.append(chapter)
                }
            }
            guard !validChapters.isEmpty else { continue }

            var copy = book
            copy.chapters = validChapters
            refreshed.append(copy)
        }

        if refreshed != books {
            books = refreshed
            persist()
        }
    }

    private func performDownload(novel: Novel, chapter: ChapterMeta) async -> Bool {
        guard !chapter.id.isEmpty, !isDownloading(chapter.id) else { return false }
        downloadingChapterIDs.insert(chapter.id)
        defer { downloadingChapterIDs.remove(chapter.id) }

        do {
            let _: ChapterResponse = try await APIClient.shared.get(
                ContentPolicy.safePath("/api/chapters/\(chapter.id)")
            )
            guard !Task.isCancelled else { return false }
            guard await APIClient.shared.hasCachedChapter(id: chapter.id) else {
                lastError = "《\(novel.title)》第 \(chapter.order) 章无法保存到本机。"
                return false
            }
            upsert(novel: novel, chapter: chapter)
            return true
        } catch is CancellationError {
            return false
        } catch {
            lastError = "《\(novel.title)》第 \(chapter.order) 章下载失败：\(AppCopy.friendlyError(error))"
            return false
        }
    }

    private func upsert(novel: Novel, chapter: ChapterMeta) {
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

    private func persist() {
        guard let data = try? JSONEncoder().encode(books) else { return }
        defaults.set(data, forKey: Self.storageKey)
    }

    private func nowMilliseconds() -> Int64 {
        Int64(Date().timeIntervalSince1970 * 1000)
    }
}
