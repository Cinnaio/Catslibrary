import SwiftUI

/// 小说行（发现页列表项）：封面 + 标题/作者/状态/阅读元信息。
struct NovelCardView: View {
    let novel: Novel
    var isSelected = false

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            NovelCoverView(novel: novel)
            VStack(alignment: .leading, spacing: 5) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(novel.title)
                        .font(serifFont(.headline, .semibold))
                        .foregroundStyle(AppTheme.textPrimary)
                        .appTextLineLimit(2)
                    if novel.hasUpdate {
                        Text("更新")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(AppTheme.primary)
                    }
                }
                Text(novel.author.isEmpty ? "佚名" : novel.author)
                    .font(.subheadline)
                    .foregroundStyle(AppTheme.textSecondary)
                    .appTextLineLimit(1)
                Text(metadataText)
                    .font(.caption)
                    .foregroundStyle(AppTheme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.vertical, 12)
        .padding(.horizontal, 4)
        .background(
            isSelected ? AppTheme.primaryLight.opacity(0.42) : Color.clear,
            in: RoundedRectangle(cornerRadius: 10, style: .continuous)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityText)
        .accessibilityAddTraits(.isButton)
    }

    private var accessibilityText: String {
        var parts = [novel.title, novel.author]
        if let status = novel.statusLabel { parts.append(status) }
        if novel.hasUpdate { parts.append("有更新") }
        parts.append("\(novel.chapterCount) 章")
        return parts.filter { !$0.isEmpty }.joined(separator: "，")
    }

    private var metadataText: String {
        var parts: [String] = []
        if let status = novel.statusLabel { parts.append(status) }
        if let category = novel.categories.first, !category.isEmpty { parts.append(category) }
        parts.append("\(novel.chapterCount) 章")
        if novel.updatedAt > 0 { parts.append(AppFormat.relativeTime(novel.updatedAt)) }
        return parts.joined(separator: " · ")
    }
}

struct NovelCoverView: View {
    let novel: Novel
    var size: CGSize = CGSize(width: 60, height: 86)

    var body: some View {
        CachedAsyncImage(
            url: APIClient.shared.coverURL(novelId: novel.id, updatedAt: novel.updatedAt),
            targetSize: size
        ) { image in
            image.resizable().scaledToFill()
        } placeholder: {
            ZStack {
                AppTheme.primaryLight
                Image(systemName: "book.closed")
                    .foregroundStyle(AppTheme.primary)
            }
        }
        .frame(width: size.width, height: size.height)
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .accessibilityHidden(true)
    }
}

/// 书籍属性使用轻量语义标签，更新状态用品牌色强调。
struct ThemeTagModifier: ViewModifier {
    var emphasized: Bool = false

    func body(content: Content) -> some View {
        content
            .font(.caption.weight(emphasized ? .semibold : .regular))
            .foregroundStyle(emphasized ? AppTheme.primary : AppTheme.textSecondary)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(emphasized ? AppTheme.primaryLight : AppTheme.controlFill, in: Capsule())
    }
}
