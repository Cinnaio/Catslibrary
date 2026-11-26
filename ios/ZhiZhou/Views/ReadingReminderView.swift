import SwiftUI
struct ReadingReminderView: View {
    let userID: String
    @State private var value = ReadingReminderPreference()
    @State private var time = Date()
    @State private var busy = false
    @State private var error: String?
    @State private var savedSignature: String?
    @State private var loadedScope: String?
    private var scope: String { "\(userID)|\(ServerConfig.serverURL)" }
    private var signature: String { "\(value.enabled)|\(time.timeIntervalSinceReferenceDate)|\(value.weekdays.sorted())" }
    private let weekdays = [(2, "星期一"), (3, "星期二"), (4, "星期三"), (5, "星期四"), (6, "星期五"), (7, "星期六"), (1, "星期日")]
    var body: some View {
        Form {
            Section {
                Toggle("提醒我读书", isOn: $value.enabled)
                DatePicker("提醒时间", selection: $time, displayedComponents: .hourAndMinute)
                ForEach(weekdays, id: \.0) { day, label in
                    Toggle(label, isOn: Binding(get: { value.weekdays.contains(day) }, set: { selected in
                        value.weekdays.removeAll { $0 == day }; if selected { value.weekdays.append(day) }
                    }))
                }
            } header: { Text("留一点时间给阅读") } footer: { Text("按这台设备的本地时间提醒，无需联网。设置仅保存在当前设备，退出账号会停止提醒；再次登录后恢复已保存的安排。") }
            Section {
                Button(busy ? "正在保存…" : "保存提醒") { Task { await save() } }.disabled(busy)
                if savedSignature == signature { Text("阅读提醒已保存").foregroundStyle(.secondary) }
                if let error { Text(error).foregroundStyle(.red) }
                if let url = URL(string: UIApplication.openSettingsURLString) { Link("打开系统通知设置", destination: url) }
            }
        }.navigationTitle("阅读提醒").readingSpaceNavigation().disabled(busy)
            .task(id: scope) {
                guard loadedScope != scope else { return }
                loadedScope = scope
                savedSignature = nil
                error = nil
                value = ReadingReminderStore.shared.preference(userID: userID)
                time = Calendar.current.date(bySettingHour: value.hour, minute: value.minute, second: 0, of: Date()) ?? Date()
            }
    }
    private func save() async {
        guard !busy else { return }; busy = true; savedSignature = nil; error = nil
        defer { busy = false }
        let components = Calendar.current.dateComponents([.hour, .minute], from: time)
        value.hour = components.hour ?? 20; value.minute = components.minute ?? 0
        do { try await ReadingReminderStore.shared.save(value, userID: userID); if !Task.isCancelled { savedSignature = signature } }
        catch is CancellationError { }
        catch { if !Task.isCancelled { self.error = AppCopy.friendlyError(error) } }
    }
}
