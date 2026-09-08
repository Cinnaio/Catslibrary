import SwiftUI

struct ProfileView: View {
    @Environment(AppState.self) private var appState
    @Environment(OfflineReadingStore.self) private var offlineStore
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var showReaderSettings = false

    var body: some View {
        GeometryReader { geometry in
            let inset = max(24, (geometry.size.width - 600) / 2)
            List {
                if let user = appState.user {
                    Section {
                        NavigationLink {
                            ProfileAccountView()
                        } label: {
                            ProfileIdentityRow(user: user, subtitle: "账户与安全")
                        }
                        .accessibilityIdentifier("profile.account")
                        .listRowInsets(EdgeInsets(top: 8, leading: inset, bottom: 28, trailing: inset))
                        .listRowSeparator(.hidden)
                    }
                    .listRowBackground(Color.clear)
                }

                Section {
                    Button {
                        showReaderSettings = true
                    } label: {
                        HStack(spacing: 12) {
                            ProfileSettingsLabel("阅读设置", systemImage: "textformat")
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
                            ProfileSettingsLabel("离线阅读", systemImage: "arrow.down.circle")
                        }
                    }
                    .accessibilityIdentifier("profile.offline")
                    .listRowSeparator(.hidden, edges: .bottom)
                }
                .listRowInsets(EdgeInsets(top: 12, leading: inset, bottom: 12, trailing: inset))
                .listRowBackground(Color.clear)

                Section {
                    NavigationLink {
                        StorageManagerView()
                    } label: {
                        ProfileSettingsLabel("存储管理", systemImage: "internaldrive")
                    }
                    .listRowInsets(EdgeInsets(top: 28, leading: inset, bottom: 12, trailing: inset))
                    .listRowSeparator(.hidden, edges: .top)
                    NavigationLink {
                        ProfilePrivacyView()
                    } label: {
                        ProfileSettingsLabel("隐私与诊断", systemImage: "hand.raised")
                    }
                    NavigationLink {
                        ProfileAboutView()
                    } label: {
                        ProfileSettingsLabel("关于知舟", systemImage: "info.circle")
                    }
                    .listRowSeparator(.hidden, edges: .bottom)
                }
                .listRowInsets(EdgeInsets(top: 12, leading: inset, bottom: 12, trailing: inset))
                .listRowBackground(Color.clear)

                if appState.user?.role == "admin" {
                    Section {
                        NavigationLink {
                            AdminRootView()
                        } label: {
                            ProfileSettingsLabel("管理后台", systemImage: "slider.horizontal.3")
                        }
                    }
                    .listRowInsets(EdgeInsets(top: 28, leading: inset, bottom: 12, trailing: inset))
                    .listRowSeparator(.hidden)
                    .listRowBackground(Color.clear)
                }
            }
            .listStyle(.plain)
            .contentMargins(.top, 8, for: .scrollContent)
            .scrollContentBackground(.hidden)
        }
        .background(Color(.systemBackground).ignoresSafeArea())
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
                    .font(.title2.weight(.semibold))
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

struct ProfileSettingsLabel: View {
    let title: String
    let systemImage: String
    @ScaledMetric(relativeTo: .body) private var symbolSize: CGFloat = 18

    init(_ title: String, systemImage: String) {
        self.title = title
        self.systemImage = systemImage
    }

    var body: some View {
        Label {
            Text(title)
                .font(.body)
                .foregroundStyle(AppTheme.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
        } icon: {
            Image(systemName: systemImage)
                .resizable()
                .scaledToFit()
                .symbolRenderingMode(.monochrome)
                .foregroundStyle(AppTheme.textSecondary)
                .frame(width: min(symbolSize, 22), height: min(symbolSize, 22))
                .frame(width: 24, height: 24)
                .accessibilityHidden(true)
        }
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
