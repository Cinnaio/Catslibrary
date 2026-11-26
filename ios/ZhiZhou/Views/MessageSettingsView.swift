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
    @State private var operation: Operation?
    @FocusState private var focusedField: Field?
    private enum Operation: Equatable { case load, save, remove(String) }
    private enum Field: Hashable { case start, end, timeZone }
    private var busy: Bool { operation != nil }
    private var isSavingChanges: Bool { operation != nil && operation != .load }
    private var scope: String { "\(appState.user?.id ?? "")|\(APIClient.shared.token ?? "")|\(ServerConfig.serverURL)" }
    var body: some View {
        AccountSettingsPage {
            AccountSettingsHeading("通知设置", detail: "选择想收到的消息，安排安静的时间。")
                .readingSpaceEntrance(0)
            if form == nil && busy { ProgressView("正在读取设置…") }
            if form != nil {
                AccountSettingsSection("推送种类") {
                    Toggle("评论回复", isOn: binding(\.replies))
                    Toggle("AI 任务完成或失败", isOn: binding(\.tasks))
                    Toggle("锁屏显示消息类型和书名", isOn: binding(\.preview)).accessibilityIdentifier("messages.settings.preview")
                }
                .readingSpaceEntrance(1)
                AccountSettingsSection("免打扰") {
                    Toggle("启用免打扰", isOn: binding(\.quietEnabled))
                    if form?.quietEnabled == true {
                        AccountSettingsField("开始时间", isFocused: focusedField == .start) {
                            TextField("例如 22:00", text: binding(\.quietStart))
                                .keyboardType(.numbersAndPunctuation)
                                .focused($focusedField, equals: .start)
                        }
                        AccountSettingsField("结束时间", isFocused: focusedField == .end) {
                            TextField("例如 08:00", text: binding(\.quietEnd))
                                .keyboardType(.numbersAndPunctuation)
                                .focused($focusedField, equals: .end)
                        }
                        AccountSettingsField("时区", isFocused: focusedField == .timeZone) {
                            TextField("例如 Asia/Shanghai", text: binding(\.timeZone))
                                .textInputAutocapitalization(.never).autocorrectionDisabled()
                                .focused($focusedField, equals: .timeZone)
                        }
                        Button {
                            form?.timeZone = TimeZone.current.identifier
                            message = nil
                        } label: {
                            AccountSettingsActionLabel(title: "使用本机时区", symbol: "clock")
                        }
                    }
                    AccountSettingsNote("设置在账号间同步。消息始终保存在消息中心；免打扰结束后发送仍未读的新消息。")
                }
                .readingSpaceEntrance(2)
                Button { Task { await save() } } label: {
                    AccountSettingsActionLabel(title: "保存设置", symbol: "checkmark", isWorking: operation == .save, prominent: true)
                }
                .accessibilityIdentifier("messages.settings.save")
            }
            if let error {
                AccountSettingsNote(error, isError: true)
                if form == nil {
                    Button { Task { await load() } } label: {
                        AccountSettingsActionLabel(title: "重新载入设置", symbol: "arrow.clockwise")
                    }
                }
            }
            if let message {
                AccountSettingsNote(message).accessibilityAddTraits(.updatesFrequently)
            }
            AccountSettingsSection("阅读提醒") {
                NavigationLink { MessageBookSubscriptionsView() } label: {
                    AccountSettingsActionLabel(title: "书架追更提醒", symbol: "books.vertical")
                }
                if let userID = appState.user?.id {
                    NavigationLink { ReadingReminderView(userID: userID).id(userID) } label: {
                        AccountSettingsActionLabel(title: "本机阅读提醒", symbol: "clock")
                    }
                    .accessibilityIdentifier("messages.settings.reminder")
                }
            }
            .readingSpaceEntrance(3)
            AccountSettingsSection("手机推送") {
                AccountSettingsNote("在 Safari 打开网页版，添加到主屏幕，再从主屏幕进入「消息中心 → 通知设置」开启推送。需要 iOS / iPadOS 16.4 或以上。通知点开后进入网页版。")
                AdminWebLink(title: "打开网页版通知设置", path: "/messages?settings=1")
                    .frame(minHeight: AppLayout.minimumTouchTarget, alignment: .leading)
            }
            .readingSpaceEntrance(4)
            AccountSettingsSection("接收设备") {
                ForEach(devices) { device in
                    AppAdaptiveRow {
                        VStack(alignment: .leading, spacing: 6) {
                            Text(device.name).foregroundStyle(ReadingSpace.ink)
                            if device.current { Text("当前设备").font(.footnote).foregroundStyle(ReadingSpace.profileMuted) }
                        }
                        Spacer(minLength: 8)
                        Button(role: .destructive) { Task { await remove(device.id) } } label: {
                            HStack {
                                if operation == .remove(device.id) { ProgressView() }
                                Text("移除")
                            }
                            .frame(minWidth: AppLayout.minimumTouchTarget, minHeight: AppLayout.minimumTouchTarget)
                            .contentShape(Rectangle())
                        }
                        .accessibilityLabel("移除接收设备：\(device.name)")
                    }
                }
                if devices.isEmpty && form != nil { AccountSettingsNote("还没有接收推送的设备。") }
            }
            .readingSpaceEntrance(5)
        }
        .disabled(busy)
        .navigationBarBackButtonHidden(isSavingChanges)
        .interactiveDismissDisabled(isSavingChanges)
        .task { if form == nil { await load() } }
    }
    private func binding<T>(_ path: WritableKeyPath<MessagePreferences, T>) -> Binding<T> {
        let fallback = form![keyPath: path]
        return Binding(get: { form?[keyPath: path] ?? fallback }, set: { form?[keyPath: path] = $0; message = nil })
    }
    private func load() async {
        guard !busy else { return }
        let owner = scope; operation = .load
        defer { if owner == scope { operation = nil } }
        do {
            let result: MessageConfiguration = try await APIClient.shared.get("/api/notifications/settings", auth: true)
            guard owner == scope, !Task.isCancelled else { return }
            form = result.settings; devices = result.devices; error = nil
        } catch { if owner == scope, !Task.isCancelled { self.error = AppCopy.friendlyError(error) } }
    }
    private func save() async {
        guard !busy, let form else { return }; let owner = scope; operation = .save; focusedField = nil; error = nil; message = nil
        defer { if owner == scope { operation = nil } }
        do {
            let response: MessagePreferencesResult = try await APIClient.shared.request("PUT", "/api/notifications/settings", body: JSONEncoder().encode(form), auth: true)
            guard owner == scope, !Task.isCancelled else { return }
            self.form = response.settings; message = "通知设置已保存"
        } catch { if owner == scope { self.error = AppCopy.friendlyError(error) } }
    }
    private func remove(_ id: String) async {
        guard !busy else { return }; let owner = scope; operation = .remove(id); error = nil
        defer { if owner == scope { operation = nil } }
        do {
            try await APIClient.shared.requestVoid("DELETE", "/api/notifications/subscriptions/" + ReaderMediaAPI.pathSegment(id), auth: true)
            guard owner == scope, !Task.isCancelled else { return }
            devices.removeAll { $0.id == id }
        } catch { if owner == scope { self.error = AppCopy.friendlyError(error) } }
    }
}
