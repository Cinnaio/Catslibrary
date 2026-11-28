import XCTest
@testable import ZhiZhouCore

final class AIAgentWritingStudioTests: XCTestCase {
    func testSceneAndKnowledgeRequireMeaningfulFields() {
        var scene = AIAgentWritingCard.blank(.scene)
        XCTAssertFalse(scene.isValid)
        scene.title = "雨夜"; scene.values["goal"] = "试探对方"
        XCTAssertTrue(scene.isValid)
        scene.values["targetWords"] = "0"
        XCTAssertFalse(scene.isValid)
        scene.values["targetWords"] = "1000"
        XCTAssertTrue(scene.isValid)
        var knowledge = AIAgentWritingCard.blank(.knowledge)
        knowledge.title = "秘密"; knowledge.values["character"] = "林"; knowledge.values["information"] = "身份"
        knowledge.values["state"] = "待定"
        XCTAssertTrue(knowledge.isValid)
        knowledge.values["state"] = "猜一个"
        XCTAssertFalse(knowledge.isValid)
    }
    func testStudioResponseKeepsProposalStateAndSourceRevisions() throws {
        let data = #"{"cards":[{"id":"voice","kind":"voice","title":"她的口吻","scope":"book","values":{"character":"她","diction":"简短直接"},"evidence":[{"kind":"chapter","id":"chapter","revision":"r1","quote":"别担心。"}],"position":0,"revision":3,"status":"proposed","locked":false,"origin":"assistant","createdAt":1,"updatedAt":2,"stale":true}],"contextOmitted":[]}"#.data(using: .utf8)!
        let value = try JSONDecoder().decode(AIAgentWritingStudio.self, from: data)
        XCTAssertEqual(value.cards.first?.statusLabel, "待采纳")
        XCTAssertEqual(value.cards.first?.evidence.first?.revision, "r1")
        XCTAssertEqual(value.cards.first?.stale, true)
    }
}
