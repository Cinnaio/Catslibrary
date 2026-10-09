import SwiftUI

private struct AccountSession: Decodable, Identifiable {
    let id: String
    let deviceName: String
    let createdAt: Int64
    let expiresAt: Int64
    let current: Bool
}

private struct AccountSessionsResponse: Decodable {
    let sessions: [AccountSession]
}

struct AccountSessionsView: View {
    @Environment(AppState.self) private var appState
    @State private var sessions: [AccountSession] = []
    @State private var loading = false
    @State private var busy = false
    @State private var error: String?
    @State private var pendingRemoval: AccountSession?
    @State private var confirmAll = false
    @State private var requestID = UUID()

    var body: some View {
        List {
            if let error {
                LoadErrorNotice(message: error, isLoading: loading) { Task { await load() } }
            }
            if loading && sessions.isEmpty { ProgressView("加载登录设备…") }
            if busy { ProgressView("正在更新登录设备…") }
            Section("已登录的设备") {
                ForEach(sessions) { session in
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text(session.deviceName.isEmpty ? "未知设备" : session.deviceName)
                            if session.current { Text("当前设备").font(.caption).foregroundStyle(AppTheme.primary) }
                        }
                        Text("登录于 \(Date(timeIntervalSince1970: Double(session.createdAt) / 1000).formatted(date: .abbreviated, time: .shortened))")
                            .font(.footnote).foregroundStyle(.secondary)
                        if !session.current {
                            Button("退出此设备", role: .destructive) { pendingRemoval = session }
                                .frame(minHeight: AppLayout.minimumTouchTarget)
                                .accessibilityIdentifier("sessions.remove.\(session.id)")
                        }
                    }
                }
            }
            Section {
                Button("退出所有设备", role: .destructive) { confirmAll = true }
                    .disabled(sessions.isEmpty)
                    .accessibilityIdentifier("sessions.logoutAll")
            } footer: {
                Text("退出所有设备也会退出当前设备。重新使用时需要登录。")
            }
        }
        .appListStyle(.settings)
        .navigationTitle("登录设备")
        .navigationBarTitleDisplayMode(.inline)
        .disabled(busy)
        .task(id: ContentAccessStore.shared.accountRevision) { sessions = []; await load() }
        .refreshable { await load() }
        .confirmationDialog("退出此设备？", isPresented: Binding(
            get: { pendingRemoval != nil }, set: { if !$0 { pendingRemoval = nil } }
        ), titleVisibility: .visible, presenting: pendingRemoval) { session in
            Button("退出此设备", role: .destructive) { Task { await remove(session) } }
            Button("取消", role: .cancel) {}
        }
        .confirmationDialog("退出所有设备？", isPresented: $confirmAll, titleVisibility: .visible) {
            Button("退出所有设备", role: .destructive) {
                busy = true
                Task {
                    defer { busy = false }
                    do { try await appState.logoutAll() }
                    catch { self.error = AppCopy.friendlyError(error) }
                }
            }
            Button("取消", role: .cancel) {}
        }
    }

    private func load() async {
        guard !busy else { return }
        let id = UUID()
        requestID = id
        guard let token = APIClient.shared.token else { sessions = []; return }
        loading = true
        defer { if requestID == id { loading = false } }
        do {
            let response: AccountSessionsResponse = try await APIClient.shared.request(
                "GET", "/api/auth/sessions", auth: true, expectedToken: token
            )
            guard !Task.isCancelled, requestID == id, APIClient.shared.token == token else { return }
            sessions = response.sessions
            error = nil
        } catch {
            guard !Task.isCancelled, requestID == id, APIClient.shared.token == token else { return }
            self.error = AppCopy.friendlyError(error)
        }
    }

    private func remove(_ session: AccountSession) async {
        guard !busy, !session.current, let token = APIClient.shared.token else { return }
        requestID = UUID()
        loading = false
        busy = true
        defer { busy = false }
        do {
            let _: EmptyResponse = try await APIClient.shared.request(
                "DELETE", "/api/auth/sessions?" + HomeView.query(["id": session.id]),
                auth: true, expectedToken: token
            )
            guard APIClient.shared.token == token else { return }
            sessions.removeAll { $0.id == session.id }
            error = nil
        } catch {
            guard APIClient.shared.token == token else { return }
            self.error = AppCopy.friendlyError(error)
        }
    }
}
