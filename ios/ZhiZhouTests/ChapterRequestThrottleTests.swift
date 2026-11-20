import XCTest
@testable import ZhiZhou

final class ChapterRequestThrottleTests: XCTestCase {
    private func response(_ headers: [String: String] = [:]) -> HTTPURLResponse {
        HTTPURLResponse(url: URL(string: "https://read.example/api/chapters/a")!, statusCode: 429,
                        httpVersion: nil, headerFields: headers)!
    }

    func testOnlyStructuredReadingLimitsAreAccepted() async throws {
        let throttle = ChapterRequestThrottle()
        let other = Data(#"{"code":"other_limit","retryAfter":1}"#.utf8)
        let accepted = await throttle.record(response: response(), data: other, scope: "reader")
        XCTAssertFalse(accepted)
        try await throttle.wait(scope: "reader")
    }

    func testLongLimitDoesNotWaitAndDoesNotAffectAnotherAccount() async throws {
        let throttle = ChapterRequestThrottle()
        let body = Data(#"{"code":"content_rate_limited","retryAfter":3600}"#.utf8)
        let retry = await throttle.record(response: response(), data: body, scope: "old-reader")
        XCTAssertFalse(retry)
        try await throttle.wait(scope: "new-reader")
        do {
            try await throttle.wait(scope: "old-reader")
            XCTFail("A long limit should return immediately")
        } catch let APIError.http(status, _) { XCTAssertEqual(status, 429) }
    }

    func testWaitBudgetIsBoundedAndCancellationIsPreserved() async throws {
        let throttle = ChapterRequestThrottle()
        let body = Data(#"{"code":"content_rate_limited","retryAfter":1}"#.utf8)
        _ = await throttle.record(response: response(), data: body, scope: "reader")
        do {
            try await throttle.wait(scope: "reader", maxWait: 0.01)
            XCTFail("The remaining wait budget must be respected")
        } catch let APIError.http(status, _) { XCTAssertEqual(status, 429) }
        let waiting = Task { try await throttle.wait(scope: "reader") }
        waiting.cancel()
        do {
            try await waiting.value
            XCTFail("Cancelled reading must not continue")
        } catch is CancellationError { }
    }

    func testRetryHeaderOverridesBodyAndInvalidValuesAreRejected() async throws {
        let throttle = ChapterRequestThrottle()
        let body = Data(#"{"code":"content_rate_limited","retryAfter":3600}"#.utf8)
        let retry = await throttle.record(response: response(["Retry-After": "0.001"]), data: body, scope: "reader")
        XCTAssertTrue(retry)
        try await throttle.wait(scope: "reader")
        let invalid = await throttle.record(response: response(["Retry-After": "-1"]), data: body, scope: "other")
        XCTAssertFalse(invalid)
    }
}
