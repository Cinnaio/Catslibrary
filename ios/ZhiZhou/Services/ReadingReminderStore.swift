import Foundation
import CryptoKit
import UserNotifications

struct ReadingReminderPreference: Codable {
    var enabled = false
    var hour = 20
    var minute = 0
    var weekdays = [1, 2, 3, 4, 5, 6, 7]
}
@MainActor
final class ReadingReminderStore {
    static let shared = ReadingReminderStore()
    private var scope = ""
    private var generation = 0
    private let center = UNUserNotificationCenter.current()
    private func key(_ userID: String) -> String {
        SHA256.hash(data: Data("\(ServerConfig.serverURL)|\(userID)".utf8)).map { String(format: "%02x", $0) }.joined()
    }
    private var pendingIDs: [String] {
        get { UserDefaults.standard.stringArray(forKey: "readingReminderPendingIDs") ?? [] }
        set { UserDefaults.standard.set(newValue, forKey: "readingReminderPendingIDs") }
    }
    private func clear(_ ids: [String]) {
        center.removePendingNotificationRequests(withIdentifiers: ids)
        center.removeDeliveredNotifications(withIdentifiers: ids)
        pendingIDs.removeAll { ids.contains($0) }
    }
    func preference(userID: String) -> ReadingReminderPreference {
        guard let data = UserDefaults.standard.data(forKey: "readingReminder." + key(userID)),
              let value = try? JSONDecoder().decode(ReadingReminderPreference.self, from: data) else { return ReadingReminderPreference() }
        return value
    }
    func activate(userID: String) {
        let next = key(userID)
        guard scope != next else { return }
        deactivate(); scope = next
        let saved = preference(userID: userID), revision = generation
        // Previously granted schedules can resume without prompting during login.
        if saved.enabled { Task { try? await apply(saved, owner: next, revision: revision) } }
    }
    func deactivate() {
        generation += 1
        clear(pendingIDs)
        scope = ""
    }
    func save(_ value: ReadingReminderPreference, userID: String) async throws {
        let owner = key(userID)
        guard scope == owner else { throw CancellationError() }
        generation += 1; let revision = generation
        guard (0...23).contains(value.hour), (0...59).contains(value.minute), value.weekdays.allSatisfy({ (1...7).contains($0) }), !value.enabled || !value.weekdays.isEmpty else {
            throw APIError.http(status: 400, message: "请选择有效的时间和提醒日期")
        }
        if value.enabled {
            let granted = try await center.requestAuthorization(options: [.alert, .sound])
            guard scope == owner, generation == revision else { throw CancellationError() }
            guard granted else { throw APIError.http(status: 400, message: "请在系统设置中允许 Cat’s Library 发送通知") }
        }
        try await apply(value, owner: owner, revision: revision)
        guard scope == owner, generation == revision else { throw CancellationError() }
        UserDefaults.standard.set(try JSONEncoder().encode(value), forKey: "readingReminder." + owner)
    }
    private func apply(_ value: ReadingReminderPreference, owner: String, revision: Int) async throws {
        guard scope == owner, generation == revision else { throw CancellationError() }
        clear(pendingIDs)
        if !value.enabled { return }
        let settings = await center.notificationSettings()
        guard scope == owner, generation == revision else { throw CancellationError() }
        guard settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional else {
            throw APIError.http(status: 400, message: "系统通知权限已关闭，请允许通知后重新保存")
        }
        let schedule = UUID().uuidString
        var createdIDs: [String] = []
        do {
            for weekday in Set(value.weekdays).sorted() {
                guard scope == owner, generation == revision else { throw CancellationError() }
                let content = UNMutableNotificationContent()
                content.title = "给自己一会儿阅读时间"
                content.body = "翻开书房，接着上次那一页。"
                content.sound = .default
                var date = DateComponents(); date.weekday = weekday; date.hour = value.hour; date.minute = value.minute
                let identifier = "library.reading.\(owner).\(schedule).\(weekday)"
                createdIDs.append(identifier); pendingIDs.append(identifier)
                let request = UNNotificationRequest(identifier: identifier, content: content, trigger: UNCalendarNotificationTrigger(dateMatching: date, repeats: true))
                try await center.add(request)
                guard scope == owner, generation == revision else { throw CancellationError() }
            }
        } catch { clear(createdIDs); throw error }
    }
}
