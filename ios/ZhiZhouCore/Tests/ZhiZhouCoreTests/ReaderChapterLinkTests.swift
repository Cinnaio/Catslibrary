import XCTest
@testable import ZhiZhouCore

final class ReaderChapterLinkTests: XCTestCase {
    private let site = URL(string: "https://catrr.uk")!

    func testChapterCitationResolvesToExactIDs() throws {
        let url = try XCTUnwrap(APIRequestURL.resolve("/read/novel%5Fone/chapter%2Dtwo", relativeTo: site))
        let link = try XCTUnwrap(ReaderChapterLink(url: url, site: site))
        XCTAssertEqual(link.novelID, "novel_one")
        XCTAssertEqual(link.chapterID, "chapter-two")
    }

    func testAbsoluteLinkCanMatchSiteWithBasePathAndExplicitDefaultPort() throws {
        let mountedSite = try XCTUnwrap(URL(string: "https://catrr.uk/library/"))
        let url = try XCTUnwrap(URL(string: "https://CATRR.UK:443/library/read/book/chapter/"))
        let link = try XCTUnwrap(ReaderChapterLink(url: url, site: mountedSite))
        XCTAssertEqual(link.novelID, "book")
        XCTAssertEqual(link.chapterID, "chapter")
        XCTAssertNil(ReaderChapterLink(url: url, site: site))
    }

    func testNonChapterAndWebSpecificURLsKeepSystemRouting() throws {
        let links = [
            "https://outside.example/read/book/chapter",
            "https://catrr.uk.example/read/book/chapter",
            "https://catrr.uk:444/read/book/chapter",
            "http://catrr.uk/read/book/chapter",
            "https://user@catrr.uk/read/book/chapter",
            "https://catrr.uk/admin/ai?view=analysis",
            "https://catrr.uk/read/book",
            "https://catrr.uk/read//chapter",
            "https://catrr.uk/read/book/%2E%2E",
            "https://catrr.uk/read/book/chapter/more",
            "https://catrr.uk/read/book/chapter?thoughtId=thought",
            "https://catrr.uk/read/book/chapter#paragraph",
        ]
        for text in links {
            let url = try XCTUnwrap(URL(string: text))
            XCTAssertNil(ReaderChapterLink(url: url, site: site), text)
        }
    }
}
