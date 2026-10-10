import Foundation

public struct ReadingStatEvent: Codable, Equatable, Sendable, Identifiable {
    public let id: String
    public let sessionId: String
    public let novelId: String
    public let chapterId: String
    public let start: Int64
    public var end: Int64

    public init(id: String = UUID().uuidString, sessionId: String, novelId: String, chapterId: String, start: Int64, end: Int64) {
        self.id = id; self.sessionId = sessionId; self.novelId = novelId
        self.chapterId = chapterId; self.start = start; self.end = end
    }
}

/// Sample with uptime as well as wall time: suspended apps and clock changes
/// must never turn into long reading intervals. Matches the Web activity clock.
public struct ReadingActivityClock {
    private var wall: Int64
    private var uptime: TimeInterval
    private var lastActivity: TimeInterval
    private var active = false

    public init(wall: Int64, uptime: TimeInterval) {
        self.wall = wall; self.uptime = uptime; self.lastActivity = uptime
    }

    public mutating func activity(at uptime: TimeInterval) { lastActivity = uptime }

    public mutating func sample(wall: Int64, uptime: TimeInterval, visible: Bool) -> (start: Int64, end: Int64)? {
        let delta = uptime - self.uptime
        let previousWall = self.wall
        let end = min(wall, previousWall + Int64(max(0, lastActivity + 300 - self.uptime) * 1000))
        let valid = active && delta > 0 && delta <= 5
            && abs(Double(wall - previousWall) - delta * 1000) < 1000 && end > previousWall
        self.wall = wall; self.uptime = uptime
        active = visible && uptime - lastActivity < 300
        return valid ? (previousWall, end) : nil
    }
}

public enum ReadingStatPeriod: String, CaseIterable, Identifiable {
    case today, week, month, year, seven, thirty, ninety, all, custom
    public var id: String { rawValue }
    public var title: String {
        switch self {
        case .today: return "今日"
        case .week: return "本周"
        case .month: return "本月"
        case .year: return "今年"
        case .seven: return "近 7 天"
        case .thirty: return "近 30 天"
        case .ninety: return "近 90 天"
        case .all: return "全部"
        case .custom: return "自定义"
        }
    }
    public static var calendar: Calendar {
        var value = Calendar(identifier: .gregorian)
        value.timeZone = TimeZone(identifier: "Asia/Shanghai")!
        value.firstWeekday = 2
        value.minimumDaysInFirstWeek = 4
        return value
    }
    public func range(now: Date = Date(), offset: Int = 0, customStart: Date = Date(), customEnd: Date = Date()) -> (start: Int64, end: Int64) {
        let cal = Self.calendar
        let today = cal.startOfDay(for: now)
        let start: Date
        let end: Date
        switch self {
        case .all:
            start = Date(timeIntervalSince1970: 0); end = now
        case .custom:
            start = cal.startOfDay(for: customStart)
            end = cal.date(byAdding: .day, value: 1, to: cal.startOfDay(for: customEnd))!
        case .week, .month, .year:
            let component: Calendar.Component = self == .week ? .weekOfYear : self == .month ? .month : .year
            let base = cal.dateInterval(of: component, for: now)!.start
            start = cal.date(byAdding: component, value: offset, to: base)!
            end = cal.date(byAdding: component, value: 1, to: start)!
        default:
            let count = self == .seven ? 7 : self == .thirty ? 30 : self == .ninety ? 90 : 1
            start = cal.date(byAdding: .day, value: -(count - 1) + offset * count, to: today)!
            end = cal.date(byAdding: .day, value: count, to: start)!
        }
        return (Int64(start.timeIntervalSince1970 * 1000), Int64(min(now, end).timeIntervalSince1970 * 1000))
    }
}
