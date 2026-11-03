import XCTest
@testable import ZhiZhouCore

final class AccountPolicyTests: XCTestCase {
    func testProfileRequiresANameAndMatchesServerStringLimits() {
        XCTAssertNotNil(AccountPolicy.profileError(displayName: " \n ", bio: ""))
        XCTAssertNil(AccountPolicy.profileError(displayName: String(repeating: "舟", count: 20), bio: ""))
        XCTAssertNotNil(AccountPolicy.profileError(displayName: String(repeating: "舟", count: 21), bio: ""))
        XCTAssertNil(AccountPolicy.profileError(displayName: "知舟", bio: String(repeating: "书", count: 80)))
        XCTAssertNotNil(AccountPolicy.profileError(displayName: "知舟", bio: String(repeating: "书", count: 81)))
        let supplementaryCharacter = "\u{20000}"
        XCTAssertNil(AccountPolicy.profileError(displayName: String(repeating: supplementaryCharacter, count: 10), bio: ""))
        XCTAssertNotNil(AccountPolicy.profileError(displayName: String(repeating: supplementaryCharacter, count: 11), bio: ""))
    }

    func testPasswordMustBePresentLongEnoughDifferentAndConfirmed() {
        XCTAssertNotNil(AccountPolicy.passwordError(current: "", new: "new-password", confirmation: "new-password"))
        XCTAssertNotNil(AccountPolicy.passwordError(current: "old-password", new: "short", confirmation: "short"))
        XCTAssertNotNil(AccountPolicy.passwordError(current: "password", new: "password", confirmation: "password"))
        XCTAssertNotNil(AccountPolicy.passwordError(current: "old-password", new: "new-password", confirmation: "different"))
        XCTAssertNil(AccountPolicy.passwordError(current: "old-password", new: "new-password", confirmation: "new-password"))
        XCTAssertNotNil(AccountPolicy.passwordError(current: "old-password", new: "new-password ", confirmation: "new-password"))
    }

    func testIncorrectCurrentPasswordKeepsSession() {
        XCTAssertFalse(AccountPolicy.shouldInvalidateSession(
            method: "POST", path: "/api/auth/change-password", statusCode: 401,
            errorMessage: "当前密码不正确"
        ))
    }

    func testExpiredSessionStillInvalidatesOnPasswordEndpoint() {
        for message in [nil, "请先登录", "登录已过期"] {
            XCTAssertTrue(AccountPolicy.shouldInvalidateSession(
                method: "POST", path: "/api/auth/change-password", statusCode: 401,
                errorMessage: message
            ))
        }
    }

    func testPasswordExceptionDoesNotApplyToOtherEndpointsOrMethods() {
        XCTAssertTrue(AccountPolicy.shouldInvalidateSession(
            method: "PUT", path: "/api/auth/me", statusCode: 401,
            errorMessage: "当前密码不正确"
        ))
        XCTAssertTrue(AccountPolicy.shouldInvalidateSession(
            method: "GET", path: "/api/auth/change-password", statusCode: 401,
            errorMessage: "当前密码不正确"
        ))
        for status in [400, 403, 429, 500] {
            XCTAssertFalse(AccountPolicy.shouldInvalidateSession(
                method: "POST", path: "/api/auth/change-password", statusCode: status,
                errorMessage: nil
            ))
        }
    }

    func testLateOldTokenRejectionCannotClearReplacementSession() {
        var rotation = SessionRotationGuard()
        XCTAssertTrue(rotation.begin(token: "old"))
        XCTAssertFalse(rotation.begin(token: "another"))
        XCTAssertTrue(rotation.deferInvalidation(for: "old"))
        XCTAssertNil(rotation.finish(token: "old", currentToken: "new"))
        XCTAssertFalse(rotation.deferInvalidation(for: "old"))
        XCTAssertTrue(rotation.begin(token: "new"))
    }

    func testFailedRotationHonorsDeferredSessionExpiry() {
        var rotation = SessionRotationGuard()
        XCTAssertTrue(rotation.begin(token: "old"))
        XCTAssertTrue(rotation.deferInvalidation(for: "old"))
        XCTAssertEqual(rotation.finish(token: "old", currentToken: "old"), "old")
    }

    func testRotationDoesNotRestoreLoggedOutOrDifferentAccounts() {
        for currentToken in [nil, "other-account"] {
            var rotation = SessionRotationGuard()
            XCTAssertTrue(rotation.begin(token: "old"))
            XCTAssertFalse(rotation.deferInvalidation(for: "unrelated"))
            XCTAssertTrue(rotation.deferInvalidation(for: "old"))
            XCTAssertNil(rotation.finish(token: "old", currentToken: currentToken))
        }
    }

    func testWrongPasswordWithoutSessionExpiryDoesNotInvalidate() {
        var rotation = SessionRotationGuard()
        XCTAssertTrue(rotation.begin(token: "current"))
        XCTAssertNil(rotation.finish(token: "current", currentToken: "current"))
    }
}
