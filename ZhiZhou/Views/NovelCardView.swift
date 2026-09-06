import SwiftUI

/// 小说卡片（发现页列表项）：封面 + 标题/作者/状态/阅读元信息。
struct NovelCardView: View {
    let novel: Novel
    var isSelected = false

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            NovelCoverView(novel: novel)
            VStack(alignment: .leading, spacing: 5) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    if let status = novel.statusLabel {
                        Text(status)
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(AppTheme.primary)
                    }
                    Spacer(minLength: 0)
                    if novel.hasUpdate {
                        Text("有更新")
                            .modifier(ThemeTagModifier(emphasized: true))
                    }
                }
                Text(novel.title)
                    .font(serifFont(.headline, .semibold))
                    .foregroundStyle(AppTheme.textPrimary)
                    .lineLimit(2)
                Text(novel.author.isEmpty ? "佚名" : novel.author)
                    .font(.subheadline)
                    .foregroundStyle(AppTheme.textSecondary)
                    .lineLimit(1)
                HStack(spacing: 7) {
                    if let category = novel.categories.first, !category.isEmpty {
                        Text(category)
                            .foregroundStyle(AppTheme.primary)
                    }
                    Text("\(novel.chapterCount) 章")
                    if novel.updatedAt > 0 {
                        Text("·")
                        Text(AppFormat.relativeTime(novel.updatedAt))
                    }
                }
                .font(.caption)
                .foregroundStyle(AppTheme.textMuted)
                if novel.categories.count > 1 {
                    HStack(spacing: 8) {
                        ForEach(novel.categories.dropFirst().prefix(2), id: \.self) { category in
                            Text(category)
                                .modifier(ThemeTagModifier())
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
        .padding(12)
        .background(AppTheme.surface, in: RoundedRectangle(cornerRadius: AppTheme.cardCornerRadius, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: AppTheme.cardCornerRadius, style: .continuous)
                .strokeBorder(
                    isSelected ? AppTheme.primary.opacity(0.78) : AppTheme.border.opacity(0.72),
                    lineWidth: isSelected ? 1.4 : 0.8
                )
        }
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
}

struct NovelCoverView: View {
    let novel: Novel
    var size: CGSize = CGSize(width: 72, height: 104)

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

/// 分类/属性标签贴纸：语义表面 + 强调描边（跟随深浅色）
struct ThemeTagModifier: ViewModifier {
    var emphasized: Bool = false

    func body(content: Content) -> some View {
        content
            .font(.caption2.weight(emphasized ? .semibold : .regular))
            .foregroundStyle(emphasized ? AppTheme.seal : AppTheme.primary)
            .padding(.horizontal, 8)
            .padding(.vertical, 5)
            .background(AppTheme.primaryLight.opacity(0.86), in: Capsule())
            .overlay(Capsule().strokeBorder(emphasized ? AppTheme.seal.opacity(0.35) : AppTheme.border, lineWidth: 0.75))
    }
}
