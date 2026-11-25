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

    static func historyWidth(for width: CGFloat, accessibility: Bool) -> CGFloat {
        if width >= 820 && !accessibility { return min(320, max(280, width * 0.28)) }
        return min(340, max(0, width - (accessibility ? 52 : 76)))
    }
}

/// 每一行交给原生 List 回收，长书架不一次创建全部封面。
struct ReadingSpaceCoverRows<Item: Identifiable, Content: View>: View {
    let items: [Item]
    let columns: Int
    @ViewBuilder var content: (Item) -> Content

    var body: some View {
        ForEach(Array(stride(from: 0, to: items.count, by: columns)), id: \.self) { offset in
            HStack(alignment: .top, spacing: ReadingSpaceWindowLayout.coverSpacing) {
                ForEach(0..<columns, id: \.self) { column in
                    if offset + column < items.count {
                        content(items[offset + column])
                            .frame(minWidth: 0, maxWidth: .infinity)
                            .readingSpaceEntrance(offset + column)
                    } else {
                        Color.clear.frame(minWidth: 0, maxWidth: .infinity).accessibilityHidden(true)
                    }
                }
            }
            .buttonStyle(.plain)
            .padding(.vertical, 12)
            .listRowInsets(EdgeInsets(top: 0, leading: 22, bottom: 0, trailing: 22))
            .listRowBackground(Color.clear)
            .listRowSeparator(.hidden)
        }
    }
}
