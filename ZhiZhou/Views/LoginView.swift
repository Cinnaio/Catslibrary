import SwiftUI

/// 登录 / 注册（注册模式随服务端 register-status 动态切换）。
struct LoginView: View {
    @EnvironmentObject private var appState: AppState
    @State private var mode: Mode = .login
    @State private var username = ""
    @State private var password = ""
    @State private var invite = ""
    @State private var showPassword = false
    @State private var registerMode: RegisterMode = .invite
    @State private var busy = false
    @State private var errorMessage: String?

    enum Mode: Hashable { case login, register }
    enum RegisterMode: String { case open, invite, closed }

    var body: some View {
        ZStack {
            AppTheme.auroraBackground.ignoresSafeArea()

            ScrollView {
                VStack(spacing: 24) {
                    header
                    glassCard
                }
                .frame(maxWidth: 430)
                .frame(maxWidth: .infinity)
                .padding(.horizontal, 22)
                .padding(.top, 12)
                .padding(.bottom, 40)
            }
            .scrollDismissesKeyboard(.interactively)
            .scrollBounceBehavior(.basedOnSize)
        }
        .preferredColorScheme(.light)
        .task { await fetchRegisterStatus() }
        .onSubmit { Task { await submit() } }
    }

    private var header: some View {
        VStack(spacing: 14) {
            ZStack {
                RoundedRectangle(cornerRadius: 26, style: .continuous)
                    .fill(AppTheme.brandGradient)
                Image(systemName: "book.closed.fill")
                    .font(.title)
                    .foregroundStyle(.white.opacity(0.95))
            }
            .frame(width: 92, height: 92)
            .shadow(color: AppTheme.terracotta.opacity(0.35), radius: 16, y: 8)
            .accessibilityHidden(true)

            Text("知舟")
                .font(serifFont(.largeTitle, .bold))
                .foregroundStyle(AppTheme.textPrimary)

            Text("登录后同步书架与阅读进度")
                .font(.footnote)
                .foregroundStyle(AppTheme.textSecondary)
        }
    }

    private var glassCard: some View {
        VStack(spacing: 16) {
            Picker("账号操作", selection: $mode) {
                Text("登录").tag(Mode.login)
                Text("注册").tag(Mode.register)
            }
            .pickerStyle(.segmented)
            .frame(minHeight: 44)

            field(icon: "person.fill", placeholder: "用户名", text: $username, isSecure: false)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .textContentType(.username)
                .submitLabel(.next)

            passwordField

            if mode == .register && registerMode == .invite {
                field(icon: "key.fill", placeholder: "邀请码", text: $invite, isSecure: false)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .textContentType(.oneTimeCode)
                    .submitLabel(.go)
            }

            if mode == .register && registerMode == .closed {
                Text("当前站点注册已关闭")
                    .font(.footnote)
                    .foregroundStyle(AppTheme.textSecondary)
                    .frame(maxWidth: .infinity, minHeight: 44)
            }

            if mode != .register || registerMode != .closed {
                submitButton
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
        .padding(20)
        .paperCard(cornerRadius: 28)
    }

    private var passwordField: some View {
        HStack(spacing: 10) {
            Image(systemName: "lock.fill")
                .font(.subheadline)
                .foregroundStyle(AppTheme.textSecondary)
                .frame(width: 20)
                .accessibilityHidden(true)

            Group {
                if showPassword {
                    TextField("密码", text: $password)
                } else {
                    SecureField("密码", text: $password)
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
                    .font(.subheadline)
                    .foregroundStyle(AppTheme.textSecondary)
                    .frame(width: 44, height: 44)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(showPassword ? "隐藏密码" : "显示密码")
        }
        .padding(.leading, 14)
        .padding(.trailing, 4)
        .background(AppTheme.surfaceWarm, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(AppTheme.border, lineWidth: 1)
        )
    }

    private func field(icon: String, placeholder: String, text: Binding<String>, isSecure: Bool) -> some View {
        HStack(spacing: 10) {
            Image(systemName: icon)
                .font(.subheadline)
                .foregroundStyle(AppTheme.textSecondary)
                .frame(width: 20)
                .accessibilityHidden(true)

            Group {
                if isSecure {
                    SecureField(placeholder, text: text)
                } else {
                    TextField(placeholder, text: text)
                }
            }
            .foregroundStyle(AppTheme.textPrimary)
            .tint(AppTheme.primary)
        }
        .padding(.horizontal, 14)
        .frame(minHeight: 48)
        .background(AppTheme.surfaceWarm, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(AppTheme.border, lineWidth: 1)
        )
    }

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
            .frame(minHeight: 52)
            .background(
                AppTheme.buttonGradient,
                in: RoundedRectangle(cornerRadius: 16, style: .continuous)
            )
        }
        .buttonStyle(ScaleButtonStyle())
        .disabled(!canSubmit)
        .opacity(canSubmit ? 1 : 0.6)
        .shadow(color: AppTheme.primaryDeep.opacity(0.35), radius: 14, y: 7)
        .accessibilityLabel(mode == .login ? "登录" : "注册")
    }

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
