import SwiftUI

/// 默认显示前三条，展开按钮留在原位，长一点的明细也能就地收起。
struct ReadingSpaceSummaryRows<Item: Identifiable, Row: View>: View {
    private let items: [Item]
    private let moreTitle: String?
    private let lessTitle: String
    private let row: (Item, Bool) -> Row
    @State private var isExpanded = false

    init(
        _ items: [Item],
        moreTitle: String? = nil,
        lessTitle: String = "收起明细",
        @ViewBuilder row: @escaping (Item, Bool) -> Row
    ) {
        self.items = items
        self.moreTitle = moreTitle
        self.lessTitle = lessTitle
        self.row = row
    }

    var body: some View {
        let hasMore = items.count > 3
        ForEach(Array(items.prefix(3).enumerated()), id: \.element.id) { index, item in
            row(item, isExpanded || !hasMore)
                .readingSpaceEntrance(index)
        }
        if hasMore {
            Button {
                isExpanded.toggle()
            } label: {
                HStack(spacing: 8) {
                    Text(isExpanded ? lessTitle : moreTitle ?? "查看其余 \(items.count - 3) 条")
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 0)
                    Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                        .font(.caption.weight(.medium))
                        .accessibilityHidden(true)
                }
                .font(.subheadline.weight(.medium))
                .foregroundStyle(AppTheme.primary)
                .frame(minHeight: AppLayout.minimumTouchTarget)
                .contentShape(Rectangle())
            }
            .buttonStyle(.borderless)
            if isExpanded {
                ForEach(Array(items.dropFirst(3).enumerated()), id: \.element.id) { index, item in
                    row(item, true)
                        .readingSpaceEntrance(index)
                }
            }
        }
    }
}

/// 主标签与可比较的值同行，空间不足时将值移到标签下方。
struct ReadingSpaceSummaryRow: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let title: String
    let value: String
    var detail = ""
    var isBookTitle = false
    var valueTint = ReadingSpace.ink

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            if dynamicTypeSize >= .xxxLarge {
                stacked
            } else {
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .firstTextBaseline, spacing: 12) {
                        label
                            .frame(maxWidth: .infinity, alignment: .leading)
                        metric
                            .fixedSize(horizontal: true, vertical: false)
                    }
                    stacked
                }
            }
            if !detail.isEmpty {
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(ReadingSpace.profileMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.bottom, 6)
        .overlay(alignment: .bottom) {
            Divider()
                .overlay(ReadingSpace.profileLine)
                .allowsHitTesting(false)
                .accessibilityHidden(true)
        }
        .accessibilityElement(children: .combine)
    }

    private var stacked: some View {
        VStack(alignment: .leading, spacing: 4) {
            label
            metric
        }
    }

    private var label: some View {
        Text(title)
            .font(isBookTitle ? serifFont(.subheadline, .medium) : .subheadline.weight(.medium))
            .foregroundStyle(ReadingSpace.ink)
            .fixedSize(horizontal: false, vertical: true)
    }

    private var metric: some View {
        Text(value)
            .font(.subheadline.weight(.medium))
            .monospacedDigit()
            .foregroundStyle(valueTint)
    }
}
