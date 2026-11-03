import Foundation

public enum ReaderAutoScrollSpeed: String, CaseIterable, Sendable {
    case off, slow, medium, fast

    public var pointsPerSecond: Double {
        switch self {
        case .off: return 0
        case .slow: return 18
        case .medium: return 32
        case .fast: return 52
        }
    }

    public func nextOffset(current: Double, maximum: Double, elapsed: Double) -> Double {
        min(maximum, current + pointsPerSecond * max(0, min(elapsed, 0.1)))
    }
}
