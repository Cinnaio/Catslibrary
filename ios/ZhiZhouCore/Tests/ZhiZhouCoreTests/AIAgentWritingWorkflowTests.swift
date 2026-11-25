import Foundation
import XCTest
@testable import ZhiZhouCore

final class AIAgentWritingWorkflowTests: XCTestCase {
    func testServerBlocksPreserveNewlinesEmojiAndChangeIndexes() throws {
        let data = Data(#"[{"kind":"equal","before":"开头\r\n","after":"开头\r\n"},{"kind":"changed","before":"旧句🐈\r\n","after":"新句🐈\r\n"},{"kind":"removed","before":"删去\n","after":""},{"kind":"added","before":"","after":"新增"}]"#.utf8)
        let blocks = try JSONDecoder().decode([AIAgentTextDifference].self, from: data)
        XCTAssertEqual(AIAgentRewriteChoices.merge(blocks, accepted: [0, 2]), "开头\r\n新句🐈\r\n删去\n新增")
        XCTAssertEqual(AIAgentRewriteChoices.merge(blocks, accepted: []), blocks.map(\.before).joined())
        XCTAssertEqual(AIAgentRewriteChoices.merge(blocks, accepted: [0, 1, 2]), blocks.map(\.after).joined())
    }
    func testSelectionRejectsStaleDuplicateAndOutOfRangeChoices() {
        XCTAssertTrue(AIAgentRewriteChoices.valid(.init(revision: "rev", acceptedChanges: [2, 0]), revision: "rev", count: 3))
        for selected in [[], [0, 0], [-1], [3]] {
            XCTAssertFalse(AIAgentRewriteChoices.valid(.init(revision: "rev", acceptedChanges: selected), revision: "rev", count: 3))
        }
        XCTAssertFalse(AIAgentRewriteChoices.valid(.init(revision: "old", acceptedChanges: [0]), revision: "new", count: 1))
    }
    func testPendingReferencesRetainScopeAndIdsAcrossRelaunch() throws {
        let pending = AIAgentPendingMessage(content: "先安排三章", providerPresetId: "preset", chapterPlanIntent: .planning,
            referenceSelection: .init(ids: ["r1", "r2"], scope: "session"))
        let recovered = try JSONDecoder().decode(AIAgentPendingMessage.self, from: JSONEncoder().encode(pending))
        XCTAssertEqual(recovered, pending)
        XCTAssertEqual(recovered.referenceSelection?.scope, "session")
        let legacy = try JSONDecoder().decode(AIAgentLocalDraft.self, from: Data(#"{"input":"保留输入","providerPresetId":""}"#.utf8))
        XCTAssertEqual(legacy.input, "保留输入")
        XCTAssertNil(legacy.referenceSelection)
    }
    func testOutlineDecodesStableIdentityAndActualPublicationProgress() throws {
        let outline = try JSONDecoder().decode(AIAgentOutline.self, from: Data(#"{"revision":2,"chapters":[{"id":"stable","title":"门后","goal":"开门","beats":"检查钥匙","progress":{"status":"published","drafts":[{"id":"draft","title":"实际标题","sessionId":"session","status":"published","chapterId":"chapter"}],"changedSinceWriting":true}}]}"#.utf8))
        XCTAssertEqual(outline.chapters.first?.id, "stable")
        XCTAssertEqual(outline.chapters.first?.progress?.label, "已发布")
        XCTAssertEqual(outline.chapters.first?.progress?.drafts.first?.chapterId, "chapter")
    }
}
