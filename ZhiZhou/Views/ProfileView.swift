import SwiftUI

struct ProfileView: View {
    @Environment(AppState.self) private var appState
    @Environment(OfflineReadingStore.self) private var offlineStore
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var reading = ProfileReadingStore()
    @State private var showEditProfile = false
    @State private var showReaderSettings = false
    @State private var showLogoutConfirm = false
    @State private var isLoggingOut = false

    var body: some View {
        GeometryReader { geometry in
            let inset = max(20, (geometry.size.width - 640) / 2)
            List {
                if let user = appState.user {
                    identity(for: user)
                        .listRowInsets(EdgeInsets(top: 12, leading: inset, bottom: 24, trailing: inset))
                        .listRowSeparator(.hidden)
                        .listRowBackground(Color.clear)
                }

                Section {
                    sectionHeading("我的阅读")
                        .listRowSeparator(.hidden)
                    readingRows
                }
                .listRowInsets(EdgeInsets(top: 14, leading: inset, bottom: 14, trailing: inset))
                .listRowBackground(Color.clear)

                Section {
                    sectionHeading("应用设置")
                        .listRowSeparator(.hidden)
                    Button {
                        showReaderSettings = true
                    } label: {
                        HStack {
                            Label("阅读设置", systemImage: "textformat.size")
                            Spacer()
                            Image(systemName: "chevron.right")
                                .font(.footnote.weight(.semibold))
                                .foregroundStyle(AppTheme.textMuted)
                        }
                    }
                    NavigationLink {
                        ChangePasswordView()
                    } label: {
                        Label("修改密码", systemImage: "lock")
                    }
                    NavigationLink {
                        StorageManagerView()
                    } label: {
                        Label("存储管理", systemImage: "internaldrive")
                    }
                    NavigationLink {
                        ProfilePrivacyView()
                    } label: {
                        Label("隐私与诊断", systemImage: "hand.raised")
                    }
                    NavigationLink {
                        ProfileAboutView()
                    } label: {
                        Label("关于知舟", systemImage: "info.circle")
                    }
                    if appState.user?.role == "admin" {
                        NavigationLink {
                            AdminRootView()
                        } label: {
                            Label("管理后台", systemImage: "gearshape.2")
                        }
                    }
                }
                .listRowInsets(EdgeInsets(top: 16, leading: inset, bottom: 16, trailing: inset))
                .listRowBackground(Color.clear)

                Section {
                    Button(role: .destructive) {
                        showLogoutConfirm = true
                    } label: {
                        HStack(spacing: 12) {
                            Label("退出登录", systemImage: "rectangle.portrait.and.arrow.right")
                            Spacer()
                            if isLoggingOut { ProgressView() }
                        }
                    }
                    .disabled(isLoggingOut || appState.isUpdatingAccount)
                }
                .listRowInsets(EdgeInsets(top: 20, leading: inset, bottom: 20, trailing: inset))
                .listRowSeparator(.hidden)
                .listRowBackground(Color.clear)
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .refreshable { await refresh() }
        }
        .pageBackground()
        .navigationTitle("我的")
        .navigationBarTitleDisplayMode(.large)
        .task { await refresh() }
        .sheet(isPresented: $showEditProfile) {
            if let user = appState.user {
                NavigationStack { ProfileEditView(user: user) }
            }
        }
        .sheet(isPresented: $showReaderSettings) {
            ReaderSettingsView()
                .presentationDetents(dynamicTypeSize.isAccessibilitySize ? [.large] : [.medium, .large])
                .presentationBackground(AppTheme.background)
        }
        .confirmationDialog("确定退出登录？", isPresented: $showLogoutConfirm, titleVisibility: .visible) {
            Button("退出登录", role: .destructive) {
                Task {
                    isLoggingOut = true
                    await appState.logout()
                    isLoggingOut = false
                    AppFeedback.success("已退出登录")
                }
            }
        }
    }

    private func identity(for user: User) -> some View {
        Button {
            showEditProfile = true
        } label: {
            identityLayout {
                ProfileAvatar(user: user, size: 72)
                VStack(alignment: .leading, spacing: 6) {
                    Text(user.displayName.isEmpty ? user.username : user.displayName)
                        .font(serifFont(.title2, .semibold))
                        .foregroundStyle(AppTheme.textPrimary)
                        .fixedSize(horizontal: false, vertical: true)
                    Text("@\(user.username)")
                        .font(.subheadline)
                        .foregroundStyle(AppTheme.textSecondary)
                        .lineLimit(1)
                    if let bio = user.bio, !bio.isEmpty {
                        Text(bio)
                            .font(.subheadline)
                            .foregroundStyle(AppTheme.textSecondary)
                            .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 3)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                if !dynamicTypeSize.isAccessibilitySize {
                    Image(systemName: "chevron.right")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(AppTheme.textMuted)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityHint("编辑昵称、简介或头像")
        .accessibilityIdentifier("profile.edit")
    }

    private var identityLayout: AnyLayout {
        dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 14))
            : AnyLayout(HStackLayout(alignment: .center, spacing: 16))
    }

    @ViewBuilder
    private var readingRows: some View {
        if !reading.hasLoaded && reading.isLoading {
            ProgressView("正在加载阅读记录")
                .font(.subheadline)
                .frame(maxWidth: .infinity, minHeight: 76)
        } else if let item = reading.recent.first {
            NavigationLink {
                ReaderView(novel: item.asNovel, chapterOrder: item.chapterOrder)
            } label: {
                VStack(alignment: .leading, spacing: 10) {
                    Text("继续阅读")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(AppTheme.primary)
                    ProfileRecentBookRow(item: item)
                }
            }
            .accessibilityIdentifier("profile.continue")
        } else if reading.hasLoaded {
            Label("暂无阅读记录", systemImage: "book.closed")
                .foregroundStyle(AppTheme.textSecondary)
                .frame(minHeight: 48)
        }

        if let error = reading.errorMessage {
            VStack(alignment: .leading, spacing: 8) {
                Text(error)
                    .font(.footnote)
                    .foregroundStyle(AppTheme.textSecondary)
                Button("重试", systemImage: "arrow.clockwise") {
                    Task { await reading.refresh() }
                }
                .disabled(reading.isLoading)
            }
        }

        NavigationLink {
            ProfileReadingHistoryView(store: reading)
        } label: {
            Label("最近阅读", systemImage: "clock")
        }
        NavigationLink {
            OfflineReadingView()
        } label: {
            LabeledContent {
                Text("\(offlineStore.totalChapterCount) 章")
                    .font(.subheadline)
                    .foregroundStyle(AppTheme.textSecondary)
                    .monospacedDigit()
            } label: {
                Label("离线阅读", systemImage: "arrow.down.circle")
            }
        }
    }

    private func sectionHeading(_ title: String) -> some View {
        Text(title)
            .font(.headline)
            .foregroundStyle(AppTheme.textPrimary)
            .textCase(nil)
            .padding(.top, 12)
            .accessibilityAddTraits(.isHeader)
    }

    private func refresh() async {
        async let refreshReading: Void = reading.refresh()
        async let refreshOffline: Void = offlineStore.refresh()
        _ = await (refreshReading, refreshOffline)
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
                    .font(serifFont(.title2, .semibold))
                    .foregroundStyle(AppTheme.primary)
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .accessibilityHidden(true)
    }
}
