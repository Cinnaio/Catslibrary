import Foundation

/// Mirrors shared/story-graph.ts. Evidence is report text, never chapter prose.
public struct StoryEvidence: Decodable, Equatable, Sendable {
    public let kind: String
    public let quote: String
    public let chapterIds: [String]
}

public struct StoryPerson: Decodable, Equatable, Identifiable, Sendable {
    public let id: String
    public let name: String
    public let aliases: [String]
    public let summary: String
    public let evidence: [StoryEvidence]
}

public struct StoryRelationship: Decodable, Equatable, Identifiable, Sendable {
    public let id: String
    public let from: String
    public let to: String
    public let label: String
    public let summary: String
    public let directed: Bool
    public let certainty: String
    public let evidence: [StoryEvidence]
}

public struct StoryThread: Decodable, Equatable, Identifiable, Sendable {
    public let id: String
    public let title: String
    public let kind: String
    public let people: [String]
    public let summary: String
    public let certainty: String
    public let evidence: [StoryEvidence]
}

public struct StoryGraph: Decodable, Equatable, Sendable {
    public let version: Int
    public let people: [StoryPerson]
    public let relationships: [StoryRelationship]
    public let threads: [StoryThread]

    public func neighborhood(of ids: Set<String>) -> Set<String> {
        var result = ids
        for edge in relationships where ids.contains(edge.from) || ids.contains(edge.to) {
            result.insert(edge.from)
            result.insert(edge.to)
        }
        return result.intersection(Set(people.map(\.id)))
    }

    public func matchingPeople(_ query: String) -> [StoryPerson] {
        let query = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return people.filter { person in
            query.isEmpty || ([person.name] + person.aliases).contains { $0.localizedCaseInsensitiveContains(query) }
        }
    }

    public func visiblePeople(query: String, focus: Set<String>) -> [StoryPerson] {
        if !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            let ids = neighborhood(of: Set(matchingPeople(query).map(\.id)))
            return people.filter { ids.contains($0.id) }
        }
        guard !focus.isEmpty else { return people }
        let ids = neighborhood(of: focus)
        return people.filter { ids.contains($0.id) }
    }
}

public struct StoryGraphResponse: Decodable, Equatable, Sendable {
    public struct Book: Decodable, Equatable, Sendable {
        public let id: String
        public let title: String
    }
    public struct Chapter: Decodable, Equatable, Identifiable, Sendable {
        public let id: String
        public let title: String
        public let ordinal: Int
    }
    public struct Archive: Decodable, Equatable, Sendable {
        public let kind: String
        public let content: String
        public let eligibility: String
        public let origin: String
        public let chaptersThrough: Int
    }
    public let novel: Book
    public let anchor: Chapter?
    public let graph: StoryGraph?
    public let updatedAt: Int64
    public let status: String
    public let archives: [Archive]
    public let chapters: [Chapter]

    /// A stale payload can include a graph; it must never become a current map.
    public var readyGraph: StoryGraph? {
        status == "ready" && graph?.version == 1 ? graph : nil
    }
    public var canGenerate: Bool {
        ["missing", "outdated"].contains(status) && anchor != nil
            && archives.contains { $0.eligibility == "usable" && !$0.content.isEmpty }
    }
}

public struct StoryGraphPoint: Equatable, Sendable {
    public let x: Double
    public let y: Double
}

public enum StoryGraphLayout {
    /// Expanding rings never reuse the outer ring, even for large casts.
    public static func positions(people: [StoryPerson], relationships: [StoryRelationship], centerID: String?) -> [String: StoryGraphPoint] {
        var degrees: [String: Int] = [:]
        for edge in relationships {
            degrees[edge.from, default: 0] += 1
            degrees[edge.to, default: 0] += 1
        }
        let sorted = people.sorted {
            if ($0.id == centerID) != ($1.id == centerID) { return $0.id == centerID }
            if degrees[$0.id, default: 0] != degrees[$1.id, default: 0] {
                return degrees[$0.id, default: 0] > degrees[$1.id, default: 0]
            }
            return $0.id < $1.id
        }
        guard let first = sorted.first else { return [:] }
        var points = [first.id: StoryGraphPoint(x: 0, y: 0)]
        var offset = 1
        var ring = 1
        while offset < sorted.count {
            let count = min(ring * 8, sorted.count - offset)
            for slot in 0..<count {
                let angle = Double(slot) / Double(count) * 2 * .pi - .pi / 2
                let radius = Double(ring) * 190
                points[sorted[offset + slot].id] = StoryGraphPoint(x: cos(angle) * radius, y: sin(angle) * radius)
            }
            offset += count
            ring += 1
        }
        return points
    }

    /// Optional plot nodes live outside the cast; dotted spokes indicate association only.
    public static func threadPositions(threads: [StoryThread], people: [String: StoryGraphPoint]) -> [String: StoryGraphPoint] {
        guard !threads.isEmpty else { return [:] }
        let outsideCast = (people.values.map { hypot($0.x, $0.y) }.max() ?? 0) + 190
        let radius = max(outsideCast, Double(threads.count) * 140 / (2 * .pi))
        var points: [String: StoryGraphPoint] = [:]
        for (index, thread) in threads.sorted(by: { $0.id < $1.id }).enumerated() {
            let angle = Double(index) / Double(threads.count) * 2 * .pi - .pi / 2
            points[thread.id] = StoryGraphPoint(x: cos(angle) * radius, y: sin(angle) * radius)
        }
        return points
    }
}

/// The server sends one JSON event per data line; an HTTP 200 stream can carry a failed result.
public enum StoryGraphStreamEvent: Decodable, Sendable {
    case heartbeat
    case progress(phase: String, characters: Int)
    case result(StoryGraphResponse)
    case failure(status: Int, message: String)
    case unknown

    private enum Keys: String, CodingKey { case type, progress, status, data }
    private struct Progress: Decodable { let phase: String; let generatedCharacters: Int }
    private struct Failure: Decodable { let error: String? }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: Keys.self)
        switch try values.decode(String.self, forKey: .type) {
        case "heartbeat": self = .heartbeat
        case "progress":
            let progress = try values.decode(Progress.self, forKey: .progress)
            self = .progress(phase: progress.phase, characters: progress.generatedCharacters)
        case "result":
            let status = try values.decode(Int.self, forKey: .status)
            if (200..<300).contains(status) {
                self = .result(try values.decode(StoryGraphResponse.self, forKey: .data))
            } else {
                self = .failure(status: status, message: try values.decode(Failure.self, forKey: .data).error ?? "星图生成失败")
            }
        default: self = .unknown
        }
    }
}
