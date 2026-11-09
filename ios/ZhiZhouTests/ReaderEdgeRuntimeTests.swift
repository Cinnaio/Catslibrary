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
        XCTAssertTrue(catalog.defaults.acts)
        XCTAssertTrue(catalog.defaults.bank)
        XCTAssertTrue(catalog.defaults.timing)
        XCTAssertEqual(catalog.rules.count, 3)
        XCTAssertEqual(catalog.declarations.count, 2)
        XCTAssertEqual(catalog.spends.count, 3)
        XCTAssertEqual(catalog.overtimeMinSeconds, 45)
        XCTAssertEqual(catalog.historyLimit, 30)
        XCTAssertEqual(try runtime.loadData(nil).data.history.count, 0)
        XCTAssertNotNil(try runtime.loadData("{broken").error)

        let settings = try JSONSerialization.jsonObject(with: JSONEncoder().encode(catalog.defaults))
        let started = try XCTUnwrap(runtime.dispatch(["type": "start", "id": "test", "settings": settings, "now": 0, "seed": 42]))
        XCTAssertTrue(started.canDeclare)
        XCTAssertEqual(started.act, "warmup")
        XCTAssertNotNil(started.feedback.timingHint)
        XCTAssertEqual(started.feedback.spends.count, 3)
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
    func testDisabledRulesSurviveCodableAndNormalizeLegacyOvertime() throws {
        let runtime = try ReaderEdgeRuntime()
        var settings = try runtime.catalog().defaults
        settings.acts = false
        settings.bank = false
        settings.timing = false
        settings.overtimeSeconds = 15
        settings = try runtime.normalize(settings)
        XCTAssertFalse(settings.acts)
        XCTAssertFalse(settings.bank)
        XCTAssertFalse(settings.timing)
        XCTAssertEqual(settings.overtimeSeconds, 45)
        let value = try JSONSerialization.jsonObject(with: JSONEncoder().encode(settings))
        let started = try XCTUnwrap(runtime.dispatch(["type": "start", "id": "disabled", "settings": value, "now": 0, "seed": 42]))
        XCTAssertNil(started.feedback.timingHint)
        XCTAssertEqual(started.act, "grind")
        XCTAssertTrue(started.feedback.spends.allSatisfy { $0.note != nil })
        let rejected = try XCTUnwrap(runtime.dispatch(["type": "edge", "declare": "grind", "now": 50]))
        XCTAssertEqual(rejected.edges, 0)
        let declared = try XCTUnwrap(runtime.dispatch(["type": "edge", "now": 100]))
        XCTAssertEqual(declared.chance, started.chance + 5)
        XCTAssertEqual(declared.grinds, 0)
    }

    @MainActor
    func testNativeBankActionsAndRecordsRetainNewCounters() throws {
        let runtime = try ReaderEdgeRuntime()
        var settings = try runtime.catalog().defaults
        settings.minutes = 30
        let value = try JSONSerialization.jsonObject(with: JSONEncoder().encode(settings))
        _ = try runtime.dispatch(["type": "start", "id": "bank", "settings": value, "now": 0, "seed": 42])
        var session = try XCTUnwrap(runtime.dispatch(["type": "edge", "declare": "grind", "now": 100]))
        XCTAssertEqual(session.grinds, 1)
        var now = 100
        for _ in 0..<1500 {
            if session.feedback.spends.first(where: { $0.kind == .permit })?.note == nil { break }
            now += 1000
            session = try XCTUnwrap(runtime.dispatch(["type": "tick", "now": now]))
        }
        let beforeBank = session.bank
        session = try XCTUnwrap(runtime.dispatch(["type": "spend", "kind": "permit", "now": now]))
        XCTAssertEqual(session.status, .permit)
        XCTAssertEqual(session.bank, beforeBank - 8)
        XCTAssertEqual(session.spent, 8)
        XCTAssertEqual(session.remainingMs, Double(settings.permitSeconds) * 1000)
        session = try XCTUnwrap(runtime.dispatch(["type": "came", "now": now]))
        let record = ReaderEdgeRecord(session: session)
        let data = ReaderEdgeData(settings: settings, history: [record])
        let raw = String(decoding: try JSONEncoder().encode(data), as: UTF8.self)
        let loaded = try runtime.loadData(raw)
        XCTAssertEqual(loaded.data.history.first?.grinds, 1)
        XCTAssertEqual(loaded.data.history.first?.spent, 8)
        let totals = try runtime.summarize(loaded.data.history)
        XCTAssertEqual(totals.grinds, 1)
        XCTAssertEqual(totals.spent, 8)
        XCTAssertEqual(totals.permitted, 1)
    }

    @MainActor
    func testOldLocalRecordsReceiveMissingFieldsBeforeNativeDecoding() throws {
        let runtime = try ReaderEdgeRuntime()
        let raw = #"{"settings":{"minutes":5},"history":[{"id":"legacy","finishedAt":1,"minutes":5,"difficulty":"easy","finale":"always","elapsedMs":1000,"edges":1,"overtime":0,"ending":"ended"}]}"#
        let loaded = try runtime.loadData(raw)
        XCTAssertNil(loaded.error)
        XCTAssertTrue(loaded.data.settings.acts)
        XCTAssertEqual(loaded.data.history.first?.grinds, 0)
        XCTAssertEqual(loaded.data.history.first?.spent, 0)
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
