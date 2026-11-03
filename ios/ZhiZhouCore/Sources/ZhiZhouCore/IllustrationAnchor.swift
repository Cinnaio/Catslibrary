import Foundation

/// 与 shared/chapter-illustrations.ts 共用的段落锚点协议。
public struct IllustrationAnchor: Codable, Hashable, Sendable {
    public let position: String
    public let paragraphIndex: Int
    public let paragraphText: String
    public let paragraphHash: String
    public let previousText: String
    public let nextText: String
    public let sourceIndex: Int
    public let sourceHash: String

    public init(position: String, paragraphIndex: Int, paragraphText: String,
                paragraphHash: String = "", previousText: String = "", nextText: String = "",
                sourceIndex: Int = 0, sourceHash: String = "") {
        self.position = position
        self.paragraphIndex = paragraphIndex
        self.paragraphText = paragraphText
        self.paragraphHash = paragraphHash
        self.previousText = previousText
        self.nextText = nextText
        self.sourceIndex = sourceIndex
        self.sourceHash = sourceHash
    }

    /// -1 为章首，paragraphs.count 为章末；重复段落缺少唯一上下文时不猜测。
    public func resolve(in paragraphs: [String], sameRevision: Bool) -> Int? {
        if position == "start" { return -1 }
        if position == "end" { return paragraphs.count }
        guard position == "after" else { return nil }
        let texts = paragraphs.map(Self.normalize)
        let target = Self.normalize(paragraphText)
        if sameRevision, texts.indices.contains(paragraphIndex), texts[paragraphIndex] == target {
            return paragraphIndex
        }
        let matches = texts.indices.filter { texts[$0] == target }
        if matches.count == 1 { return matches[0] }
        let contextual = matches.filter { index in
            let previous = index > 0 ? texts[index - 1] : ""
            let next = index + 1 < texts.count ? texts[index + 1] : ""
            return previous == Self.normalize(previousText) && next == Self.normalize(nextText)
        }
        return contextual.count == 1 ? contextual[0] : nil
    }

    public static func normalize(_ text: String) -> String {
        text.split(whereSeparator: { $0.isWhitespace || $0 == "\u{FEFF}" }).joined(separator: " ")
    }

    /// JS FNV-1a 按 UTF-16 code unit 计算，包含 emoji 时也保持一致。
    public static func contentHash(_ text: String) -> String {
        var hash: UInt32 = 2_166_136_261
        for unit in normalize(text).utf16 {
            hash ^= UInt32(unit)
            hash = hash &* 16_777_619
        }
        return String(hash, radix: 36)
    }
}
