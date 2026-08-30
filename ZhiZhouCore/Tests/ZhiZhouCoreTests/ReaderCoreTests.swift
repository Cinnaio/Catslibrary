import Foundation
import XCTest
@testable import ZhiZhouCore

@MainActor
final class ReaderCoreTests: XCTestCase {
    private var defaults: UserDefaults!
    private var suiteName = ""

    override func setUp() {
        super.setUp()
        suiteName = "ZhiZhouCoreTests.ReaderCore.\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suiteName)
    }

    override func tearDown() {
        defaults.removePersistentDomain(forName: suiteName)
        defaults = nil
        super.tearDown()
    }

    func testSettingsAreStoredInTheActiveUserScope() {
        let localStore = ReaderLocalStore(defaults: defaults)
        var alice = ReaderSettingsState()
        alice.set("fontSize", "5", timestamp: 100)
        localStore.saveSettings(alice.snapshot, userID: "alice")

        let bob = ReaderSettingsState(snapshot: localStore.loadSettings(userID: "bob"))
        let restoredAlice = ReaderSettingsState(snapshot: localStore.loadSettings(userID: "alice"))

        XCTAssertEqual(bob.fontSizeIndex, 2)
        XCTAssertEqual(restoredAlice.fontSizeIndex, 5)
    }

    func testDirtyLocalSettingWinsAgainstAnOlderServerSnapshot() {
        let local = ReaderSettingsSnapshot(
            values: ["fontSize": "5"],
            updatedAt: ["fontSize": 200],
            dirtyKeys: ["fontSize"]
        )
        let remote = ReaderSettingsSnapshot(
            values: ["fontSize": "1"],
            updatedAt: ["fontSize": 100],
            dirtyKeys: []
        )

        let result = ReaderSettingsMerge.merge(
            local: local,
            remote: remote,
            knownKeys: ["fontSize"]
        )

        XCTAssertEqual(result.snapshot.values["fontSize"], "5")
        XCTAssertTrue(result.shouldUpload)
        XCTAssertEqual(result.snapshot.dirtyKeys, Set(["fontSize"]))
    }

    func testNewerServerSettingReplacesLocalSnapshot() {
        let local = ReaderSettingsSnapshot(
            values: ["fontSize": "5"],
            updatedAt: ["fontSize": 100],
            dirtyKeys: ["fontSize"]
        )
        let remote = ReaderSettingsSnapshot(
            values: ["fontSize": "1"],
            updatedAt: ["fontSize": 200]
        )

        let result = ReaderSettingsMerge.merge(
            local: local,
            remote: remote,
            knownKeys: ["fontSize"]
        )

        XCTAssertEqual(result.snapshot.values["fontSize"], "1")
        XCTAssertTrue(result.snapshot.dirtyKeys.isEmpty)
        XCTAssertFalse(result.shouldUpload)
    }

    func testClientContentModeCannotBeChangedToAdult() {
        var state = ReaderSettingsState()
        state.set("contentMode", "adult", timestamp: 100)

        XCTAssertEqual(state.contentMode, "safe")
        XCTAssertEqual(state.values["contentMode"], "safe")
    }

    func testQueryEscapesReservedCharactersInValues() {
        let query = ReaderQuery.encode(["search": "a&b+c=d?"])

        XCTAssertEqual(query, "search=a%26b%2Bc%3Dd%3F")
    }

    func testUserContentPathsAlwaysRequestSafeMode() {
        XCTAssertEqual(ContentPolicy.safePath("/api/novels/novel-1"), "/api/novels/novel-1?contentMode=safe")
        XCTAssertEqual(ContentPolicy.safePath("/api/novels?page=1"), "/api/novels?page=1&contentMode=safe")
    }

    func testThoughtSelectionsResolveToAllMatchingUTF16Ranges() {
        let text = "密林间，树影斑驳。猫跃上石墙，猫回头。"

        let ranges = ReaderTextHighlight.ranges(
            in: text,
            matching: ["树影", "猫", "猫", "", "不存在"]
        )

        XCTAssertEqual(
            ranges,
            [
                NSRange(location: 4, length: 2),
                NSRange(location: 9, length: 1),
                NSRange(location: 15, length: 1),
            ]
        )
    }

    func testPendingProgressDoesNotLeakAcrossUsers() {
        let outbox = ReaderProgressOutbox(
            localStore: ReaderLocalStore(defaults: defaults),
            uploader: { _ in }
        )
        let body = SaveProgressBody(
            novelId: "novel-1",
            chapterId: "chapter-1",
            chapterTitle: "第一章",
            chapterOrder: 1,
            scrollPercent: 0.45,
            pageMode: "scroll",
            clientUpdatedAt: 100
        )

        outbox.activate(userID: "alice")
        outbox.enqueue(body)
        outbox.activate(userID: "bob")
        XCTAssertEqual(outbox.pendingCount, 0)

        outbox.activate(userID: "alice")
        XCTAssertEqual(outbox.pendingCount, 1)
        XCTAssertEqual(outbox.pendingBody(for: "novel-1"), body)
        outbox.deactivate()
    }

