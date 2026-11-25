import XCTest
import UIKit

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
    private func openBookWorkspace(_ bookID: String, app: XCUIApplication) {
        let book = app.buttons["catalog.\(bookID)"]
        reveal(book, app: app)
        tap(book)
        tap(app.buttons["detail.manage"])
        XCTAssertTrue(app.descendants(matching: .any).matching(identifier: "admin.workspace.book").firstMatch.waitForExistence(timeout: 10))
    }

    @MainActor
    func testWorkspaceRestoresBookDraftOutsideFirstIndexPageAndIsolatesAccounts() {
        let app = launch("admin-workspace")
        openBookWorkspace("audit-book-4", app: app)
        tap(app.buttons["admin.workspace.writing"])
        let input = app.descendants(matching: .any).matching(identifier: "admin.writing.instruction").firstMatch
        tap(input)
        let text = "保留山里的邮局，补充人物动机。"
        input.typeText(text)
        capture("admin-writing-book-input", app: app)
        app.terminate()
        app.launch()
        openBookWorkspace("audit-book-4", app: app)
        tap(app.buttons["admin.workspace.writing"])
        XCTAssertTrue(input.waitForExistence(timeout: 15))
        XCTAssertEqual(input.value as? String, text)
        app.terminate()
        var environment = app.launchEnvironment
        environment["ZHIZHOU_UI_ACCOUNT"] = UUID().uuidString
        app.launchEnvironment = environment
        app.launch()
        openBookWorkspace("audit-book-4", app: app)
        tap(app.buttons["admin.workspace.writing"])
        XCTAssertTrue(input.waitForExistence(timeout: 15))
        XCTAssertNotEqual(input.value as? String, text)
    }

    @MainActor
    func testReaderWorkspaceCarriesCurrentChapterIntoWriting() {
        let app = launch("admin-workspace")
        let book = app.buttons["catalog.audit-book-4"]
        reveal(book, app: app); tap(book)
        tap(app.buttons["detail.read"])
        tap(app.buttons["更多阅读操作"])
        tap(app.buttons["管理这本书"])
        tap(app.buttons["admin.workspace.writing"])
        let anchor = app.descendants(matching: .any).matching(identifier: "admin.writing.anchor").firstMatch
        XCTAssertTrue(anchor.waitForExistence(timeout: 15))
        let value = anchor.label + " " + (anchor.value as? String ?? "")
        XCTAssertTrue(value.contains("一封没有寄出的信"))
        capture("admin-writing-current-chapter", app: app)
    }

    @MainActor
    func testUnifiedTaskInboxOpensExactTaskResults() {
        let app = launch("admin-workspace")
        openAdminModule("tasks", app: app)
        tap(app.buttons["admin.inbox.ai.audit-workspace-task"])
        let results = app.buttons["admin.task.results.audit-workspace-task"]
        reveal(results, app: app); tap(results)
        XCTAssertTrue(app.staticTexts["新的来信"].firstMatch.waitForExistence(timeout: 15))
        capture("admin-task-draft-results", app: app)
    }

    @MainActor
    func testReaderAccountDoesNotExposeBookManagement() {
        let app = launch("reader-role")
        tap(app.buttons["catalog.audit-book-1"])
        XCTAssertTrue(app.buttons["detail.read"].waitForExistence(timeout: 15))
        XCTAssertFalse(app.buttons["detail.manage"].exists)
    }

    @MainActor
    func testBookshelfCanReachFiftyFirstFavoriteAndDetailKnowsItIsSaved() {
        let app = launch("bookshelf-many")
        selectTab("书架", app: app)
        let favorites = app.buttons["bookshelf.section.favorites"]
        if favorites.exists {
            tap(favorites)
        }
        let more = app.buttons["bookshelf.loadMore"]
        for _ in 0..<60 {
            if more.isHittable { break }
            app.swipeUp()
        }
        tap(more)
        let last = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "书架作品51")).firstMatch
        reveal(last, app: app)
        tap(last)
        XCTAssertTrue(app.buttons["已在书架，点按移除"].waitForExistence(timeout: 10))
        capture("bookshelf-fifty-first-favorite", app: app)
    }

    @MainActor
    func testIPadBottomTabsAndAlignedSearchPreserveWindowLayout() throws {
        try XCTSkipUnless(UIDevice.current.userInterfaceIdiom == .pad, "覆盖 iPad 底部导航与内容搜索")
        executionTimeAllowance = 180
        defer { XCUIDevice.shared.orientation = .portrait }
        let app = launch("ipad-bookshelf")
        for orientation in [UIDeviceOrientation.landscapeLeft, .portrait] {
            XCUIDevice.shared.orientation = orientation
            for (title, searchID, heroID) in [
                ("发现", "discovery.search", "discovery.continue-reading"),
                ("书架", "bookshelf.search", "bookshelf.recent.audit-book-1"),
            ] {
                selectTab(title, app: app)
                let search = app.searchFields[searchID]
                let hero = app.buttons[heroID]
                XCTAssertTrue(search.waitForExistence(timeout: 10))
                XCTAssertTrue(hero.waitForExistence(timeout: 15))
                XCTAssertTrue(app.tabBars.firstMatch.isHittable)
                XCTAssertGreaterThan(app.tabBars.firstMatch.frame.minY, app.frame.midY, "主导航必须位于窗口底部")
                XCTAssertEqual(search.frame.minX, hero.frame.minX, accuracy: 2)
                XCTAssertEqual(search.frame.maxX, hero.frame.maxX, accuracy: 2)
            }
            let second = app.buttons["bookshelf.recent.audit-book-2"]
            XCTAssertTrue(second.waitForExistence(timeout: 10))
            XCTAssertLessThan(second.frame.width, app.searchFields["bookshelf.search"].frame.width * 0.6,
                              "底部导航的紧凑布局不能把平板书架变成手机单列")
        }

        let search = app.searchFields["bookshelf.search"]
        tap(search)
        search.typeText("海边书店")
        let filtered = app.buttons["bookshelf.favorite.audit-book-3"]
        XCTAssertTrue(filtered.waitForExistence(timeout: 15))
        XCTAssertTrue(app.buttons["bookshelf.favorite.audit-book-2"].waitForNonExistence(timeout: 10))
        tap(search.buttons.firstMatch)
        XCTAssertTrue(app.buttons["bookshelf.recent.audit-book-2"].waitForExistence(timeout: 15))
    }

    @MainActor
    func testIPadBookshelfTapAndContextMenuTargetIndividualBooks() throws {
        try XCTSkipUnless(UIDevice.current.userInterfaceIdiom == .pad, "覆盖平板网格中不同书籍的点击与长按")
        executionTimeAllowance = 180
        XCUIDevice.shared.orientation = .landscapeLeft
        defer { XCUIDevice.shared.orientation = .portrait }
        let app = launch("ipad-bookshelf")
        selectTab("书架", app: app)
        let secondRecent = app.buttons["bookshelf.recent.audit-book-2"]
        tap(secondRecent)
        XCTAssertTrue(app.staticTexts["长街灯火里的旧日时光 · 第 2 章"].firstMatch.waitForExistence(timeout: 15))
        XCTAssertTrue(app.buttons["reader.toolbar.contents"].isHittable)
        XCTAssertFalse(app.tabBars.firstMatch.isHittable)
        tap(app.navigationBars.buttons.firstMatch)

        let thirdRecent = app.buttons["bookshelf.recent.audit-book-3"]
        XCTAssertTrue(thirdRecent.waitForExistence(timeout: 15))
        thirdRecent.press(forDuration: 1)
        tap(app.buttons["书籍详情"])
        XCTAssertTrue(app.buttons["detail.read"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.staticTexts["海边书店"].firstMatch.isHittable)
        tap(app.buttons["关闭"])
        XCTAssertTrue(secondRecent.waitForExistence(timeout: 15))
        secondRecent.press(forDuration: 1)
        tap(app.buttons["删除阅读记录"])
        let recentConfirmation = app.staticTexts["将删除《长街灯火里的旧日时光》的最近阅读记录"]
        XCTAssertTrue(recentConfirmation.waitForExistence(timeout: 10))
        dismissIPadShelfConfirmation(app)
        XCTAssertTrue(recentConfirmation.waitForNonExistence(timeout: 5))

        tap(app.buttons["bookshelf.section.favorites"])
        let thirdFavorite = app.buttons["bookshelf.favorite.audit-book-3"]
        tap(thirdFavorite)
        XCTAssertTrue(app.buttons["detail.read"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.staticTexts["海边书店"].firstMatch.isHittable)
        tap(app.navigationBars.buttons.firstMatch)
        tap(app.buttons["bookshelf.favorite.audit-book-2"])
        XCTAssertTrue(app.staticTexts["长街灯火里的旧日时光 · 第 3 章"].firstMatch.waitForExistence(timeout: 15))
        tap(app.navigationBars.buttons.firstMatch)
        XCTAssertTrue(thirdFavorite.waitForExistence(timeout: 15))
        thirdFavorite.press(forDuration: 1)
        tap(app.buttons["移出书架"])
        let favoriteConfirmation = app.staticTexts["将把《海边书店》移出书架"]
        XCTAssertTrue(favoriteConfirmation.waitForExistence(timeout: 10))
        dismissIPadShelfConfirmation(app)
        XCTAssertTrue(favoriteConfirmation.waitForNonExistence(timeout: 5))

        // 编辑模式仍使用原生列表；完成编辑返回网格后，点击仍打开同一本书。
        tap(app.buttons["编辑"])
        XCTAssertTrue(app.buttons["bookshelf.favorite.audit-book-2"].waitForExistence(timeout: 10))
        tap(app.buttons["完成"])
        tap(app.buttons["bookshelf.favorite.audit-book-3"])
        XCTAssertTrue(app.buttons["detail.read"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.staticTexts["海边书店"].firstMatch.isHittable)
    }

    @MainActor
    private func dismissIPadShelfConfirmation(_ app: XCUIApplication) {
        if app.buttons["取消"].exists {
            tap(app.buttons["取消"])
        } else {
            app.navigationBars.firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.1, dy: 0.5)).tap()
        }
    }

    @MainActor
    func testIPadBookshelfReaderStaysResponsiveAcrossToolsAndRotation() throws {
        try XCTSkipUnless(UIDevice.current.userInterfaceIdiom == .pad, "覆盖 iPad 阅读导航及工具面板")
        executionTimeAllowance = 120
        XCUIDevice.shared.orientation = .portrait
        defer { XCUIDevice.shared.orientation = .portrait }
        let app = launch()
        selectTab("书架", app: app)
        let recent = app.buttons["bookshelf.recent.audit-book-1"]
        let paragraph = app.textViews["reader.paragraph.1"]

        // 连续两次进入，覆盖导航目的地重建与面板在旋转时切换呈现方式。
        for pageMode in [false, true] {
            selectTab("我的", app: app)
            let settings = app.buttons["阅读设置"]
            reveal(settings, app: app)
            tap(settings)
            let mode = app.buttons[pageMode ? "左右翻页" : "上下滚动"]
            reveal(mode, app: app)
            tap(mode)
            tap(app.buttons["完成"])
            selectTab("书架", app: app)
            tap(recent)
            let loadedContent = pageMode
                ? app.descendants(matching: .any).matching(identifier: "reader.progress").firstMatch
                : paragraph
            XCTAssertTrue(loadedContent.waitForExistence(timeout: 15))
            for orientation in [UIDeviceOrientation.landscapeLeft, .portrait] {
                tap(app.buttons["reader.toolbar.contents"])
                XCTAssertTrue(app.searchFields.firstMatch.waitForExistence(timeout: 10))
                XCUIDevice.shared.orientation = orientation
                tap(app.buttons["完成"])
                XCTAssertTrue(loadedContent.waitForExistence(timeout: 10))
                tap(app.buttons["reader.toolbar.settings"])
                tap(app.buttons["完成"])
            }
            // 真实操作要求应用主线程持续响应，不能只检查加载前存在的导航栏。
            app.swipeUp()
            app.swipeDown()
            if app.buttons["显示阅读控制"].exists { tap(app.buttons["显示阅读控制"]) }
            tap(app.buttons["reader.toolbar.contents"])
            tap(app.buttons["完成"])
            tap(app.navigationBars.buttons.firstMatch)
            XCTAssertTrue(recent.waitForExistence(timeout: 10))
        }
    }

    @MainActor
    func testIPadDiscoveryScrollReaderHasFullPageNavigation() throws {
        try ipadDiscoveryReaderLayout(pageMode: false)
    }

    @MainActor
    func testIPadDiscoveryPagedReaderHasFullPageNavigation() throws {
        try ipadDiscoveryReaderLayout(pageMode: true)
    }

    @MainActor
    private func ipadDiscoveryReaderLayout(pageMode: Bool) throws {
        try XCTSkipUnless(UIDevice.current.userInterfaceIdiom == .pad, "覆盖 iPad 发现页与阅读器布局")
        executionTimeAllowance = 180
        XCUIDevice.shared.orientation = .landscapeLeft
        defer { XCUIDevice.shared.orientation = .portrait }
        let app = launch(appearance: "dark")
        selectTab("我的", app: app)
        let settings = app.buttons["阅读设置"]
        reveal(settings, app: app)
        tap(settings)
        let mode = app.buttons[pageMode ? "左右翻页" : "上下滚动"]
        reveal(mode, app: app)
        tap(mode)
        tap(app.buttons["完成"])
        selectTab("发现", app: app)

        // 同时覆盖直接续读，以及详情内的开始阅读链接，防止只修书架入口。
        for throughDetail in [false, true] {
            if throughDetail {
                let book = app.buttons["catalog.audit-book-1"]
                reveal(book, app: app)
                tap(book)
                let read = app.buttons["detail.read"]
                XCTAssertTrue(read.waitForExistence(timeout: 15))
                let chapters = app.descendants(matching: .any).matching(identifier: "detail.chapters").firstMatch
                XCTAssertTrue(chapters.waitForExistence(timeout: 10))
                XCTAssertGreaterThan(chapters.frame.width, app.frame.width * 0.9)
                tap(read)
            } else {
                tap(app.buttons["discovery.continue-reading"])
            }

            for orientation in [UIDeviceOrientation.landscapeLeft, .portrait] {
                XCUIDevice.shared.orientation = orientation
                let text = pageMode
                    ? app.textViews.matching(NSPredicate(format: "identifier BEGINSWITH %@", "reader.page.")).firstMatch
                    : app.textViews["reader.paragraph.1"]
                XCTAssertTrue(text.waitForExistence(timeout: 15))
                XCTAssertTrue(text.isHittable, "正文必须在当前窗口真实可见")
                let contents = app.buttons["reader.toolbar.contents"]
                XCTAssertTrue(contents.waitForExistence(timeout: 10))
                XCTAssertTrue(contents.isHittable, "阅读器不能只剩底部进度条")
                XCTAssertTrue(app.navigationBars.buttons.firstMatch.isHittable, "必须能返回发现页或详情")
                XCTAssertFalse(app.buttons["discovery.continue-reading"].isHittable, "发现侧栏不能覆盖阅读器")
                XCTAssertFalse(app.tabBars.firstMatch.isHittable)
                let viewport = app.descendants(matching: .any).matching(
                    identifier: pageMode ? "reader.body.pages" : "reader.body.scroll"
                ).firstMatch
                let progress = app.descendants(matching: .any).matching(identifier: "reader.progress").firstMatch
                XCTAssertTrue(viewport.waitForExistence(timeout: 10))
                XCTAssertTrue(progress.waitForExistence(timeout: 10))
                XCTAssertGreaterThan(viewport.frame.width, app.frame.width * 0.9)
                tap(contents)
                tap(app.buttons["完成"])
            }
            tap(app.navigationBars.buttons.firstMatch)
            if throughDetail {
                XCTAssertTrue(app.buttons["detail.read"].waitForExistence(timeout: 10))
                tap(app.navigationBars.buttons.firstMatch)
            }
            XCTAssertTrue(app.buttons["catalog.audit-book-1"].waitForExistence(timeout: 10))
        }
    }

    @MainActor
    func testIPadDetailReadAndChapterEntriesRemainOpen() throws {
        try XCTSkipUnless(UIDevice.current.userInterfaceIdiom == .pad, "覆盖 iPad 详情阅读入口")
        XCUIDevice.shared.orientation = .landscapeLeft
        defer { XCUIDevice.shared.orientation = .portrait }
        let app = launch()

        for identifier in ["detail.read", "detail.chapter.2", "detail.read"] {
            // 个人首页会隐藏导航栏，切回发现必须恢复；返回阅读前后的路径也要完整。
            selectTab("我的", app: app)
            selectTab("发现", app: app)
            tap(app.buttons["catalog.audit-book-1"])
            let entry = app.buttons[identifier]
            reveal(entry, app: app)
            tap(entry)
            assertReaderStaysOpenAndReturnToDetail(app)
            tap(app.navigationBars.buttons.firstMatch)
            let discoverTab = app.tabBars.buttons["发现"]
            XCTAssertTrue(discoverTab.waitForExistence(timeout: 10))
            XCTAssertTrue(discoverTab.isHittable, "返回首页后底部标签不能继续隐藏")
            XCTAssertTrue(app.navigationBars.firstMatch.isHittable, "返回发现页后顶部导航必须恢复")
        }
    }

    @MainActor
    func testIPadDetailSearchDismissalKeepsReaderOpen() throws {
        try XCTSkipUnless(UIDevice.current.userInterfaceIdiom == .pad, "覆盖 iPad 弹层关闭后进入阅读器")
        XCUIDevice.shared.orientation = .landscapeLeft
        defer { XCUIDevice.shared.orientation = .portrait }
        let app = launch()
        tap(app.buttons["catalog.audit-book-1"])

        let directorySearch = app.buttons["detail.chapterSearch"]
        reveal(directorySearch, app: app)
        tap(directorySearch)
        tap(app.buttons["目录选项"])
        tap(app.buttons["跳转章节"])
        let number = app.alerts.textFields.firstMatch
        tap(number)
        number.typeText("6")
        tap(app.alerts.buttons["开始阅读"])
        assertReaderStaysOpenAndReturnToDetail(app)

        tap(app.buttons["正文搜索"])
        let search = app.searchFields.firstMatch
        tap(search)
        search.typeText("信纸\n")
        tap(app.buttons["bookSearch.hit.audit-book-1-chapter-1"])
        assertReaderStaysOpenAndReturnToDetail(app)
    }

    @MainActor
    private func assertReaderStaysOpenAndReturnToDetail(
        _ app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line
    ) {
        let contents = app.buttons["reader.toolbar.contents"]
        XCTAssertTrue(contents.waitForExistence(timeout: 15), file: file, line: line)
        let text = app.textViews.matching(NSPredicate(
            format: "identifier BEGINSWITH %@ OR identifier BEGINSWITH %@", "reader.paragraph.", "reader.page."
        )).firstMatch
        XCTAssertTrue(text.waitForExistence(timeout: 15), file: file, line: line)
        // 不能只检查打开的一帧：弹层动画结束后阅读器也必须继续留在栈中。
        let disappeared = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: contents)
        disappeared.isInverted = true
        XCTAssertEqual(XCTWaiter.wait(for: [disappeared], timeout: 2), .completed, file: file, line: line)
        XCTAssertTrue(contents.isHittable, file: file, line: line)
        let inlineTools = app.descendants(matching: .any).matching(identifier: "reader.tools.inline").firstMatch
        XCTAssertFalse(inlineTools.exists, "打开阅读器不能自行展开工具", file: file, line: line)
        tap(contents, file: file, line: line)
        if app.frame.width >= 960 {
            XCTAssertTrue(inlineTools.waitForExistence(timeout: 10), file: file, line: line)
            let viewport = app.descendants(matching: .any).matching(NSPredicate(
                format: "identifier == %@ OR identifier == %@", "reader.body.scroll", "reader.body.pages"
            )).firstMatch
            XCTAssertTrue(viewport.waitForExistence(timeout: 10), file: file, line: line)
            XCTAssertLessThanOrEqual(viewport.frame.maxX, inlineTools.frame.minX + 1,
                                     "工具面板不得覆盖正文", file: file, line: line)
        }
        tap(app.buttons["完成"], file: file, line: line)
        tap(app.navigationBars.buttons.firstMatch, file: file, line: line)
        XCTAssertTrue(app.buttons["detail.read"].waitForExistence(timeout: 10), file: file, line: line)
        XCTAssertFalse(contents.exists, file: file, line: line)
        // 只看到作品正文并不够，必须能使用返回后的导航栏。
        tap(app.buttons["正文搜索"], file: file, line: line)
        XCTAssertTrue(app.searchFields.firstMatch.waitForExistence(timeout: 10), file: file, line: line)
        tap(app.buttons["关闭"], file: file, line: line)
        XCTAssertTrue(app.navigationBars.buttons.firstMatch.isHittable, file: file, line: line)
    }

    @MainActor
    func testChapterSearchAndNumberJump() {
        let app = launch()
        tap(app.buttons["catalog.audit-book-1"])
        tap(app.buttons["detail.read"])
        tap(app.buttons["目录"])
        let search = app.searchFields.firstMatch
        tap(search)
        search.typeText("没有这一章")
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "没有这一章")).firstMatch.waitForExistence(timeout: 10))
        tap(app.buttons["目录选项"])
        tap(app.buttons["跳转章节"])
        let number = app.alerts.textFields.firstMatch
        tap(number)
        number.typeText("12")
        tap(app.alerts.buttons["开始阅读"])
        XCTAssertTrue(app.navigationBars["第 12 章 山路上的回声"].waitForExistence(timeout: 10))
        capture("reader-jump-to-chapter", app: app)
    }

    @MainActor
    func testCustomCacheBudgetSurvivesRelaunchAndRejectsInvalidInput() {
        let app = launch()
        func openStorage() {
            selectTab("我的", app: app)
            let storage = app.buttons["存储管理"]
            reveal(storage, app: app)
            tap(storage)
        }
        openStorage()
        let limit = app.buttons["storage.cacheLimit"]
        reveal(limit, app: app)
        tap(limit)
        let field = app.textFields["storage.cacheLimit.value"]
        tap(field)
        let initial = field.value as? String ?? "256"
        field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: initial.count) + "0")
        XCTAssertFalse(app.buttons["storage.cacheLimit.save"].isEnabled)
        field.typeText(XCUIKeyboardKey.delete.rawValue + "333")
        tap(app.buttons["storage.cacheLimit.save"])
        XCTAssertTrue(app.buttons["storage.cacheLimit"].waitForExistence(timeout: 10))
        app.terminate()
        app.launch()
        openStorage()
        reveal(app.buttons["storage.cacheLimit"], app: app)
        tap(app.buttons["storage.cacheLimit"])
        XCTAssertEqual(field.value as? String, "333")
        capture("storage-custom-cache-budget", app: app)
        // Restore the device preference so later UI tests retain the default budget.
        field.tap()
        field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 3) + initial)
        tap(app.buttons["storage.cacheLimit.save"])
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
        XCTAssertTrue(picture.waitForExistence(timeout: 10))
        picture.press(forDuration: 0.8)
        XCTAssertTrue(app.buttons["保存到相册"].waitForExistence(timeout: 10))
        tap(app.buttons["查看大图"])
        XCTAssertTrue(app.navigationBars["图片预览"].waitForExistence(timeout: 10))
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
    func testMovedThoughtMarkerFollowsItsQuoteAndShowsWave() {
        let app = launch("thought-anchor")
        tap(app.buttons["catalog.audit-book-1"])
        tap(app.buttons["detail.read"])
        let quote = app.textViews["reader.paragraph.1"]
        XCTAssertTrue(quote.waitForExistence(timeout: 10))
        let marker = app.buttons["1 条段评"]
        XCTAssertTrue(marker.waitForExistence(timeout: 10))
        XCTAssertGreaterThanOrEqual(marker.frame.minY, quote.frame.minY)
        XCTAssertLessThanOrEqual(marker.frame.maxY, quote.frame.maxY + 1)
        capture("thought-moved-quote-wave", app: app)
        tap(marker)
        XCTAssertTrue(app.staticTexts["挂在原引用上的想法"].waitForExistence(timeout: 10))
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
        selectTab("我的", app: app)
        tap(app.buttons["profile.thoughts"])
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
        reveal(app.buttons["account.logout"], app: app)
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
        openAdminModule("ai-service", app: app)
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
        let novelsModule = app.buttons["admin.module.novels"]
        reveal(novelsModule, app: app)
        XCTAssertTrue(novelsModule.waitForExistence(timeout: 10))
        capture("admin-modules", app: app)
        tap(novelsModule)
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

    @MainActor
    func testAdminNovelEditorUsesSelectedBookOnFirstAndRepeatedPresentation() {
        let app = launch("admin-parity")
        openAdminModule("novels", app: app)
        XCTAssertTrue(app.staticTexts["山中来信"].firstMatch.waitForExistence(timeout: 15))

        // The first presentation must edit the first book, never default to create.
        for (index, title, author) in [(0, "山中来信", "林溪"), (1, "长街灯火里的旧日时光", "陈雨"), (0, "山中来信", "林溪")] {
            tap(app.buttons["小说操作"].element(boundBy: index))
            tap(app.buttons["编辑"])
            XCTAssertTrue(app.staticTexts["编辑小说"].firstMatch.waitForExistence(timeout: 10))
            XCTAssertTrue(app.buttons["保存"].exists)
            XCTAssertFalse(app.buttons["创建"].exists)
            XCTAssertEqual(app.textFields["书名 *"].value as? String, title)
            XCTAssertEqual(app.textFields["作者 *"].value as? String, author)
            tap(app.buttons["取消"])
            XCTAssertTrue(app.staticTexts["编辑小说"].firstMatch.waitForNonExistence(timeout: 10))
        }

        tap(app.buttons["新建小说"])
        XCTAssertTrue(app.staticTexts["新建小说"].firstMatch.waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["创建"].exists)
        let newTitle = app.textFields["书名 *"].value as? String ?? ""
        XCTAssertTrue(newTitle.isEmpty || newTitle == "书名 *")
        tap(app.buttons["取消"])
        XCTAssertTrue(app.staticTexts["新建小说"].firstMatch.waitForNonExistence(timeout: 10))
        tap(app.buttons["小说操作"].element(boundBy: 0))
        tap(app.buttons["编辑"])
        XCTAssertTrue(app.staticTexts["编辑小说"].firstMatch.waitForExistence(timeout: 10))
        XCTAssertEqual(app.textFields["书名 *"].value as? String, "山中来信")
    }

    @MainActor
    private func openAdminWorkspace(app: XCUIApplication) {
        selectTab("我的", app: app)
        reveal(app.buttons["管理后台"], app: app)
        tap(app.buttons["管理后台"])
    }

    @MainActor
    private func openAdminModule(_ id: String, app: XCUIApplication) {
        openAdminWorkspace(app: app)
        let module = app.buttons["admin.module.\(id)"]
        if !module.exists {
            let all = app.buttons["admin.allModules"]
            reveal(all, app: app)
            tap(all)
            let groups = [
                "ai-service": "creation", "book-import": "library", "discover": "library",
                "tasks": "runtime", "operations-audit": "platform",
                "backups": "platform", "site-settings": "platform",
            ]
            if let groupID = groups[id] {
                let group = app.descendants(matching: .any)["admin.group.\(groupID)"].firstMatch
                reveal(group, app: app)
                tap(group)
            }
        }
        reveal(module, app: app)
        tap(module)
    }

    @MainActor
    func testAdminDiscoverLoadsDefaultRankingAndSwitchesPeriod() {
        let app = launch("admin-discover-ranking")
        openAdminModule("discover", app: app)
        XCTAssertTrue(app.buttons["查看周榜示例作品"].waitForExistence(timeout: 10))

        tap(app.buttons["admin.discover.ranking"])
        tap(app.buttons["本月榜单"])
        XCTAssertTrue(app.buttons["查看月榜示例作品"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["查看周榜示例作品"].exists)
    }

    @MainActor
    func testAdminDiscoverRetriesSourceCapabilities() {
        let app = launch("admin-discover-retry")
        openAdminModule("discover", app: app)
        tap(app.buttons["重试"])
        XCTAssertTrue(app.buttons["查看周榜示例作品"].waitForExistence(timeout: 10))
    }

    @MainActor
    func testAdminDiscoverExplainsUnavailableRankingPresets() {
        let app = launch("admin-discover-no-presets")
        openAdminModule("discover", app: app)
        XCTAssertTrue(app.staticTexts["当前服务器未提供预设榜单。可粘贴榜单页面 URL 继续。"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.textFields["粘贴榜单页面 URL"].exists)
    }

    @MainActor
    func testAdminTaskCenterDownloadRecords() {
        let app = launch("admin-parity")
        openAdminModule("tasks", app: app)
        reveal(app.buttons["抓取任务"], app: app)
        XCTAssertTrue(app.buttons["抓取任务"].exists)
        reveal(app.buttons["AI 任务"], app: app)
        XCTAssertTrue(app.buttons["AI 任务"].exists)
        reveal(app.buttons["下载记录"], app: app)
        tap(app.buttons["下载记录"])
        XCTAssertTrue(app.staticTexts["山中来信下载记录"].waitForExistence(timeout: 10))
        capture("admin-task-center-downloads", app: app)
    }

    @MainActor
    func testAdminFollowupSaveAndReload() {
        let app = launch("admin-parity")
        openAdminModule("novels", app: app)
        tap(app.buttons["小说操作"].firstMatch)
        tap(app.buttons["追更设置"])
        let enabled = app.switches["admin.followup.enabled"]
        tap(enabled)
        reveal(app.buttons["admin.followup.save"], app: app)
        tap(app.buttons["admin.followup.save"])
        XCTAssertTrue(app.staticTexts["追更设置已保存"].waitForExistence(timeout: 10))
        tap(app.buttons["完成"])
        tap(app.buttons["小说操作"].firstMatch)
        tap(app.buttons["追更设置"])
        XCTAssertTrue(enabled.waitForExistence(timeout: 10))
        XCTAssertEqual(enabled.value as? String, "1")
        capture("admin-followup-saved", app: app)
    }

    @MainActor
    func testAdminImportPreviewCommitAndHistory() {
        let app = launch("admin-parity")
        openAdminModule("book-import", app: app)
        let address = app.textFields["admin.import.url"]
        tap(address)
        address.typeText("https://example.com/book")
        tap(app.buttons["admin.import.preview"])
        let conflict = app.switches["重复章节 · 冲突"]
        reveal(conflict, app: app)
        XCTAssertTrue(conflict.exists)
        XCTAssertFalse(conflict.isEnabled)
        let commit = app.buttons["admin.import.commit"]
        reveal(commit, app: app)
        tap(commit)
        tap(app.buttons["提交导入"])
        XCTAssertTrue(app.staticTexts["admin.import.result"].waitForExistence(timeout: 10))
        let history = app.buttons["我的导入历史"]
        reveal(history, app: app)
        tap(history)
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "已导入")).firstMatch.waitForExistence(timeout: 10))
        capture("admin-import-history", app: app)
    }

    @MainActor
    func testAdminOperationsLoadsSecondPage() {
        let app = launch("admin-parity")
        openAdminModule("operations-audit", app: app)
        XCTAssertTrue(app.staticTexts["测试操作 1"].waitForExistence(timeout: 10))
        let more = app.buttons["admin.records.more"]
        for _ in 0..<60 {
            if more.isHittable { break }
            app.swipeUp()
        }
        tap(more)
        let last = app.staticTexts["测试操作 51"]
        reveal(last, app: app)
        XCTAssertTrue(last.waitForExistence(timeout: 10))
        capture("admin-operation-audit-second-page", app: app)
    }

    @MainActor
    func testAdminImportRequiresExplicitAmbiguousTarget() {
        let app = launch("admin-import-ambiguous")
        openAdminModule("book-import", app: app)
        tap(app.textFields["admin.import.url"])
        app.textFields["admin.import.url"].typeText("https://example.com/book")
        tap(app.buttons["admin.import.preview"])
        let commit = app.buttons["admin.import.commit"]
        reveal(commit, app: app)
        XCTAssertTrue(commit.exists)
        XCTAssertFalse(commit.isEnabled)
        let candidate = app.buttons["山中来信 · 林溪"]
        for _ in 0..<12 {
            if candidate.isHittable { break }
            app.swipeDown()
        }
        tap(candidate)
        reveal(commit, app: app)
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate(format: "enabled == true"), object: commit)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 10), .completed)
        capture("admin-import-target-confirmed", app: app)
    }

    @MainActor
    func testAdminCallsRangeChangesDetails() {
        let app = launch("admin-parity")
        openAdminWorkspace(app: app)
        let all = app.buttons["admin.allModules"]
        reveal(all, app: app)
        tap(all)
        let search = app.searchFields.firstMatch
        if !search.exists && app.buttons["搜索"].firstMatch.exists {
            tap(app.buttons["搜索"].firstMatch)
        }
        if !search.isHittable { app.swipeDown() }
        tap(search)
        search.typeText("Token")
        tap(app.buttons["admin.module.calls"])
        XCTAssertTrue(app.staticTexts["近30天调用"].waitForExistence(timeout: 10))
        tap(app.buttons["admin.calls.days"])
        tap(app.buttons["近 7 天"])
        XCTAssertTrue(app.staticTexts["近7天调用"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.staticTexts["近30天调用"].exists)
        capture("admin-calls-seven-days", app: app)
    }

    @MainActor
    func testAdminBackupFailureRetryAndReadOnlyHistory() {
        let app = launch("admin-backup-retry", largeText: true)
        openAdminModule("backups", app: app)
        XCTAssertTrue(app.staticTexts["备份状态暂时无法读取"].waitForExistence(timeout: 10))
        tap(app.buttons["重试"])
        let failure = app.staticTexts["远端存储连接超时"]
        reveal(failure, app: app)
        XCTAssertTrue(failure.waitForExistence(timeout: 10))
        let versions = app.buttons["备份版本"]
        reveal(versions, app: app)
        tap(versions)
        XCTAssertTrue(app.staticTexts["审查备份"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["恢复备份"].exists)
        capture("admin-backup-readonly-large-text", app: app)
    }

    @MainActor
    func testAdminSiteSettingsShowsStatusAndWebEntry() {
        let app = launch("admin-parity")
        openAdminModule("site-settings", app: app)
        XCTAssertTrue(app.staticTexts["站点信息审查数据"].waitForExistence(timeout: 10))
        let configured = app.staticTexts["已配置"]
        reveal(configured, app: app)
        XCTAssertTrue(configured.exists)
        let web = app.descendants(matching: .any)["admin.web./admin/site-settings?view=security"].firstMatch
        reveal(web, app: app)
        XCTAssertTrue(web.exists)
        XCTAssertFalse(app.secureTextFields.firstMatch.exists)
        capture("admin-site-settings-readonly", app: app)
    }
}
