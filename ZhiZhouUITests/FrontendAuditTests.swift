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
    func testChapterIllustrationPreviewAndVisibilitySetting() {
        let app = launch("media")
        tap(app.buttons["catalog.audit-book-1"])
        tap(app.buttons["detail.read"])
        let picture = app.buttons["放大查看插图：山路与清晨"]
        tap(picture)
        XCTAssertTrue(app.navigationBars["图片预览"].waitForExistence(timeout: 10))
        capture("reader-illustration-preview", app: app)
        tap(app.buttons["完成"])
        tap(app.buttons["阅读设置"])
        let visibility = app.switches["reader.settings.illustrations"]
        reveal(visibility, app: app)
        tap(visibility)
        tap(app.buttons["完成"])
        XCTAssertFalse(picture.exists)
        capture("reader-illustrations-hidden", app: app)
        tap(app.buttons["阅读设置"])
        reveal(visibility, app: app)
        tap(visibility)
        tap(app.buttons["完成"])
        app.swipeDown()
        XCTAssertTrue(picture.waitForExistence(timeout: 10))
    }

    @MainActor
    func testChapterIllustrationFailureCanRetry() {
        let app = launch("media-retry")
        tap(app.buttons["catalog.audit-book-1"])
        tap(app.buttons["detail.read"])
        tap(app.buttons["重新加载图片"])
        XCTAssertTrue(app.buttons["放大查看插图：山路与清晨"].waitForExistence(timeout: 10))
    }

    @MainActor
    func testWebThoughtImageIsVisibleAndOpensPreview() {
        let app = launch("media")
        tap(app.buttons["catalog.audit-book-1"])
        tap(app.buttons["detail.read"])
        tap(app.buttons["更多阅读操作"])
        tap(app.buttons["当前段评"])
        XCTAssertTrue(app.staticTexts["来自 Web 的图片想法"].waitForExistence(timeout: 10))
        let picture = app.buttons["放大查看插图：AI 生成插画"]
        reveal(picture, app: app)
        tap(picture)
        XCTAssertTrue(app.navigationBars["图片预览"].waitForExistence(timeout: 10))
        capture("thought-image-preview", app: app)
    }

    @MainActor
    func testOtherDeviceCanBeRemovedWithoutLoggingOutCurrentDevice() {
        let app = launch("parity")
        selectTab("我的", app: app)
        tap(app.buttons["profile.account"])
        tap(app.buttons["登录设备"])
        XCTAssertTrue(app.staticTexts["当前设备"].waitForExistence(timeout: 10))
        tap(app.buttons["sessions.remove.audit-web"])
        tap(app.buttons.matching(NSPredicate(format: "label == %@ AND identifier != %@", "退出此设备", "sessions.remove.audit-web")).firstMatch)
        XCTAssertTrue(app.staticTexts["Web 浏览器"].waitForNonExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["当前设备"].exists)
    }

    @MainActor
    func testBookmarkSaveReloadAndDelete() {
        let app = launch("parity")
        tap(app.buttons["catalog.audit-book-1"])
        tap(app.buttons["detail.read"])
        tap(app.buttons["更多阅读操作"])
        tap(app.buttons["保存章节书签"])
        let note = app.descendants(matching: .any).matching(identifier: "bookmark.note").firstMatch
        tap(note)
        note.typeText("从这里接着读")
        tap(app.buttons["保存"])
        XCTAssertTrue(app.navigationBars["添加书签"].waitForNonExistence(timeout: 10))
        tap(app.buttons["更多阅读操作"])
        tap(app.buttons["保存章节书签"])
        XCTAssertTrue(app.navigationBars["编辑书签"].waitForExistence(timeout: 10))
        XCTAssertEqual(note.value as? String, "从这里接着读")
        tap(app.buttons["bookmark.delete"])
        tap(app.buttons.matching(NSPredicate(format: "label == %@ AND identifier != %@", "删除书签", "bookmark.delete")).firstMatch)
        XCTAssertTrue(app.navigationBars["编辑书签"].waitForNonExistence(timeout: 10))
    }

    @MainActor
    func testPreviousChapterRecapRequiresExplicitGeneration() {
        let app = launch("parity")
        tap(app.buttons["catalog.audit-book-1"])
        tap(app.buttons["detail.read"])
        tap(app.buttons["更多阅读操作"])
        tap(app.buttons["前情提要"])
        let generate = app.buttons["生成前情提要"]
        XCTAssertTrue(generate.waitForExistence(timeout: 10))
        XCTAssertFalse(app.staticTexts["她沿着旧信上的地址回到山里，找到了那间多年未开的邮局。"].exists)
        tap(generate)
        XCTAssertTrue(app.staticTexts["她沿着旧信上的地址回到山里，找到了那间多年未开的邮局。"].waitForExistence(timeout: 10))
    }

    @MainActor
    func testMyThoughtsCanLoadBeyondFirstFifty() {
        let app = launch("parity")
        selectTab("书架", app: app)
        tap(app.buttons["我的想法"])
        let more = app.buttons["加载更多"]
        for _ in 0..<35 {
            if more.isHittable { break }
            app.swipeUp()
        }
        tap(more)
        let last = app.staticTexts["我的阅读想法 51"]
        reveal(last, app: app)
        XCTAssertTrue(last.waitForExistence(timeout: 10))
        XCTAssertFalse(more.exists)
    }

    @MainActor
    func testCatchupForStaleProgressRequiresExplicitGeneration() {
        let app = launch("parity")
        tap(app.buttons["catalog.audit-book-1"])
        let entry = app.buttons["回来接着读 · 回顾已读内容"]
        reveal(entry, app: app)
        tap(entry)
        tap(app.buttons["生成回来接着读"])
        XCTAssertTrue(app.staticTexts["她沿着旧信上的地址回到山里，找到了那间多年未开的邮局。"].waitForExistence(timeout: 10))
    }

    @MainActor
    func testLogoutAllClearsCurrentAccount() {
        let app = launch("parity")
        selectTab("我的", app: app)
        tap(app.buttons["profile.account"])
        tap(app.buttons["登录设备"])
        tap(app.buttons["sessions.logoutAll"])
        tap(app.buttons.matching(NSPredicate(format: "label == %@ AND identifier != %@", "退出所有设备", "sessions.logoutAll")).firstMatch)
        XCTAssertTrue(app.textFields["用户名"].waitForExistence(timeout: 15))
    }

    @MainActor
    func testPagedIllustrationDoesNotReplaceTextPages() {
        let app = launch("media")
        selectTab("我的", app: app)
        tap(app.buttons["阅读设置"])
        let mode = app.buttons["左右翻页"]
        reveal(mode, app: app)
        tap(mode)
        tap(app.buttons["完成"])
        selectTab("发现", app: app)
        tap(app.buttons["catalog.audit-book-1"])
        tap(app.buttons["detail.read"])
        let picture = app.buttons["放大查看插图：山路与清晨"]
        XCTAssertTrue(picture.waitForExistence(timeout: 15))
        swipeInsideBody(app, left: true)
        XCTAssertTrue(app.navigationBars["第 1 章 一封没有寄出的信"].exists)
        swipeInsideBody(app, left: false)
        tap(picture)
        XCTAssertTrue(app.navigationBars["图片预览"].waitForExistence(timeout: 10))
    }

    @MainActor
    func testScrollChapterEndButton() {
        chapterEndButtonJourney(pageMode: false)
    }

    @MainActor
    func testPagedChapterEndHasOneButton() {
        chapterEndButtonJourney(pageMode: true)
    }

    @MainActor
    func testScrollChapterSwipesStartInsideBody() {
        let app = openReaderForBodySwipe(pageMode: false)
        swipeInsideBody(app, left: true)
        XCTAssertTrue(app.navigationBars["第 2 章 山路上的回声"].waitForExistence(timeout: 15))
        swipeInsideBody(app, left: false)
        XCTAssertTrue(app.navigationBars["第 1 章 一封没有寄出的信"].waitForExistence(timeout: 15))
        // 纵向拖动仍然滚动正文，不切换章节。
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.65))
            .press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.35)))
        XCTAssertTrue(app.navigationBars["第 1 章 一封没有寄出的信"].exists)
    }

    @MainActor
    func testPagedSwipesStartInsideBody() {
        let app = openReaderForBodySwipe(pageMode: true)
        let status = app.descendants(matching: .any).matching(identifier: "reader.progress").firstMatch
        XCTAssertTrue(status.waitForExistence(timeout: 15))
        let initial = status.label
        swipeInsideBody(app, left: true)
        let changed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label != %@", initial), object: status)
        XCTAssertEqual(XCTWaiter.wait(for: [changed], timeout: 5), .completed)
        swipeInsideBody(app, left: false)
        let restored = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == %@", initial), object: status)
        XCTAssertEqual(XCTWaiter.wait(for: [restored], timeout: 5), .completed)
    }

    @MainActor
    private func openReaderForBodySwipe(pageMode: Bool) -> XCUIApplication {
        let app = launch()
        XCTAssertTrue(app.buttons["catalog.audit-book-1"].waitForExistence(timeout: 15))
        selectTab("我的", app: app)
        reveal(app.buttons["阅读设置"], app: app)
        tap(app.buttons["阅读设置"])
        let mode = app.buttons[pageMode ? "左右翻页" : "上下滚动"]
        reveal(mode, app: app)
        tap(mode)
        tap(app.buttons["完成"])
        selectTab("发现", app: app)
        tap(app.buttons["catalog.audit-book-1"])
        tap(app.buttons["detail.read"])
        XCTAssertTrue(app.navigationBars["第 1 章 一封没有寄出的信"].waitForExistence(timeout: 15))
        return app
    }

    @MainActor
    private func swipeInsideBody(_ app: XCUIApplication, left: Bool) {
        // 起点、终点均远离屏幕边缘；手势穿过正文中央的 UITextView。
        app.coordinate(withNormalizedOffset: CGVector(dx: left ? 0.7 : 0.3, dy: 0.45))
            .press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: left ? 0.3 : 0.7, dy: 0.45)))
    }

    @MainActor
    private func chapterEndButtonJourney(pageMode: Bool) {
        let app = launch()
        XCTAssertTrue(app.buttons["catalog.audit-book-1"].waitForExistence(timeout: 15))
        selectTab("我的", app: app)
        reveal(app.buttons["阅读设置"], app: app)
        tap(app.buttons["阅读设置"])
        let mode = app.buttons[pageMode ? "左右翻页" : "上下滚动"]
        reveal(mode, app: app)
        tap(mode)
        tap(app.buttons["完成"])
        selectTab("发现", app: app)
        tap(app.buttons["catalog.audit-book-1"])
        tap(app.buttons["detail.read"])
        XCTAssertTrue(app.navigationBars["第 1 章 一封没有寄出的信"].waitForExistence(timeout: 15))

        let next = app.buttons["reader.next-chapter"]
        for _ in 0..<30 {
            if next.isHittable { break }
            if pageMode { app.swipeLeft() } else { app.swipeUp() }
        }
        XCTAssertTrue(next.isHittable)
        XCTAssertEqual(app.buttons.matching(identifier: "reader.next-chapter").count, 1)
        if pageMode {
            XCTAssertEqual(app.buttons.matching(NSPredicate(format: "label == %@", "下一章")).count, 1)
        }
        capture(pageMode ? "reader-page-end" : "reader-scroll-end", app: app)
        // 点击胶囊左侧的空白区域，验证整个按钮表面都能切章。
        next.coordinate(withNormalizedOffset: CGVector(dx: 0.15, dy: 0.5)).tap()
        XCTAssertTrue(app.navigationBars["第 2 章 山路上的回声"].waitForExistence(timeout: 15))
        capture(pageMode ? "reader-page-next-chapter" : "reader-scroll-next-chapter", app: app)
    }

    @MainActor
    private func readingJourney(appearance: String) {
        let app = launch(appearance: appearance)
        XCTAssertTrue(app.buttons["catalog.audit-book-1"].waitForExistence(timeout: 15))
        capture("\(appearance)-discovery", app: app)
        selectTab("我的", app: app)
        XCTAssertTrue(app.buttons["profile.account"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["profile.continue"].exists)
        XCTAssertFalse(app.buttons["最近阅读"].exists)
        XCTAssertFalse(app.buttons["修改密码"].exists)
        XCTAssertFalse(app.buttons["account.logout"].exists)
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
        XCTAssertTrue(app.buttons["profile.account"].waitForExistence(timeout: 15))
        capture("large-text-profile", app: app)
        tap(app.buttons["profile.account"])
        XCTAssertTrue(app.buttons["profile.edit"].waitForExistence(timeout: 10))
        capture("large-text-account", app: app)
        tap(app.navigationBars["账户与安全"].buttons.firstMatch)
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
        tap(app.buttons["profile.account"])
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
    func testAccountLogoutCanBeCancelledAndConfirmed() {
        let app = launch()
        selectTab("我的", app: app)
        tap(app.buttons["profile.account"])
        capture("account", app: app)
        tap(app.buttons["account.logout"])
        let confirm = app.buttons.matching(NSPredicate(
            format: "label == %@ AND identifier != %@", "退出登录", "account.logout"
        )).firstMatch
        XCTAssertTrue(confirm.waitForExistence(timeout: 5))
        if app.buttons["取消"].exists {
            tap(app.buttons["取消"])
        } else {
            // iPad confirmation popovers dismiss by tapping outside the popover.
            app.navigationBars["账户与安全"]
                .coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        }
        XCTAssertTrue(confirm.waitForNonExistence(timeout: 5))
        XCTAssertTrue(app.navigationBars["账户与安全"].exists)
        XCTAssertTrue(app.buttons["profile.edit"].exists)
        tap(app.buttons["account.logout"])
        tap(confirm)
        XCTAssertTrue(app.textFields["用户名"].waitForExistence(timeout: 15))
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
        // Short fixture lists cannot always enter the native pull-to-refresh
        // threshold. Changing the query exercises the same first-page reload
        // path with a deterministic user action.
        let search = app.searchFields.firstMatch
        if !search.exists || !search.isHittable {
            let searchButton = app.buttons["搜索"].firstMatch
            if searchButton.exists { tap(searchButton) }
        }
        tap(search)
        search.typeText("山")
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
        reveal(app.buttons["运行参数"], app: app)
        tap(app.buttons["运行参数"])
        let enabled = app.switches["启用前情提要"]
        XCTAssertTrue(enabled.waitForExistence(timeout: 10))
        reveal(enabled, app: app)
        // SwiftUI exposes the whole labeled row as the switch on iPad.
        // Hit the trailing control rather than the center of the label.
        enabled.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.5)).tap()
        let off = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == '0'"), object: enabled)
        XCTAssertEqual(XCTWaiter.wait(for: [off], timeout: 5), .completed)
        capture("admin-settings-edited", app: app)
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.42))
            .press(forDuration: 0.1, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.82)))
        capture("admin-settings-after-refresh", app: app)
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
