import SwiftUI

/// 个人中心：用户信息、阅读设置、服务器信息、退出登录。
struct ProfileView: View {
    @EnvironmentObject private var appState: AppState

    @State private var showLogoutConfirm = false
    @State private var showReaderSettings = false
    @AppStorage("zhizhou.allowInvalidCert") private var allowInvalidCert = false
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
                .frame(minHeight: 44)
            }

            Section("服务器") {
                LabeledContent("当前地址", value: ServerConfig.serverURL)
            }

            Section {
                DisclosureGroup("高级", isExpanded: $showAdvanced) {
                    Toggle("信任无效证书（开发用）", isOn: $allowInvalidCert)
                    Text("仅用于自签名或过期证书排查，日常请关闭。")
                        .font(.caption)
                        .foregroundStyle(AppTheme.textMuted)
                }
            }

            Section {
                Button("退出登录", role: .destructive) {
                    showLogoutConfirm = true
                }
                .frame(minHeight: 44)
            }
        }
        .scrollContentBackground(.hidden)
        .glassPageBackground()
        .navigationTitle("我的")
        .navigationBarTitleDisplayMode(.large)
        .browseColorScheme()
        .sheet(isPresented: $showReaderSettings) {
            ReaderSettingsView()
                .preferredColorScheme(.light)
                .presentationBackground(AppTheme.surfaceWarm)
                .presentationDetents([.medium, .large])
        }
        .confirmationDialog("确定退出登录？", isPresented: $showLogoutConfirm, titleVisibility: .visible) {
            Button("退出登录", role: .destructive) {
                Task { await appState.logout() }
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
