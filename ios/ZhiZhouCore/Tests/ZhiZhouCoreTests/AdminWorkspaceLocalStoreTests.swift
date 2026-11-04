import Foundation
import XCTest
@testable import ZhiZhouCore

final class AdminWorkspaceLocalStoreTests: XCTestCase {
    private func withStore(_ body: (AdminWorkspaceLocalStore, UserDefaults) throws -> Void) rethrows {
        let suite = "AdminWorkspaceTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        try body(AdminWorkspaceLocalStore(defaults: defaults), defaults)
    }

    func testDraftsAreIsolatedByBothAccountAndBook() {
        withStore { store, _ in
            store.save(AdminWritingDraft(id: "book-a", values: ["instruction": "甲的要求"], updatedAt: 1), userID: "alice")
            store.save(AdminWritingDraft(id: "book-b", values: ["instruction": "乙的要求"], updatedAt: 2), userID: "alice")
            store.save(AdminWritingDraft(id: "book-a", values: ["instruction": "另一个账号"], updatedAt: 3), userID: "bob")
            XCTAssertEqual(store.draft(contextID: "book-a", userID: "alice")?.values["instruction"], "甲的要求")
            XCTAssertEqual(store.draft(contextID: "book-b", userID: "alice")?.values["instruction"], "乙的要求")
            XCTAssertEqual(store.draft(contextID: "book-a", userID: "bob")?.values["instruction"], "另一个账号")
            XCTAssertNil(store.draft(contextID: "book-b", userID: "bob"))
        }
    }

    func testMultilineInputAndChapterAnchorSurviveReopening() {
        withStore { store, defaults in
            let values = ["instruction": "第一行\n第二行，保留标点。", "anchor": "chapter-12", "step": "1", "mode": "续写"]
            store.save(AdminWritingDraft(id: "book-a", values: values, updatedAt: 10), userID: "alice")
            let reopened = AdminWorkspaceLocalStore(defaults: defaults)
            XCTAssertEqual(reopened.draft(contextID: "book-a", userID: "alice")?.values, values)
        }
    }

    func testSubmittingOneDraftKeepsOtherBooksAndAccounts() {
        withStore { store, _ in
            for owner in ["alice", "bob"] {
                for book in ["a", "b"] { store.save(AdminWritingDraft(id: book, values: ["title": book], updatedAt: 1), userID: owner) }
            }
            store.removeDraft(contextID: "a", userID: "alice")
            XCTAssertNil(store.draft(contextID: "a", userID: "alice"))
            XCTAssertNotNil(store.draft(contextID: "b", userID: "alice"))
            XCTAssertEqual(store.drafts(userID: "bob").count, 2)
        }
    }

    func testRecentBooksAreDeduplicatedBoundedAndAccountScoped() {
        withStore { store, _ in
            for index in 0..<12 {
                store.record(AdminRecentBook(id: "book-\(index)", title: "书\(index)", author: "作者", visitedAt: Int64(index)), userID: "alice")
            }
            store.record(AdminRecentBook(id: "book-6", title: "新书名", author: "作者", visitedAt: 20), userID: "alice")
            let recent = store.recentBooks(userID: "alice")
            XCTAssertEqual(recent.count, 8)
            XCTAssertEqual(Set(recent.map(\.id)).count, 8)
            XCTAssertEqual(recent.first?.title, "新书名")
            XCTAssertFalse(recent.contains { $0.id == "book-0" })
            XCTAssertTrue(store.recentBooks(userID: "bob").isEmpty)
        }
    }

    func testGeneralAndBookDraftsStaySeparateAndSortByLastEdit() {
        withStore { store, _ in
            store.save(AdminWritingDraft(id: "general", values: ["title": "新写"], updatedAt: 1), userID: "alice")
            store.save(AdminWritingDraft(id: "book-a", values: ["title": "续写"], updatedAt: 2), userID: "alice")
            XCTAssertEqual(store.drafts(userID: "alice").map(\.id), ["book-a", "general"])
            store.save(AdminWritingDraft(id: "general", values: ["title": "新的标题"], updatedAt: 3), userID: "alice")
            XCTAssertEqual(store.drafts(userID: "alice").map(\.id), ["general", "book-a"])
        }
    }

    func testMissingOwnerCannotPersistDraftsOrRecentBooks() {
        withStore { store, _ in
            store.save(AdminWritingDraft(id: "a", values: ["title": "内容"], updatedAt: 1), userID: "")
            store.record(AdminRecentBook(id: "a", title: "内容", author: "", visitedAt: 1), userID: "")
            XCTAssertTrue(store.drafts(userID: "").isEmpty)
            XCTAssertTrue(store.recentBooks(userID: "").isEmpty)
        }
    }
}
