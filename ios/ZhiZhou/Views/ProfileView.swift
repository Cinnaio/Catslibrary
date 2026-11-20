import SwiftUI

private enum ProfileSection: String, CaseIterable, Identifiable {
    case reading, collection, account
    var id: String { rawValue }
    var title: String {
        switch self {
        case .reading: return "阅读"
        case .collection: return "收藏"
        case .account: return "账户"
        }
    }
}

struct ProfileView: View {
    let openBookshelf: () -> Void
    @Environment(AppState.self) private var appState
    @Environment(OfflineReadingStore.self) private var offlineStore
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var showReaderSettings = false
    @State private var section: ProfileSection = .reading
    @Namespace private var sectionHighlight

    var body: some View {
        GeometryReader { geometry in
            ScrollView {
                VStack(spacing: 0) {
                    profileCover(topInset: geometry.safeAreaInsets.top)
                    profilePaper
                        .padding(.top, -28)
                }
                .frame(maxWidth: 700)
                .frame(maxWidth: .infinity)
                .buttonStyle(.plain)
            }
            .scrollIndicators(.hidden)
            .ignoresSafeArea(.container, edges: .top)
        }
        .background(ReadingSpace.profilePaper)
        .navigationTitle("我的")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.hidden, for: .navigationBar)
        .task { await offlineStore.refresh() }
        .onChange(of: appState.user?.id) { _, _ in section = .reading }
        .sheet(isPresented: $showReaderSettings) {
            ReaderSettingsView()
                .presentationDetents(dynamicTypeSize.isAccessibilitySize ? [.large] : [.medium, .large])
                .presentationBackground(AppTheme.background)
        }
    }

    private func profileCover(topInset: CGFloat) -> some View {
        GeometryReader { geometry in
            Image("ReadingWindow")
                .resizable()
                .scaledToFill()
                .frame(width: geometry.size.width, height: geometry.size.height)
                .clipped()
                .overlay(Color.black.opacity(0.22))
                .accessibilityHidden(true)
        }
        .frame(height: max(222, topInset + 160))
        .overlay(alignment: .top) {
            // 保留系统状态栏前景色，用自适应渐变保证照片上的时间与信号可读。
            LinearGradient(stops: [
                .init(color: ReadingSpace.profilePaper.opacity(0.95), location: 0),
                .init(color: ReadingSpace.profilePaper.opacity(0.95), location: 0.65),
                .init(color: .clear, location: 1)
            ], startPoint: .top, endPoint: .bottom)
                .frame(height: topInset + 12)
                .allowsHitTesting(false)
                .accessibilityHidden(true)
        }
        .overlay(alignment: .top) {
            HStack(spacing: 16) {
                Text("My little library.")
                    .font(.custom("Georgia-Italic", size: 23, relativeTo: .title2))
                    .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
                    .foregroundStyle(.white)
                    .shadow(color: .black.opacity(0.3), radius: 8, y: 1)
                    .accessibilityHidden(true)
                Spacer(minLength: 0)
                Button { showReaderSettings = true } label: {
                    Image(systemName: "slider.horizontal.3")
                        .font(.system(size: 18, weight: .medium))
                        .foregroundStyle(Color(hex: "302D28"))
                        .frame(width: 44, height: 44)
                        .background(Color(hex: "FAF8F4"), in: Circle())
                }
                .accessibilityLabel("阅读与外观设置")
                .accessibilityIdentifier("profile.appearance")
            }
            .padding(.horizontal, 24)
            .padding(.top, topInset + 12)
        }
    }

    private var profilePaper: some View {
        VStack(spacing: 0) {
            profileIdentity
            sectionPicker
                .padding(.top, 16)
                .padding(.bottom, 18)
            VStack(alignment: .leading, spacing: 24) {
                switch section {
                case .reading:
                    ProfileReadingOverview(openBookshelf: openBookshelf)
                    readingShortcuts
                case .collection:
                    collections
                case .account:
                    preferences
                    general
                    if appState.user?.isAdmin == true {
                        NavigationLink { AdminRootView().profileDestinationNavigation() } label: {
                            profileRow("管理后台", symbol: "slider.horizontal.3")
                        }
                    }
                }
            }
            .readingSpaceEntrance()
            .id(section)
            .padding(.bottom, 32)
        }
        .padding(.horizontal, 22)
        .frame(maxWidth: .infinity, alignment: .top)
        .background {
            UnevenRoundedRectangle(topLeadingRadius: 32, topTrailingRadius: 32)
                .fill(ReadingSpace.profilePaper)
        }
    }

    private var profileIdentity: some View {
        VStack(spacing: 6) {
            Text("A READER’S ROOM")
                .font(.caption2)
                .tracking(1.7)
                .foregroundStyle(ReadingSpace.profileMuted)
                .accessibilityHidden(true)
            Text(roomTitle)
                .font(serifFont(.title, .medium))
                .foregroundStyle(ReadingSpace.ink)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            Text("把喜欢的故事，留在身边。")
                .font(.footnote)
                .foregroundStyle(ReadingSpace.profileMuted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .multilineTextAlignment(.center)
        .frame(maxWidth: .infinity)
        .padding(.top, 62)
        .overlay(alignment: .top) {
            if let user = appState.user {
                NavigationLink { ProfileAccountView().profileDestinationNavigation() } label: {
                    ProfileAvatar(user: user, size: 78)
                        .padding(5)
                        .background(ReadingSpace.profilePaper, in: Circle())
                        .overlay(alignment: .bottomTrailing) {
                            Image(systemName: "sparkles")
                                .font(.system(size: 12, weight: .medium))
                                .foregroundStyle(ReadingSpace.profilePaper)
                                .frame(width: 26, height: 26)
                                .background(ReadingSpace.ink, in: Circle())
                                .overlay(Circle().stroke(ReadingSpace.profilePaper, lineWidth: 3))
                        }
                        .contentShape(Circle())
                }
                .offset(y: -37)
                .accessibilityLabel("账户与安全")
                .accessibilityIdentifier("profile.account")
            }
        }
    }

    private var roomTitle: String {
        guard let user = appState.user else { return "我的书房" }
        let name = user.displayName.isEmpty ? user.username : user.displayName
        return "\(name)的书房"
    }

    private var sectionPicker: some View {
        let layout = dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(spacing: 6))
            : AnyLayout(HStackLayout(spacing: 10))
        return layout {
            ForEach(ProfileSection.allCases) { item in
                Button {
                    withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.2)) { section = item }
                } label: {
                    Text(item.title)
                        .font(.subheadline)
                        .foregroundStyle(section == item ? ReadingSpace.profilePaper : ReadingSpace.profileMuted)
                        .padding(.horizontal, 18)
                        .frame(minHeight: AppLayout.minimumTouchTarget)
                        .background {
                            if section == item {
                                Capsule().fill(ReadingSpace.ink)
                                    .matchedGeometryEffect(id: "profileSection", in: sectionHighlight)
                            }
                        }
                        .contentShape(Capsule())
                }
                .accessibilityAddTraits(section == item ? [.isSelected] : [])
                .accessibilityIdentifier("profile.section.\(item.rawValue)")
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("个人页分区")
    }

    private var readingShortcuts: some View {
        VStack(spacing: 0) {
            NavigationLink { ReaderBookmarksView().profileDestinationNavigation() } label: {
                profileRow("我的书签", symbol: "bookmark")
            }
            .accessibilityIdentifier("profile.bookmarks")
            Divider().overlay(ReadingSpace.profileLine)
            NavigationLink { MyThoughtsView().profileDestinationNavigation() } label: {
                profileRow("我的想法", symbol: "text.bubble")
            }
            .accessibilityIdentifier("profile.thoughts")
            Divider().overlay(ReadingSpace.profileLine)
            offlineLink
        }
    }

    private var collections: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("折起的一角")
                .font(serifFont(.title3, .medium))
                .foregroundStyle(ReadingSpace.ink)
                .accessibilityAddTraits(.isHeader)
            Text("喜欢的段落，和当时的心情。")
                .font(.subheadline).foregroundStyle(ReadingSpace.profileMuted)
            NavigationLink { ReaderBookmarksView().profileDestinationNavigation() } label: {
                profileRow("我的书签", symbol: "bookmark")
            }
            .accessibilityIdentifier("profile.bookmarks")
            NavigationLink { MyThoughtsView().profileDestinationNavigation() } label: {
                profileRow("我的想法", symbol: "text.bubble")
            }
            .accessibilityIdentifier("profile.thoughts")
        }
    }

    private var preferences: some View {
        profileSection("关于我的小天地") {
            NavigationLink { ProfileAccountView().profileDestinationNavigation() } label: {
                profileRow("账户与安全", symbol: "person.crop.circle")
            }
            NavigationLink { ContentModeView().profileDestinationNavigation() } label: {
                profileRow("内容模式", symbol: "eye",
                           detail: ContentAccessStore.shared.mode == "adult" ? "R18 · 在线" : "安全模式")
            }
            .accessibilityIdentifier("profile.content-mode")
            Button { showReaderSettings = true } label: {
                profileRow("阅读设置", symbol: "textformat")
            }
            .accessibilityIdentifier("profile.reader-settings")
            offlineLink
        }
    }

    private var offlineLink: some View {
        NavigationLink { OfflineReadingView().profileDestinationNavigation() } label: {
            profileRow("离线阅读", symbol: "arrow.down.circle",
                       detail: offlineStore.totalChapterCount > 0 ? "\(offlineStore.totalChapterCount) 章" : nil)
        }
        .accessibilityIdentifier("profile.offline")
    }

    private var general: some View {
        profileSection("通用") {
            NavigationLink { StorageManagerView().profileDestinationNavigation() } label: { profileRow("存储管理", symbol: "internaldrive") }
            NavigationLink { PrivacyNoticeView().profileDestinationNavigation() } label: { profileRow("隐私说明", symbol: "hand.raised") }
            NavigationLink { ProfileAboutView().profileDestinationNavigation() } label: { profileRow("关于 Cat’s Library", symbol: "info.circle") }
        }
    }

    private func profileSection<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title).font(serifFont(.title3, .medium))
                .foregroundStyle(ReadingSpace.ink).accessibilityAddTraits(.isHeader)
            VStack(spacing: 0, content: content)
        }
    }

    private func profileRow(_ title: String, symbol: String, detail: String? = nil) -> some View {
        HStack(spacing: 12) {
            Image(systemName: symbol).foregroundStyle(ReadingSpace.profileMuted)
                .frame(width: 22).accessibilityHidden(true)
            AppAdaptiveRow(spacing: 8) {
                Text(title).foregroundStyle(ReadingSpace.ink)
                if let detail {
                    Text(detail).font(.caption).foregroundStyle(ReadingSpace.profileMuted)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Image(systemName: "chevron.right").font(.caption2.weight(.semibold))
                .foregroundStyle(ReadingSpace.profileMuted).accessibilityHidden(true)
        }
        .font(.subheadline)
        .fixedSize(horizontal: false, vertical: true)
        .padding(.vertical, 14)
        .frame(minHeight: 50)
        .contentShape(Rectangle())
    }
}

extension View {
    /// 书房首页隐藏标题栏；子页面恢复原生返回导航及其系统配色。
    func profileDestinationNavigation() -> some View {
        toolbar(.visible, for: .navigationBar)
            .toolbarColorScheme(nil, for: .navigationBar)
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
