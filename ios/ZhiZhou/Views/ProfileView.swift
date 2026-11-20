import SwiftUI

struct ProfileView: View {
    @Environment(AppState.self) private var appState
    @Environment(OfflineReadingStore.self) private var offlineStore
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var showReaderSettings = false

    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                profileHeader
                ProfileReadingOverview()
                    .readingSpaceEntrance()
                preferences
                    .readingSpaceEntrance(1)
                general
                    .readingSpaceEntrance(2)
                if appState.user?.isAdmin == true {
                    NavigationLink { AdminRootView() } label: {
                        profileRow("管理后台", symbol: "slider.horizontal.3")
                    }
                    .background(ReadingSpace.paper, in: RoundedRectangle(cornerRadius: ReadingSpace.panelRadius))
                }
            }
            .buttonStyle(.plain)
            .padding(.horizontal, 20)
            .padding(.bottom, 28)
            .frame(maxWidth: 700)
            .frame(maxWidth: .infinity)
        }
        .background(ReadingSpace.canvas)
        .navigationTitle("我的")
        .navigationBarTitleDisplayMode(.inline)
        .task { await offlineStore.refresh() }
        .sheet(isPresented: $showReaderSettings) {
            ReaderSettingsView()
                .presentationDetents(dynamicTypeSize.isAccessibilitySize ? [.large] : [.medium, .large])
                .presentationBackground(AppTheme.background)
        }
    }

    private var profileHeader: some View {
        VStack(spacing: 0) {
            GeometryReader { geometry in
                Image("ReadingWindow")
                    .resizable().scaledToFill()
                    .frame(width: geometry.size.width, height: geometry.size.height)
                    .clipped()
            }
            .frame(height: 190)
            .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
            .accessibilityHidden(true)
            if let user = appState.user {
                NavigationLink { ProfileAccountView() } label: {
                    VStack(alignment: .leading, spacing: 12) {
                        ProfileAvatar(user: user, size: 76)
                            .padding(5)
                            .background(ReadingSpace.paper, in: Circle())
                            .padding(.top, -34)
                        HStack(alignment: .firstTextBaseline, spacing: 12) {
                            Text(user.displayName.isEmpty ? user.username : user.displayName)
                                .font(serifFont(.title, .semibold))
                                .foregroundStyle(ReadingSpace.ink)
                                .fixedSize(horizontal: false, vertical: true)
                            Spacer(minLength: 0)
                            Image(systemName: "chevron.right")
                                .font(.footnote.weight(.semibold))
                                .foregroundStyle(AppTheme.textSecondary)
                                .accessibilityHidden(true)
                        }
                        Text("账户与安全")
                            .font(.subheadline).foregroundStyle(AppTheme.textSecondary)
                    }
                    .padding(.horizontal, 20).padding(.bottom, 22)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(ReadingSpace.paper, in: RoundedRectangle(cornerRadius: 26, style: .continuous))
                    .padding(.top, -20)
                    .contentShape(Rectangle())
                }
                .accessibilityIdentifier("profile.account")
            }
        }
    }

    private var preferences: some View {
        profileSection("阅读偏好") {
            NavigationLink { ContentModeView() } label: {
                profileRow("内容模式", symbol: "eye",
                           detail: ContentAccessStore.shared.mode == "adult" ? "R18 · 在线" : "安全模式")
            }
            .accessibilityIdentifier("profile.content-mode")
            Button { showReaderSettings = true } label: {
                profileRow("阅读设置", symbol: "textformat")
            }
            .accessibilityIdentifier("profile.reader-settings")
            NavigationLink { OfflineReadingView() } label: {
                profileRow("离线阅读", symbol: "arrow.down.circle",
                           detail: offlineStore.totalChapterCount > 0 ? "\(offlineStore.totalChapterCount) 章" : nil)
            }
            .accessibilityIdentifier("profile.offline")
        }
    }

    private var general: some View {
        profileSection("通用") {
            NavigationLink { StorageManagerView() } label: { profileRow("存储管理", symbol: "internaldrive") }
            NavigationLink { PrivacyNoticeView() } label: { profileRow("隐私说明", symbol: "hand.raised") }
            NavigationLink { ProfileAboutView() } label: { profileRow("关于 Cat’s Library", symbol: "info.circle") }
        }
    }

    private func profileSection<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).font(.subheadline).foregroundStyle(AppTheme.textSecondary)
                .padding(.leading, 6).accessibilityAddTraits(.isHeader)
            VStack(spacing: 0, content: content)
                .background(ReadingSpace.paper, in: RoundedRectangle(cornerRadius: ReadingSpace.panelRadius))
        }
    }

    private func profileRow(_ title: String, symbol: String, detail: String? = nil) -> some View {
        HStack(spacing: 12) {
            Image(systemName: symbol).foregroundStyle(AppTheme.primary)
                .frame(width: 24).accessibilityHidden(true)
            AppAdaptiveRow(spacing: 8) {
                Text(title).foregroundStyle(AppTheme.textPrimary)
                if let detail {
                    Text(detail).font(.subheadline).foregroundStyle(AppTheme.textSecondary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Image(systemName: "chevron.right").font(.caption.weight(.semibold))
                .foregroundStyle(AppTheme.textSecondary).accessibilityHidden(true)
        }
        .fixedSize(horizontal: false, vertical: true)
        .padding(.horizontal, 18).padding(.vertical, 14)
        .frame(minHeight: 52)
        .contentShape(Rectangle())
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
