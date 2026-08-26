import SwiftUI

/// 登录 / 注册（注册模式随服务端 register-status 动态切换）。
/// 登录是一个安静的工具页：不用装饰性玻璃，只保留品牌、输入与主操作三层。
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
            loginBackdrop

            ScrollView {
                VStack(spacing: 0) {
                    brandHeader
                        .padding(.top, 52)
                        .padding(.bottom, 32)

                    modePicker
                        .padding(.bottom, 20)

                    fieldsGroup
                        .padding(.bottom, 24)

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
                .padding(.horizontal, 28)
                .padding(.bottom, 32)
                .frame(maxWidth: 420)
                .frame(maxWidth: .infinity)
            }
            .scrollDismissesKeyboard(.interactively)
            .scrollBounceBehavior(.basedOnSize)
        }
        .task { await fetchRegisterStatus() }
    }

    private var loginBackdrop: some View {
        Color(.systemGroupedBackground)
            .ignoresSafeArea()
    }

    // MARK: - 品牌头部

    private var brandHeader: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                Image(systemName: "book.closed.fill")
                    .font(.system(size: 25, weight: .semibold))
                    .symbolRenderingMode(.hierarchical)
                    .foregroundStyle(AppTheme.primary)
                    .accessibilityHidden(true)

                Text("知舟")
                    .font(serifFont(.largeTitle, .bold))
                    .foregroundStyle(AppTheme.textPrimary)
                    .accessibilityAddTraits(.isHeader)
            }

            Text("登录后可同步书架与阅读进度")
                .font(.callout)
                .foregroundStyle(AppTheme.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: - 账号操作

    private var modePicker: some View {
        HStack(spacing: 28) {
            modeButton("登录", for: .login)
            modeButton("注册", for: .register)
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("账号操作")
    }

    private func modeButton(_ title: String, for targetMode: Mode) -> some View {
        let selected = mode == targetMode
        return Button {
            guard mode != targetMode else { return }
            withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.2)) {
                mode = targetMode
            }
        } label: {
            VStack(spacing: 7) {
                Text(title)
                    .font(.body.weight(selected ? .semibold : .regular))
                    .foregroundStyle(selected ? AppTheme.textPrimary : AppTheme.textSecondary)

                Capsule()
                    .fill(selected ? AppTheme.primary : Color.clear)
                    .frame(width: 24, height: 2)
            }
            .frame(minWidth: 44, minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? [.isSelected] : [])
        .accessibilityLabel(title)
    }

    // MARK: - 单层分组表单

    private var fieldsGroup: some View {
        VStack(spacing: 0) {
            usernameField

            if mode == .register, registerMode == .invite {
                fieldDivider
                inviteField
            }

            fieldDivider
            passwordField
        }
        .background(AppTheme.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.2), value: mode)
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.2), value: registerMode)
    }

    private var fieldDivider: some View {
        Divider()
            .overlay(AppTheme.border.opacity(0.55))
            .padding(.leading, 52)
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
        .frame(minHeight: 58)
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
                .submitLabel(.next)
                .focused($focusedField, equals: .invite)
                .onSubmit { focusedField = .password }
                .foregroundStyle(AppTheme.textPrimary)
                .tint(AppTheme.primary)
        }
        .padding(.horizontal, 16)
        .frame(minHeight: 58)
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
        .padding(.trailing, 8)
        .frame(minHeight: 58)
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
                }
            }
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity)
            .frame(minHeight: 54)
            .background(AppTheme.deepGradient, in: RoundedRectangle(cornerRadius: 15, style: .continuous))
        }
        .buttonStyle(ScaleButtonStyle())
        .opacity(canSubmit || busy ? 1 : 0.42)
        .disabled(!canSubmit)
        .accessibilityLabel(mode == .login ? "登录" : "注册")
    }

    private var registerClosedNote: some View {
        Label("当前站点注册已关闭", systemImage: "lock.fill")
            .font(.footnote)
            .foregroundStyle(AppTheme.textSecondary)
            .frame(maxWidth: .infinity, minHeight: 48)
            .background(AppTheme.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    @ViewBuilder
    private var statusLine: some View {
        if appState.sessionRestoreFailed || errorMessage != nil {
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
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .background(AppTheme.danger.opacity(0.09), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
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
