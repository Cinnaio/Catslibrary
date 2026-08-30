import Foundation
import XCTest
@testable import ZhiZhouCore

@MainActor
final class AITaskCoordinatorTests: XCTestCase {
    private var defaults: UserDefaults!
    private var suiteName = ""

    override func setUp() {
        super.setUp()
        suiteName = "ZhiZhouCoreTests.AITaskCoordinator.\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suiteName)
    }

    override func tearDown() {
        defaults.removePersistentDomain(forName: suiteName)
        defaults = nil
        super.tearDown()
    }

    func testConcurrentStartsForTheSameKeyShareOneServerLaunch() async throws {
        let coordinator = makeCoordinator()
        coordinator.activate(userID: "admin-1")
        var launchCalls = 0

        let launch: AITaskCoordinator.Launcher = { requestID in
            launchCalls += 1
            try await Task.sleep(nanoseconds: 30_000_000)
            return "task-\(requestID)"
        }
        let first = Task {
            try await coordinator.start(
                key: "cover.prompt",
                kind: "cover_prompt",
                recover: { _ in nil },
                launch: launch
            )
        }
        let second = Task {
            try await coordinator.start(
                key: "cover.prompt",
                kind: "cover_prompt",
                recover: { _ in nil },
                launch: launch
            )
        }

        let firstResult = try await first.value
        let secondResult = try await second.value

        XCTAssertEqual(launchCalls, 1)
        XCTAssertEqual(firstResult.record.taskID, secondResult.record.taskID)
        XCTAssertEqual(
            [firstResult.reusedExistingOperation, secondResult.reusedExistingOperation].filter { $0 }.count,
            1
        )
    }

    func testInterruptedLaunchPersistsRequestIDAndRecoversWithoutRelaunching() async throws {
        enum TestError: Error { case disconnected }

        let firstCoordinator = makeCoordinator()
        firstCoordinator.activate(userID: "admin-1")
        var originalRequestID = ""
        do {
            _ = try await firstCoordinator.start(
                key: "writing.generate",
                kind: "continue",
                resourceID: "novel-1",
                recover: { _ in nil },
                launch: { requestID in
                    originalRequestID = requestID
                    throw TestError.disconnected
                }
            )
            XCTFail("Expected the interrupted request to throw")
        } catch TestError.disconnected {
            // Expected: the pending operation remains durable for reconciliation.
        }

        let reopenedCoordinator = makeCoordinator()
        reopenedCoordinator.activate(userID: "admin-1")
        var recoveryRequestID = ""
        var relaunchCalls = 0
        let recovered = try await reopenedCoordinator.start(
            key: "writing.generate",
            kind: "continue",
            resourceID: "novel-1",
            recover: { record in
                recoveryRequestID = record.requestID
                return "task-recovered"
            },
            launch: { _ in
                relaunchCalls += 1
                return "task-duplicate"
            }
        )

        XCTAssertFalse(originalRequestID.isEmpty)
        XCTAssertEqual(recoveryRequestID, originalRequestID)
        XCTAssertEqual(recovered.record.taskID, "task-recovered")
        XCTAssertTrue(recovered.reusedExistingOperation)
        XCTAssertEqual(relaunchCalls, 0)
    }

    func testRecordsAreScopedToTheActiveAccount() async throws {
        let coordinator = makeCoordinator()
        coordinator.activate(userID: "admin-1")
        _ = try await coordinator.start(
            key: "cover.image",
            kind: "cover",
            resourceID: "novel-1",
            recover: { _ in nil },
            launch: { _ in "task-admin-1" }
        )

        coordinator.activate(userID: "admin-2")
        XCTAssertNil(coordinator.record(for: "cover.image"))

        coordinator.activate(userID: "admin-1")
        XCTAssertEqual(coordinator.record(for: "cover.image")?.taskID, "task-admin-1")
    }

    func testOldTerminalCallbackCannotClearANewerOperation() async throws {
        let coordinator = makeCoordinator()
        coordinator.activate(userID: "admin-1")
        let first = try await coordinator.start(
            key: "writing.generate",
            kind: "write_chapter",
            recover: { _ in nil },
            launch: { _ in "task-1" }
        )
        coordinator.finish(key: "writing.generate", expectedTaskID: first.record.taskID)

        let second = try await coordinator.start(
            key: "writing.generate",
            kind: "write_chapter",
            recover: { _ in nil },
            launch: { _ in "task-2" }
        )
        coordinator.finish(key: "writing.generate", expectedTaskID: "task-1")

        XCTAssertEqual(second.record.taskID, "task-2")
        XCTAssertEqual(coordinator.record(for: "writing.generate")?.taskID, "task-2")
    }

    func testDeactivationInvalidatesAnInFlightLaunch() async throws {
        let coordinator = makeCoordinator()
        coordinator.activate(userID: "admin-1")
        let launchStarted = TestLatch()
        let releaseLaunch = TestLatch()

        let pending = Task { () throws -> AITaskLaunch in
            try await coordinator.start(
                key: "cover.prompt",
                kind: "cover_prompt",
                recover: { _ in nil },
                launch: { _ in
                    await launchStarted.signal()
                    await releaseLaunch.wait()
                    return "task-late"
                }
            )
        }

        await launchStarted.wait()
        coordinator.deactivate()
        await releaseLaunch.signal()

        do {
            _ = try await pending.value
            XCTFail("Expected the old session launch to be rejected")
        } catch let error as AITaskCoordinationError {
            XCTAssertEqual(error, .sessionChanged)
        }
        XCTAssertNil(coordinator.record(for: "cover.prompt"))
    }

    func testAccountSwitchKeepsOldOperationOutOfTheNewAccountNamespace() async throws {
        let coordinator = makeCoordinator()
        coordinator.activate(userID: "admin-1")
        let launchStarted = TestLatch()
        let releaseLaunch = TestLatch()

        let pending = Task { () throws -> AITaskLaunch in
            try await coordinator.start(
                key: "writing.generate",
                kind: "continue",
                resourceID: "novel-1",
                recover: { _ in nil },
                launch: { _ in
                    await launchStarted.signal()
                    await releaseLaunch.wait()
                    return "task-old-account"
                }
            )
        }

        await launchStarted.wait()
        coordinator.activate(userID: "admin-2")
        await releaseLaunch.signal()

        do {
            _ = try await pending.value
            XCTFail("Expected the account switch to reject the old launch")
        } catch let error as AITaskCoordinationError {
            XCTAssertEqual(error, .sessionChanged)
        }
        XCTAssertNil(coordinator.record(for: "writing.generate"))

        coordinator.activate(userID: "admin-1")
        let oldRecord = try XCTUnwrap(coordinator.record(for: "writing.generate"))
        XCTAssertNil(oldRecord.taskID)
        XCTAssertEqual(oldRecord.resourceID, "novel-1")
    }

    private func makeCoordinator() -> AITaskCoordinator {
        AITaskCoordinator(localStore: AITaskLocalStore(defaults: defaults))
    }
}

private actor TestLatch {
    private var isSignaled = false
    private var waiter: CheckedContinuation<Void, Never>?

    func wait() async {
        if isSignaled { return }
        await withCheckedContinuation { continuation in
            waiter = continuation
        }
    }

    func signal() {
        isSignaled = true
        waiter?.resume()
        waiter = nil
    }
}
