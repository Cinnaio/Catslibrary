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
    private func reveal(_ element: XCUIElement, app: XCUIApplication) {
        for _ in 0..<8 {
            if element.isHittable { return }
            app.swipeUp()
        }
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
        XCTAssertTrue(app.buttons["profile.continue"].waitForExistence(timeout: 15))
        capture("\(appearance)-profile", app: app)
        reveal(app.buttons["阅读设置"], app: app)
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
        let settings = app.buttons["阅读设置"]
        reveal(settings, app: app)
        tap(settings)
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
        reveal(passwordLink, app: app)
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
        // Keep the drag inside the visible catalog, above the floating tab bar.
        // A ScrollView's accessibility frame can include off-screen content.
        let list = app.scrollViews.firstMatch
        let x = list.frame.midX / app.frame.width
        app.coordinate(withNormalizedOffset: CGVector(dx: x, dy: 0.42))
            .press(forDuration: 0.1, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: x, dy: 0.82)))
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

    @MainActor
    func testAdminSettingsRefreshPreservesDraft() {
        let app = launch()
        selectTab("我的", app: app)
        reveal(app.buttons["管理后台"], app: app)
        tap(app.buttons["管理后台"])
        reveal(app.buttons["AI 服务"], app: app)
        tap(app.buttons["AI 服务"])
        tap(app.buttons["运行参数"])
        let enabled = app.switches["启用前情提要"]
        tap(enabled)
        XCTAssertEqual(enabled.value as? String, "0")
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.42))
            .press(forDuration: 0.1, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.82)))
        XCTAssertTrue(app.alerts["操作失败"].waitForExistence(timeout: 10))
        capture("admin-settings-draft-retained", app: app)
        tap(app.alerts.buttons["好"])
        XCTAssertEqual(enabled.value as? String, "0")
    }

    @MainActor
    func testAdminCatalogAndSearch() {
        let app = launch()
        selectTab("我的", app: app)
        reveal(app.buttons["管理后台"], app: app)
        tap(app.buttons["管理后台"])
        XCTAssertTrue(app.buttons["小说管理"].waitForExistence(timeout: 10))
        capture("admin-modules", app: app)
        tap(app.buttons["小说管理"])
        XCTAssertTrue(app.staticTexts["山中来信"].firstMatch.waitForExistence(timeout: 15))
        capture("admin-novels", app: app)
        let search = app.searchFields.firstMatch
        if !search.exists && app.buttons["搜索"].firstMatch.exists {
            tap(app.buttons["搜索"].firstMatch)
        }
        if !search.isHittable { app.swipeDown() }
        tap(search)
        search.typeText("absent-title")
        XCTAssertTrue(app.staticTexts["没有匹配的小说"].waitForExistence(timeout: 15))
        capture("admin-search-empty", app: app)
    }
}
