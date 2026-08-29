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
