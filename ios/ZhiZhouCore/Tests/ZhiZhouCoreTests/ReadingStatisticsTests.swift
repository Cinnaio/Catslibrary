import XCTest
@testable import ZhiZhouCore

final class ReadingStatisticsTests: XCTestCase {
    func testForegroundPauseOnlyClosesPreviousInterval() {
        var clock = ReadingActivityClock(wall: 0, uptime: 0)
        XCTAssertNil(clock.sample(wall: 0, uptime: 0, visible: true))
        XCTAssertEqual(clock.sample(wall: 1000, uptime: 1, visible: true)?.end, 1000)
        XCTAssertEqual(clock.sample(wall: 1500, uptime: 1.5, visible: false)?.end, 1500)
        XCTAssertNil(clock.sample(wall: 2500, uptime: 2.5, visible: false))
        clock.activity(at: 3)
        XCTAssertNil(clock.sample(wall: 3000, uptime: 3, visible: true))
        XCTAssertEqual(clock.sample(wall: 4000, uptime: 4, visible: true)?.start, 3000)
    }

    func testFiveMinuteIdleLimitAndActivityResume() {
        var clock = ReadingActivityClock(wall: 0, uptime: 0)
        _ = clock.sample(wall: 0, uptime: 0, visible: true)
        var total: Int64 = 0
        for second in 1...305 {
            if let part = clock.sample(wall: Int64(second * 1000), uptime: Double(second), visible: true) {
                total += part.end - part.start
            }
        }
        XCTAssertEqual(total, 300_000)
        clock.activity(at: 306)
        XCTAssertNil(clock.sample(wall: 306_000, uptime: 306, visible: true))
        XCTAssertEqual(clock.sample(wall: 307_000, uptime: 307, visible: true)?.end, 307_000)
    }

    func testSuspensionAndWallClockChangesAreDiscarded() {
        var clock = ReadingActivityClock(wall: 0, uptime: 0)
        _ = clock.sample(wall: 0, uptime: 0, visible: true)
        XCTAssertNil(clock.sample(wall: 60_000, uptime: 60, visible: true))
        XCTAssertEqual(clock.sample(wall: 61_000, uptime: 61, visible: true)?.start, 60_000)
        XCTAssertNil(clock.sample(wall: 120_000, uptime: 62, visible: true))
        XCTAssertNil(clock.sample(wall: 119_000, uptime: 63, visible: true))
    }

    func testIdleBoundaryClipsPartialSample() {
        var clock = ReadingActivityClock(wall: 0, uptime: 0)
        _ = clock.sample(wall: 0, uptime: 0, visible: true)
        for second in 1...299 { _ = clock.sample(wall: Int64(second * 1000), uptime: Double(second), visible: true) }
        let part = clock.sample(wall: 301_000, uptime: 301, visible: true)
        XCTAssertEqual(part?.start, 299_000)
        XCTAssertEqual(part?.end, 300_000)
    }

    func testShanghaiDayAndMondayWeekIgnoreDeviceTimezone() {
        let now = date("2026-10-11T17:30:00Z") // Monday 01:30 in Shanghai
        let today = ReadingStatPeriod.today.range(now: now)
        let week = ReadingStatPeriod.week.range(now: now)
        XCTAssertEqual(today.start, ms("2026-10-11T16:00:00Z"))
        XCTAssertEqual(week.start, today.start)
        XCTAssertEqual(week.end, ms("2026-10-11T17:30:00Z"))
        let previous = ReadingStatPeriod.week.range(now: now, offset: -1)
        XCTAssertEqual(previous.start, ms("2026-10-04T16:00:00Z"))
        XCTAssertEqual(previous.end, today.start)
    }

    func testMonthLeapYearAndYearRollover() {
        let now = date("2024-03-01T01:00:00Z")
        let february = ReadingStatPeriod.month.range(now: now, offset: -1)
        XCTAssertEqual(february.start, ms("2024-01-31T16:00:00Z"))
        XCTAssertEqual(february.end - february.start, 29 * 86_400_000)
        let year = ReadingStatPeriod.year.range(now: now, offset: -1)
        XCTAssertEqual(year.start, ms("2022-12-31T16:00:00Z"))
        XCTAssertEqual(year.end, ms("2023-12-31T16:00:00Z"))
    }

    func testRollingAllAndCustomEndIsInclusive() {
        let now = date("2026-10-10T04:00:00Z")
        for (period, count) in [(ReadingStatPeriod.seven, 7), (.thirty, 30), (.ninety, 90)] {
            let current = period.range(now: now)
            let previous = period.range(now: now, offset: -1)
            XCTAssertEqual(previous.end, current.start)
            XCTAssertEqual(previous.end - previous.start, Int64(count) * 86_400_000)
            XCTAssertEqual(current.end, Int64(now.timeIntervalSince1970 * 1000))
        }
        XCTAssertEqual(ReadingStatPeriod.all.range(now: now).start, 0)
        let custom = ReadingStatPeriod.custom.range(now: now, customStart: date("2026-10-01T04:00:00Z"), customEnd: date("2026-10-02T04:00:00Z"))
        XCTAssertEqual(custom.start, ms("2026-09-30T16:00:00Z"))
        XCTAssertEqual(custom.end, ms("2026-10-02T16:00:00Z"))
    }

    func testEventRetryPreservesIDAndWireMilliseconds() throws {
        let original = ReadingStatEvent(sessionId: "session", novelId: "novel", chapterId: "chapter", start: 1_791_600_000_000, end: 1_791_600_030_000)
        let data = try JSONEncoder().encode(original)
        XCTAssertEqual(try JSONDecoder().decode(ReadingStatEvent.self, from: data), original)
        let wire = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(Set(wire.keys), ["id", "sessionId", "novelId", "chapterId", "start", "end"])
        XCTAssertEqual((wire["end"] as? NSNumber)?.int64Value, original.end)
    }

    private func date(_ text: String) -> Date { ISO8601DateFormatter().date(from: text)! }
    private func ms(_ text: String) -> Int64 { Int64(date(text).timeIntervalSince1970 * 1000) }
}
