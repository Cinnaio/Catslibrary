import Foundation

/// 图片只占据布局片段，不改变正文 UTF-16 坐标。
public enum ReaderMediaLayout {
    public struct Insertion: Sendable {
        public let id: String
        public let offset: Int
        public let order: Int
        public init(id: String, offset: Int, order: Int) {
            self.id = id; self.offset = offset; self.order = order
        }
    }

    public struct Segment: Equatable, Sendable {
        public let range: NSRange
        public let illustrationID: String?
    }

    public static func segments(textLength: Int, insertions: [Insertion]) -> [Segment] {
        let length = max(0, textLength)
        let sorted = insertions.sorted {
            if $0.offset != $1.offset { return $0.offset < $1.offset }
            if $0.order != $1.order { return $0.order < $1.order }
            return $0.id < $1.id
        }
        var segments: [Segment] = []
        var cursor = 0
        for item in sorted {
            let offset = min(length, max(0, item.offset))
            if offset > cursor {
                segments.append(Segment(range: NSRange(location: cursor, length: offset - cursor), illustrationID: nil))
            }
            segments.append(Segment(range: NSRange(location: offset, length: 0), illustrationID: item.id))
            cursor = offset
        }
        if cursor < length {
            segments.append(Segment(range: NSRange(location: cursor, length: length - cursor), illustrationID: nil))
        }
        return segments
    }
}
