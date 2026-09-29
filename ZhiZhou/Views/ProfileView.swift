import SwiftUI

struct ProfileView: View {
    @Environment(AppState.self) private var appState
    @Environment(OfflineReadingStore.self) private var offlineStore
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var showReaderSettings = false

    var body: some View {
        List {
            if let user = appState.user {
                Section {
                    NavigationLink {
                        ProfileAccountView()
                    } label: {
                        ProfileIdentityRow(user: user, subtitle: "账户与安全")
                    }
                    .accessibilityIdentifier("profile.account")
                }
            }

            Section("阅读") {
                Button {
                    showReaderSettings = true
                } label: {
                    HStack(spacing: 12) {
                        AppIconLabel("阅读设置", systemImage: "textformat")
                        Spacer(minLength: 12)
                        Image(systemName: "chevron.right")
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(AppTheme.textMuted)
                            .accessibilityHidden(true)
                    }
                }
                .accessibilityIdentifier("profile.reader-settings")

                NavigationLink {
                    OfflineReadingView()
                } label: {
                    LabeledContent {
                        if offlineStore.totalChapterCount > 0 {
                            Text("\(offlineStore.totalChapterCount) 章")
                                .font(.subheadline)
                                .foregroundStyle(AppTheme.textSecondary)
                                .monospacedDigit()
                        }
                    } label: {
                        AppIconLabel("离线阅读", systemImage: "arrow.down.circle")
                    }
                }
                .accessibilityIdentifier("profile.offline")
            }

            Section("通用") {
                NavigationLink {
                    StorageManagerView()
                } label: {
                    AppIconLabel("存储管理", systemImage: "internaldrive")
                }
                NavigationLink {
                    PrivacyNoticeView()
                } label: {
                    AppIconLabel("隐私说明", systemImage: "hand.raised")
                }
                NavigationLink {
                    ProfileAboutView()
                } label: {
                    AppIconLabel("关于知舟", systemImage: "info.circle")
                }
            }

            if appState.user?.role == "admin" {
                Section("管理") {
                    NavigationLink {
                        AdminRootView()
                    } label: {
                        AppIconLabel("管理后台", systemImage: "slider.horizontal.3")
                    }
                }
            }
        }
        .appListStyle(.settings)
        .navigationTitle("我的")
        .navigationBarTitleDisplayMode(.large)
        .task { await offlineStore.refresh() }
        .sheet(isPresented: $showReaderSettings) {
            ReaderSettingsView()
                .presentationDetents(dynamicTypeSize.isAccessibilitySize ? [.large] : [.medium, .large])
                .presentationBackground(AppTheme.background)
        }
    }
}

struct ProfileIdentityRow: View {
    let user: User
    let subtitle: String
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        identityLayout {
            ProfileAvatar(user: user, size: 60)
            VStack(alignment: .leading, spacing: 6) {
                Text(user.displayName.isEmpty ? user.username : user.displayName)
                    .font(.headline.weight(.semibold))
                    .foregroundStyle(AppTheme.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
                Text(subtitle)
                    .font(.subheadline)
                    .foregroundStyle(AppTheme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
    }

    private var identityLayout: AnyLayout {
        dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 14))
            : AnyLayout(HStackLayout(alignment: .center, spacing: 16))
    }
}

struct ProfileAvatar: View {
    let user: User
    var size: CGFloat = 72

    var body: some View {
        CachedAsyncImage(
            url: APIClient.shared.avatarURL(userId: user.id, updatedAt: user.updatedAt),
            targetSize: CGSize(width: size, height: size),
            showsRetry: false
        ) { image in
            image.resizable().scaledToFill()
        } placeholder: {
            ZStack {
                AppTheme.primaryLight
                Text(String((user.displayName.isEmpty ? user.username : user.displayName).prefix(1)))
                    .font(.system(size: size * 0.4, weight: .medium))
                    .foregroundStyle(AppTheme.primary)
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .accessibilityHidden(true)
    }
}
