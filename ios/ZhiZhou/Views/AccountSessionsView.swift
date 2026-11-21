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
    @State private var removingSessionID: String?
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        AccountSettingsList {
            AccountSettingsHeading("管理登录设备", detail: "查看账号的登录会话，退出不再使用的设备。")
                .padding(.bottom, 28)

            if let error {
                VStack(alignment: .leading, spacing: 8) {
                    AccountSettingsNote(error, isError: true)
                    Button { Task { await load() } } label: {
                        AccountSettingsActionLabel(title: "重新加载", symbol: "arrow.clockwise", isWorking: loading)
                    }
                    .disabled(loading)
                }
                .padding(.bottom, 20)
            }
            if loading && sessions.isEmpty && error == nil {
                ProgressView("加载登录设备…")
                    .font(.footnote)
                    .foregroundStyle(ReadingSpace.profileMuted)
                    .padding(.vertical, 16)
            } else if !loading && sessions.isEmpty && error == nil {
                AccountSettingsNote("暂无可显示的登录设备，下拉可重新读取。")
                    .padding(.vertical, 16)
            }

            ForEach(Array(sessions.enumerated()), id: \.element.id) { index, session in
                sessionRow(session)
                    .readingSpaceEntrance(index)
            }

            VStack(alignment: .leading, spacing: 8) {
                Button(role: .destructive) { confirmAll = true } label: {
                    AccountSettingsActionLabel(
                        title: "退出所有设备", symbol: "rectangle.portrait.and.arrow.right",
                        isWorking: busy && removingSessionID == nil, destructive: true
                    )
                }
                .disabled(sessions.isEmpty)
                .accessibilityIdentifier("sessions.logoutAll")
                AccountSettingsNote("退出所有设备也会退出当前设备。重新使用时需要登录。")
            }
            .padding(.top, 28)
        }
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

    private func sessionRow(_ session: AccountSession) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            let heading = dynamicTypeSize >= .xxxLarge
                ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8))
                : AnyLayout(HStackLayout(alignment: .firstTextBaseline, spacing: 12))
            heading {
                Text(session.deviceName.isEmpty ? "未知设备" : session.deviceName)
                    .font(.body.weight(.medium))
                    .foregroundStyle(ReadingSpace.ink)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if session.current {
                    Label("当前设备", systemImage: "checkmark.circle")
                        .font(.caption)
                        .foregroundStyle(AppTheme.primary)
                }
            }
            .fixedSize(horizontal: false, vertical: true)
            AccountSettingsNote("登录于 \(Date(timeIntervalSince1970: Double(session.createdAt) / 1000).formatted(date: .abbreviated, time: .shortened))")
            if !session.current {
                Button(role: .destructive) { pendingRemoval = session } label: {
                    AccountSettingsActionLabel(
                        title: "退出此设备", symbol: "rectangle.portrait.and.arrow.right",
                        isWorking: removingSessionID == session.id, destructive: true
                    )
                }
                .accessibilityIdentifier("sessions.remove.\(session.id)")
            }
        }
        .padding(.vertical, 16)
        .overlay(alignment: .bottom) { ReadingSpace.profileLine.frame(height: 0.5).accessibilityHidden(true) }
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
        removingSessionID = session.id
        defer { busy = false; removingSessionID = nil }
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
