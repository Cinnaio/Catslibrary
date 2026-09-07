import XCTest

final class FrontendAuditTests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    @MainActor
    private func launch(_ scenario: String = "normal", appearance: String = "light", largeText: Bool = false) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment = [
            "ZHIZHOU_UI_AUDIT": "1",
            "ZHIZHOU_UI_SCENARIO": scenario,
            "ZHIZHOU_UI_APPEARANCE": appearance,
            "ZHIZHOU_UI_ACCOUNT": UUID().uuidString,
        ]
        app.launchArguments = ["-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]
        if largeText {
            app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        }
        app.launch()
        return app
    }

    @MainActor
    private func capture(_ name: String, app: XCUIApplication) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    @MainActor
    private func tap(_ element: XCUIElement, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(element.waitForExistence(timeout: 15), file: file, line: line)
        let hittable = XCTNSPredicateExpectation(predicate: NSPredicate(format: "hittable == true"), object: element)
        XCTAssertEqual(XCTWaiter.wait(for: [hittable], timeout: 10), .completed, file: file, line: line)
        element.tap()
    }

    @MainActor
    private func selectTab(_ title: String, app: XCUIApplication) {
        let tab = app.tabBars.buttons[title]
        tap(tab.exists ? tab : app.buttons[title].firstMatch)
    }

    @MainActor
    func testLightReadingJourney() {
        readingJourney(appearance: "light")
    }

    @MainActor
    func testDarkReadingJourney() {
        readingJourney(appearance: "dark")
    }

    @MainActor
    private func readingJourney(appearance: String) {
        let app = launch(appearance: appearance)
        XCTAssertTrue(app.buttons["catalog.audit-book-1"].waitForExistence(timeout: 15))
        capture("\(appearance)-discovery", app: app)
        selectTab("我的", app: app)
        XCTAssertTrue(app.buttons["profile.edit"].waitForExistence(timeout: 10))
        capture("\(appearance)-profile", app: app)
        tap(app.buttons["阅读设置"])
        XCTAssertTrue(app.buttons["增大字号"].waitForExistence(timeout: 10))
        capture("\(appearance)-reader-settings", app: app)
        tap(app.buttons["完成"])
        selectTab("书架", app: app)
        capture("\(appearance)-bookshelf", app: app)
        selectTab("发现", app: app)
        tap(app.buttons["catalog.audit-book-1"])
        XCTAssertTrue(app.buttons["detail.read"].waitForExistence(timeout: 15))
        capture("\(appearance)-detail", app: app)
        tap(app.buttons["detail.read"])
        XCTAssertTrue(app.staticTexts["第 1 章 一封没有寄出的信"].firstMatch.waitForExistence(timeout: 15))
        capture("\(appearance)-reader", app: app)
    }

    @MainActor
    func testLargeTextProfileAndSettings() {
        let app = launch(largeText: true)
        selectTab("我的", app: app)
        XCTAssertTrue(app.buttons["profile.edit"].waitForExistence(timeout: 15))
        capture("large-text-profile", app: app)
        app.swipeUp()
        tap(app.buttons["阅读设置"])
        XCTAssertTrue(app.buttons["增大字号"].waitForExistence(timeout: 10))
        capture("large-text-settings", app: app)
        app.swipeUp()
        capture("large-text-settings-lower", app: app)
    }

    @MainActor
    func testProfileEditingAndWrongPassword() {
        let app = launch()
        selectTab("我的", app: app)
        tap(app.buttons["profile.edit"])
        let nickname = app.textFields["昵称"]
        tap(nickname)
        nickname.typeText("A")
        capture("profile-edit", app: app)
        tap(app.buttons["保存"])
        XCTAssertTrue(app.navigationBars["个人资料"].waitForNonExistence(timeout: 10))
        capture("profile-after-save", app: app)
        XCTAssertTrue(app.buttons["profile.edit"].waitForExistence(timeout: 10))
        let passwordLink = app.buttons["修改密码"]
        if !passwordLink.isHittable { app.swipeUp() }
        tap(passwordLink)
        let current = app.secureTextFields["当前密码"]
        tap(current)
        current.typeText("wrong-password")
        let new = app.secureTextFields["新密码"]
        tap(new)
        new.typeText("new-password")
        let confirmation = app.secureTextFields["再次输入新密码"]
        tap(confirmation)
        confirmation.typeText("new-password")
        tap(app.buttons["保存"])
        XCTAssertTrue(app.staticTexts["当前密码不正确"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.navigationBars["修改密码"].exists)
        capture("password-validation", app: app)
    }

    @MainActor
    func testLoginAndEmptyStates() {
        let app = launch("login")
        XCTAssertTrue(app.textFields["用户名"].waitForExistence(timeout: 15))
        capture("login", app: app)
        app.terminate()
        let emptyApp = launch("empty")
        selectTab("书架", app: emptyApp)
        capture("empty-bookshelf", app: emptyApp)
        selectTab("我的", app: emptyApp)
        tap(emptyApp.buttons.matching(NSPredicate(format: "label CONTAINS %@", "离线阅读")).firstMatch)
        capture("empty-offline-library", app: emptyApp)
    }

    @MainActor
    func testDiscoveryRefreshFailureRetriesFirstPage() {
        let app = launch("refresh-error")
        XCTAssertTrue(app.buttons["catalog.audit-book-1"].waitForExistence(timeout: 15))
        let list = app.scrollViews.firstMatch
        list.swipeDown()
        XCTAssertTrue(app.staticTexts["暂时无法刷新书单"].waitForExistence(timeout: 10))
        capture("discovery-refresh-error", app: app)
        tap(app.buttons["重试"])
        XCTAssertTrue(app.staticTexts["暂时无法刷新书单"].waitForNonExistence(timeout: 10))
        XCTAssertTrue(app.buttons["catalog.audit-book-1"].exists)
    }

    @MainActor
    func testSessionRestorationCanRetryWithoutCredentials() {
        let app = launch("restore-error")
        tap(app.buttons["session.retry"])
        XCTAssertTrue(app.buttons["session.retry"].waitForExistence(timeout: 10))
        capture("session-restore-error", app: app)
        tap(app.buttons["session.retry"])
        XCTAssertTrue(app.buttons["catalog.audit-book-1"].waitForExistence(timeout: 15))
    }
}
