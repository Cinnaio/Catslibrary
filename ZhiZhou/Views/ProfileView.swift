import SwiftUI

/// 个人中心：用户信息、阅读设置、存储管理、服务器信息、退出登录。
struct ProfileView: View {
    @Environment(AppState.self) private var appState
    @Environment(OfflineReadingStore.self) private var offlineStore

    @State private var showLogoutConfirm = false
    @State private var showReaderSettings = false
    @State private var diagnosticsEnabled = AppObservability.shared.isDiagnosticsEnabled
    #if DEBUG
    @AppStorage("zhizhou.allowInvalidCert") private var allowInvalidCert = false
    #endif
    @State private var showAdvanced = false

    var body: some View {
        List {
            if let user = appState.user {
                Section {
                    HStack(spacing: 12) {
                        avatar(for: user)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(user.displayName)
                                .font(serifFont(.headline, .semibold))
                                .foregroundStyle(AppTheme.textPrimary)
                            Text("@\(user.username)")
                                .font(.footnote)
                                .foregroundStyle(AppTheme.textSecondary)
                            Text(user.displayBio)
                                .font(.caption)
                                .foregroundStyle(AppTheme.textMuted)
                                .lineLimit(2)
                        }
                    }
                    .padding(.vertical, 4)
                    .accessibilityElement(children: .combine)
                }
            }

            Section("阅读") {
                Button {
                    showReaderSettings = true
                } label: {
                    Label("阅读设置", systemImage: "textformat.size")
                }

                NavigationLink {
                    OfflineReadingView()
                } label: {
                    HStack {
                        Label("离线阅读", systemImage: "arrow.down.circle")
                        Spacer()
                        if offlineStore.totalChapterCount > 0 {
                            Text("\(offlineStore.totalChapterCount) 章")
                                .font(.footnote)
                                .foregroundStyle(AppTheme.textSecondary)
                        }
                    }
                }
            }

            Section("应用") {
                NavigationLink {
                    StorageManagerView()
                } label: {
                    Label("存储管理", systemImage: "internaldrive")
                }
            }

            Section("隐私与诊断") {
                Toggle("帮助改进知舟", isOn: $diagnosticsEnabled)
                    .onChange(of: diagnosticsEnabled) { _, enabled in
                        AppObservability.shared.setDiagnosticsEnabled(enabled)
                        AppFeedback.success(enabled ? "匿名诊断已开启" : "匿名诊断已关闭")
                    }

                NavigationLink {
                    PrivacyNoticeView()
                } label: {
                    Label("隐私说明", systemImage: "hand.raised")
                }

                Text("可选发送匿名的功能事件、性能指标和崩溃诊断，帮助定位问题；不会发送小说正文、搜索词、密码或账号信息。关闭后，尚未发送的本地诊断记录会立即清除。")
                    .font(.footnote)
                    .foregroundStyle(AppTheme.textSecondary)
                    .lineSpacing(3)
            }

            if appState.user?.role == "admin" {
                Section("管理") {
                    NavigationLink {
                        AdminRootView()
                    } label: {
                        Label("管理后台", systemImage: "gearshape.2")
                    }
                }
            }

            Section("服务器") {
                LabeledContent("当前地址", value: ServerConfig.serverURL)
            }

            #if DEBUG
            Section {
                DisclosureGroup("高级", isExpanded: $showAdvanced) {
                    Toggle("信任无效证书（开发用）", isOn: $allowInvalidCert)
                        .onChange(of: allowInvalidCert) { _, value in
                            APIClient.shared.allowsInvalidCertificates = value
                        }
                    Text("仅用于自签名或过期证书排查；Release 构建不包含此开关。")
                        .font(.caption)
                        .foregroundStyle(AppTheme.textMuted)
                }
            }
            #endif

            Section {
                Button("退出登录", role: .destructive) {
                    showLogoutConfirm = true
                }
            }
        }
        .scrollContentBackground(.hidden)
        .pageBackground()
        .navigationTitle("我的")
        .navigationBarTitleDisplayMode(.large)
        .sheet(isPresented: $showReaderSettings) {
            ReaderSettingsView()
                .presentationDetents([.medium, .large])
        }
        .confirmationDialog("确定退出登录？", isPresented: $showLogoutConfirm, titleVisibility: .visible) {
            Button("退出登录", role: .destructive) {
                Task {
                    await appState.logout()
                    AppFeedback.success("已退出登录")
                }
            }
        }
    }

    @ViewBuilder
    private func avatar(for user: User) -> some View {
        if let url = APIClient.shared.avatarURL(userId: user.id) {
            CachedAsyncImage(url: url, targetSize: CGSize(width: 56, height: 56)) { image in
                image.resizable().scaledToFill()
            } placeholder: {
                placeholder
            }
            .frame(width: 56, height: 56)
            .clipShape(Circle())
            .accessibilityHidden(true)
        } else {
            placeholder
        }
    }

    private var placeholder: some View {
        ZStack {
            AppTheme.primaryLight
            Image(systemName: "person.fill")
                .foregroundStyle(AppTheme.primary)
        }
        .frame(width: 56, height: 56)
        .clipShape(Circle())
        .accessibilityHidden(true)
    }
}
