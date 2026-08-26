import SwiftUI

/// 小说卡片（发现页列表项）：封面 + 标题/作者/简介/分类。
struct NovelCardView: View {
    let novel: Novel

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            cover
            VStack(alignment: .leading, spacing: 6) {
                Text(novel.title)
                    .font(serifFont(.headline, .semibold))
                    .foregroundStyle(AppTheme.textPrimary)
                    .lineLimit(2)
                Text(novel.author)
                    .font(.subheadline)
                    .foregroundStyle(AppTheme.textSecondary)
                    .lineLimit(1)
                if !novel.description.isEmpty {
                    Text(novel.description)
                        .font(.footnote)
                        .foregroundStyle(AppTheme.textSecondary)
                        .lineLimit(2)
                }
                HStack(spacing: 8) {
                    if let status = novel.statusLabel {
                        Text(status)
                            .modifier(ThemeTagModifier())
                    }
                    if novel.hasUpdate {
                        Text("有更新")
                            .modifier(ThemeTagModifier(emphasized: true))
                    }
                    ForEach(novel.categories.prefix(2), id: \.self) { category in
                        Text(category)
                            .modifier(ThemeTagModifier())
                    }
                    Spacer(minLength: 0)
                    Text("\(novel.chapterCount) 章")
                        .font(.caption)
                        .foregroundStyle(AppTheme.textMuted)
                }
            }
        }
        .padding(12)
        .paperCard(cornerRadius: 18)
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

    private var cover: some View {
        CachedAsyncImage(
            url: APIClient.shared.coverURL(novelId: novel.id, updatedAt: novel.updatedAt),
            targetSize: CGSize(width: 76, height: 108)
        ) { image in
            image.resizable().scaledToFill()
        } placeholder: {
            ZStack {
                AppTheme.primaryLight
                Image(systemName: "book.closed")
                    .foregroundStyle(AppTheme.primary)
            }
        }
        .frame(width: 76, height: 108)
        .clipShape(RoundedRectangle(cornerRadius: 8))
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
