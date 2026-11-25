import SwiftUI
import UIKit

/// 按当前窗口的可用宽度排版，同一导航层级覆盖全屏、分屏和自由窗口。
enum ReadingSpaceWindowLayout {
    // 先隔离设备，再按 iPad 窗口宽度适配，避免横屏 iPhone 进入平板布局。
    @MainActor static var usesIPadLayout: Bool { UIDevice.current.userInterfaceIdiom == .pad }

    static let bookshelfWidth: CGFloat = 1080
    static let creationWidth: CGFloat = 640
    static let coverSpacing: CGFloat = 22

    static func coverColumns(for width: CGFloat) -> Int {
        let contentWidth = max(0, min(width, bookshelfWidth) - 44)
        return min(6, max(1, Int((contentWidth + coverSpacing) / (152 + coverSpacing))))
    }

    /// 宽窗口同时保留至少约 600pt 的正文区域；窄窗口与无障碍字号使用弹层。
    static func readerToolWidth(for width: CGFloat, accessibility: Bool) -> CGFloat? {
        guard width >= 960, !accessibility else { return nil }
        return min(360, width * 0.32)
    }

    static func historyWidth(for width: CGFloat, accessibility: Bool) -> CGFloat {
        if width >= 820 && !accessibility { return min(320, max(280, width * 0.28)) }
        return min(340, max(0, width - (accessibility ? 52 : 76)))
    }
}

/// 放在 ScrollView 中按需创建封面，每本书拥有独立点击与长按区域。
struct ReadingSpaceCoverGrid<Item: Identifiable, Content: View>: View {
    let items: [Item]
    let columns: Int
    @ViewBuilder var content: (Item) -> Content

    var body: some View {
        LazyVGrid(
            columns: Array(repeating: GridItem(.flexible(minimum: 0), spacing: ReadingSpaceWindowLayout.coverSpacing, alignment: .top), count: max(1, columns)),
            alignment: .leading,
            spacing: 24
        ) {
            ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                content(item)
                    .frame(minWidth: 0, maxWidth: .infinity, alignment: .topLeading)
                    .readingSpaceEntrance(index)
            }
        }
    }
}
