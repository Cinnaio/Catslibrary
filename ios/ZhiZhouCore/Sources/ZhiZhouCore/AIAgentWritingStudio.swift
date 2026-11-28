import Foundation

public enum AIAgentStudioKind: String, Codable, CaseIterable, Identifiable, Sendable {
    case scene, voice, reading, knowledge, relationship, preference
    public var id: String { rawValue }
    public var title: String {
        switch self {
        case .scene: "场景卡"
        case .voice: "人物说话档案"
        case .reading: "模拟试读"
        case .knowledge: "角色知情表"
        case .relationship: "关系推进计划"
        case .preference: "改稿偏好"
        }
    }
    public var scope: String { self == .scene || self == .reading ? "session" : "book" }
    public var detail: String {
        switch self {
        case .scene: "逐场安排与写作，锁定满意的场景，再按顺序合成草稿。"
        case .voice: "从原文对白整理表达习惯，可按交流对象分别保存。"
        case .reading: "标注具体段落中的感受、疑问与调整建议，反馈属于模拟编辑意见。"
        case .knowledge: "分别记录人物掌握、怀疑、误信和未知的信息，保留获知来源。"
        case .relationship: "安排关系变化需要经历的事件，也允许误解、反复与退步。"
        case .preference: "从已经采纳的改动整理偏好；确认后用于本书或个人创作。"
        }
    }
    public var prompt: String {
        switch self {
        case .scene: "先读取写作工坊和章节计划，按我的要求拆分或完善场景卡。只规划时不要写正文；写某场前先读相邻场景，保持锁定场景不变。"
        case .voice: "查阅并核对原文对白，整理人物面对不同对象时的用词、称呼、节奏和情绪表达，区分观察与推测，附逐字引文。"
        case .reading: "查阅指定草稿、章节或场景，按指定角度模拟试读，关注疑问、信息密度、情绪中断、结尾期待和场景衔接。每项发现附原文引句，明确是模拟编辑意见。"
        case .knowledge: "回查原文，区分角色的已知、怀疑、误信和未知；没有提及不代表明确不知道，证据不足标为待定。未来揭示属于计划，附来源原句。"
        case .relationship: "结合原文关系与目标，安排关系推进事件、关联场景与未解矛盾。当前状态与未来计划分开，允许反复和退步。"
        case .preference: "调用 read_writing_edits 查阅已经采纳的改稿前后对照。至少两次独立改动体现同一习惯才提议长期偏好，附修改前后引句、适用情境与例外；证据不足时说明。"
        }
    }
    public var fields: [AIAgentStudioField] {
        switch self {
        case .scene: [
            .init("viewpoint", "视角人物", 160), .init("place", "时间与地点", 240),
            .init("goal", "场景目标", 800, required: true), .init("conflict", "冲突", 800),
            .init("turn", "转折", 800), .init("ending", "收尾与下一场衔接", 800),
            .init("targetWords", "预计字数", 5), .init("prose", "场景正文", 12000)
        ]
        case .voice: [
            .init("character", "人物", 160, required: true), .init("audience", "面对谁", 240),
            .init("diction", "用词与称呼", 1000, required: true), .init("rhythm", "句式与节奏", 800),
            .init("emotion", "情绪表达方式", 1000), .init("boundaries", "不符合人物的说法", 800)
        ]
        case .reading: [
            .init("perspective", "试读角度", 400, required: true), .init("reaction", "阅读感受与期待", 1400, required: true),
            .init("suggestion", "可尝试的调整", 1800)
        ]
        case .knowledge: [
            .init("character", "人物", 160, required: true), .init("information", "秘密或关键信息", 1200, required: true),
            .init("state", "认知状态", 20, required: true, options: ["已知", "怀疑", "误信", "未知", "待定"]),
            .init("learnedAt", "如何、何时获知或形成误会", 1000), .init("constraint", "后续揭示安排", 1000)
        ]
        case .relationship: [
            .init("people", "涉及人物", 240, required: true), .init("current", "当前关系", 1000, required: true),
            .init("target", "希望发生的变化", 1000), .init("milestones", "推进事件与关联场景（逐行填写）", 2400, required: true),
            .init("unresolved", "未解矛盾、反复与退步", 1400)
        ]
        case .preference: [
            .init("rule", "写作偏好", 1600, required: true), .init("appliesTo", "适用情境", 1000, required: true),
            .init("exceptions", "例外与限制", 1000)
        ]
        }
    }
}
public struct AIAgentStudioField: Identifiable, Sendable {
    public let id: String
    public let title: String
    public let limit: Int
    public let required: Bool
    public let options: [String]
    public init(_ id: String, _ title: String, _ limit: Int, required: Bool = false, options: [String] = []) {
        self.id = id; self.title = title; self.limit = limit; self.required = required; self.options = options
    }
}
public struct AIAgentStudioEvidence: Codable, Sendable {
    public let kind: String
    public let id: String
    public let revision: String
    public let quote: String
    public let beforeQuote: String?
}
public struct AIAgentStudioReplacement: Codable, Sendable { public let id: String; public let revision: Int }
public struct AIAgentWritingCard: Codable, Identifiable, Sendable {
    public var id: String
    public var kind: AIAgentStudioKind
    public var title: String
    public var scope: String
    public var values: [String: String]
    public var evidence: [AIAgentStudioEvidence]
    public var position: Int
    public var revision: Int
    public var status: String
    public var locked: Bool
    public var origin: String
    public var replaces: AIAgentStudioReplacement?
    public var createdAt: Double
    public var updatedAt: Double
    public var stale: Bool?
    public static func blank(_ kind: AIAgentStudioKind, position: Int = 0) -> Self {
        .init(id: "", kind: kind, title: "", scope: kind.scope,
              values: Dictionary(uniqueKeysWithValues: kind.fields.map { ($0.id, $0.options.first ?? "") }),
              evidence: [], position: position, revision: 0, status: "active", locked: false, origin: "author", createdAt: 0, updatedAt: 0)
    }
    public var isValid: Bool {
        guard !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, title.utf16.count <= 160, (0...9999).contains(position) else { return false }
        if kind == .scene, let words = values["targetWords"], !words.isEmpty {
            guard let count = Int(words), (1...12000).contains(count) else { return false }
        }
        return kind.fields.allSatisfy { field in
            let value = values[field.id] ?? ""
            return value.utf16.count <= field.limit && (!field.required || !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                && (field.options.isEmpty || field.options.contains(value))
        }
    }
    public var statusLabel: String { status == "proposed" ? "待采纳" : locked ? "已锁定" : "已保存" }
}
public struct AIAgentWritingStudio: Decodable, Sendable {
    public let cards: [AIAgentWritingCard]
    public let contextOmitted: [String]
}
public struct AIAgentWritingVersion: Decodable, Identifiable, Sendable {
    public let revision: Int
    public let card: AIAgentWritingCard
    public let createdAt: Double
    public var id: Int { revision }
}
