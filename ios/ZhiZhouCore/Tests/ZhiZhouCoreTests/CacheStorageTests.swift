import Foundation
import XCTest
@testable import ZhiZhouCore

final class CacheStorageTests: XCTestCase {
    func testCustomBudgetSurvivesReloadAndPartitionsTheWholeBudget() {
        let name = "CacheStorageTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: name)!
        defer { defaults.removePersistentDomain(forName: name) }
        XCTAssertEqual(CacheStoragePolicy.load(from: defaults).megabytes, 256)
        defaults.set(333, forKey: CacheStoragePolicy.defaultsKey)
        let reloaded = CacheStoragePolicy.load(from: defaults)
        XCTAssertEqual(reloaded.megabytes, 333)
        XCTAssertEqual(reloaded.imageBytes + reloaded.chapterBytes, 333_000_000)
        XCTAssertEqual(CacheStoragePolicy(megabytes: -1).megabytes, 32)
        XCTAssertEqual(CacheStoragePolicy(megabytes: Int.max).megabytes, 8192)
    }

    func testDownloadsSurviveBudgetReductionAndCacheClearAcrossRestart() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let cache = ChapterDiskCache(directoryURL: directory, maxBytes: 100)
        let saved = Data(repeating: 1, count: 80)
        try await cache.storeOffline(saved, for: "download", scope: "alice")
        await cache.store(Data(repeating: 2, count: 80), for: "temporary", scope: "alice")
        await cache.setMaxBytes(1)
        let evicted = await cache.contains("temporary", scope: "alice")
        XCTAssertFalse(evicted)
        await cache.removeAll()
        let reopened = ChapterDiskCache(directoryURL: directory, maxBytes: 1)
        let download = await reopened.data(for: "download", scope: "alice")
        let otherAccount = await reopened.data(for: "download", scope: "bob")
        let usage = await reopened.usage()
        XCTAssertEqual(download, saved)
        XCTAssertNil(otherAccount)
        XCTAssertEqual(usage.automaticBytes, 0)
        XCTAssertEqual(usage.offlineBytes, 80)
    }

    func testLegacyDownloadMigrationIsIdempotentAndExplicitDeleteRemovesIt() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let cache = ChapterDiskCache(directoryURL: directory, maxBytes: 100)
        let payload = Data("legacy".utf8)
        await cache.store(payload, for: "saved", scope: "alice")
        let first = try await cache.preserveOffline("saved", scope: "alice")
        let second = try await cache.preserveOffline("saved", scope: "alice")
        let missing = try await cache.preserveOffline("missing", scope: "alice")
        XCTAssertTrue(first)
        XCTAssertTrue(second)
        XCTAssertFalse(missing)
        await cache.removeAll()
        let retained = await cache.data(for: "saved", scope: "alice")
        XCTAssertEqual(retained, payload)
        await cache.remove("saved", scope: "alice")
        let deleted = await cache.contains("saved", scope: "alice")
        XCTAssertFalse(deleted)
    }

    func testOnlineUpdateRefreshesDownloadEvenWhenItExceedsAutomaticBudget() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let cache = ChapterDiskCache(directoryURL: directory, maxBytes: 1)
        try await cache.storeOffline(Data("old".utf8), for: "saved", scope: "alice")
        let replacement = Data("corrected chapter".utf8)
        await cache.store(replacement, for: "saved", scope: "alice")
        await cache.removeAll()
        let restored = await cache.data(for: "saved", scope: "alice")
        XCTAssertEqual(restored, replacement)
    }

    func testDeletingOneAccountsDownloadsKeepsOtherAccountsCopy() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let cache = ChapterDiskCache(directoryURL: directory)
        try await cache.storeOffline(Data("alice".utf8), for: "same-url", scope: "alice")
        try await cache.storeOffline(Data("bob".utf8), for: "same-url", scope: "bob")
        await cache.removeAll(scope: "alice")
        let alice = await cache.data(for: "same-url", scope: "alice")
        let bob = await cache.data(for: "same-url", scope: "bob")
        XCTAssertNil(alice)
        XCTAssertEqual(bob, Data("bob".utf8))
    }

    func testFailedOfflineWriteIsReportedAndDoesNotDeleteLegacyCopy() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let cache = ChapterDiskCache(directoryURL: directory, maxBytes: 100)
        await cache.store(Data("legacy".utf8), for: "saved", scope: "alice")
        // A file in place of the directory simulates an unwritable persistent destination.
        try Data().write(to: directory.appendingPathComponent("offline-v1"))
        do {
            _ = try await cache.preserveOffline("saved", scope: "alice")
            XCTFail("Migration must report a failed write")
        } catch {
            let retained = await cache.data(for: "saved", scope: "alice")
            XCTAssertEqual(retained, Data("legacy".utf8))
        }
    }
}
