import SwiftUI

/// 登录 / 注册（注册模式随服务端 register-status 动态切换）。
/// 采用浅色、原生感的账号入口：品牌识别、清晰说明、胶囊输入与单一主操作。
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
    @State private var interactionFeedback = 0
    @FocusState private var focusedField: Field?

    enum Mode: Hashable { case login, register }
    enum RegisterMode: String { case open, invite, closed }
    private enum Field: Hashable { case username, invite, password }

    var body: some View {
        GeometryReader { proxy in
            ZStack {
                loginBackdrop

                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        brandHeader

                        accountSwitch
                            .padding(.top, 28)
                            .padding(.bottom, 18)

                        fieldsGroup

                        if mode != .register || registerMode != .closed {
                            submitButton
                                .padding(.top, 16)
                        }

                        if mode == .register && registerMode == .closed {
                            registerClosedNote
                                .padding(.top, 16)
                        }

                        statusLine
                            .padding(.top, 16)

                        Spacer(minLength: 24)

                        syncNote
                    }
                    .padding(.horizontal, 24)
                    .padding(.vertical, 20)
                    .frame(maxWidth: 460)
                    .frame(maxWidth: .infinity, minHeight: proxy.size.height, alignment: .top)
                }
                .scrollDismissesKeyboard(.interactively)
                .scrollBounceBehavior(.basedOnSize)
            }
        }
        .task { await fetchRegisterStatus() }
        .sensoryFeedback(.selection, trigger: interactionFeedback)
    }

    private var loginBackdrop: some View {
        AppTheme.background
            .ignoresSafeArea()
    }

    // MARK: - 品牌头部

    private var brandHeader: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                Image(systemName: "book.closed.fill")
                    .font(.system(size: 21, weight: .semibold))
                    .symbolRenderingMode(.hierarchical)
                    .foregroundStyle(AppTheme.primary)
                    .frame(width: 48, height: 48)
                    .background(AppTheme.primaryLight, in: RoundedRectangle(cornerRadius: 15, style: .continuous))
                    .accessibilityHidden(true)

                Text("知舟")
                    .font(serifFont(.title2, .bold))
                    .foregroundStyle(AppTheme.textPrimary)
                    .accessibilityAddTraits(.isHeader)
            }

            Text(mode == .login ? "登录知舟" : "创建知舟账号")
                .font(.system(size: 34, weight: .bold, design: .rounded))
                .foregroundStyle(AppTheme.textPrimary)
                .padding(.top, 14)

            Text(mode == .login
                 ? "登录后即可同步你的书架与阅读进度。"
                 : "创建账号，开始同步你的书架与阅读进度。")
                .font(.title3)
                .foregroundStyle(AppTheme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: - 账号切换

    private var accountSwitch: some View {
        Group {
            if registerMode != .closed {
                HStack(spacing: 4) {
                    Text(mode == .login ? "还没有账号？" : "已经有账号？")
                        .foregroundStyle(AppTheme.textSecondary)

                    Button(mode == .login ? "注册" : "登录") {
                        interactionFeedback &+= 1
                        switchMode()
                    }
                    .fontWeight(.semibold)
                    .foregroundStyle(AppTheme.primary)
                    .buttonStyle(ScaleButtonStyle(pressedScale: 0.96))
                }
                .font(.subheadline)
                .frame(minHeight: 44)
                .accessibilityElement(children: .contain)
            }
        }
    }

    private func switchMode() {
        withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.2)) {
            mode = mode == .login ? .register : .login
            errorMessage = nil
            focusedField = nil
        }
    }

    // MARK: - 输入

    private var fieldsGroup: some View {
        VStack(spacing: 12) {
            fieldSurface {
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

            if mode == .register, registerMode == .invite {
                fieldSurface {
                    TextField("邀请码", text: $invite)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .submitLabel(.next)
                        .focused($focusedField, equals: .invite)
                        .onSubmit { focusedField = .password }
                        .foregroundStyle(AppTheme.textPrimary)
                        .tint(AppTheme.primary)
                }
            }

            fieldSurface {
                HStack(spacing: 10) {
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
                        interactionFeedback &+= 1
                    } label: {
                        Image(systemName: showPassword ? "eye.slash" : "eye")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(AppTheme.textSecondary)
                            .frame(width: 36, height: 36)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(ScaleButtonStyle(pressedScale: 0.92))
                    .accessibilityLabel(showPassword ? "隐藏密码" : "显示密码")
                }
            }
        }
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.2), value: mode)
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.2), value: registerMode)
    }

    private func fieldSurface<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        content()
            .padding(.horizontal, 18)
            .frame(minHeight: 58)
            .background(
                Color(.tertiarySystemFill),
                in: RoundedRectangle(cornerRadius: 17, style: .continuous)
            )
            .overlay {
                RoundedRectangle(cornerRadius: 17, style: .continuous)
                    .strokeBorder(AppTheme.border.opacity(0.28), lineWidth: 0.7)
            }
    }

    // MARK: - 主操作

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
            .foregroundStyle(canSubmit || busy ? Color.white : AppTheme.textMuted)
            .frame(maxWidth: .infinity)
            .frame(minHeight: 56)
            .background(
                canSubmit || busy
                    ? AppTheme.deepGradient
                    : LinearGradient(
                        colors: [Color(.systemFill), Color(.systemFill)],
                        startPoint: .top,
                        endPoint: .bottom
                    ),
                in: RoundedRectangle(cornerRadius: 18, style: .continuous)
            )
        }
        .buttonStyle(ScaleButtonStyle())
        .disabled(!canSubmit)
        .accessibilityLabel(mode == .login ? "登录" : "注册")
    }

    private var syncNote: some View {
        VStack(alignment: .leading, spacing: 10) {
            Image(systemName: "arrow.triangle.2.circlepath")
                .font(.system(size: 26, weight: .semibold))
                .foregroundStyle(AppTheme.primary)
                .accessibilityHidden(true)

            Text(mode == .login ? "登录后同步书架与阅读进度。" : "注册后同步书架与阅读进度。")
                .font(.footnote)
                .foregroundStyle(AppTheme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.top, 42)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var registerClosedNote: some View {
        Label("当前站点注册已关闭", systemImage: "lock.fill")
            .font(.footnote)
            .foregroundStyle(AppTheme.textSecondary)
            .frame(maxWidth: .infinity, minHeight: 48)
            .background(
                Color(.tertiarySystemFill),
                in: RoundedRectangle(cornerRadius: 16, style: .continuous)
            )
    }

    @ViewBuilder
    private var statusLine: some View {
        if appState.sessionRestoreFailed || errorMessage != nil {
            VStack(alignment: .leading, spacing: 8) {
                if appState.sessionRestoreFailed {
                    Label("网络异常，未能恢复上次会话，请检查网络后重新登录", systemImage: "wifi.slash")
                        .foregroundStyle(AppTheme.warning)
                }

                if let errorMessage {
                    Text(errorMessage)
                        .foregroundStyle(AppTheme.danger)
                        .accessibilityAddTraits(.updatesFrequently)
                }
            }
            .font(.footnote)
            .multilineTextAlignment(.leading)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .background(AppTheme.danger.opacity(0.09), in: RoundedRectangle(cornerRadius: 15, style: .continuous))
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
            AppFeedback.success()
        } catch {
            AppFeedback.error()
            errorMessage = AppCopy.friendlyError(error)
        }
    }
}
