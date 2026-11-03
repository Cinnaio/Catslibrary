import XCTest
@testable import ZhiZhouCore

final class APIRequestURLTests: XCTestCase {
    private let base = URL(string: "https://catrr.uk")!

    func testIllustrationRequestPreservesEncodedChapterIDThroughContentPolicy() throws {
        // ReaderMediaAPI encodes IDs before getReader adds contentMode.
        let path = ContentPolicy.readerPath("/api/chapters/chapter%5F123%2Dabc/illustrations", mode: "safe")
        let url = try XCTUnwrap(APIRequestURL.resolve(path, relativeTo: base))
        XCTAssertEqual(url.absoluteString, "https://catrr.uk/api/chapters/chapter%5F123%2Dabc/illustrations?contentMode=safe")
        XCTAssertEqual(url.path, "/api/chapters/chapter_123-abc/illustrations")
        XCTAssertFalse(url.absoluteString.contains("%25"))
    }

    func testBinaryImageRequestPreservesEachEncodedSegment() throws {
        let path = ContentPolicy.readerPath("/api/chapters/chapter%5F1/illustrations/image%2D1/image", mode: "adult")
        let url = try XCTUnwrap(APIRequestURL.resolve(path, relativeTo: base))
        XCTAssertEqual(url.path, "/api/chapters/chapter_1/illustrations/image-1/image")
        XCTAssertEqual(URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems,
                       [URLQueryItem(name: "contentMode", value: "adult")])
    }

    func testReservedCharactersRemainWithinPathSegment() throws {
        let url = try XCTUnwrap(APIRequestURL.resolve("/api/assets/a%2Fb%25c%3Fd%23e", relativeTo: base))
        XCTAssertEqual(URLComponents(url: url, resolvingAgainstBaseURL: false)?.percentEncodedPath,
                       "/api/assets/a%2Fb%25c%3Fd%23e")
        XCTAssertNil(url.query)
        XCTAssertNil(url.fragment)
    }

    func testUnicodeAndQueryAreNotEncodedAgain() throws {
        let path = ContentPolicy.readerPath("/api/assets/%E5%9B%BE?search=a%26b%2Bc%3Dd%3F", mode: "safe")
        let url = try XCTUnwrap(APIRequestURL.resolve(path, relativeTo: base))
        XCTAssertEqual(url.absoluteString, "https://catrr.uk/api/assets/%E5%9B%BE?search=a%26b%2Bc%3Dd%3F&contentMode=safe")
    }

    func testOrdinaryRoutesAndServerBasePathRemainCompatible() throws {
        for root in ["https://catrr.uk/gateway", "https://catrr.uk/gateway/"] {
            let url = try XCTUnwrap(APIRequestURL.resolve("/api/progress?novelId=novel_1", relativeTo: URL(string: root)!))
            XCTAssertEqual(url.absoluteString, "https://catrr.uk/gateway/api/progress?novelId=novel_1")
        }
        XCTAssertEqual(APIRequestURL.resolve("api/health", relativeTo: base)?.absoluteString, "https://catrr.uk/api/health")
        XCTAssertNil(APIRequestURL.resolve("//other.example/api/health", relativeTo: base))
    }
}
