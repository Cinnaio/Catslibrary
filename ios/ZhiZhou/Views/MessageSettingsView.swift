import SwiftUI

private struct MessagePreferences: Codable {
    var replies: Bool
    var tasks: Bool
    var preview: Bool
    var quietEnabled: Bool
    var quietStart: String
    var quietEnd: String
    var timeZone: String
    var revision: Int
}
private struct MessageDevice: Decodable, Identifiable { let id: String; let name: String; let createdAt: Double; let current: Bool }
private struct MessageConfiguration: Decodable { let settings: MessagePreferences; let devices: [MessageDevice]; let pushConfigured: Bool }
private struct MessagePreferencesResult: Decodable { let settings: MessagePreferences }
struct MessageSettingsView: View {
    @Environment(AppState.self) private var appState
    var body: some View {
        MessageSettingsContent()
            .id("\(appState.user?.id ?? "")|\(APIClient.shared.token ?? "")|\(ServerConfig.serverURL)")
    }
}
private struct MessageSettingsContent: View {
    @Environment(AppState.self) private var appState
    @State private var form: MessagePreferences?
    @State private var devices: [MessageDevice] = []
    @State private var error: String?
    @State private var message: String?
    @State private var busy = false
    private var scope: String { "\(appState.user?.id ?? "")|\(APIClient.shared.token ?? "")|\(ServerConfig.serverURL)" }
    var body: some View {
        Form {
            if form == nil && busy { ProgressView("正在读取设置…") }
            if form != nil {
                Section("推送种类") {
                    Toggle("评论回复", isOn: binding(\.replies))
                    Toggle("AI 任务完成或失败", isOn: binding(\.tasks))
                    Toggle("锁屏显示消息类型和书名", isOn: binding(\.preview))
                }
                Section {
                    Toggle("启用免打扰", isOn: binding(\.quietEnabled))
                    if form?.quietEnabled == true {
                        TextField("开始，例如 22:00", text: binding(\.quietStart)).keyboardType(.numbersAndPunctuation)
                        TextField("结束，例如 08:00", text: binding(\.quietEnd)).keyboardType(.numbersAndPunctuation)
                        TextField("时区", text: binding(\.timeZone)).textInputAutocapitalization(.never).autocorrectionDisabled()
                        Button("使用本机时区") { form?.timeZone = TimeZone.current.identifier; message = nil }
                    }
                    Button(busy ? "正在保存…" : "保存设置") { Task { await save() } }.disabled(busy)
                } header: { Text("免打扰") } footer: { Text("设置在账号间同步。消息始终保存在消息中心；免打扰结束后发送仍未读的新消息。") }
            }
            if let error { Section { Text(error).foregroundStyle(.red); if form == nil { Button("重新载入设置") { Task { await load() } }.disabled(busy) } } }
            if let message { Text(message).foregroundStyle(.secondary).accessibilityAddTraits(.updatesFrequently) }
            Section { NavigationLink("书架追更提醒") { MessageBookSubscriptionsView() } }
            if let userID = appState.user?.id { Section { NavigationLink("本机阅读提醒") { ReadingReminderView(userID: userID).id(userID) } } }
            Section("手机推送") {
                Text("在 Safari 打开网页版，添加到主屏幕，再从主屏幕进入「消息中心 → 通知设置」开启推送。需要 iOS / iPadOS 16.4 或以上。通知点开后进入网页版。")
                AdminWebLink(title: "打开网页版通知设置", path: "/messages?settings=1")
            }
            Section("接收设备") {
                ForEach(devices) { device in
                    HStack { Text(device.name); Spacer(); Button("移除", role: .destructive) { Task { await remove(device.id) } }.disabled(busy) }
                }
                if devices.isEmpty && form != nil { Text("还没有接收推送的设备。").foregroundStyle(.secondary) }
            }
        }.navigationTitle("通知设置").readingSpaceNavigation().disabled(busy)
            .task { if form == nil { await load() } }
    }
    private func binding<T>(_ path: WritableKeyPath<MessagePreferences, T>) -> Binding<T> {
        let fallback = form![keyPath: path]
        return Binding(get: { form?[keyPath: path] ?? fallback }, set: { form?[keyPath: path] = $0; message = nil })
    }
    private func load() async {
        guard !busy else { return }
        let owner = scope; busy = true
        defer { if owner == scope { busy = false } }
        do {
            let result: MessageConfiguration = try await APIClient.shared.get("/api/notifications/settings", auth: true)
            guard owner == scope, !Task.isCancelled else { return }
            form = result.settings; devices = result.devices; error = nil
        } catch { if owner == scope, !Task.isCancelled { self.error = AppCopy.friendlyError(error) } }
    }
    private func save() async {
        guard !busy, let form else { return }; let owner = scope; busy = true; error = nil; message = nil
        defer { if owner == scope { busy = false } }
        do {
            let response: MessagePreferencesResult = try await APIClient.shared.request("PUT", "/api/notifications/settings", body: JSONEncoder().encode(form), auth: true)
            guard owner == scope, !Task.isCancelled else { return }
            self.form = response.settings; message = "通知设置已保存"
        } catch { if owner == scope { self.error = AppCopy.friendlyError(error) } }
    }
    private func remove(_ id: String) async {
        guard !busy else { return }; let owner = scope; busy = true
        defer { if owner == scope { busy = false } }
        do {
            try await APIClient.shared.requestVoid("DELETE", "/api/notifications/subscriptions/" + ReaderMediaAPI.pathSegment(id), auth: true)
            guard owner == scope, !Task.isCancelled else { return }
            devices.removeAll { $0.id == id }
        } catch { if owner == scope { self.error = AppCopy.friendlyError(error) } }
    }
}
