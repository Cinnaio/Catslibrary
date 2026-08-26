import SwiftUI

/// 登录 / 注册（注册模式随服务端 register-status 动态切换）。
/// 参照 Apple 登录页规范：克制、内聚、层级清楚——品牌头部 + 系统内嵌分组表单 + 单一主操作。
struct LoginView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var mode: Mode = .login
    @State private var username = ""
    @State private var password = ""
    @State private var invite = ""
    @State private var showPassword = false
    @State private var registerMode: RegisterMode = .invite
    @State private var busy = false
    @State private var errorMessage: String?
    @FocusState private var focusedField: Field?

    enum Mode: Hashable { case login, register }
    enum RegisterMode: String { case open, invite, closed }
    private enum Field: Hashable { case username, invite, password }

    var body: some View {
        ZStack {
            Color(.systemGroupedBackground).ignoresSafeArea()

            ScrollView {
                VStack(spacing: 0) {
                    brandHeader
                        .padding(.top, 24)
                        .padding(.bottom, 28)

                    modePicker
                        .padding(.bottom, 16)

                    fieldsGroup
                        .padding(.bottom, 20)

                    if mode != .register || registerMode != .closed {
                        submitButton
                    }

                    if mode == .register && registerMode == .closed {
                        registerClosedNote
                            .padding(.top, 20)
                    }

                    statusLine
                        .padding(.top, 16)
                }
                .padding(.horizontal, 24)
                .padding(.bottom, 28)
                .frame(maxWidth: 420)
                .frame(maxWidth: .infinity)
            }
            .scrollDismissesKeyboard(.interactively)
            .scrollBounceBehavior(.basedOnSize)
        }
        .task { await fetchRegisterStatus() }
    }

    // MARK: - 品牌头部（留白、居中、克制）

    private var brandHeader: some View {
        VStack(spacing: 16) {
            BrandMark()
            .accessibilityHidden(true)

            Text("知舟")
                .font(serifFont(.largeTitle, .bold))
                .foregroundStyle(AppTheme.textPrimary)
                .accessibilityAddTraits(.isHeader)

            Text("登录后可同步书架与阅读进度")
                .font(.subheadline)
                .foregroundStyle(AppTheme.textSecondary)
                .multilineTextAlignment(.center)
        }
    }

    // MARK: - 账号操作（系统分段控件）

    private var modePicker: some View {
        Picker("账号操作", selection: $mode) {
            Text("登录").tag(Mode.login)
            Text("注册").tag(Mode.register)
        }
        .pickerStyle(.segmented)
    }

    // MARK: - 系统内嵌分组表单（inset-grouped 手感的输入区）

    private var fieldsGroup: some View {
        VStack(spacing: 0) {
            usernameField

            if mode == .register {
                if registerMode == .invite {
                    fieldDivider
                    inviteField
                }
            }

            fieldDivider
            passwordField
        }
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(AppTheme.surface)
        )
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(AppTheme.border.opacity(0.7), lineWidth: 0.5)
        )
        .shadow(color: .black.opacity(0.05), radius: 8, y: 3)
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.2), value: mode)
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.2), value: registerMode)
    }

    private var usernameField: some View {
        HStack(spacing: 12) {
            Image(systemName: "person.fill")
                .font(.subheadline)
                .foregroundStyle(AppTheme.textSecondary)
                .frame(width: 24)
                .accessibilityHidden(true)

            TextField("用户名", text: $username)
                .textContentType(.username)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.next)
                .focused($focusedField, equals: .username)
                .onSubmit {
                    focusedField = mode == .register && registerMode == .invite ? .invite : .password
                }
                .foregroundStyle(AppTheme.textPrimary)
                .tint(AppTheme.primary)
        }
        .padding(.horizontal, 16)
        .frame(minHeight: 54)
    }

    private var inviteField: some View {
        HStack(spacing: 12) {
            Image(systemName: "key.fill")
                .font(.subheadline)
                .foregroundStyle(AppTheme.textSecondary)
                .frame(width: 24)
                .accessibilityHidden(true)

            TextField("邀请码", text: $invite)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.go)
                .focused($focusedField, equals: .invite)
                .onSubmit { focusedField = .password }
                .foregroundStyle(AppTheme.textPrimary)
                .tint(AppTheme.primary)
        }
        .padding(.horizontal, 16)
        .frame(minHeight: 54)
    }

    private var passwordField: some View {
        HStack(spacing: 12) {
            Image(systemName: "lock.fill")
                .font(.subheadline)
                .foregroundStyle(AppTheme.textSecondary)
                .frame(width: 24)
                .accessibilityHidden(true)

            Group {
                if showPassword {
                    TextField("密码", text: $password)
                        .focused($focusedField, equals: .password)
                        .onSubmit { Task { await submit() } }
                } else {
                    SecureField("密码", text: $password)
                        .focused($focusedField, equals: .password)
                        .onSubmit { Task { await submit() } }
                }
            }
            .textContentType(mode == .register ? .newPassword : .password)
            .submitLabel(.go)
            .foregroundStyle(AppTheme.textPrimary)
            .tint(AppTheme.primary)

            Button {
                showPassword.toggle()
            } label: {
                Image(systemName: showPassword ? "eye.slash.fill" : "eye.fill")
                    .font(.footnote)
                    .foregroundStyle(AppTheme.textSecondary)
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(showPassword ? "隐藏密码" : "显示密码")
        }
        .padding(.leading, 16)
        .padding(.trailing, 4)
        .frame(minHeight: 54)
    }

    private var fieldDivider: some View {
        Divider()
            .padding(.leading, 52)
    }

    // MARK: - 主操作（唯一、明显、对比安全）

    private var submitButton: some View {
        Button {
            Task { await submit() }
        } label: {
            Group {
                if busy {
                    ProgressView()
                        .tint(.white)
                } else {
                    Text(mode == .login ? "登录" : "注册")
                        .font(.headline)
                        .foregroundStyle(.white)
                }
            }
            .frame(maxWidth: .infinity)
            .frame(minHeight: 54)
            .background(
                AppTheme.deepGradient,
                in: RoundedRectangle(cornerRadius: 14, style: .continuous)
            )
        }
        .buttonStyle(ScaleButtonStyle())
        .disabled(!canSubmit)
        .opacity(canSubmit ? 1 : 0.5)
        .shadow(color: .black.opacity(canSubmit ? 0.12 : 0), radius: 10, y: 5)
        .accessibilityLabel(mode == .login ? "登录" : "注册")
    }

    private var registerClosedNote: some View {
        Text("当前站点注册已关闭")
            .font(.footnote)
            .foregroundStyle(AppTheme.textSecondary)
            .frame(maxWidth: .infinity, minHeight: 44)
    }

    private var statusLine: some View {
        VStack(spacing: 10) {
            if appState.sessionRestoreFailed {
                Label("网络异常，未能恢复上次会话，请检查网络后重新登录", systemImage: "wifi.slash")
                    .font(.footnote)
                    .foregroundStyle(AppTheme.warning)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
            }

            if let errorMessage {
                Text(errorMessage)
                    .font(.footnote)
                    .foregroundStyle(AppTheme.danger)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
                    .accessibilityAddTraits(.updatesFrequently)
            }
        }
    }

    // MARK: - 逻辑

    private var canSubmit: Bool {
        guard !busy, !username.trimmingCharacters(in: .whitespaces).isEmpty else { return false }
        if mode == .register {
            if registerMode == .closed { return false }
            if registerMode == .invite, invite.trimmingCharacters(in: .whitespaces).isEmpty { return false }
            return password.count >= 8
        }
        return !password.isEmpty
    }

    private func fetchRegisterStatus() async {
        if let r: RegisterStatusResponse = try? await APIClient.shared.get("/api/auth/register-status") {
            registerMode = RegisterMode(rawValue: r.mode) ?? .invite
            if registerMode == .closed, mode == .register { mode = .login }
        }
    }

    private func submit() async {
        guard canSubmit else {
            if mode == .register, password.count < 8 {
                errorMessage = "密码至少 8 位"
            } else if mode == .register, registerMode == .invite, invite.trimmingCharacters(in: .whitespaces).isEmpty {
                errorMessage = "请填写邀请码"
            }
            return
        }
        busy = true
        defer { busy = false }
        errorMessage = nil
        do {
            if mode == .login {
                try await appState.login(username: username, password: password)
            } else {
                try await appState.register(username: username, password: password, invite: invite)
            }
        } catch {
            errorMessage = AppCopy.friendlyError(error)
        }
    }
}
