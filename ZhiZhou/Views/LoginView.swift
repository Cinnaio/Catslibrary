import SwiftUI

/// 登录 / 注册（注册模式随服务端 register-status 动态切换）。
/// 品牌识别、原生账号输入与单一主操作。
struct LoginView: View {
    @Environment(AppState.self) private var appState
    @Environment(OfflineReadingStore.self) private var offlineStore
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var mode: Mode = .login
    @State private var username = ""
    @State private var password = ""
    @State private var invite = ""
    @State private var showPassword = false
    @State private var registerMode: RegisterMode = .loading
    @State private var registerStatusError: String?
    @State private var busy = false
    @State private var isRestoringSession = false
    @State private var errorMessage: String?
    @State private var interactionFeedback = 0
    @State private var showOfflineReading = false
    @FocusState private var focusedField: Field?

    enum Mode: Hashable { case login, register }
    enum RegisterMode: String { case loading, open, invite, closed, unavailable }
    private enum Field: Hashable { case username, invite, password }

    var body: some View {
        GeometryReader { proxy in
            ZStack {
                loginBackdrop

                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        brandHeader

                        accountSwitch
                            .disabled(busy || isRestoringSession)
                            .padding(.top, 28)
                            .padding(.bottom, 18)

                        fieldsGroup
                            .disabled(busy || isRestoringSession)

                        if mode != .register || registerMode == .open || registerMode == .invite {
                            submitButton
                                .padding(.top, 16)
                        }

                        if mode == .register && registerMode == .closed {
                            registerClosedNote
                                .padding(.top, 16)
                        }

                        if mode == .register,
                           registerMode == .loading || registerMode == .unavailable {
                            registerStatusNote
                                .padding(.top, 16)
                        }

                        statusLine
                            .padding(.top, 16)

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
        .sheet(isPresented: $showOfflineReading) {
            NavigationStack {
                OfflineReadingView()
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("关闭", systemImage: "xmark") { showOfflineReading = false }
                        }
                    }
            }
        }
        .sensoryFeedback(.selection, trigger: interactionFeedback)
    }

    private var loginBackdrop: some View {
        AppTheme.canvas
            .ignoresSafeArea()
    }

    // MARK: - 品牌头部

    private var brandHeader: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                BrandMark(size: 48)

