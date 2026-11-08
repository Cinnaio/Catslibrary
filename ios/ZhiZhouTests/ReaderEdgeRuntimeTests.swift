import XCTest
@testable import ZhiZhou

/// Runs under the native test host; checks JavaScriptCore and Codable, not just Node.
final class ReaderEdgeRuntimeTests: XCTestCase {
    @MainActor
    func testBundledRuntimeDecodesSettingsAndPreservesPausedStage() throws {
        let runtime = try ReaderEdgeRuntime()
        let catalog = try runtime.catalog()
        XCTAssertFalse(catalog.defaults.sound)
        XCTAssertFalse(catalog.defaults.speech)
        XCTAssertEqual(catalog.historyLimit, 30)
        XCTAssertEqual(try runtime.loadData(nil).data.history.count, 0)
        XCTAssertNotNil(try runtime.loadData("{broken").error)

        let settings = try JSONSerialization.jsonObject(with: JSONEncoder().encode(catalog.defaults))
        let started = try XCTUnwrap(runtime.dispatch(["type": "start", "id": "test", "settings": settings, "now": 0, "seed": 42]))
        XCTAssertTrue(started.canDeclare)
        XCTAssertEqual(try runtime.dispatch(["type": "edge", "now": 100])?.status, .cooldown)
        XCTAssertEqual(try runtime.dispatch(["type": "pause", "now": 200, "reason": "manual"])?.resumeStatus, .cooldown)
        let resumed = try XCTUnwrap(runtime.dispatch(["type": "resume", "now": 10_000]))
        XCTAssertEqual(resumed.status, .cooldown)
        XCTAssertEqual(resumed.elapsedMs, 200)
        let interrupted = try XCTUnwrap(runtime.dispatch(["type": "tick", "now": 13_000]))
        XCTAssertEqual(interrupted.status, .paused)
        XCTAssertEqual(interrupted.pauseReason, "interrupted")
        XCTAssertEqual(interrupted.elapsedMs, 200)
        XCTAssertNil(try runtime.dispatch(["type": "discard"]))
    }

    @MainActor
    func testLocalDataIsSeparatedByAccountAndServerButSharedAcrossBooks() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let storage = ReaderEdgeLocalStore(directory: directory)
        let runtime = try ReaderEdgeRuntime()
        let revision = UUID()
        let first = ReaderEdgeContext(server: "https://one.invalid", userID: "a", bookID: "book-1", accountRevision: revision)
        let sameAccount = ReaderEdgeContext(server: first.server, userID: "a", bookID: "book-2", accountRevision: UUID())
        let otherAccount = ReaderEdgeContext(server: first.server, userID: "b", bookID: "book-1", accountRevision: revision)
        let otherServer = ReaderEdgeContext(server: "https://two.invalid", userID: "a", bookID: "book-1", accountRevision: revision)
        let data = ReaderEdgeData(settings: try runtime.catalog().defaults, history: [])
        try storage.write(data, context: first)
        XCTAssertEqual(try runtime.loadData(storage.read(sameAccount)).data.settings, data.settings)
        XCTAssertNil(try storage.read(otherAccount))
        XCTAssertNil(try storage.read(otherServer))
    }

    func testUnexpectedStoredDurationCannotOverflowFormatter() {
        XCTAssertEqual(readerEdgeTime(.infinity), "00:00")
        XCTAssertEqual(readerEdgeTime(-100), "00:00")
        XCTAssertEqual(readerEdgeTime(60_001), "01:01")
        XCTAssertFalse(readerEdgeTime(.greatestFiniteMagnitude).isEmpty)
    }
}
