import SwiftUI

struct ProfileView: View {
    @Environment(AppState.self) private var appState
    @Environment(OfflineReadingStore.self) private var offlineStore
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var showReaderSettings = false

    var body: some View {
        GeometryReader { geometry in
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
                        ProfileSettingsLabel("阅读设置", systemImage: "textformat.size", color: .teal)
                    }
                    .accessibilityIdentifier("profile.reader-settings")
                    NavigationLink {
                        OfflineReadingView()
                    } label: {
                        LabeledContent {
                            Text("\(offlineStore.totalChapterCount) 章")
                                .font(.subheadline)
                                .foregroundStyle(AppTheme.textSecondary)
                                .monospacedDigit()
                        } label: {
                            ProfileSettingsLabel("离线阅读", systemImage: "arrow.down", color: .blue)
                        }
                    }
                    .accessibilityIdentifier("profile.offline")
                }

                Section("通用") {
                    NavigationLink {
                        StorageManagerView()
                    } label: {
                        ProfileSettingsLabel("存储管理", systemImage: "internaldrive", color: .gray)
                    }
                    NavigationLink {
                        ProfilePrivacyView()
                    } label: {
                        ProfileSettingsLabel("隐私与诊断", systemImage: "hand.raised.fill", color: .indigo)
                    }
                    NavigationLink {
                        ProfileAboutView()
                    } label: {
                        ProfileSettingsLabel("关于知舟", systemImage: "info", color: .gray)
                    }
                }

                if appState.user?.role == "admin" {
                    Section {
                        NavigationLink {
                            AdminRootView()
                        } label: {
                            ProfileSettingsLabel("管理后台", systemImage: "gearshape.2.fill", color: .gray)
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .contentMargins(.horizontal, max(20, (geometry.size.width - 640) / 2), for: .scrollContent)
            .scrollContentBackground(.hidden)
        }
        .pageBackground()
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
            ProfileAvatar(user: user, size: 56)
            VStack(alignment: .leading, spacing: 4) {
                Text(user.displayName.isEmpty ? user.username : user.displayName)
                    .font(.headline)
                    .foregroundStyle(AppTheme.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
                Text(subtitle)
                    .font(.subheadline)
                    .foregroundStyle(AppTheme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.vertical, 8)
        .accessibilityElement(children: .combine)
    }

    private var identityLayout: AnyLayout {
        dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 14))
            : AnyLayout(HStackLayout(alignment: .center, spacing: 16))
    }
}

struct ProfileSettingsLabel: View {
    let title: String
    let systemImage: String
    let color: Color

    init(_ title: String, systemImage: String, color: Color) {
        self.title = title
        self.systemImage = systemImage
        self.color = color
    }

    var body: some View {
        Label {
            Text(title)
                .font(.body)
                .foregroundStyle(AppTheme.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
        } icon: {
            Image(systemName: systemImage)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 28, height: 28)
                .background(color, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                .accessibilityHidden(true)
        }
        .padding(.vertical, 2)
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
