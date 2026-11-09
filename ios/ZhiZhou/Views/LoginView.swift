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
    @State private var passkeyBusy = false
    @State private var passkeyConfig: PasskeyConfigResponse?
    @State private var isRestoringSession = false
    @State private var errorMessage: String?
    @State private var interactionFeedback = 0
    @State private var showPasswordRecovery = false
    @State private var showOfflineReading = false
    @State private var challenge = AccountChallengeController()
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
                            .padding(.bottom, 28)

                        fieldsGroup
                            .padding(.top, 20)
                            .disabled(busy || isRestoringSession)

                        if appState.sessionRestoreFailed || errorMessage != nil {
                            statusLine
                                .padding(.top, 16)
                        }

                        if mode != .register || registerMode == .open || registerMode == .invite {
                            submitButton
                                .padding(.top, 20)
                        }

                        if mode == .login, passkeyAvailable {
                            passkeyButton
                                .padding(.top, 12)
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

                        accountSwitch
                            .disabled(busy || isRestoringSession)
                            .padding(.top, 16)

                    }
                    .padding(.horizontal, 28)
                    .padding(.top, max(20, min(40, proxy.size.height * 0.05)))
                    .padding(.bottom, 28)
                    .frame(maxWidth: 460)
                    .frame(maxWidth: .infinity, minHeight: proxy.size.height, alignment: .top)
                    .animation(reduceMotion ? AppMotion.micro : AppMotion.state, value: registerMode)
                    .animation(
                        reduceMotion ? AppMotion.micro : AppMotion.state,
                        value: appState.sessionRestoreFailed || errorMessage != nil
                    )
                }
                .scrollDismissesKeyboard(.interactively)
                .scrollBounceBehavior(.basedOnSize)
                .scrollIndicators(.hidden)
            }
        }
        .task(id: mode) {
            await fetchRegisterStatus()
            if mode == .login {
                await fetchPasskeyConfiguration()
            } else {
                passkeyConfig = nil
            }
        }
        .sheet(isPresented: $showPasswordRecovery) {
            NavigationStack { AccountEmailView(bindingEmail: false) }
        }
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
        .sheet(isPresented: Binding(get: { challenge.action != nil }, set: { if !$0 { challenge.finish(nil) } })) {
            if let action = challenge.action { AccountChallengeSheet(action: action, finish: challenge.finish) }
        }
        .onDisappear { challenge.finish(nil) }
    }

    private var statusTransition: AnyTransition {
        if reduceMotion {
            return .opacity.animation(AppMotion.micro)
        }
        return .move(edge: .top).combined(with: .opacity)
    }

    private var loginBackdrop: some View {
        AppTheme.canvas
            .ignoresSafeArea()
    }

    // MARK: - 品牌头部

    private var brandHeader: some View {
        VStack(alignment: .leading, spacing: 24) {
            HStack(spacing: 12) {
                BrandMark(size: 48)

                Text("Cat’s Library")
                    .font(.system(.title2, design: .serif))
                    .foregroundStyle(AppTheme.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            welcomeCopy
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var welcomeCopy: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(mode == .login ? "欢迎回来" : "创建账号")
                .font(serifFont(.title, .regular))
                .foregroundStyle(AppTheme.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            Text(mode == .login
                 ? "登录后，同步书架与阅读进度。"
                 : "让书架与阅读进度，随账号同步。")
                .font(.subheadline)
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

                    Button {
                        interactionFeedback &+= 1
                        switchMode()
                    } label: {
                        Text(mode == .login ? "注册" : "登录")
                            .fontWeight(.semibold)
                            .foregroundStyle(AppTheme.primary)
                            .frame(minWidth: AppLayout.minimumTouchTarget, minHeight: AppLayout.minimumTouchTarget)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(ScaleButtonStyle(pressedScale: 0.96))
                }
                .font(.subheadline)
                .frame(maxWidth: .infinity, minHeight: AppLayout.minimumTouchTarget)
                .accessibilityElement(children: .contain)
            }
        }
    }

    private func switchMode() {
        withAnimation(reduceMotion ? AppMotion.micro : AppMotion.state) {
            mode = mode == .login ? .register : .login
            errorMessage = nil
            focusedField = nil
        }
    }

    // MARK: - 输入

    private var fieldsGroup: some View {
        VStack(spacing: 18) {
            fieldSurface("用户名", isFocused: focusedField == .username) {
                TextField("用户名", text: $username)
                    .textContentType(.username)
                    .accessibilityLabel("用户名")
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
                fieldSurface("邀请码", isFocused: focusedField == .invite) {
                    TextField("邀请码", text: $invite)
                        .textInputAutocapitalization(.never)
                        .accessibilityLabel("邀请码")
                        .autocorrectionDisabled()
                        .submitLabel(.next)
                        .focused($focusedField, equals: .invite)
                        .onSubmit { focusedField = .password }
                        .foregroundStyle(AppTheme.textPrimary)
                        .tint(AppTheme.primary)
                }
            }

            fieldSurface("密码", isFocused: focusedField == .password, showsRecovery: mode == .login) {
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
                    .accessibilityLabel("密码")
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
        .animation(reduceMotion ? AppMotion.micro : AppMotion.state, value: mode)
        .animation(reduceMotion ? AppMotion.micro : AppMotion.state, value: registerMode)
    }

    private func fieldSurface<Content: View>(
        _ title: String,
        isFocused: Bool,
        showsRecovery: Bool = false,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text(title)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(AppTheme.textPrimary)
                    .accessibilityHidden(true)
                if showsRecovery {
                    Spacer(minLength: 12)
                    Button {
                        showPasswordRecovery = true
                    } label: {
                        Text("忘记密码")
                            .font(.footnote)
                            .foregroundStyle(AppTheme.primary)
                            .frame(minWidth: AppLayout.minimumTouchTarget, minHeight: AppLayout.minimumTouchTarget)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
            content()
                .padding(.horizontal, AppLayout.fieldHorizontalInset)
                .padding(.vertical, AppLayout.fieldVerticalInset)
                .frame(minHeight: AppLayout.fieldMinHeight)
                .background(AppTheme.surface, in: RoundedRectangle(cornerRadius: AppTheme.fieldCornerRadius))
                .overlay {
                    RoundedRectangle(cornerRadius: AppTheme.fieldCornerRadius)
                        .strokeBorder(isFocused ? AppTheme.primary : AppTheme.border, lineWidth: isFocused ? 1.5 : 1)
                }
                .animation(reduceMotion ? nil : AppMotion.micro, value: isFocused)
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
                        .tint(AppTheme.onPrimary)
                } else {
                    Text(mode == .login ? "登录" : "注册")
                        .font(.headline)
                }
            }
            .foregroundStyle(canSubmit || busy ? AppTheme.onPrimary : AppTheme.textSecondary)
            .padding(.horizontal, AppLayout.fieldHorizontalInset)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity, minHeight: AppLayout.fieldMinHeight)
            .background(
                canSubmit || busy ? AppTheme.primary : AppTheme.controlFill,
                in: RoundedRectangle(cornerRadius: AppTheme.fieldCornerRadius)
            )
        }
        .buttonStyle(ScaleButtonStyle(pressedScale: 0.98))
        .disabled(!canSubmit)
        .accessibilityLabel(mode == .login ? "登录" : "注册")
    }

    private var passkeyAvailable: Bool {
        passkeyConfig?.enabled == true && passkeyConfig?.configured == true
    }

    @ViewBuilder
    private var passkeyButton: some View {
        if PasskeyService.shared.localAvailabilityError != nil {
            Text("此安装版本暂不支持 Passkey，请使用密码登录。")
                .font(.footnote)
                .foregroundStyle(AppTheme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
        } else {
            Button {
                Task { await submitPasskey() }
            } label: {
                HStack(spacing: 8) {
                    if passkeyBusy {
                        ProgressView()
                    } else {
                        Image(systemName: "person.badge.key")
                    }
                    Text(passkeyBusy ? "等待设备验证…" : "使用 Passkey 登录")
                }
                .font(.subheadline.weight(.medium))
                .frame(maxWidth: .infinity, minHeight: AppLayout.minimumTouchTarget)
            }
            .buttonStyle(.borderless)
            .tint(AppTheme.primary)
            .disabled(busy || passkeyBusy || isRestoringSession)
            .accessibilityLabel("使用 Passkey 登录")
            .accessibilityIdentifier("login.passkey")
        }
    }

    private var registerClosedNote: some View {
        Label("当前站点注册已关闭", systemImage: "lock.fill")
            .font(.footnote)
            .foregroundStyle(AppTheme.textSecondary)
            .frame(maxWidth: .infinity, minHeight: 48)
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
            .transition(statusTransition)
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
            .transition(statusTransition)
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

    private func fetchPasskeyConfiguration() async {
        do {
            passkeyConfig = try await PasskeyService.shared.configuration()
        } catch {
            // Passkey is an optional login path; a config/network failure must
            // not hide the password form or make the login page unusable.
            passkeyConfig = nil
        }
    }

    private func submitPasskey() async {
        guard !busy, !passkeyBusy, !isRestoringSession, mode == .login else { return }
        busy = true
        passkeyBusy = true
        focusedField = nil
        errorMessage = nil
        defer {
            passkeyBusy = false
            busy = false
        }
        do {
            try await appState.loginWithPasskey(username: username)
            AppFeedback.success()
        } catch let error as NativePasskeyError where error == .cancelled {
            errorMessage = "已取消 Passkey 验证，请改用密码登录。"
        } catch {
            AppFeedback.error()
            errorMessage = AppCopy.friendlyError(error)
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
            let token = try await challenge.verify(mode == .login ? "login" : "register")
            if mode == .login {
                try await appState.login(username: username, password: password, turnstileToken: token)
            } else {
                try await appState.register(username: username, password: password, invite: invite, turnstileToken: token)
            }
            AppFeedback.success()
        } catch {
            AppFeedback.error()
            errorMessage = AppCopy.friendlyError(error)
        }
    }
}
