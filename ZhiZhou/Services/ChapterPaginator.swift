import UIKit

/// 章节分页：把正文按给定字号/行距/视口尺寸切成多个 NSAttributedString 页。
/// 基于 TextKit（NSLayoutManager + 逐页添加 NSTextContainer）排版，与 SwiftUI 渲染同源同宽度。
enum ChapterPaginator {
    /// 排版规格：字体、行距、段距、标题与段落。
    struct Spec: @unchecked Sendable {
        let bodyFont: UIFont
        let titleFont: UIFont
        let lineSpacing: CGFloat
        let paragraphSpacing: CGFloat
        let title: String
        let paragraphs: [String]
    }

    /// 组装整章排版用的富文本（标题 + 首行缩进 + 段间距）。
    static func attributedString(for spec: Spec) -> NSAttributedString {
        let result = NSMutableAttributedString()

        let titlePS = NSMutableParagraphStyle()
        titlePS.lineSpacing = 6
        titlePS.paragraphSpacing = spec.paragraphSpacing
        titlePS.alignment = .left
        result.append(NSAttributedString(string: spec.title + "\n", attributes: [
            .font: spec.titleFont,
            .paragraphStyle: titlePS,
        ]))

        let bodyPS = NSMutableParagraphStyle()
        bodyPS.lineSpacing = spec.lineSpacing
        bodyPS.paragraphSpacing = spec.paragraphSpacing
        bodyPS.alignment = .justified
        bodyPS.lineBreakMode = .byWordWrapping
        for (index, paragraph) in spec.paragraphs.enumerated() {
            if index > 0 { result.append(NSAttributedString(string: "\n")) }
            result.append(NSAttributedString(string: paragraphIndent + paragraph, attributes: [
                .font: spec.bodyFont,
                .paragraphStyle: bodyPS,
            ]))
        }
        return result
    }

    /// 一页的排版结果：页面文本 + 该页在整章富文本中的字符区间。
    /// 保存区间后，调整字号/行距重新分页时可以按“当前页开头字符”定位，避免正文偏移。
    struct Page: @unchecked Sendable {
        let attributed: NSAttributedString
        let range: NSRange
    }

    /// 按视口尺寸切页，返回每页对应的富文本与字符区间。
    static func pages(
        of attributed: NSAttributedString,
        pageSize: CGSize,
        isCancelled: @escaping @Sendable () -> Bool = { false }
    ) -> [Page] {
        guard pageSize.width > 1, pageSize.height > 1 else { return [] }
        let storage = NSTextStorage(attributedString: attributed)
        let layout = NSLayoutManager()
        storage.addLayoutManager(layout)

        var pages: [Page] = []
        var lastLocation = -1
        while !isCancelled() {
            let container = NSTextContainer(size: pageSize)
            container.lineFragmentPadding = 0
            layout.addTextContainer(container)
            layout.ensureLayout(for: container)
            let glyphRange = layout.glyphRange(for: container)
            let charRange = layout.characterRange(forGlyphRange: glyphRange, actualGlyphRange: nil)
            guard charRange.length > 0 else { break }
            // 防止 TextKit 在异常输入下重复返回相同区间；不再用固定页数上限
            // 静默截断超长章节。
            guard charRange.location > lastLocation else { break }
            lastLocation = charRange.location
            pages.append(Page(
                attributed: attributed.attributedSubstring(from: charRange),
                range: charRange
            ))
            if charRange.location + charRange.length >= attributed.length { break }
        }
        return pages
    }
}
