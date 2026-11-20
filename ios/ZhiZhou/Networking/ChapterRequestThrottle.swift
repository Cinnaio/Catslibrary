import Foundation

/// Shared cooldown for chapter requests belonging to the same captured account.
actor ChapterRequestThrottle {
    private var deadlines: [String: Date] = [:]

    @discardableResult
    func wait(scope: String, maxWait: TimeInterval = 65) async throws -> TimeInterval {
        let started = Date()
        while let deadline = deadlines[scope] {
            try Task.checkCancellation()
            let seconds = deadline.timeIntervalSinceNow
            let elapsed = max(0, Date().timeIntervalSince(started))
            if seconds <= 0 { deadlines.removeValue(forKey: scope); return elapsed }
            guard seconds <= 65, elapsed + seconds <= maxWait else {
                throw APIError.http(status: 429, message: "章节访问暂时受限，请稍后继续阅读或下载。")
            }
            try await Task.sleep(nanoseconds: UInt64(ceil(seconds * 1000)) * 1_000_000)
        }
        return max(0, Date().timeIntervalSince(started))
    }

    func record(response: HTTPURLResponse, data: Data, scope: String) -> Bool {
        guard response.statusCode == 429,
              let body = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              body["code"] as? String == "content_rate_limited" else { return false }
        let seconds: TimeInterval?
        if let value = response.value(forHTTPHeaderField: "Retry-After"), let number = Double(value) {
            seconds = number
        } else if let value = body["retryAfter"] as? NSNumber {
            seconds = value.doubleValue
        } else {
            seconds = nil
        }
        guard let seconds, seconds.isFinite, seconds > 0, seconds <= 86400 else { return false }
        deadlines = deadlines.filter { $0.value > Date() }
        let deadline = Date().addingTimeInterval(seconds + 0.1)
        deadlines[scope] = max(deadlines[scope] ?? .distantPast, deadline)
        return seconds <= 65
    }
}