    func testProgressDeletionDiscardsPendingUploadAndSendsDelete() async {
        let localStore = ReaderLocalStore(defaults: defaults)
        var uploaded: [SaveProgressBody] = []
        var deleted: [(String, Int64)] = []
        let outbox = ReaderProgressOutbox(
            localStore: localStore,
            uploader: { body in uploaded.append(body) },
            deleter: { novelID, deletedAt in deleted.append((novelID, deletedAt)) }
        )
        let body = SaveProgressBody(
            novelId: "novel-1",
            chapterId: "chapter-1",
            chapterTitle: "第一章",
            chapterOrder: 1,
            scrollPercent: 0.45,
            pageMode: "scroll",
            clientUpdatedAt: 100
        )

        outbox.activate(userID: "alice")
        outbox.enqueue(body)
        outbox.discard(novelID: "novel-1", deletedAt: 200)
        outbox.enqueue(body)
        await outbox.flush()

        XCTAssertTrue(uploaded.isEmpty)
        XCTAssertEqual(deleted.map { $0.0 }, ["novel-1"])
        XCTAssertEqual(deleted.map { $0.1 }, [200])
        XCTAssertEqual(outbox.pendingCount, 0)
        XCTAssertEqual(outbox.pendingDeleteCount, 0)
        XCTAssertTrue(localStore.loadProgress(userID: "alice").isEmpty)
        XCTAssertTrue(localStore.loadProgressTombstones(userID: "alice").isEmpty)
    }

    func testProgressDeletionTombstonePersistsUntilAcknowledged() async {
        enum DeletionError: Error { case unavailable }

        let localStore = ReaderLocalStore(defaults: defaults)
        let failingOutbox = ReaderProgressOutbox(
            localStore: localStore,
            uploader: { _ in },
            deleter: { _, _ in throw DeletionError.unavailable }
        )
        failingOutbox.activate(userID: "alice")
        failingOutbox.discard(novelID: "novel-1", deletedAt: 300)
        await failingOutbox.flush()

        XCTAssertEqual(failingOutbox.pendingDelete(for: "novel-1"), 300)
        failingOutbox.deactivate()

        let reopenedOutbox = ReaderProgressOutbox(
            localStore: localStore,
            uploader: { _ in },
            deleter: { _, _ in }
        )
        reopenedOutbox.activate(userID: "alice")

        XCTAssertEqual(reopenedOutbox.pendingDelete(for: "novel-1"), 300)
        reopenedOutbox.activate(userID: "bob")
        XCTAssertNil(reopenedOutbox.pendingDelete(for: "novel-1"))
        reopenedOutbox.activate(userID: "alice")
        await reopenedOutbox.flush()
        XCTAssertNil(reopenedOutbox.pendingDelete(for: "novel-1"))
    }

    func testChapterCacheSurvivesARecreatedCacheInstance() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("ZhiZhouCoreTests-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: directory) }

        let url = "https://example.com/api/chapters/chapter-1?contentMode=safe"
        let payload = Data("chapter content".utf8)
        let cache = ChapterDiskCache(directoryURL: directory, maxBytes: 1024 * 1024)

        await cache.store(payload, for: url)

        let reopenedCache = ChapterDiskCache(directoryURL: directory, maxBytes: 1024 * 1024)
        let restored = await reopenedCache.data(for: url)
        let other = await reopenedCache.data(for: "https://example.com/api/chapters/chapter-2?contentMode=safe")

        XCTAssertEqual(restored, payload)
        XCTAssertNil(other)
    }

    func testChapterCacheCanBeCleared() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("ZhiZhouCoreTests-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: directory) }

        let url = "https://example.com/api/chapters/chapter-1?contentMode=safe"
        let cache = ChapterDiskCache(directoryURL: directory, maxBytes: 1024 * 1024)
        await cache.store(Data("chapter content".utf8), for: url)

        await cache.removeAll()

        let exists = await cache.contains(url)
        XCTAssertFalse(exists)
    }

    func testChapterCacheIsolatedByAccountScope() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("ZhiZhouCoreTests-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: directory) }

        let url = "https://example.com/api/chapters/chapter-1?contentMode=safe"
        let alicePayload = Data("alice chapter content".utf8)
        let bobPayload = Data("bob chapter content".utf8)
        let cache = ChapterDiskCache(directoryURL: directory, maxBytes: 1024 * 1024)

        await cache.store(alicePayload, for: url, scope: "alice")
        await cache.store(bobPayload, for: url, scope: "bob")

        let alice = await cache.data(for: url, scope: "alice")
        let bob = await cache.data(for: url, scope: "bob")
        let unknown = await cache.data(for: url, scope: "unknown")

        XCTAssertEqual(alice, alicePayload)
        XCTAssertEqual(bob, bobPayload)
        XCTAssertNil(unknown)

        await cache.removeAll(scope: "alice")
        let removedAlice = await cache.data(for: url, scope: "alice")
        let retainedBob = await cache.data(for: url, scope: "bob")
        XCTAssertNil(removedAlice)
        XCTAssertEqual(retainedBob, bobPayload)
    }

    func testChapterCacheCanRemoveOneEntry() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("ZhiZhouCoreTests-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: directory) }

        let first = "https://example.com/api/chapters/chapter-1?contentMode=safe"
        let second = "https://example.com/api/chapters/chapter-2?contentMode=safe"
        let cache = ChapterDiskCache(directoryURL: directory, maxBytes: 1024 * 1024)

        await cache.store(Data("one".utf8), for: first)
        await cache.store(Data("two".utf8), for: second)
        await cache.remove(first)

        let firstExists = await cache.contains(first)
        let secondExists = await cache.contains(second)
        XCTAssertFalse(firstExists)
        XCTAssertTrue(secondExists)
    }
}
