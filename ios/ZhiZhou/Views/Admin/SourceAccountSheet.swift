import SwiftUI
import UIKit

/// 已安装书源的登录与会话管理。
struct SourceAccountSheet: View {
    let source: ScrapeSourceCapability
    @Environment(\.dismiss) private var dismiss

    @State private var status: SourceAccountStatus?
    @State private var username = ""
    @State private var password = ""
    @State private var sessionCookie = ""
    @State private var captchaText = ""
    @State private var challenge: SourceAccountCaptcha?
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var showClearConfirmation = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    LabeledContent("当前状态") {
                        Text(statusText)
                            .foregroundStyle(statusColor)
                    }
                    if let status {
                        LabeledContent("账号", value: status.username.isEmpty ? "未配置" : status.username)
                        LabeledContent("密码", value: status.hasPassword ? "已保存" : "未保存")
                        LabeledContent("Cookie", value: status.hasSession ? "已保存" : "未保存")
                        if !status.lastError.isEmpty {
                            Text(status.lastError)
                                .font(.footnote)
                                .foregroundStyle(AppTheme.danger)
                        }
                    }
                } header: {
                    Text("\(source.name) 账号")
                } footer: {
                    Text("密码和 Cookie 仅在服务端加密保存，不会回显。")
                }

                Section("账号登录") {
                    TextField("\(source.name) 登录账号", text: $username)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    SecureField(status?.hasPassword == true ? "留空表示保持原密码" : "\(source.name) 登录密码", text: $password)
                    Button("保存账号") { Task { await saveAccount() } }
                        .disabled(isLoading || username.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    Button("获取验证码") { Task { await loadCaptcha() } }
                        .disabled(isLoading)

                    if let challenge {
                        if let image = captchaImage(challenge.imageDataUrl) {
                            image
                                .resizable()
                                .scaledToFit()
                                .frame(height: 44)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        } else if challenge.captchaRequired {
                            Text("当前登录页需要验证码，请使用浏览器 Cookie 方式。")
                                .font(.footnote)
                                .foregroundStyle(AppTheme.warning)
                        }
                        if challenge.captchaRequired {
                            TextField("验证码", text: $captchaText)
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled()
                        }
                        Button("提交登录") { Task { await login() } }
                            .disabled(isLoading || (challenge.captchaRequired && captchaText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty))
                    }
                }

                Section {
                    TextEditor(text: $sessionCookie)
                        .frame(minHeight: 90)
                        .font(.footnote)
                    Button("加密保存 Cookie") { Task { await saveCookie() } }
                        .disabled(isLoading || sessionCookie.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || username.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                } header: {
                    Text("浏览器 Cookie 兜底")
                } footer: {
                    Text("在浏览器登录 \(source.name) 后，将会话 Cookie 粘贴到这里。")
                }

                Section {
                    Button("测试当前会话") { Task { await testSession() } }
                        .disabled(isLoading || status?.hasSession != true)
                    Button("清除 \(source.name) 账号", role: .destructive) { showClearConfirmation = true }
                        .disabled(isLoading || status?.configured != true)
                }
            }
            .scrollContentBackground(.hidden)
            .appListStyle(.settings)
            .navigationTitle("\(source.name) 账号")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("关闭") { dismiss() }
                }
            }
            .task { await loadStatus() }
            .overlay {
                if isLoading {
                    ProgressView()
                        .padding(18)
                        .appMaterialBackground(
                            .regularMaterial,
                            fallback: AppTheme.surface,
                            in: RoundedRectangle(cornerRadius: AppTheme.cardCornerRadius, style: .continuous)
                        )
                }
            }
            .alert("操作未完成", isPresented: Binding(
                get: { errorMessage != nil },
                set: { if !$0 { errorMessage = nil } }
            )) {
                Button("好", role: .cancel) {}
            } message: {
                Text(errorMessage ?? "")
            }
            .confirmationDialog("清除 \(source.name) 账号？", isPresented: $showClearConfirmation, titleVisibility: .visible) {
                Button("清除账号", role: .destructive) { Task { await clearAccount() } }
                Button("取消", role: .cancel) {}
            } message: {
                Text("账号、密码和 Cookie 都会从服务端删除。")
            }
        }
    }

    private var statusText: String {
        switch status?.status {
        case "authenticated": return "会话可用"
        case "session_saved": return "会话已保存"
        case "credentials_saved": return "账号已保存"
        case "invalid": return "会话已失效"
        case "needs_captcha": return "需要重新验证"
        case "error": return "状态异常"
        default: return "未配置"
        }
    }

    private var statusColor: Color {
        switch status?.status {
        case "authenticated", "session_saved": return AppTheme.success
        case "invalid", "error": return AppTheme.danger
        case "needs_captcha", "credentials_saved": return AppTheme.warning
        default: return AppTheme.textSecondary
        }
    }

    private func loadStatus() async {
        isLoading = true
        defer { isLoading = false }
        do {
            let next = try await AdminAPI.sourceAccount(sourceId: source.id)
            status = next
            if !next.username.isEmpty { username = next.username }
        } catch {
            errorMessage = AppCopy.friendlyError(error)
        }
    }

    private func saveAccount() async {
        let name = username.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            status = try await AdminAPI.saveSourceAccount(sourceId: source.id, username: name, password: password.trimmingCharacters(in: .whitespacesAndNewlines))
            password = ""
            errorMessage = nil
        } catch {
            errorMessage = AppCopy.friendlyError(error)
        }
    }

    private func saveCookie() async {
        let name = username.trimmingCharacters(in: .whitespacesAndNewlines)
        let cookie = sessionCookie.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, !cookie.isEmpty else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            status = try await AdminAPI.saveSourceAccount(sourceId: source.id, username: name, sessionCookie: cookie)
            sessionCookie = ""
            errorMessage = nil
        } catch {
            errorMessage = AppCopy.friendlyError(error)
        }
    }

    private func loadCaptcha() async {
        isLoading = true
        defer { isLoading = false }
        do {
            challenge = try await AdminAPI.sourceAccountCaptcha(sourceId: source.id)
            captchaText = ""
            errorMessage = nil
        } catch {
            errorMessage = AppCopy.friendlyError(error)
        }
    }

    private func login() async {
        guard let challenge else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            let result = try await AdminAPI.sourceAccountLogin(sourceId: source.id, challengeId: challenge.challengeId, captcha: captchaText)
            status = accountStatus(from: result)
            self.challenge = nil
            captchaText = ""
            errorMessage = nil
        } catch {
            errorMessage = AppCopy.friendlyError(error)
        }
    }

    private func testSession() async {
        isLoading = true
        defer { isLoading = false }
        do {
            status = accountStatus(from: try await AdminAPI.testSourceAccount(sourceId: source.id))
            errorMessage = nil
        } catch {
            errorMessage = AppCopy.friendlyError(error)
            status = try? await AdminAPI.sourceAccount(sourceId: source.id)
        }
    }

    private func clearAccount() async {
        isLoading = true
        defer { isLoading = false }
        do {
            try await AdminAPI.clearSourceAccount(sourceId: source.id)
            status = nil
            username = ""
            password = ""
            sessionCookie = ""
            challenge = nil
            errorMessage = nil
        } catch {
            errorMessage = AppCopy.friendlyError(error)
        }
    }

    private func accountStatus(from response: SourceAccountLogin) -> SourceAccountStatus {
        SourceAccountStatus(
            site: response.site,
            username: response.username,
            configured: response.configured,
            hasPassword: response.hasPassword,
            hasSession: response.hasSession,
            status: response.status,
            lastLoginAt: response.lastLoginAt,
            lastCheckedAt: response.lastCheckedAt,
            lastError: response.lastError
        )
    }

    private func captchaImage(_ value: String) -> Image? {
        guard let comma = value.firstIndex(of: ","), let data = Data(base64Encoded: String(value[value.index(after: comma)...])), let image = UIImage(data: data) else { return nil }
        return Image(uiImage: image)
    }
}
