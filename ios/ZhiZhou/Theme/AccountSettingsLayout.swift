import SwiftUI

/// 账户内页与确认弹窗共用连续纸面；仅输入控件保留独立填充。
struct AccountSettingsPage<Content: View>: View {
    private let content: Content

    init(@ViewBuilder content: () -> Content) { self.content = content() }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 32) { content }
                .padding(.horizontal, 24)
                .padding(.top, 20)
                .padding(.bottom, 32)
                .frame(maxWidth: 700, alignment: .leading)
                .frame(maxWidth: .infinity, alignment: .center)
        }
        .background(ReadingSpace.profilePaper)
        .readingSpaceTopEdge(opaque: false)
        .scrollDismissesKeyboard(.interactively)
        .tint(AppTheme.primary)
        .buttonStyle(.plain)
    }
}

/// 设备与密钥保留原生列表的刷新、复用和侧滑操作。
struct AccountSettingsList<Content: View>: View {
    private let content: Content

    init(@ViewBuilder content: () -> Content) { self.content = content() }

    var body: some View {
        List {
            content
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
                .listRowInsets(EdgeInsets(top: 0, leading: 24, bottom: 0, trailing: 24))
        }
        .modifier(ReadingSpaceRoomListStyle())
        .contentMargins(.top, 20, for: .scrollContent)
        .contentMargins(.bottom, 32, for: .scrollContent)
        .frame(maxWidth: 700)
        .frame(maxWidth: .infinity)
        .background(ReadingSpace.profilePaper)
        .readingSpaceTopEdge(opaque: false)
        .scrollDismissesKeyboard(.interactively)
        .tint(AppTheme.primary)
        .buttonStyle(.plain)
    }
}

struct AccountSettingsHeading: View {
    let title: String
    let detail: String

    init(_ title: String, detail: String) {
        self.title = title
        self.detail = detail
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title)
                .font(.system(.title, design: .serif).weight(.medium))
                .foregroundStyle(ReadingSpace.ink)
                .accessibilityAddTraits(.isHeader)
            AccountSettingsNote(detail)
        }
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct AccountSettingsSection<Content: View>: View {
    let title: String
    private let content: Content

    init(_ title: String, @ViewBuilder content: () -> Content) {
        self.title = title
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(title)
                .font(.system(.title3, design: .serif).weight(.medium))
                .foregroundStyle(ReadingSpace.ink)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct AccountSettingsField<Content: View>: View {
    let title: String
    let isFocused: Bool
    private let content: Content
    @Environment(\.colorSchemeContrast) private var contrast

    init(_ title: String, isFocused: Bool = false, @ViewBuilder content: () -> Content) {
        self.title = title
        self.isFocused = isFocused
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(ReadingSpace.ink)
                .fixedSize(horizontal: false, vertical: true)
            content
                .font(.body)
                .foregroundStyle(ReadingSpace.ink)
                .textFieldStyle(.plain)
                .padding(.horizontal, 16)
                .padding(.vertical, 14)
                .frame(minHeight: AppLayout.minimumTouchTarget)
                .background(ReadingSpace.profileFill, in: RoundedRectangle(cornerRadius: 14))
                .overlay {
                    RoundedRectangle(cornerRadius: 14)
                        .strokeBorder(
                            isFocused ? AppTheme.primary : contrast == .increased ? ReadingSpace.profileMuted : ReadingSpace.profileLine,
                            lineWidth: isFocused || contrast == .increased ? 1.5 : 0.75
                        )
                        .allowsHitTesting(false)
                }
        }
    }
}

struct AccountSettingsNote: View {
    let text: String
    var isError = false

    init(_ text: String, isError: Bool = false) {
        self.text = text
        self.isError = isError
    }

    var body: some View {
        Text(text)
            .font(.footnote)
            .foregroundStyle(isError ? AppTheme.danger : ReadingSpace.profileMuted)
            .lineSpacing(4)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .textSelection(.enabled)
    }
}

/// 等待状态只替换图标，按钮的标题和占位始终保留。
struct AccountSettingsActionLabel: View {
    let title: String
    let symbol: String
    var isWorking = false
    var destructive = false
    var prominent = false
    @Environment(\.isEnabled) private var isEnabled

    var body: some View {
        HStack(spacing: 12) {
            Group {
                if isWorking { ProgressView().tint(prominent ? AppTheme.onPrimary : AppTheme.primary) }
                else { Image(systemName: symbol) }
            }
            .frame(width: AppLayout.iconSlot)
            .accessibilityHidden(true)
            Text(title)
                .fixedSize(horizontal: false, vertical: true)
        }
        .font(.subheadline.weight(prominent ? .medium : .regular))
        .foregroundStyle(prominent ? AppTheme.onPrimary : destructive ? AppTheme.danger : ReadingSpace.ink)
        .padding(.horizontal, prominent ? 16 : 0)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, minHeight: AppLayout.minimumTouchTarget, alignment: prominent ? .center : .leading)
        .background(prominent ? AppTheme.primary : Color.clear, in: RoundedRectangle(cornerRadius: 16))
        .contentShape(Rectangle())
        .opacity(isEnabled || isWorking ? 1 : 0.45)
        .accessibilityElement(children: .combine)
        .accessibilityValue(isWorking ? "正在处理" : "")
    }
}
