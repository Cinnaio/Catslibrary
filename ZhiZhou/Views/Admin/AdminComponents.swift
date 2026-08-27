import SwiftUI

/// 后台列表中统一使用的轻量状态标签。
struct AdminStatusBadge: View {
    let title: String
    let tint: Color
    var systemImage: String?

    init(_ title: String, tint: Color, systemImage: String? = nil) {
        self.title = title
        self.tint = tint
        self.systemImage = systemImage
    }

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: systemImage ?? "circle.fill")
                .font(.system(size: systemImage == nil ? 6 : 9, weight: .semibold))
            Text(title)
        }
        .font(.caption2.weight(.medium))
        .foregroundStyle(tint)
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(tint.opacity(0.13), in: Capsule())
        .accessibilityElement(children: .combine)
    }
}

/// 用于替换正在执行操作的菜单或按钮，避免后台操作看起来像“没有响应”。
struct AdminInlineProgress: View {
    var body: some View {
        ProgressView()
            .controlSize(.small)
            .frame(width: 32, height: 32)
            .accessibilityLabel("处理中")
    }
}

/// 管理后台统一的紧凑筛选横条：多个筛选条件共享一行，超出窄屏时可横向滚动。
struct AdminFilterBar<Content: View>: View {
    private let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                content
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 4)
        }
        .scrollClipDisabled()
        .listRowInsets(EdgeInsets())
        .listRowBackground(Color.clear)
        .listRowSeparator(.hidden)
    }
}

/// 管理后台统一的筛选菜单按钮：保留原生 Menu 行为，视觉上收敛为轻量胶囊。
struct AdminFilterMenu<Content: View>: View {
    let title: String
    let value: String
    private let content: Content

    init(_ title: String, value: String, @ViewBuilder content: () -> Content) {
        self.title = title
        self.value = value
        self.content = content()
    }

    var body: some View {
        Menu {
            content
        } label: {
            HStack(spacing: 6) {
                Text("\(title) · \(value)")
                    .lineLimit(1)
                Image(systemName: "chevron.down")
                    .font(.caption2.weight(.semibold))
            }
            .font(.subheadline.weight(.medium))
            .foregroundStyle(AppTheme.textPrimary)
            .padding(.horizontal, 12)
            .frame(minHeight: 44)
            .background(AppTheme.surface, in: Capsule())
            .overlay(
                Capsule()
                    .strokeBorder(AppTheme.border, lineWidth: 1)
            )
        }
        .accessibilityLabel(title)
        .accessibilityValue(value)
    }
}
