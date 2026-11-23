import XCTest
@testable import ZhiZhouCore

final class StoryGraphTests: XCTestCase {
    private func graph(count: Int = 4) throws -> StoryGraph {
        let people: [[String: Any]] = (0..<count).map { index in
            ["id": "p\(index)", "name": "人物\(index)", "aliases": index == 0 ? ["Alice", "小林"] : [],
             "summary": "当前处境", "evidence": [["kind": "relationship", "quote": "报告摘录", "chapterIds": ["c1"]]]]
        }
        let edges: [[String: Any]] = count < 4 ? [] : [
            ["id": "r1", "from": "p0", "to": "p1", "label": "信任", "summary": "单向信任", "directed": true, "certainty": "belief", "evidence": []],
            ["id": "r2", "from": "p1", "to": "p2", "label": "认识", "summary": "相识", "directed": false, "certainty": "fact", "evidence": []],
        ]
        return try JSONDecoder().decode(StoryGraph.self, from: JSONSerialization.data(withJSONObject: [
            "version": 1, "people": people, "relationships": edges,
            "threads": [["id": "t1", "title": "遗落的钥匙", "kind": "item", "people": ["p0", "p2"],
                         "summary": "去向不明", "certainty": "clue", "evidence": []]],
        ]))
    }

    func testAliasesSearchKeepsOnlyMatchesAndDirectNeighbors() throws {
        let value = try graph()
        XCTAssertEqual(value.matchingPeople(" alice ").map(\.id), ["p0"])
        XCTAssertEqual(value.matchingPeople("小林").map(\.id), ["p0"])
        XCTAssertEqual(Set(value.visiblePeople(query: "alice", focus: ["p3"]).map(\.id)), ["p0", "p1"])
        XCTAssertTrue(value.visiblePeople(query: "不存在", focus: []).isEmpty)
    }

    func testFocusUnionDoesNotExpandRecursivelyAndPanoramaRestoresCast() throws {
        let value = try graph()
        XCTAssertEqual(value.neighborhood(of: ["p0"]), ["p0", "p1"])
        XCTAssertEqual(value.neighborhood(of: ["p0", "p2"]), ["p0", "p1", "p2"])
        XCTAssertEqual(value.visiblePeople(query: "", focus: ["p3"]).map(\.id), ["p3"])
        XCTAssertEqual(value.visiblePeople(query: "  ", focus: []).count, 4)
    }

    func testLargeCastHasUniqueStablePositionsAndExplicitCenter() throws {
        let value = try graph(count: 160)
        let layout = StoryGraphLayout.positions(people: value.people, relationships: value.relationships, centerID: "p39")
        XCTAssertEqual(layout.count, 160)
        XCTAssertEqual(layout["p39"], StoryGraphPoint(x: 0, y: 0))
        XCTAssertEqual(Set(layout.values.map { "\($0.x),\($0.y)" }).count, 160)
        XCTAssertTrue(layout.values.allSatisfy { $0.x.isFinite && $0.y.isFinite })
        XCTAssertEqual(layout, StoryGraphLayout.positions(people: Array(value.people.reversed()), relationships: value.relationships, centerID: "p39"))
    }

    func testThreadNodesRemainOutsideCastAndCarryAssociation() throws {
        let value = try graph()
        let cast = StoryGraphLayout.positions(people: value.people, relationships: value.relationships, centerID: "p0")
        let threads = StoryGraphLayout.threadPositions(threads: value.threads, people: cast)
        let point = try XCTUnwrap(threads["t1"])
        XCTAssertGreaterThan(hypot(point.x, point.y), cast.values.map { hypot($0.x, $0.y) }.max() ?? 0)
        XCTAssertEqual(value.threads[0].people, ["p0", "p2"])
        XCTAssertEqual(value.threads[0].certainty, "clue")
        XCTAssertTrue(StoryGraphLayout.threadPositions(threads: [], people: cast).isEmpty)
    }

    func testEmptyAndSinglePersonLayouts() throws {
        XCTAssertTrue(StoryGraphLayout.positions(people: [], relationships: [], centerID: nil).isEmpty)
        let value = try graph(count: 1)
        XCTAssertEqual(StoryGraphLayout.positions(people: value.people, relationships: [], centerID: nil)["p0"], StoryGraphPoint(x: 0, y: 0))
    }

    func testOutdatedResponseNeverExposesItsGraph() throws {
        for status in ["ready", "missing", "outdated", "unavailable"] {
            let json = """
            {"novel":{"id":"book","title":"作品"},"anchor":{"id":"c1","title":"第一章","ordinal":1},
             "graph":{"version":1,"people":[],"relationships":[],"threads":[]},"updatedAt":1795420800000,
             "status":"\(status)","archives":[],"chapters":[]}
            """
            let value = try JSONDecoder().decode(StoryGraphResponse.self, from: Data(json.utf8))
            XCTAssertEqual(value.readyGraph != nil, status == "ready")
            XCTAssertFalse(value.canGenerate)
        }
    }

    func testUnavailableReportCannotEnableGeneration() throws {
        for eligibility in ["usable", "source_changed", "beyond_anchor", "stale", "missing"] {
            let json = """
            {"novel":{"id":"book","title":"作品"},"anchor":{"id":"c1","title":"第一章","ordinal":1},
             "graph":null,"updatedAt":0,"status":"missing","chapters":[],
             "archives":[{"kind":"plot","content":"报告内容","eligibility":"\(eligibility)","origin":"analysis","chaptersThrough":1}]}
            """
            let value = try JSONDecoder().decode(StoryGraphResponse.self, from: Data(json.utf8))
            XCTAssertEqual(value.canGenerate, eligibility == "usable")
        }
    }

    func testStreamProgressAndErrorInsideSuccessfulTransport() throws {
        let progress = try JSONDecoder().decode(StoryGraphStreamEvent.self, from: Data(#"{"type":"progress","progress":{"phase":"writing","generatedCharacters":42}}"#.utf8))
        guard case .progress(let phase, let count) = progress else { return XCTFail("Expected progress") }
        XCTAssertEqual(phase, "writing")
        XCTAssertEqual(count, 42)
        for status in [403, 409, 422, 429, 502] {
            let json = """
            {"type":"result","status":\(status),"data":{"error":"报告已变化"}}
            """
            let event = try JSONDecoder().decode(StoryGraphStreamEvent.self, from: Data(json.utf8))
            guard case .failure(let code, let message) = event else { return XCTFail("Expected failure") }
            XCTAssertEqual(code, status)
            XCTAssertEqual(message, "报告已变化")
        }
    }

    func testSuccessfulStreamResultPreservesScopeAndEvidenceSemantics() throws {
        let json = #"{"type":"result","status":200,"data":{"novel":{"id":"book","title":"作品"},"graph":null,"updatedAt":0,"status":"unavailable","archives":[],"chapters":[]}}"#
        let event = try JSONDecoder().decode(StoryGraphStreamEvent.self, from: Data(json.utf8))
        guard case .result(let response) = event else { return XCTFail("Expected result") }
        XCTAssertEqual(response.novel.id, "book")
        XCTAssertNil(response.readyGraph)
        let value = try graph()
        XCTAssertTrue(value.relationships[0].directed)
        XCTAssertEqual(value.relationships[0].certainty, "belief")
        XCTAssertEqual(value.people[0].evidence[0].quote, "报告摘录")
        XCTAssertEqual(value.people[0].evidence[0].chapterIds, ["c1"])
    }
}
