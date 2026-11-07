import SwiftUI

struct AccountEmailView: View {
    let bindingEmail: Bool
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss
    @State private var identifier = ""
    @State private var password = ""
    @State private var busy = false
    @State private var message: String?
    @State private var errorMessage: String?
    @State private var challenge = AccountChallengeController()

    private struct Response: Decodable { let message: String }

    var body: some View {
        Form {
            if bindingEmail, let user = appState.user {
                Section("当前邮箱") {
                    Text(user.emailVerified == true ? (user.email ?? "已验证") : "尚未绑定已验证邮箱")
                }
            }
            Section {
                TextField(bindingEmail ? "邮箱地址" : "用户名或已验证邮箱", text: $identifier)
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                    .keyboardType(bindingEmail ? .emailAddress : .default)
                if bindingEmail {
                    SecureField("当前密码", text: $password).textContentType(.password)
                }
                Button(busy ? "发送中…" : bindingEmail ? "发送验证邮件" : "发送重置邮件") {
                    Task { await send() }
                }.disabled(busy || identifier.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || (bindingEmail && password.isEmpty))
            } footer: {
                Text(bindingEmail ? "新邮箱验证前，原邮箱保持有效。在邮件中打开网页确认后，需重新登录 App。" : "如果账号已绑定可用邮箱，你将收到密码重置链接。请在浏览器完成设置后返回 App 登录。")
            }
            if let message { Section { Text(message) } }
            if let errorMessage { Section { Text(errorMessage).foregroundStyle(AppTheme.danger) } }
        }
        .appListStyle(.settings)
        .disabled(busy)
        .navigationTitle(bindingEmail ? "邮箱与密码找回" : "找回密码")
        .navigationBarTitleDisplayMode(.inline)
        .interactiveDismissDisabled(busy)
        .toolbar {
            if !bindingEmail { ToolbarItem(placement: .cancellationAction) { Button("关闭") { dismiss() }.disabled(busy) } }
        }
        .onAppear { if bindingEmail { identifier = appState.user?.email ?? "" } }
        .sheet(isPresented: Binding(get: { challenge.action != nil }, set: { if !$0 { challenge.finish(nil) } })) {
            if let action = challenge.action { AccountChallengeSheet(action: action, finish: challenge.finish).disabled(false) }
        }
        .onDisappear { challenge.finish(nil) }
    }

    @MainActor private func send() async {
        guard !busy else { return }
        let owner = appState.user?.id
        busy = true; errorMessage = nil; message = nil
        defer { busy = false }
        do {
            let token = try await challenge.verify(bindingEmail ? "verify-email" : "forgot-password")
            guard !bindingEmail || appState.user?.id == owner else { return }
            var body = bindingEmail ? ["email": identifier.trimmingCharacters(in: .whitespacesAndNewlines), "currentPassword": password] : ["identifier": identifier.trimmingCharacters(in: .whitespacesAndNewlines)]
            if !token.isEmpty { body["turnstileToken"] = token }
            let response: Response = try await APIClient.shared.post(bindingEmail ? "/api/auth/email/request" : "/api/auth/forgot-password", body: JSONEncoder().encode(body), auth: bindingEmail)
            guard !bindingEmail || appState.user?.id == owner else { return }
            password = ""; message = response.message
        } catch is CancellationError { errorMessage = "已取消安全验证，输入已保留。" }
        catch { errorMessage = AppCopy.friendlyError(error) }
    }
}
