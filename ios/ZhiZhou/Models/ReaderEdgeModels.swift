import Foundation

struct ReaderEdgeSettings: Codable, Equatable {
    var minutes: Int
    var difficulty: String
    var finale: String
    var permitSeconds: Int
    var overtimeSeconds: Int
    var sound: Bool
    var speech: Bool
    var heartbeat: Bool
    var tone: String
    var categories: [String: Bool]
    var segmentLength: String
    var hiddenRemaining: Bool
    var customChance: Int?
    var holdMin: Int
    var holdMax: Int
    var acts: Bool
    var bank: Bool
    var timing: Bool
}

struct ReaderEdgeOption: Decodable, Identifiable {
    let id: String
    let label: String
    let summary: String?
    let sample: String?
    let chance: Int?
}

struct ReaderEdgeCatalog: Decodable {
    let defaults: ReaderEdgeSettings
    let difficulties: [ReaderEdgeOption]
    let finales: [ReaderEdgeOption]
    let tones: [ReaderEdgeOption]
    let categories: [ReaderEdgeOption]
    let acts: [String: String]
    let rules: [ReaderEdgeOption]
    let declarations: [ReaderEdgeOption]
    let spends: [ReaderEdgeOption]
    let overtimeMinSeconds: Int
    let overtimeMaxSeconds: Int
    let endings: [String: String]
    let historyLimit: Int

    func baseChance(for settings: ReaderEdgeSettings) -> Int {
        settings.customChance ?? difficulties.first { $0.id == settings.difficulty }?.chance ?? 0
    }
}

enum ReaderEdgeStatus: String, Decodable {
    case running, cooldown, paused, permit, finished
}

enum ReaderEdgePhase: String, Decodable {
    case go, slow, stop
}

enum ReaderEdgeDeclaration: String {
    case hold, grind
}

enum ReaderEdgeSpendKind: String, Decodable {
    case pardon, time, permit
}

struct ReaderEdgeSpendOption: Decodable, Identifiable {
    let kind: ReaderEdgeSpendKind
    let cost: Int
    let note: String?
    var id: String { kind.rawValue }
}

/// Derived by the shared engine after each action, including native ticks.
struct ReaderEdgeFeedback: Decodable {
    let timing: String?
    let timingHint: String?
    let sprinting: Bool
    let spends: [ReaderEdgeSpendOption]
}

/// A read-only projection; the shared JavaScript engine owns the complete state.
struct ReaderEdgeSession: Decodable, Identifiable {
    let id: String
    let settings: ReaderEdgeSettings
    let status: ReaderEdgeStatus
    let resumeStatus: ReaderEdgeStatus?
    let pauseReason: String?
    let elapsedMs: Double
    let totalMs: Double
    let phase: ReaderEdgePhase
    let act: String
    let phaseEndsAt: Double
    let command: String
    let bpm: Int
    let edges: Int
    let grinds: Int
    let bank: Int
    let spent: Int
    let chance: Int
    let ruined: Bool
    let overtime: Int
    let ending: String?
    let feedback: ReaderEdgeFeedback

    var isActive: Bool { status != .finished }
    var isAdvancing: Bool { status != .finished && status != .paused }
    var canDeclare: Bool { status == .running && phase != .stop }
    var remainingMs: Double {
        status == .permit || (status == .paused && resumeStatus == .permit)
            ? phaseRemainingMs : max(0, totalMs - elapsedMs)
    }
    var phaseRemainingMs: Double { max(0, phaseEndsAt - elapsedMs) }
    var progress: Double { totalMs > 0 ? min(1, elapsedMs / totalMs) : 0 }

    var phaseTitle: String {
        switch status {
        case .paused: return "已暂停"
        case .finished: return "本次结束"
        case .cooldown: return "等它平息"
        case .permit: return "允许时间里"
        case .running:
            switch phase {
            case .go: return "可以动"
            case .slow: return "慢一点"
            case .stop: return "松手"
            }
        }
    }

    var pauseHint: String? {
        switch pauseReason {
        case "background": return "切到后台或音频中断后已暂停，准备好再继续。"
        case "interrupted": return "检测到设备休眠或运行中断，已暂停。"
        default: return nil
        }
    }
}

struct ReaderEdgeRecord: Codable, Identifiable {
    let id: String
    let finishedAt: Double
    let minutes: Int
    let difficulty: String
    let finale: String
    let elapsedMs: Double
    let edges: Int
    let grinds: Int
    let spent: Int
    let overtime: Int
    let ending: String

    init(session: ReaderEdgeSession, finishedAt: Date = Date()) {
        id = session.id
        self.finishedAt = finishedAt.timeIntervalSince1970 * 1000
        minutes = session.settings.minutes
        difficulty = session.settings.difficulty
        finale = session.settings.finale
        elapsedMs = session.elapsedMs.rounded()
        edges = session.edges
        grinds = session.grinds
        spent = session.spent
        overtime = session.overtime
        ending = session.ending ?? "ended"
    }
}

struct ReaderEdgeTotals: Decodable {
    let sessions: Int
    let edges: Int
    let grinds: Int
    let spent: Int
    let permitted: Int
    let longestMs: Double
}

struct ReaderEdgeData: Codable {
    var settings: ReaderEdgeSettings
    var history: [ReaderEdgeRecord]
}

struct ReaderEdgeLoadedData: Decodable {
    let data: ReaderEdgeData
    let error: String?
}

struct ReaderEdgeContext: Equatable {
    let server: String
    let userID: String
    let bookID: String
    let accountRevision: UUID
}

func readerEdgeTime(_ milliseconds: Double) -> String {
    guard milliseconds.isFinite else { return "00:00" }
    // The shared history validator accepts any finite elapsed value; bound conversion to Int.
    let seconds = Int(min(999_999_999, max(0, milliseconds / 1000)).rounded(.up))
    return String(format: "%02d:%02d", seconds / 60, seconds % 60)
}
