import XCTest
@testable import ZhiZhouCore

final class ReaderAutoScrollTests: XCTestCase {
    func testRefreshRateDoesNotChangeDistance() {
        let speed = ReaderAutoScrollSpeed.medium
        let at60Hz = (0..<60).reduce(0.0) { offset, _ in speed.nextOffset(current: offset, maximum: 1000, elapsed: 1.0 / 60) }
        let at120Hz = (0..<120).reduce(0.0) { offset, _ in speed.nextOffset(current: offset, maximum: 1000, elapsed: 1.0 / 120) }
        XCTAssertEqual(at60Hz, 32, accuracy: 0.00001)
        XCTAssertEqual(at120Hz, at60Hz, accuracy: 0.00001)
    }

    func testLongFrameCannotSkipAheadAndBottomCannotOvershoot() {
        XCTAssertEqual(ReaderAutoScrollSpeed.fast.nextOffset(current: 10, maximum: 1000, elapsed: 30), 15.2, accuracy: 0.00001)
        XCTAssertEqual(ReaderAutoScrollSpeed.fast.nextOffset(current: 98, maximum: 100, elapsed: 0.1), 100)
        XCTAssertEqual(ReaderAutoScrollSpeed.medium.nextOffset(current: 10, maximum: 100, elapsed: -1), 10)
        XCTAssertEqual(ReaderAutoScrollSpeed.off.nextOffset(current: 10, maximum: 100, elapsed: 1), 10)
    }
}
