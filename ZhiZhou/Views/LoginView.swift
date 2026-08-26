import SwiftUI

/// 登录 / 注册（注册模式随服务端 register-status 动态切换）。
/// 参照 Apple Liquid Glass 规范：克制、内聚、层级清楚——品牌头部 + 分组玻璃表单 + 单一主操作。
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

    private var loginBackdrop: some View {
        ZStack {
            Color(.systemGroupedBackground)

            Circle()
                .fill(AppTheme.primary.opacity(0.12))
                .frame(width: 300, height: 300)
                .blur(radius: 72)
                .offset(x: 150, y: -280)

            Circle()
                .fill(AppTheme.primaryLight.opacity(0.28))
                .frame(width: 240, height: 240)
                .blur(radius: 64)
                .offset(x: -170, y: 320)
        }
        .ignoresSafeArea()
    }

    // MARK: - 品牌头部（留白、居中、克制）

    private var brandHeader: some View {
        VStack(spacing: 16) {
            Image(systemName: "book.closed.fill")
                .font(.system(size: 28, weight: .semibold))
                .foregroundStyle(AppTheme.primaryDeep)
                .frame(width: 78, height: 78)
                .glassEffect(
                    AppTheme.glassProminent,
                    in: RoundedRectangle(cornerRadius: 24, style: .continuous)
                )
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

    // MARK: - 账号操作（Liquid Glass 分组控件）

    private var modePicker: some View {
        GlassEffectContainer(spacing: 8) {
            HStack(spacing: 8) {
                modeButton("登录", for: .login)
                modeButton("注册", for: .register)
            }
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
            Text(title)
                .font(.body.weight(selected ? .semibold : .regular))
                .foregroundStyle(selected ? AppTheme.textPrimary : AppTheme.textSecondary)
                .frame(maxWidth: .infinity)
                .frame(minHeight: 46)
        }
        .buttonStyle(.glass(selected ? AppTheme.glass : AppTheme.glassClear))
        .accessibilityAddTraits(selected ? [.isSelected] : [])
        .accessibilityLabel(title)
    }

    // MARK: - Liquid Glass 分组表单

    private var fieldsGroup: some View {
        GlassEffectContainer(spacing: 8) {
            VStack(spacing: 8) {
                usernameField

                if mode == .register, registerMode == .invite {
                    inviteField
                }

                passwordField
            }
        }
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
        .glassEffect(AppTheme.glassClear, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
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
        .frame(minHeight: 54)
        .glassEffect(AppTheme.glassClear, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
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
            .buttonStyle(.glass(AppTheme.glassClear))
            .accessibilityLabel(showPassword ? "隐藏密码" : "显示密码")
        }
        .padding(.leading, 16)
        .padding(.trailing, 4)
        .frame(minHeight: 54)
        .glassEffect(AppTheme.glassClear, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    // MARK: - 主操作（唯一、明显、对比安全）

    private var submitButton: some View {
        Button {
            Task { await submit() }
        } label: {
            Group {
                if busy {
                    ProgressView()
                        .tint(AppTheme.primaryDeep)
                } else {
                    Text(mode == .login ? "登录" : "注册")
                        .font(.headline)
                }
            }
            .foregroundStyle(AppTheme.primaryDeep)
            .frame(maxWidth: .infinity)
            .frame(minHeight: 54)
        }
        .buttonStyle(.glass(AppTheme.glassProminent))
        .tint(AppTheme.primary)
        .disabled(!canSubmit)
        .accessibilityLabel(mode == .login ? "登录" : "注册")
    }

    private var registerClosedNote: some View {
        Text("当前站点注册已关闭")
            .font(.footnote)
            .foregroundStyle(AppTheme.textSecondary)
            .frame(maxWidth: .infinity, minHeight: 44)
            .glassEffect(AppTheme.glassClear, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
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
            .glassEffect(
                .clear.tint(AppTheme.danger.opacity(0.12)),
                in: RoundedRectangle(cornerRadius: 18, style: .continuous)
            )
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
