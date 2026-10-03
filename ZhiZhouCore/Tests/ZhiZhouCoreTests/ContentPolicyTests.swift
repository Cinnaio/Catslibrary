import XCTest
@testable import ZhiZhouCore

final class ContentPolicyTests: XCTestCase {
    func testReaderPathReplacesOldModeWithoutDuplicatingIt() {
        XCTAssertEqual(ContentPolicy.readerPath("/api/novels?contentMode=safe&page=2", mode: "adult"), "/api/novels?page=2&contentMode=adult")
        XCTAssertEqual(ContentPolicy.safePath("/api/chapters/one?contentMode=adult"), "/api/chapters/one?contentMode=safe")
        XCTAssertEqual(ContentPolicy.readerPath("/api/novels", mode: "invalid"), "/api/novels?contentMode=safe")
        XCTAssertEqual(ContentPolicy.readerPath("/api/novels?search=a%26b%2Bc%3Dd%3F&contentMode=safe", mode: "adult"), "/api/novels?search=a%26b%2Bc%3Dd%3F&contentMode=adult")
    }

    func testAdultAndAuthenticatedChapterRequestsNeverUseOfflineCache() {
        XCTAssertFalse(ContentPolicy.canCacheChapter(path: "/api/chapters/one?contentMode=adult", authenticated: false))
        XCTAssertFalse(ContentPolicy.canCacheChapter(path: "/api/chapters/one?contentMode=adult", authenticated: true))
        XCTAssertFalse(ContentPolicy.canCacheChapter(path: "/api/chapters/one?contentMode=safe", authenticated: true))
        XCTAssertFalse(ContentPolicy.canCacheChapter(path: "/api/chapters/one", authenticated: false))
        XCTAssertFalse(ContentPolicy.canCacheChapter(path: "/api/chapters/one?contentMode=safe&contentMode=adult", authenticated: false))
        XCTAssertTrue(ContentPolicy.canCacheChapter(path: "/api/chapters/one?contentMode=safe", authenticated: false))
    }
}
