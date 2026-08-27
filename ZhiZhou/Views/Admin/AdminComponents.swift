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
