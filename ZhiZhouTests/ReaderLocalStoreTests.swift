import Foundation
import XCTest
@testable import ZhiZhou

@MainActor
final class ReaderLocalStoreTests: XCTestCase {
    private var defaults: UserDefaults!
    private var suiteName = ""

    override func setUp() {
        super.setUp()
        suiteName = "ZhiZhouTests.ReaderLocalStore.\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suiteName)
    }

    override func tearDown() {
        defaults.removePersistentDomain(forName: suiteName)
        defaults = nil
        super.tearDown()
    }

    func testSettingsAreStoredInTheActiveUserScope() {
        let store = ReaderSettingsStore(localStore: ReaderLocalStore(defaults: defaults))

        store.activate(userID: "alice")
        store.set("fontSize", "5")
        store.activate(userID: "bob")
        XCTAssertEqual(store.fontSizeIndex, 2)

        store.set("fontSize", "0")
        store.activate(userID: "alice")
        XCTAssertEqual(store.fontSizeIndex, 5)
        store.deactivate()
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
        let store = ReaderSettingsStore(localStore: ReaderLocalStore(defaults: defaults))

        store.activate(userID: "alice")
        store.set("contentMode", "adult")

        XCTAssertEqual(store.contentMode, "safe")
        XCTAssertEqual(store.values["contentMode"], "safe")
        store.deactivate()
    }

    func testHomeQueryEscapesReservedCharactersInValues() {
        let query = HomeView.query(["search": "a&b+c=d?"])

        XCTAssertEqual(query, "search=a%26b%2Bc%3Dd%3F")
    }

    func testUserContentPathsAlwaysRequestSafeMode() {
        XCTAssertEqual(ContentPolicy.safePath("/api/novels/novel-1"), "/api/novels/novel-1?contentMode=safe")
        XCTAssertEqual(ContentPolicy.safePath("/api/novels?page=1"), "/api/novels?page=1&contentMode=safe")
    }

    func testPendingProgressDoesNotLeakAcrossUsers() {
        let store = ReaderProgressStore(localStore: ReaderLocalStore(defaults: defaults))
        let body = SaveProgressBody(
            novelId: "novel-1",
            chapterId: "chapter-1",
            chapterTitle: "第一章",
            chapterOrder: 1,
            scrollPercent: 0.45,
            pageMode: "scroll",
            clientUpdatedAt: 100
        )

        store.activate(userID: "alice")
        store.enqueue(body)
        store.activate(userID: "bob")
        XCTAssertEqual(store.pendingCount, 0)

        store.activate(userID: "alice")
        XCTAssertEqual(store.pendingCount, 1)
        XCTAssertEqual(store.pendingBody(for: "novel-1"), body)
        store.deactivate()
    }

    func testChapterCacheSurvivesARecreatedCacheInstance() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("ZhiZhouTests-\(UUID().uuidString)", isDirectory: true)
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
            .appendingPathComponent("ZhiZhouTests-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: directory) }

        let url = "https://example.com/api/chapters/chapter-1?contentMode=safe"
        let cache = ChapterDiskCache(directoryURL: directory, maxBytes: 1024 * 1024)
        await cache.store(Data("chapter content".utf8), for: url)

        await cache.removeAll()

        let exists = await cache.contains(url)
        XCTAssertFalse(exists)
    }
}
