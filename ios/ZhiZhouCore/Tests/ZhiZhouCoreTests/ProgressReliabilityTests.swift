import Foundation
import XCTest
@testable import ZhiZhouCore

@MainActor
final class ProgressReliabilityTests: XCTestCase {
    private func decode(_ json: String) throws -> ProgressWriteAcknowledgement {
        try JSONDecoder().decode(ProgressWriteAcknowledgement.self, from: Data(json.utf8))
    }

    private func body(_ novelID: String, time: Int64) -> SaveProgressBody {
        SaveProgressBody(novelId: novelID, chapterId: "chapter", chapterTitle: "章节", chapterOrder: 1,
                         scrollPercent: 0.5, pageMode: "scroll", clientUpdatedAt: time)
    }

    func testAnonymousSuccessAndMismatchedReceiptsCannotAcknowledgeProgress() throws {
        let anonymous = try decode(#"{"success":true}"#)
        XCTAssertThrowsError(try anonymous.validate(userID: "alice", novelID: "book", clientUpdatedAt: 100))
        XCTAssertThrowsError(try anonymous.validate(userID: "alice", novelID: "book", clientUpdatedAt: 100, deleting: true))
        let receipt = try decode(#"{"success":true,"acknowledged":{"userId":"alice","novelId":"book","clientUpdatedAt":100}}"#)
        XCTAssertNoThrow(try receipt.validate(userID: "alice", novelID: "book", clientUpdatedAt: 100))
        XCTAssertThrowsError(try receipt.validate(userID: "bob", novelID: "book", clientUpdatedAt: 100))
        XCTAssertThrowsError(try receipt.validate(userID: "alice", novelID: "other", clientUpdatedAt: 100))
        XCTAssertThrowsError(try receipt.validate(userID: "alice", novelID: "book", clientUpdatedAt: 101))
    }

    func testLegacyAuthoritativeStateAndExplicitMissingNovelDeletionRemainCompatible() throws {
        let progress = try decode(#"{"success":true,"progress":{"novelId":"book","chapterId":"chapter","updatedAt":90},"tombstone":null}"#)
        XCTAssertNoThrow(try progress.validate(userID: "alice", novelID: "book", clientUpdatedAt: 100))
        XCTAssertThrowsError(try progress.validate(userID: "alice", novelID: "other", clientUpdatedAt: 100))
        let empty = try decode(#"{"success":true,"progress":null,"tombstone":null}"#)
        XCTAssertNoThrow(try empty.validate(userID: "alice", novelID: "book", clientUpdatedAt: 100, deleting: true))
        XCTAssertThrowsError(try empty.validate(userID: "alice", novelID: "book", clientUpdatedAt: 100))
    }

    func testRejectedNovelDoesNotBlockHealthyNovelAndErrorSurvivesSuccess() async {
        let suite = "ProgressReliability.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let store = ReaderLocalStore(defaults: defaults)
        var uploads: [String] = []
        let outbox = ReaderProgressOutbox(localStore: store, uploader: { body, userID in
            XCTAssertEqual(userID, "alice")
            uploads.append(body.novelId)
            if body.novelId == "deleted" { throw ProgressSyncError.itemRejected("章节不存在") }
        })
        outbox.activate(userID: "alice")
        outbox.enqueue(body("deleted", time: 100))
        outbox.enqueue(body("healthy", time: 200))
        await outbox.flush()
        XCTAssertEqual(uploads, ["deleted", "healthy"])
        XCTAssertNotNil(outbox.pendingBody(for: "deleted"))
        XCTAssertNil(outbox.pendingBody(for: "healthy"))
        XCTAssertTrue(outbox.lastSyncError?.contains("章节不存在") == true)
        XCTAssertEqual(store.loadProgress(userID: "alice").count, 1)
    }

    func testFailedDeletionFencesOnlyThatNovelAndRetainsNewerLocalProgress() async {
        let suite = "ProgressReliability.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        var uploads: [String] = []
        let outbox = ReaderProgressOutbox(localStore: ReaderLocalStore(defaults: defaults),
            uploader: { body, _ in uploads.append(body.novelId) },
            deleter: { _, _, _ in throw ProgressSyncError.itemRejected("暂时无访问权限") })
        outbox.activate(userID: "alice")
        outbox.discard(novelID: "blocked", deletedAt: 100)
        outbox.enqueue(body("blocked", time: 200))
        outbox.enqueue(body("healthy", time: 300))
        await outbox.flush()
        XCTAssertEqual(uploads, ["healthy"])
        XCTAssertEqual(outbox.pendingDelete(for: "blocked"), 100)
        XCTAssertNotNil(outbox.pendingBody(for: "blocked"))
    }

    func testUnconfirmedOrSessionWideFailureKeepsQueueForNextLogin() async {
        let suite = "ProgressReliability.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        var attempts = 0
        let outbox = ReaderProgressOutbox(localStore: ReaderLocalStore(defaults: defaults), uploader: { _, _ in
            attempts += 1
            throw ProgressSyncError.unconfirmed
        })
        outbox.activate(userID: "alice")
        outbox.enqueue(body("first", time: 100))
        outbox.enqueue(body("second", time: 200))
        await outbox.flush()
        XCTAssertEqual(attempts, 1)
        XCTAssertEqual(outbox.pendingCount, 2)
        outbox.activate(userID: "bob")
        XCTAssertEqual(outbox.pendingCount, 0)
        outbox.activate(userID: "alice")
        XCTAssertEqual(outbox.pendingCount, 2)
    }

    func testAcknowledgedProgressRemainsAvailableAfterOfflineRestart() async {
        let suite = "ProgressReliability.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let store = ReaderLocalStore(defaults: defaults)
        let outbox = ReaderProgressOutbox(localStore: store, uploader: { _, _ in })
        outbox.activate(userID: "alice")
        let position = body("book", time: 100)
        outbox.enqueue(position)
        await outbox.flush()
        XCTAssertEqual(outbox.pendingCount, 0)

        let reopened = ReaderProgressOutbox(localStore: store, uploader: { _, _ in XCTFail("Offline restore must not upload") })
        reopened.activate(userID: "alice")
        XCTAssertEqual(reopened.latestBody(for: "book"), position)
        XCTAssertEqual(reopened.pendingCount, 0)
        reopened.activate(userID: "bob")
        XCTAssertNil(reopened.latestBody(for: "book"))
    }

    func testNewerRemotePositionWinsWithoutAddingItToTheOutbox() async {
        let suite = "ProgressReliability.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let outbox = ReaderProgressOutbox(localStore: ReaderLocalStore(defaults: defaults), uploader: { _, _ in })
        outbox.activate(userID: "alice")
        outbox.enqueue(body("book", time: 200))
        outbox.rememberRemote(body("book", time: 100))
        XCTAssertEqual(outbox.latestBody(for: "book")?.clientUpdatedAt, 200)
        outbox.rememberRemote(body("book", time: 300))
        await outbox.flush()
        XCTAssertEqual(outbox.latestBody(for: "book")?.clientUpdatedAt, 300)
        XCTAssertEqual(outbox.pendingCount, 0)
    }

    func testAcknowledgedDeletionStillFencesStaleRemoteProgressAfterRestart() async {
        let suite = "ProgressReliability.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let store = ReaderLocalStore(defaults: defaults)
        let outbox = ReaderProgressOutbox(localStore: store, uploader: { _, _ in }, deleter: { _, _, _ in })
        outbox.activate(userID: "alice")
        outbox.enqueue(body("book", time: 100))
        outbox.discard(novelID: "book", deletedAt: 200)
        await outbox.flush()
        XCTAssertEqual(outbox.pendingDeleteCount, 0)

        let reopened = ReaderProgressOutbox(localStore: store, uploader: { _, _ in })
        reopened.activate(userID: "alice")
        reopened.rememberRemote(body("book", time: 100))
        reopened.enqueue(body("book", time: 200))
        XCTAssertNil(reopened.latestBody(for: "book"))
        XCTAssertEqual(reopened.pendingCount, 0)
        reopened.enqueue(body("book", time: 300))
        XCTAssertEqual(reopened.latestBody(for: "book")?.clientUpdatedAt, 300)
    }

    func testLegacyPendingProgressMigratesAndRemoteDeletionHonorsNewerLocalReading() {
        let suite = "ProgressReliability.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let store = ReaderLocalStore(defaults: defaults)
        store.saveProgress(["book": body("book", time: 200)], userID: "alice")
        let outbox = ReaderProgressOutbox(localStore: store, uploader: { _, _ in })
        outbox.activate(userID: "alice")
        XCTAssertEqual(outbox.latestBody(for: "book")?.clientUpdatedAt, 200)
        outbox.rememberRemoteDeletion(novelID: "book", deletedAt: 100)
        XCTAssertEqual(outbox.pendingCount, 1)
        outbox.rememberRemoteDeletion(novelID: "book", deletedAt: 300)
        XCTAssertNil(outbox.latestBody(for: "book"))
        XCTAssertEqual(outbox.pendingCount, 0)
    }
}
