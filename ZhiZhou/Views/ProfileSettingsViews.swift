import SwiftUI

struct ProfileAccountView: View {
    @Environment(AppState.self) private var appState
    @State private var showEditProfile = false
    @State private var showLogoutConfirm = false
    @State private var isLoggingOut = false

    var body: some View {
        List {
            if let user = appState.user {
                Section {
                    Button {
                        showEditProfile = true
                    } label: {
                        HStack(spacing: 12) {
                            ProfileIdentityRow(user: user, subtitle: "@\(user.username)")
                            Image(systemName: "pencil")
                                .font(.body)
                                .foregroundStyle(AppTheme.textSecondary)
                                .accessibilityHidden(true)
                        }
                    }
                    .accessibilityHint("编辑昵称、简介或头像")
                    .accessibilityIdentifier("profile.edit")
                }
            }

            Section {
                NavigationLink {
                    ChangePasswordView()
                } label: {
                    AppIconLabel("修改密码", systemImage: "lock")
                }
            }

            Section {
                Button(role: .destructive) {
                    showLogoutConfirm = true
                } label: {
                    HStack(spacing: 12) {
                        Text("退出登录")
                        Spacer()
                        if isLoggingOut {
                            ProgressView().accessibilityLabel("正在退出登录")
                        }
                    }
                }
                .accessibilityIdentifier("account.logout")
            }
        }
        .appListStyle(.settings)
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
}

struct ProfilePrivacyView: View {
    @State private var diagnosticsEnabled = AppObservability.shared.isDiagnosticsEnabled

    var body: some View {
        List {
            Section {
                NavigationLink {
                    PrivacyNoticeView()
                } label: {
                    AppIconLabel("隐私说明", systemImage: "hand.raised")
                }
            }
            Section {
                Toggle("帮助改进知舟", isOn: $diagnosticsEnabled)
                    .onChange(of: diagnosticsEnabled) { _, enabled in
                        AppObservability.shared.setDiagnosticsEnabled(enabled)
                        AppFeedback.success(enabled ? "匿名诊断已开启" : "匿名诊断已关闭")
                    }
            } header: {
                Text("诊断")
            } footer: {
                Text("可选发送匿名的功能事件、性能指标和崩溃诊断；不会发送小说正文、搜索词、密码或账号信息。关闭后，尚未发送的本地诊断记录会立即清除。")
            }
        }
        .appListStyle(.settings)
        .navigationTitle("隐私与诊断")
        .navigationBarTitleDisplayMode(.inline)
    }
}

struct ProfileAboutView: View {
    #if DEBUG
    @AppStorage("zhizhou.allowInvalidCert") private var allowInvalidCert = false
    #endif

    var body: some View {
        List {
            Section {
                HStack(spacing: 16) {
                    BrandMark(size: 48)
                    Text("知舟")
                        .font(serifFont(.title2, .semibold))
                        .foregroundStyle(AppTheme.textPrimary)
                }
                .padding(.vertical, 12)
                LabeledContent("版本", value: version)
            }
            Section("服务器") {
                Text(ServerConfig.serverURL)
                    .font(.subheadline)
                    .foregroundStyle(AppTheme.textSecondary)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
            }
            #if DEBUG
            Section {
                Toggle("信任无效证书", isOn: $allowInvalidCert)
                    .onChange(of: allowInvalidCert) { _, value in
                        APIClient.shared.allowsInvalidCertificates = value
                    }
            } header: {
                Text("开发设置")
            } footer: {
                Text("仅用于自签名或过期证书排查。")
            }
            #endif
        }
        .appListStyle(.settings)
        .navigationTitle("关于知舟")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var version: String {
        let marketing = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""
        let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? ""
        return "\(marketing) (\(build))"
    }
}
