import XCTest
@testable import ZhiZhouCore

final class ReaderTapGuardTests: XCTestCase {
    func testStationaryTouchCanTapWithoutDelay() {
        var guardState = ReaderTapGuard()

        XCTAssertTrue(guardState.allowsTap(at: 0))
        guardState.updatePhase(.tracking, at: 1)
        XCTAssertTrue(guardState.allowsTap(at: 1))
        guardState.updatePhase(.idle, at: 1.125)
        XCTAssertTrue(guardState.allowsTap(at: 1.125))
    }

    func testDraggingAndDecelerationRejectTapsRegardlessOfDuration() {
        var guardState = ReaderTapGuard()
        guardState.updatePhase(.moving, at: 1)
        XCTAssertFalse(guardState.allowsTap(at: 1))
        XCTAssertFalse(guardState.allowsTap(at: 10))

        // A drag can transition straight to deceleration without an idle phase.
        guardState.updatePhase(.moving, at: 10)
        XCTAssertFalse(guardState.allowsTap(at: 20))
    }

    func testTouchStoppingMomentumCannotRevealChrome() {
        var guardState = ReaderTapGuard()
        guardState.updatePhase(.moving, at: 1)
        guardState.updatePhase(.tracking, at: 1.25)
        XCTAssertFalse(guardState.allowsTap(at: 1.75))
        guardState.updatePhase(.idle, at: 2)

        XCTAssertFalse(guardState.allowsTap(at: 2))
        XCTAssertFalse(guardState.allowsTap(at: 2.24))
        XCTAssertTrue(guardState.allowsTap(at: 2.25))
    }

    func testStationaryTrackingDoesNotKeepExtendingTheProtection() {
        var guardState = ReaderTapGuard()
        guardState.updatePhase(.moving, at: 1)
        guardState.updatePhase(.idle, at: 2)
        guardState.updatePhase(.tracking, at: 2.125)
        guardState.updatePhase(.idle, at: 2.2)

        XCTAssertFalse(guardState.allowsTap(at: 2.125))
        XCTAssertTrue(guardState.allowsTap(at: 2.25))
    }

    func testConsecutiveDragsProtectEachRelease() {
        var guardState = ReaderTapGuard()
        guardState.updatePhase(.moving, at: 1)
        guardState.updatePhase(.idle, at: 2)
        guardState.updatePhase(.tracking, at: 2.1)
        guardState.updatePhase(.moving, at: 2.125)
        guardState.updatePhase(.idle, at: 3)

        XCTAssertFalse(guardState.allowsTap(at: 3.125))
        XCTAssertTrue(guardState.allowsTap(at: 3.25))
    }
}
