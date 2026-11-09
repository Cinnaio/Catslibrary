import Foundation
import XCTest
@testable import ZhiZhou

@MainActor
final class OfflineReadingStoreTests: XCTestCase {
    func testRefreshCannotRestoreAChapterDeletedDuringFileValidation() async throws {
        let suite = "OfflineReadingStoreTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let novel = Novel(id: "book", title: "测试", author: "", description: "", coverUrl: "",
                          categories: [], status: "", sourceUrl: "", chapterCount: 1,
                          remoteChapterCount: 1, updateCheckedAt: 0, createdAt: 0, updatedAt: 0)
        let chapter = ChapterMeta(id: "chapter", novelId: "book", title: "第一章", order: 1,
                                  wordCount: 10, sourceUrl: "", createdAt: 0)
        let book = OfflineReadingStore.DownloadedBook(novel: novel, chapters: [chapter], updatedAt: 1)
        let account = Data("alice".utf8).base64EncodedString().replacingOccurrences(of: "=", with: "")
        defaults.set(try JSONEncoder().encode([book]), forKey: "zhizhou.offlineReading.user.v2.\(account)")
        let validationStarted = expectation(description: "refresh is waiting for the disk actor")
        var validation: CheckedContinuation<Bool, Never>?
        let store = OfflineReadingStore(defaults: defaults, preserveChapter: { _, _ in
            await withCheckedContinuation { continuation in
                validation = continuation
                validationStarted.fulfill()
            }
        }, removeChapter: { _, _ in })
        store.activate(userID: "alice")
        let refresh = Task { await store.refresh() }
        await fulfillment(of: [validationStarted], timeout: 1)
        guard let validation else {
            refresh.cancel()
            return
        }
        let removed = await store.remove(novelID: "book", chapterID: "chapter")
        XCTAssertTrue(removed)
        validation.resume(returning: true)
        await refresh.value
        XCTAssertTrue(store.books.isEmpty)
        let reopened = OfflineReadingStore(defaults: defaults)
        reopened.activate(userID: "alice")
        XCTAssertTrue(reopened.books.isEmpty)
    }
}
