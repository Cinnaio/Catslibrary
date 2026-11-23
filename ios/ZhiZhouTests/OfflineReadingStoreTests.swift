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

    func testRemoveAllWaitsForInflightWritesAndStopsBatchAndSingleDownloads() async throws {
        let suite = "OfflineReadingStoreTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let novel = Novel(id: "book", title: "测试", author: "", description: "", coverUrl: "",
                          categories: [], status: "", sourceUrl: "", chapterCount: 3,
                          remoteChapterCount: 3, updateCheckedAt: 0, createdAt: 0, updatedAt: 0)
        let chapters = (1...3).map { ChapterMeta(id: "c\($0)", novelId: "book", title: "第\($0)章", order: $0,
                                                wordCount: 10, sourceUrl: "", createdAt: 0) }
        let started = expectation(description: "both disk writes started")
        started.expectedFulfillmentCount = 2
        let cancelled = expectation(description: "both pending writes were cancelled")
        cancelled.expectedFulfillmentCount = 2
        var writes: [CheckedContinuation<Void, Never>] = []
        var disk: Set<String> = []
        var calls: [String] = []
        var holdWrites = true
        let store = OfflineReadingStore(defaults: defaults,
            preserveChapter: { id, _ in disk.contains(id) },
            removeChapter: { id, _ in disk.remove(id) },
            downloadChapter: { id, _ in
                calls.append(id)
                if holdWrites {
                    await withTaskCancellationHandler {
                        await withCheckedContinuation { continuation in
                            writes.append(continuation)
                            started.fulfill()
                        }
                    } onCancel: {
                        cancelled.fulfill()
                    }
                }
                // Simulate a disk actor already writing: cancellation cannot undo this write.
                disk.insert(id)
            },
            hasChapter: { id, _ in disk.contains(id) })
        store.activate(userID: "alice")
        let batch = Task { await store.downloadAll(novel: novel, chapters: Array(chapters.prefix(2))) }
        let single = Task { await store.download(novel: novel, chapter: chapters[2]) }
        await fulfillment(of: [started], timeout: 1)
        var clearFinished = false
        let clear = Task { let result = await store.removeAll(); clearFinished = true; return result }
        await fulfillment(of: [cancelled], timeout: 1)
        XCTAssertTrue(store.isRemovingAll)
        XCTAssertFalse(clearFinished)
        await store.download(novel: novel, chapter: chapters[1])
        await store.downloadAll(novel: novel, chapters: [chapters[1]])
        XCTAssertEqual(Set(calls), ["c1", "c3"])
        writes.forEach { $0.resume() }
        let removed = await clear.value
        await batch.value
        await single.value
        XCTAssertTrue(removed)
        XCTAssertTrue(disk.isEmpty)
        XCTAssertTrue(store.books.isEmpty)
        XCTAssertFalse(store.isBatchDownloading)
        XCTAssertTrue(store.downloadingChapterIDs.isEmpty)
        let reopened = OfflineReadingStore(defaults: defaults)
        reopened.activate(userID: "alice")
        XCTAssertTrue(reopened.books.isEmpty)
        // A later, intentional download is allowed after clearing completes.
        holdWrites = false
        await store.download(novel: novel, chapter: chapters[1])
        XCTAssertTrue(store.isDownloaded("c2"))
        XCTAssertEqual(disk, ["c2"])
    }

    func testClearAllCannotClearAnAccountActivatedWhileWaitingForDownload() async throws {
        let suite = "OfflineReadingStoreTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let novel = Novel(id: "book", title: "测试", author: "", description: "", coverUrl: "",
                          categories: [], status: "", sourceUrl: "", chapterCount: 1,
                          remoteChapterCount: 1, updateCheckedAt: 0, createdAt: 0, updatedAt: 0)
        let chapter = ChapterMeta(id: "c1", novelId: "book", title: "第一章", order: 1,
                                  wordCount: 10, sourceUrl: "", createdAt: 0)
        let started = expectation(description: "alice download started")
        let cancelled = expectation(description: "alice pending write was cancelled")
        var write: CheckedContinuation<Void, Never>?
        var removedUsers: [String] = []
        let store = OfflineReadingStore(defaults: defaults,
            preserveChapter: { _, _ in true },
            removeChapter: { _, user in removedUsers.append(user) },
            downloadChapter: { _, user in
                if user == "alice" {
                    await withTaskCancellationHandler {
                        await withCheckedContinuation { write = $0; started.fulfill() }
                    } onCancel: {
                        cancelled.fulfill()
                    }
                }
            }, hasChapter: { _, _ in true })
        store.activate(userID: "alice")
        let download = Task { await store.download(novel: novel, chapter: chapter) }
        await fulfillment(of: [started], timeout: 1)
        let clear = Task { await store.removeAll() }
        await fulfillment(of: [cancelled], timeout: 1)
        XCTAssertTrue(store.isRemovingAll)
        store.activate(userID: "bob")
        await store.download(novel: novel, chapter: chapter)
        write?.resume()
        let result = await clear.value
        await download.value
        XCTAssertFalse(result)
        XCTAssertEqual(store.activeUserID, "bob")
        XCTAssertTrue(store.isDownloaded("c1"))
        XCTAssertTrue(removedUsers.isEmpty)
    }

}
