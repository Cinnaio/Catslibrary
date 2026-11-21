import SwiftUI

/// 后台工作台共用连续纸面；保留原生列表的复用、刷新与操作。
struct AdminWorkspaceList<Content: View>: View {
    private let content: Content

    init(@ViewBuilder content: () -> Content) { self.content = content() }

    var body: some View {
        List {
            content
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
                .listRowInsets(EdgeInsets(top: 8, leading: 24, bottom: 8, trailing: 24))
        }
        .modifier(ReadingSpaceRoomListStyle())
        .contentMargins(.bottom, 32, for: .scrollContent)
        .frame(maxWidth: 820)
        .frame(maxWidth: .infinity)
        .background(ReadingSpace.profilePaper)
        .foregroundStyle(ReadingSpace.ink)
        .tint(AppTheme.primary)
        .readingSpaceNavigation()
        .scrollDismissesKeyboard(.interactively)
    }
}

struct AdminWorkspaceHeading: View {
    let title: String
    var detail: String = ""

    init(_ title: String, detail: String = "") {
        self.title = title
        self.detail = detail
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(serifFont(.title, .medium))
                .foregroundStyle(ReadingSpace.ink)
                .accessibilityAddTraits(.isHeader)
            if !detail.isEmpty {
                Text(detail)
                    .font(.footnote)
                    .foregroundStyle(ReadingSpace.profileMuted)
                    .lineSpacing(3)
            }
        }
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.top, 12)
        .padding(.bottom, 8)
    }
}

/// 分区标题是普通内容行，随正文滚动，不产生吸顶背景。
struct AdminWorkspaceSection<Content: View>: View {
    let title: String
    private let content: Content

    init(_ title: String, @ViewBuilder content: () -> Content) {
        self.title = title
        self.content = content()
    }

    var body: some View {
        Group {
            Text(title)
                .font(serifFont(.title3, .medium))
                .foregroundStyle(ReadingSpace.ink)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 16)
                .padding(.bottom, 2)
                .accessibilityAddTraits(.isHeader)
            content
        }
    }
}

struct AdminWorkspaceEntry: View {
    let title: String
    let systemImage: String
    var detail: String = ""

    init(_ title: String, systemImage: String, detail: String = "") {
        self.title = title
        self.systemImage = systemImage
        self.detail = detail
    }

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: systemImage)
                .font(.body)
                .foregroundStyle(ReadingSpace.profileMuted)
                .frame(width: 24)
                .frame(minHeight: 24)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.body.weight(.medium))
                    .foregroundStyle(ReadingSpace.ink)
                if !detail.isEmpty {
                    Text(detail)
                        .font(.footnote)
                        .foregroundStyle(ReadingSpace.profileMuted)
                        .lineSpacing(2)
                }
            }
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.vertical, 4)
        .frame(minHeight: AppLayout.minimumTouchTarget, alignment: .leading)
        .contentShape(Rectangle())
    }
}
