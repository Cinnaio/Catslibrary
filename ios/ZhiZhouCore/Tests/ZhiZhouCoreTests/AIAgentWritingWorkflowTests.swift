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
    func testThreadTrackingDecodesPartialRecoveryAndLegacyPayloads() throws {
        let legacy = #"{"candidates":[],"sourceRevision":"source","graphStatus":"ready","plans":[{"id":"plan","thread":{"id":"clue","title":"玉佩","summary":"主人未知","kind":"clue","certainty":"clue","people":[],"evidence":[]},"disposition":"advance","note":"","revision":1,"sourceRevision":"source","sourceAnchorId":"chapter"}]}"#
        let old = try JSONDecoder().decode(AIAgentStoryThreadState.self, from: Data(legacy.utf8))
        XCTAssertNil(old.trackingAvailable)
        XCTAssertNil(old.plans.first?.progress)
        var payload = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(legacy.utf8)) as? [String: Any])
        var plans = try XCTUnwrap(payload["plans"] as? [[String: Any]])
        plans[0]["disposition"] = "partial"
        plans[0]["targetChapterNumber"] = 10
        plans[0]["targetStage"] = "揭晓门派"
        plans[0]["reminder"] = "due"
        plans[0]["progress"] = [["id": "progress", "chapterId": "chapter", "chapterTitle": "初见", "chapterNumber": 1,
            "chapterRevision": "hash", "quote": "她收起玉佩。", "note": "持有人已知", "kind": "partial", "recordedAt": 1, "sourceChanged": true]]
        payload["plans"] = plans
        payload["trackingAvailable"] = true
        payload["currentChapterNumber"] = 10
        let current = try JSONDecoder().decode(AIAgentStoryThreadState.self, from: JSONSerialization.data(withJSONObject: payload))
        XCTAssertEqual(current.plans.first?.label, "部分回收")
        XCTAssertEqual(current.plans.first?.targetChapterNumber, 10)
        XCTAssertEqual(current.plans.first?.progress?.first?.sourceChanged, true)
        XCTAssertEqual(current.currentChapterNumber, 10)
    }
}
