import SwiftUI

/// 发现页作品在双列封面和紧凑列表之间共用书目信息。
struct NovelCardView: View {
    let novel: Novel
    var isSelected = false
    var isCoverLayout = false

    var body: some View {
        let layout = isCoverLayout
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 12))
            : AnyLayout(HStackLayout(alignment: .top, spacing: 14))
        layout {
            if isCoverLayout {
                Color.clear
                    .aspectRatio(0.7, contentMode: .fit)
                    .overlay {
                        GeometryReader { geometry in
                            NovelCoverView(novel: novel, size: geometry.size)
                        }
                    }
                    .shadow(color: AppTheme.cardShadow, radius: 8, y: 4)
                    .accessibilityHidden(true)
            } else {
                NovelCoverView(novel: novel)
            }
            VStack(alignment: .leading, spacing: 5) {
                Text(novel.title)
                    .font(serifFont(.headline, .medium))
                    .foregroundStyle(ReadingSpace.ink)
                    .appTextLineLimit(2)
                Text(novel.author.isEmpty ? "佚名" : novel.author)
                    .font(.footnote)
                    .foregroundStyle(ReadingSpace.profileMuted)
                    .appTextLineLimit(1)
                Text(metadataText)
                    .font(.caption)
                    .foregroundStyle(novel.hasUpdate ? AppTheme.primary : ReadingSpace.profileMuted)
                    .appTextLineLimit(2)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.vertical, isCoverLayout ? 0 : 14)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(
            isSelected ? ReadingSpace.profileFill : Color.clear,
            in: RoundedRectangle(cornerRadius: 12, style: .continuous)
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
        if novel.hasUpdate { parts.append("有更新") }
        if let status = novel.statusLabel { parts.append(status) }
        if !isCoverLayout, let category = novel.categories.first, !category.isEmpty { parts.append(category) }
        parts.append("\(novel.chapterCount) 章")
        if !isCoverLayout, novel.updatedAt > 0 { parts.append(AppFormat.relativeTime(novel.updatedAt)) }
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
                ReadingSpace.profileFill
                Image(systemName: "book.closed")
                    .foregroundStyle(AppTheme.primary.opacity(0.6))
            }
            .paperShimmer()
        }
        .frame(width: size.width, height: size.height)
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .accessibilityHidden(true)
    }
}
