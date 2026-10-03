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

    func testRestoringAdultRequiresSharedPreferenceAndCurrentSessionGrant() {
        XCTAssertTrue(ContentPolicy.canRestoreAdultMode(accountMode: "adult", sessionAuthorized: true, adultContentEnabled: true, configured: true, expiresIn: 60))
        XCTAssertFalse(ContentPolicy.canRestoreAdultMode(accountMode: "adult", sessionAuthorized: false, adultContentEnabled: true, configured: true, expiresIn: 60))
        XCTAssertFalse(ContentPolicy.canRestoreAdultMode(accountMode: "safe", sessionAuthorized: true, adultContentEnabled: true, configured: true, expiresIn: 60))
        XCTAssertFalse(ContentPolicy.canRestoreAdultMode(accountMode: "adult", sessionAuthorized: true, adultContentEnabled: false, configured: true, expiresIn: 60))
        XCTAssertFalse(ContentPolicy.canRestoreAdultMode(accountMode: "adult", sessionAuthorized: true, adultContentEnabled: true, configured: false, expiresIn: 60))
        for expired in [0.0, -1.0, Double.nan, Double.infinity] {
            XCTAssertFalse(ContentPolicy.canRestoreAdultMode(accountMode: "adult", sessionAuthorized: true, adultContentEnabled: true, configured: true, expiresIn: expired))
        }
    }

    func testChallengeBootstrapFramesAreAllowedWithoutOpeningTopLevelNavigation() {
        let expected = URL(string: "https://catrr.uk/api/content-policy/native-challenge")!
        for allowed in ["about:blank", "about:srcdoc", "https://challenges.cloudflare.com/turnstile/frame", expected.absoluteString] {
            XCTAssertTrue(AdultChallengeNavigationPolicy.allows(URL(string: allowed), expected: expected, isMainFrame: false, hasTargetFrame: true))
        }
        for blocked in ["about:blank", "about:srcdoc", "https://challenges.cloudflare.com/turnstile/frame", "https://catrr.uk/other"] {
            XCTAssertFalse(AdultChallengeNavigationPolicy.allows(URL(string: blocked), expected: expected, isMainFrame: true, hasTargetFrame: true))
            XCTAssertFalse(AdultChallengeNavigationPolicy.isChallenge(URL(string: blocked), expected: expected))
        }
        for blocked in ["https://evil.example/frame", "https://challenges.cloudflare.com.evil.example/frame", "http://challenges.cloudflare.com/frame", "file:///tmp/frame", "about:config"] {
            XCTAssertFalse(AdultChallengeNavigationPolicy.allows(URL(string: blocked), expected: expected, isMainFrame: false, hasTargetFrame: true))
        }
        XCTAssertTrue(AdultChallengeNavigationPolicy.allows(expected, expected: expected, isMainFrame: true, hasTargetFrame: true))
        XCTAssertFalse(AdultChallengeNavigationPolicy.allows(expected, expected: expected, isMainFrame: false, hasTargetFrame: false))
        XCTAssertFalse(AdultChallengeNavigationPolicy.isChallenge(URL(string: "https://other.example/api/content-policy/native-challenge"), expected: expected))
    }
}
