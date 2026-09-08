import SwiftUI

enum AppPageStyle {
    case browsing
    case settings

    var background: Color {
        switch self {
        case .browsing: return AppTheme.canvas
        case .settings: return AppTheme.background
        }
    }
}

enum AppLayout {
    static let minimumTouchTarget: CGFloat = 44
    static let pageInset: CGFloat = 16
    static let readableWidth: CGFloat = 600
    static let iconSlot: CGFloat = 24

    static func readableInset(for width: CGFloat) -> CGFloat {
        max(pageInset, (width - readableWidth) / 2)
    }
}

struct AppIconLabel: View {
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
                .frame(width: AppLayout.iconSlot, height: AppLayout.iconSlot)
                .accessibilityHidden(true)
        }
    }
}

/// 元信息与同行操作在大字体时纵向排列，避免挤压主要内容。
struct AppAdaptiveRow<Content: View>: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    private let spacing: CGFloat
    private let content: Content

    init(spacing: CGFloat = 8, @ViewBuilder content: () -> Content) {
        self.spacing = spacing
        self.content = content()
    }

    var body: some View {
        let layout = dynamicTypeSize >= .xxxLarge
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: spacing))
            : AnyLayout(HStackLayout(alignment: .firstTextBaseline, spacing: spacing))
        layout { content }
    }
}

extension View {
    func appListStyle(_ style: AppPageStyle, maximumWidth: CGFloat? = 800) -> some View {
        modifier(AppListStyleModifier(style: style, maximumWidth: maximumWidth))
    }

    func accessibleSegmentedPicker() -> some View {
        modifier(AccessibleSegmentedPickerModifier())
    }

    /// 保留常规列表密度；辅助功能字号允许完整换行。
    func appTextLineLimit(_ limit: Int) -> some View {
        modifier(AppTextLineLimitModifier(limit: limit))
    }

    func chapterTitleStyle() -> some View {
        font(.body)
            .appTextLineLimit(2)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct AppListStyleModifier: ViewModifier {
    let style: AppPageStyle
    let maximumWidth: CGFloat?

    func body(content: Content) -> some View {
        Group {
            switch style {
            case .browsing:
                if let maximumWidth {
                    GeometryReader { geometry in
                        content
                            .listStyle(.plain)
                            .contentMargins(.horizontal, max(0, (geometry.size.width - maximumWidth) / 2), for: .scrollContent)
                    }
                } else {
                    content.listStyle(.plain)
                }
            case .settings: content.listStyle(.insetGrouped)
            }
        }
        .scrollContentBackground(.hidden)
        .environment(\.defaultMinListRowHeight, AppLayout.minimumTouchTarget)
        .pageBackground(style)
    }
}

private struct AccessibleSegmentedPickerModifier: ViewModifier {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    func body(content: Content) -> some View {
        if dynamicTypeSize >= .xxxLarge {
            content.pickerStyle(.menu)
                .frame(minHeight: AppLayout.minimumTouchTarget)
        } else {
            content.pickerStyle(.segmented)
                .frame(minHeight: AppLayout.minimumTouchTarget)
        }
    }
}

private struct AppTextLineLimitModifier: ViewModifier {
    let limit: Int
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    func body(content: Content) -> some View {
        content
            .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : limit)
            .fixedSize(horizontal: false, vertical: true)
    }
}