                Text("知舟")
                    .font(serifFont(.title2, .bold))
                    .foregroundStyle(AppTheme.textPrimary)
                    .accessibilityAddTraits(.isHeader)
            }

            Text(mode == .login ? "登录知舟" : "创建知舟账号")
                .font(.largeTitle.weight(.bold))
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
            fieldSurface(isFocused: focusedField == .username) {
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
                fieldSurface(isFocused: focusedField == .invite) {
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

            fieldSurface(isFocused: focusedField == .password) {
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
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
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
                            .frame(width: 44, height: 44)
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

    private func fieldSurface<Content: View>(
        isFocused: Bool,
        @ViewBuilder content: () -> Content
    ) -> some View {
        content()
            .padding(.horizontal, 16)
            .padding(.vertical, 4)
            .frame(minHeight: 52)
            .appFieldSurface(isFocused: isFocused)
            .animation(reduceMotion ? nil : .easeOut(duration: 0.16), value: isFocused)
    }

    // MARK: - 主操作

    private var submitButton: some View {
        Button {
            Task { await submit() }
        } label: {
            Group {
                if busy {
                    ProgressView()
                        .tint(AppTheme.onPrimary)
                } else {
                    Text(mode == .login ? "登录" : "注册")
                        .font(.headline)
                }
            }
            .foregroundStyle(AppTheme.onPrimary)
            .frame(maxWidth: .infinity)
            .frame(minHeight: 32)
        }
        .buttonStyle(.borderedProminent)
        .controlSize(.large)
        .buttonBorderShape(.roundedRectangle(radius: AppTheme.controlCornerRadius))
        .tint(AppTheme.primary)
        .disabled(!canSubmit)
        .accessibilityLabel(mode == .login ? "登录" : "注册")
    }

    private var registerClosedNote: some View {
        Label("当前站点注册已关闭", systemImage: "lock.fill")
            .font(.footnote)
            .foregroundStyle(AppTheme.textSecondary)
            .frame(maxWidth: .infinity, minHeight: 48)
            .appFieldSurface()
    }

    @ViewBuilder
    private var statusLine: some View {
        if appState.sessionRestoreFailed || errorMessage != nil {
            VStack(alignment: .leading, spacing: 8) {
                if appState.sessionRestoreFailed {
                    Label("暂时无法恢复上次会话", systemImage: "wifi.slash")
                        .foregroundStyle(AppTheme.warning)

                    Button(isRestoringSession ? "正在恢复会话" : "重试连接", systemImage: "arrow.clockwise") {
                        guard !isRestoringSession else { return }
                        isRestoringSession = true
                        Task {
                            await appState.bootstrap()
                            isRestoringSession = false
                        }
                    }
                    .disabled(isRestoringSession || busy)
                    .accessibilityIdentifier("session.retry")

                    if !offlineStore.books.isEmpty {
                        Button {
                            showOfflineReading = true
                        } label: {
                            Label(
                                "进入离线阅读（\(offlineStore.totalChapterCount) 章）",
                                systemImage: "book.closed"
                            )
                        }
                        .fontWeight(.semibold)
                        .foregroundStyle(AppTheme.primary)
                        .buttonStyle(.bordered)
                    }
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
            .background(
                (errorMessage == nil ? AppTheme.warning : AppTheme.danger).opacity(0.09),
                in: RoundedRectangle(cornerRadius: 15, style: .continuous)
            )
            .overlay {
                RoundedRectangle(cornerRadius: 15, style: .continuous)
                    .strokeBorder(
                        (errorMessage == nil ? AppTheme.warning : AppTheme.danger).opacity(0.22),
                        lineWidth: 0.8
                    )
            }
        }
    }

    @ViewBuilder
    private var registerStatusNote: some View {
        switch registerMode {
        case .loading:
            Label("正在获取注册状态…", systemImage: "arrow.triangle.2.circlepath")
                .foregroundStyle(AppTheme.textSecondary)
                .frame(maxWidth: .infinity, alignment: .leading)
        case .unavailable:
            VStack(alignment: .leading, spacing: 8) {
                Label("暂时无法确认注册状态", systemImage: "wifi.slash")
                    .foregroundStyle(AppTheme.warning)

                if let registerStatusError {
                    Text(registerStatusError)
                        .foregroundStyle(AppTheme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Button("重试") {
                    Task { await fetchRegisterStatus() }
                }
                .fontWeight(.semibold)
                .foregroundStyle(AppTheme.primary)
                .buttonStyle(.bordered)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        case .open, .invite, .closed:
            EmptyView()
        }
    }

    // MARK: - 逻辑

    private var canSubmit: Bool {
        guard !busy, !isRestoringSession, !username.trimmingCharacters(in: .whitespaces).isEmpty else { return false }
        if mode == .register {
            guard registerMode == .open || registerMode == .invite else { return false }
            if registerMode == .invite, invite.trimmingCharacters(in: .whitespaces).isEmpty { return false }
            return password.utf16.count >= 8
        }
        return !password.isEmpty
    }

    private func fetchRegisterStatus() async {
        registerMode = .loading
        registerStatusError = nil
        do {
            let r: RegisterStatusResponse = try await APIClient.shared.get("/api/auth/register-status")
            registerMode = RegisterMode(rawValue: r.mode) ?? .unavailable
            if registerMode == .closed, mode == .register { mode = .login }
        } catch {
            registerMode = .unavailable
            registerStatusError = AppCopy.friendlyError(error)
        }
    }

    private func submit() async {
        guard !busy, !isRestoringSession else { return }
        guard canSubmit else {
            if mode == .register, password.utf16.count < 8 {
                errorMessage = "密码至少 8 位"
            } else if mode == .register, registerMode == .invite, invite.trimmingCharacters(in: .whitespaces).isEmpty {
                errorMessage = "请填写邀请码"
            }
            return
        }
        busy = true
        focusedField = nil
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
