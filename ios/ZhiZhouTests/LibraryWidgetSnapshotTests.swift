import XCTest
@testable import ZhiZhou

final class LibraryWidgetSnapshotTests: XCTestCase {
    private let scope = String(repeating: "a", count: 64)
    func testSnapshotExpiresAndRejectsFutureTimestamp() {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let snapshot = LibraryWidgetSnapshot(scope: scope, savedAt: now, content: LibraryWidgetContent(reading: nil, quotes: []))
        XCTAssertTrue(snapshot.isValid(at: now))
        XCTAssertFalse(snapshot.isValid(at: now.addingTimeInterval(-1)))
        XCTAssertFalse(snapshot.isValid(at: snapshot.expiresAt))
    }
    func testLinkRoundTripsReservedCharactersWithoutEmbeddingContent() throws {
        let snapshot = LibraryWidgetSnapshot(scope: scope, savedAt: Date(), content: LibraryWidgetContent(reading: nil, quotes: []))
        let url = try XCTUnwrap(snapshot.link(kind: "quote", id: "句子&one?#two"))
        let link = try XCTUnwrap(LibraryWidgetLink(url: url))
        XCTAssertEqual(link.itemID, "句子&one?#two")
        XCTAssertEqual(link.kind, "quote")
        XCTAssertEqual(link.scope, scope)
        XCTAssertFalse(url.absoluteString.contains("token"))
    }
    func testInvalidRoutesAndAmbiguousParametersAreRejected() {
        let valid = "catslibrary://widget/continue?scope=\(scope)&id=n"
        XCTAssertNotNil(LibraryWidgetLink(url: URL(string: valid)!))
        for value in [valid.replacingOccurrences(of: "catslibrary:", with: "https:"),
                      valid.replacingOccurrences(of: "/continue", with: "/admin"),
                      valid + "&id=other", valid + "&scope=\(scope)",
                      valid.replacingOccurrences(of: "&id=n", with: "&id=")] {
            XCTAssertNil(LibraryWidgetLink(url: URL(string: value)!))
        }
    }
}
