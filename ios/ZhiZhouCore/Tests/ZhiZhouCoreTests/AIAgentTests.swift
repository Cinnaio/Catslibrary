import Foundation
import XCTest
@testable import ZhiZhouCore

final class AIAgentTests: XCTestCase {
    private func task(preview: String, count: Int, round: Int = 1, startedAt: Int64 = 100, status: String = "running") throws -> AIAgentTask {
        let progress = AIAgentTextProgress(kind: "text-progress", phase: "writing", preview: preview,
            generatedCharacters: count, reasoningCharacters: 0, startedAt: startedAt, updatedAt: startedAt + Int64(count), round: round)
        let data = try JSONEncoder().encode(progress)
        return AIAgentTask(id: "task_1", kind: "agent_chat", status: status, step: "生成回复", current: 1, total: 8,
                           error: "", result: String(decoding: data, as: UTF8.self))
    }

    func testDetailAcceptsServerWireShapeAndOptionalFields() throws {
        let json = #"""
        {
          "session":{"id":"agent_1","novelId":"novel_1","novelTitle":"测试作品","title":"新的创作对话",
            "afterChapterId":"","anchorTitle":"","brief":"","contentPreferences":{"version":1,"adultContentMode":"off",
            "intimacyWeight":"none","adultCharactersConfirmed":false},"activeTaskId":"","createdAt":1794180000000,"updatedAt":1794180000001},
          "events":[{"id":1,"role":"user","content":"修改开头","taskId":"task_1","metadata":{},"createdAt":1794180000001}],
          "hasEarlier":false,"activeTask":null,
          "artifacts":[{"task":{"id":"task_2","kind":"write_chapter","status":"completed","step":"完成","current":1,"total":1,"error":""},
            "drafts":[{"id":"draft_1","title":"第一章","content":"正文 **原文**","status":"draft","revision":"hash"}],"covers":[]}],
          "actions":[{"id":"action_1","kind":"publish_draft","title":"发布第一章","status":"pending",
            "preview":{"description":"追加发布","after":"正文","draftId":"draft_1"},"error":"","createdAt":1794180000001}]
        }
        """#
        let value = try JSONDecoder().decode(AIAgentDetail.self, from: Data(json.utf8))
        XCTAssertNil(value.activeTask)
        XCTAssertNil(value.memories)
        XCTAssertNil(value.summary)
        XCTAssertNil(value.recovery)
        XCTAssertFalse(value.confirmsDelivery(of: "ios_agent_unconfirmed"))
        XCTAssertNil(value.events.first?.metadata.sources)
        XCTAssertNil(value.artifacts.first?.task.result)
        XCTAssertEqual(value.artifacts.first?.drafts.first?.content, "正文 **原文**")
        XCTAssertNil(value.session.contentPreferences.consentRuleTier)
        XCTAssertTrue(value.actions[0].canConfirm)
    }

    func testDeliveryReceiptCanConfirmAnOlderMessageOutsideTheEventWindow() throws {
        let json = #"""
        {
          "session":{"id":"agent_1","novelId":"novel_1","novelTitle":"测试作品","title":"创作对话",
            "afterChapterId":"","anchorTitle":"","brief":"","contentPreferences":{"version":1,"adultContentMode":"off",
            "intimacyWeight":"none","adultCharactersConfirmed":false},"activeTaskId":"task_2","createdAt":1,"updatedAt":2},
          "events":[{"id":10,"role":"user","content":"后续消息","taskId":"task_2","requestId":"ios_agent_recent","metadata":{},"createdAt":2},
                    {"id":11,"role":"activity","content":"活动记录","taskId":"task_2","requestId":"ios_agent_activity","metadata":{},"createdAt":3}],
          "hasEarlier":true,"artifacts":[],"actions":[],
          "messageReceipt":{"requestId":"ios_agent_earlier","taskId":"task_1"},
          "recovery":{"taskId":"task_2","phase":"retrieval","canResume":false,"message":"请新建对话"}
        }
        """#
        let detail = try JSONDecoder().decode(AIAgentDetail.self, from: Data(json.utf8))
        XCTAssertTrue(detail.confirmsDelivery(of: "ios_agent_earlier"))
        XCTAssertTrue(detail.confirmsDelivery(of: "ios_agent_recent"))
        XCTAssertFalse(detail.confirmsDelivery(of: "ios_agent_activity"))
        XCTAssertFalse(detail.confirmsDelivery(of: "ios_agent_unrelated"))
        XCTAssertEqual(detail.recovery?.taskId, "task_2")
        XCTAssertEqual(detail.recovery?.canResume, false)
    }

    func testReadingEventDecodesChapterReportAndLegacyEvidence() throws {
        let json = #"""
        {
          "id":2,"role":"activity","content":"查阅资料","taskId":"task_1","createdAt":100,
          "metadata":{"tool":"search_story","sources":[
            {"id":"e1","kind":"chapter","novelId":"novel_1","chapterId":"c1","title":"第一章",
             "origin":"published","revision":"hash","offset":0,"endOffset":4,"excerpt":"章节片段","truncated":true},
            {"id":"e2","kind":"analysis","novelId":"novel_1","reportId":"report_1","reportRevision":2,
             "title":"人物关系","origin":"manual","revision":"2","offset":0,"endOffset":4,"excerpt":"报告片段","truncated":false,
             "fromChapter":{"id":"c1","title":"第一章"},"throughChapter":{"id":"c2","title":"第二章"}},
            {"id":"e3","kind":"plot","novelId":"novel_1","title":"情节档案","origin":"automatic","revision":"hash",
             "offset":0,"endOffset":4,"excerpt":"档案片段","truncated":false,"throughChapter":{"id":"c1","title":"第一章"}}
          ]}
        }
        """#
        let event = try JSONDecoder().decode(AIAgentEvent.self, from: Data(json.utf8))
        let sources = try XCTUnwrap(event.metadata.sources)
        XCTAssertEqual(sources.map(\.excerpt), ["章节片段", "报告片段", "档案片段"])
        XCTAssertEqual(sources.first?.chapterId, "c1")
        XCTAssertEqual(sources.first?.truncated, true)
        let report = try XCTUnwrap(sources.first(where: { $0.kind == "analysis" }))
        XCTAssertEqual(report.reportId, "report_1")
        XCTAssertEqual(report.reportRevision, 2)
        XCTAssertEqual(report.fromChapter?.title, "第一章")
        XCTAssertEqual(report.throughChapter?.title, "第二章")
        XCTAssertNil(sources.last?.fromChapter)
    }

    func testMemoryPageDecodesStatusesSourcesAndStructuredSummary() throws {
        let json = """
        {"memories":[{"id":"m1","novelId":"n1","sessionId":"s1","kind":"agreement","title":"保留悬念","content":"结尾揭晓",
          "status":"pending","sourceEventId":100,"supersedesId":"old","revision":2,"createdAt":1,"updatedAt":2}],"hasMore":true,
          "summary":{"throughEventId":90,"content":{"goal":"讨论下一章","decisions":["#1 保留悬念"],"rejected":["#2 不采纳"],
          "openQuestions":["#3 待确认"],"nextSteps":["#4 检查草稿"],"references":["#1"]},"revision":1,"updatedAt":3}}
        """
        let page = try JSONDecoder().decode(AIAgentMemoryPage.self, from: Data(json.utf8))
        XCTAssertTrue(page.hasMore)
        XCTAssertEqual(page.memories.first?.sourceEventId, 100)
        XCTAssertEqual(page.memories.first?.supersedesId, "old")
        XCTAssertEqual(page.memories.first?.statusLabel, "待确认")
        XCTAssertEqual(page.memories.first?.canEdit, true)
        XCTAssertEqual(page.summary?.content.rejected, ["#2 不采纳"])
        XCTAssertEqual(page.summary?.throughEventId, 90)
    }

    func testMemoryHistoryAndUnavailableSourceRemainReadable() throws {
        let json = """
        {"memories":[{"id":"m1","novelId":"n1","sessionId":"","kind":"agreement","title":"旧约定","content":"内容",
          "status":"archived","sourceEventId":null,"supersedesId":null,"revision":3,"createdAt":1,"updatedAt":2}],"hasMore":false,"summary":null}
        """
        let page = try JSONDecoder().decode(AIAgentMemoryPage.self, from: Data(json.utf8))
        XCTAssertNil(page.summary)
        XCTAssertEqual(page.memories.first?.canEdit, false)
        XCTAssertEqual(page.memories.first?.statusLabel, "已移除")
        let source = try JSONDecoder().decode(AIAgentMemorySourceResponse.self, from: Data(#"{"source":null}"#.utf8))
        XCTAssertNil(source.source)
    }

    func testStaleCheckpointCannotTruncateLivePreview() throws {
        let live = try task(preview: "新的段落", count: 8)
        let checkpoint = try task(preview: "新的", count: 2)
        XCTAssertEqual(checkpoint.preservingNewerPreview(from: live).progress?.preview, "新的段落")
        let nextRound = try task(preview: "下一轮", count: 3, round: 2)
        XCTAssertEqual(nextRound.preservingNewerPreview(from: live).progress?.preview, "下一轮")
        let nextCall = try task(preview: "重开调用", count: 1, startedAt: 200)
        XCTAssertEqual(nextCall.preservingNewerPreview(from: live).progress?.preview, "重开调用")
        let completed = try task(preview: "已完成", count: 3, status: "completed")
        XCTAssertEqual(completed.preservingNewerPreview(from: live).progress?.preview, "已完成")
    }

    func testSavedAssistantRoundSuppressesOnlyItsOwnPreview() throws {
        let event = try JSONDecoder().decode(AIAgentEvent.self, from: Data(#"{"id":3,"role":"assistant","content":"回复","taskId":"task_1","metadata":{"round":1},"createdAt":100}"#.utf8))
        XCTAssertTrue(AIAgentEvent.containsPreview([event], task: try task(preview: "回复", count: 2)))
        XCTAssertFalse(AIAgentEvent.containsPreview([event], task: try task(preview: "下一轮", count: 3, round: 2)))
        let events = AIAgentEvent.merged([event], [event])
        XCTAssertEqual(events.map(\.id), [3])
    }

    func testPreviewBoundsAndInvalidTaskResults() throws {
        XCTAssertNil(AIAgentTextProgress.parse(#"{"kind":"cover","preview":"data:image/png;base64,abc"}"#))
        XCTAssertNil(try task(preview: String(repeating: "文", count: 24_001), count: 24_001).progress)
        XCTAssertNil(try task(preview: "正文", count: -1).progress)
        XCTAssertNil(try task(preview: "正文", count: 2, round: 9).progress)
        XCTAssertNotNil(try task(preview: String(repeating: "文", count: 24_000), count: 24_000).progress)
    }

    func testPendingRetryRetainsIdentityAndIsolatesAccountsSitesAndSessions() throws {
        let suite = "agent-tests-" + UUID().uuidString
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let store = AIAgentDraftStore(defaults: defaults)
        var draft = AIAgentLocalDraft()
        draft.input = "下一条尚未发送"
        draft.providerPresetId = "preset_A"
        draft.pending = AIAgentPendingMessage(content: "请调整开头", providerPresetId: "preset_A")
        store.save(draft, site: "site_A", userID: "user_A", sessionID: "session_A")
        let restored = store.read(site: "site_A", userID: "user_A", sessionID: "session_A")
        XCTAssertEqual(restored, draft)
        XCTAssertEqual(restored.pending?.requestId, draft.pending?.requestId)
        XCTAssertEqual(restored.pending?.providerPresetId, "preset_A")
        XCTAssertEqual(store.read(site: "site_B", userID: "user_A", sessionID: "session_A"), .init())
        XCTAssertEqual(store.read(site: "site_A", userID: "user_B", sessionID: "session_A"), .init())
        XCTAssertEqual(store.read(site: "site_A", userID: "user_A", sessionID: "session_B"), .init())
        XCTAssertEqual(store.read(site: "site_A", userID: "", sessionID: "session_A"), .init())
    }

    func testAdultPreferenceNormalizationMatchesExistingContract() {
        var preferences = AIAgentPreferences()
        preferences.adultContentMode = "explicit"
        preferences.consentRuleTier = "fictional_nonconsent"
        XCTAssertTrue(preferences.normalized.adultCharactersConfirmed)
        XCTAssertEqual(preferences.normalized.intimacyWeight, "medium")
        preferences = preferences.normalized
        preferences.adultContentMode = "off"
        XCTAssertEqual(preferences.normalized, AIAgentPreferences())
    }

    func testActionResumeRequiresServerPermission() throws {
        func decode(_ status: String, _ resumable: Bool) throws -> AIAgentAction {
            let object: [String: Any] = ["id": "a", "kind": "apply_rewrite", "title": "采纳改写", "status": status,
                "preview": ["description": "预览"], "error": "", "createdAt": 1, "canResume": resumable]
            return try JSONDecoder().decode(AIAgentAction.self, from: JSONSerialization.data(withJSONObject: object))
        }
        XCTAssertFalse(try decode("executing", false).canConfirm)
        XCTAssertTrue(try decode("executing", true).canConfirm)
        XCTAssertFalse(try decode("failed", true).canConfirm)
        XCTAssertFalse(try decode("completed", true).canConfirm)
    }

    func testMarkdownBlocksRetainCodeAndParseCommonReplyFormatting() {
        let source = "# 标题\n\n- **重点**\n- [x] 已完成\n\n> 引用\n\n```swift\nlet text = \"**保留原文**\"\n```\n\n| 项目 | 说明 |\n| --- | --- |\n| A | a\\|b |"
        let blocks = AgentMarkdown.blocks(source)
        XCTAssertEqual(blocks, [
            .heading(1, "标题"), .item(marker: "•", text: "**重点**", indent: 0),
            .item(marker: "☑", text: "已完成", indent: 0), .quote("引用"),
            .code(language: "swift", text: "let text = \"**保留原文**\""),
            .table([["项目", "说明"], ["A", "a|b"]]),
        ])
    }

    func testUnfinishedStreamingFenceRemainsLiteral() {
        XCTAssertEqual(AgentMarkdown.blocks("文字\n\n```\n# 不是标题\n**未完成"), [
            .paragraph("文字"), .code(language: "", text: "# 不是标题\n**未完成"),
        ])
    }
}
