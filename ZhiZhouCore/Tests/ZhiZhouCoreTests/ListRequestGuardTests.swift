import XCTest
@testable import ZhiZhouCore

final class ListRequestGuardTests: XCTestCase {
    func testOlderSearchCannotReplaceNewSearchOrClearItsLoadingState() {
        var requests = ListRequestGuard<String>()
        let old = requests.begin("old")
        let current = requests.begin("new")
        XCTAssertFalse(requests.accepts(old, query: "new"))
        requests.finish(old)
        XCTAssertTrue(requests.isLoading)
        XCTAssertTrue(requests.accepts(current, query: "new"))
    }

    func testFilterChangeRejectsResponseEvenDuringDebounce() {
        var requests = ListRequestGuard<String>()
        let old = requests.begin("all")
        XCTAssertFalse(requests.accepts(old, query: "completed"))
        requests.finish(old)
        XCTAssertNil(requests.beginNext("completed"))
    }

    func testPaginationRequiresSuccessfulMatchingQueryAndOnlyOneRequest() throws {
        var requests = ListRequestGuard<String>()
        XCTAssertNil(requests.beginNext("all"))
        let first = requests.begin("all")
        requests.finish(first, succeeded: true)
        let next = try XCTUnwrap(requests.beginNext("all"))
        XCTAssertNil(requests.beginNext("all"))
        XCTAssertNil(requests.beginNext("other"))
        requests.finish(next)
        XCTAssertNotNil(requests.beginNext("all"), "A failed next page remains retryable")
    }

    func testRefreshSupersedesInFlightPagination() throws {
        var requests = ListRequestGuard<String>()
        let first = requests.begin("all")
        requests.finish(first, succeeded: true)
        let next = try XCTUnwrap(requests.beginNext("all"))
        let refresh = requests.begin("all")
        XCTAssertFalse(requests.accepts(next, query: "all"))
        requests.finish(next, succeeded: true)
        XCTAssertTrue(requests.accepts(refresh, query: "all"))
    }

    func testFailedFilterReloadCannotPageIntoPreviousResults() {
        var requests = ListRequestGuard<String>()
        let first = requests.begin("all")
        requests.finish(first, succeeded: true)
        let filtered = requests.begin("completed")
        requests.finish(filtered)
        XCTAssertNil(requests.beginNext("completed"))
        let retry = requests.begin("completed")
        requests.finish(retry, succeeded: true)
        XCTAssertNotNil(requests.beginNext("completed"))
    }
}
