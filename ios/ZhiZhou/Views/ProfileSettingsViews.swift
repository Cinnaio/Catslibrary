import SwiftUI

struct ProfileAccountView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var showEditProfile = false
    @State private var showLogoutConfirm = false
    @State private var isLoggingOut = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 32) {
                if let user = appState.user {
                    identity(user)
                }

                accountSection("登录与找回") {
                    NavigationLink { AccountEmailView(bindingEmail: true) } label: {
                        accountRow("邮箱与密码找回", symbol: "envelope", detail: "管理邮箱与密码找回方式")
                    }
                    .accessibilityLabel("邮箱与密码找回")
                    NavigationLink { ChangePasswordView() } label: {
                        accountRow("修改密码", symbol: "lock", detail: "更新用于登录的密码")
                    }
                    .accessibilityLabel("修改密码")
                }

                accountSection("设备与密钥") {
                    NavigationLink { AccountSessionsView() } label: {
                        accountRow("登录设备", symbol: "laptopcomputer.and.iphone", detail: "查看与管理登录会话")
                    }
                    .accessibilityLabel("登录设备")
                    NavigationLink { PasskeySettingsView() } label: {
                        accountRow("Passkey", symbol: "person.badge.key", detail: "管理免密码登录的通行密钥")
                    }
                    .accessibilityLabel("Passkey")
                    .accessibilityIdentifier("account.passkey")
                }

                Button(role: .destructive) {
                    showLogoutConfirm = true
                } label: {
                    HStack(spacing: 14) {
                        Image(systemName: "rectangle.portrait.and.arrow.right")
                            .frame(width: 24)
                            .accessibilityHidden(true)
                        Text("退出登录")
                            .fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 12)
                        if isLoggingOut {
                            ProgressView().accessibilityLabel("正在退出登录")
                        }
                    }
                    .font(.subheadline)
                    .foregroundStyle(AppTheme.danger)
                    .padding(.vertical, 16)
                    .frame(maxWidth: .infinity, minHeight: AppLayout.minimumTouchTarget, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .accessibilityLabel("退出登录")
                .accessibilityValue(isLoggingOut ? "正在退出登录" : "")
                .accessibilityIdentifier("account.logout")
                .padding(.top, 8)
            }
            .buttonStyle(.plain)
            .padding(.horizontal, 24)
            .padding(.top, 20)
            .padding(.bottom, 32)
            .frame(maxWidth: 700, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .center)
        }
        .background(ReadingSpace.profilePaper)
        .readingSpaceTopEdge(opaque: false)
        .disabled(isLoggingOut || appState.isUpdatingAccount)
        .navigationTitle("账户与安全")
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(isLoggingOut)
        .sheet(isPresented: $showEditProfile) {
            if let user = appState.user {
                NavigationStack { ProfileEditView(user: user) }
            }
        }
        .confirmationDialog("确定退出登录？", isPresented: $showLogoutConfirm, titleVisibility: .visible) {
            Button("退出登录", role: .destructive) {
                guard !isLoggingOut, !appState.isUpdatingAccount else { return }
                isLoggingOut = true
                Task {
                    await appState.logout()
                    isLoggingOut = false
                    AppFeedback.success("已退出登录")
                }
            }
            Button("取消", role: .cancel) {}
        }
    }

    private func identity(_ user: User) -> some View {
        let displayName = user.displayName.isEmpty ? user.username : user.displayName
        return Button {
            showEditProfile = true
        } label: {
            identityLayout {
                ProfileAvatar(user: user, size: 64)
                VStack(alignment: .leading, spacing: 8) {
                    Text(displayName)
                        .font(serifFont(.title2, .medium))
                        .foregroundStyle(ReadingSpace.ink)
                    Text("@\(user.username)")
                        .font(.subheadline)
                        .foregroundStyle(ReadingSpace.profileMuted)
                    Label("编辑个人资料", systemImage: "pencil")
                        .font(.caption)
                        .foregroundStyle(ReadingSpace.profileMuted)
                }
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, minHeight: AppLayout.minimumTouchTarget, alignment: .leading)
            .contentShape(Rectangle())
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("个人资料，\(displayName)，@\(user.username)")
        .accessibilityHint("编辑昵称、简介或头像")
        .accessibilityIdentifier("profile.edit")
    }

    private var identityLayout: AnyLayout {
        dynamicTypeSize >= .xxxLarge
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 16))
            : AnyLayout(HStackLayout(alignment: .center, spacing: 16))
    }

    private func accountSection<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(serifFont(.title3, .medium))
                .foregroundStyle(ReadingSpace.ink)
                .accessibilityAddTraits(.isHeader)
            VStack(spacing: 0, content: content)
        }
    }

    private func accountRow(_ title: String, symbol: String, detail: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 14) {
            Image(systemName: symbol)
                .font(.subheadline)
                .foregroundStyle(ReadingSpace.profileMuted)
                .frame(width: 24)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 5) {
                Text(title)
                    .font(.subheadline)
                    .foregroundStyle(ReadingSpace.ink)
                Text(detail)
                    .font(.footnote)
                    .foregroundStyle(ReadingSpace.profileMuted)
            }
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            Image(systemName: "chevron.right")
                .font(.caption2.weight(.semibold))
                .foregroundStyle(ReadingSpace.profileMuted)
                .accessibilityHidden(true)
        }
        .padding(.vertical, 14)
        .frame(maxWidth: .infinity, minHeight: AppLayout.minimumTouchTarget, alignment: .leading)
        .contentShape(Rectangle())
    }
}

struct ProfileAboutView: View {
    #if DEBUG
    @AppStorage("zhizhou.allowInvalidCert") private var allowInvalidCert = false
    #endif

    var body: some View {
        AccountSettingsPage {
            AppAdaptiveRow(spacing: 16) {
                BrandMark(size: 56)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 8) {
                    Text("Cat’s Library")
                        .font(.system(.title2, design: .serif).weight(.semibold))
                        .foregroundStyle(ReadingSpace.ink)
                        .fixedSize(horizontal: false, vertical: true)
                    Text("阅读与创作空间")
                        .font(.subheadline)
                        .foregroundStyle(ReadingSpace.profileMuted)
                }
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel("关于 Cat’s Library，阅读与创作空间")
            .accessibilityAddTraits(.isHeader)

            AccountSettingsSection("应用版本") {
                Text(version)
                    .font(.body.monospacedDigit())
                    .foregroundStyle(ReadingSpace.ink)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
            }
            AccountSettingsSection("当前站点") {
                Text(ServerConfig.serverURL)
                    .font(.body)
                    .foregroundStyle(ReadingSpace.ink)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
            }
            #if DEBUG
            AccountSettingsSection("开发设置") {
                Toggle("信任无效证书", isOn: $allowInvalidCert)
                    .font(.body)
                    .foregroundStyle(ReadingSpace.ink)
                    .frame(minHeight: AppLayout.minimumTouchTarget)
                    .onChange(of: allowInvalidCert) { _, value in
                        APIClient.shared.allowsInvalidCertificates = value
                    }
                AccountSettingsNote("仅用于自签名或过期证书排查。")
            }
            #endif
        }
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .scrollEdgeEffectHidden(true, for: .top)
        .accessibilityIdentifier("profile.about")
    }

    private var version: String {
        let marketing = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""
        let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? ""
        return "\(marketing) (\(build))"
    }
}
