import Foundation

/// Separates a reading tap from a touch that stops scrolling or deceleration.
/// Both methods take monotonic uptime so wall-clock changes cannot affect taps.
public struct ReaderTapGuard {
    public enum Phase {
        case idle
        case tracking
        case moving
    }

    public private(set) var isScrollInteractionActive = false
    private var suppressedUntil: TimeInterval = 0

    public init() {}

    public mutating func updatePhase(_ phase: Phase, at uptime: TimeInterval) {
        switch phase {
        case .moving:
            isScrollInteractionActive = true
        case .tracking:
            // A touch can stop deceleration before it ends. Keep that touch blocked.
            break
        case .idle:
            if isScrollInteractionActive {
                suppressedUntil = uptime + 0.25
            }
            isScrollInteractionActive = false
        }
    }

    public func allowsTap(at uptime: TimeInterval) -> Bool {
        !isScrollInteractionActive && uptime >= suppressedUntil
    }
}
