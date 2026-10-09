import UIKit
import ZhiZhouCore

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
        let thoughtSelectionsByParagraph: [Int: [String]]
        let thoughtHighlightColor: UIColor
        let thoughtUnderlineColor: UIColor
        var illustrations: [IllustrationPlacement] = []
    }

    struct IllustrationPlacement: Sendable {
        let characterOffset: Int
        let illustration: ChapterIllustration
    }

    /// 正文坐标不插入占位字符，隐藏插图后仍能用同一字符锚点恢复。
    static func paragraphOffsets(title: String, paragraphs: [String]) -> [Int] {
        var cursor = title.utf16.count + 1
        return paragraphs.enumerated().map { index, text in
            if index > 0 { cursor += 1 }
            let start = cursor
            cursor += (paragraphIndent + text).utf16.count
            return start
        }
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
            let renderedParagraph = NSMutableAttributedString(
                string: paragraphIndent + paragraph,
                attributes: [
                    .font: spec.bodyFont,
                    .paragraphStyle: bodyPS,
                ]
            )
            let indentLength = paragraphIndent.utf16.count
            for range in ReaderTextHighlight.ranges(
                in: paragraph,
                matching: spec.thoughtSelectionsByParagraph[index] ?? [],
                includeParagraph: (spec.thoughtSelectionsByParagraph[index] ?? []).contains { IllustrationAnchor.normalize($0).isEmpty }
            ) {
                renderedParagraph.addAttributes(
                    [
                        .backgroundColor: spec.thoughtHighlightColor,
                        .underlineColor: spec.thoughtUnderlineColor,
                        .underlineStyle: NSUnderlineStyle.single.rawValue,
                        .readerThoughtWave: true,
                    ],
                    range: NSRange(
                        location: indentLength + range.location,
                        length: range.length
                    )
                )
            }
            result.append(renderedParagraph)
        }
        return result
    }

    /// 一页的排版结果：页面文本 + 该页在整章富文本中的字符区间。
    /// 保存区间后，调整字号/行距重新分页时可以按“当前页开头字符”定位，避免正文偏移。
    struct Page: @unchecked Sendable {
        let attributed: NSAttributedString
        let range: NSRange
        var illustration: ChapterIllustration? = nil
    }

    static func illustratedPages(of attributed: NSAttributedString, placements: [IllustrationPlacement],
                                 pageSize: CGSize, isCancelled: @escaping @Sendable () -> Bool) -> [Page] {
        var result: [Page] = []
        let segments = ReaderMediaLayout.segments(textLength: attributed.length, insertions: placements.map {
            ReaderMediaLayout.Insertion(id: $0.illustration.id, offset: $0.characterOffset, order: $0.illustration.order)
        })
        for segment in segments {
            guard !isCancelled() else { return [] }
            if let id = segment.illustrationID,
               let item = placements.first(where: { $0.illustration.id == id })?.illustration {
                result.append(Page(attributed: NSAttributedString(string: ""), range: segment.range, illustration: item))
            } else {
                let chunk = attributed.attributedSubstring(from: segment.range)
                result += pages(of: chunk, pageSize: pageSize, isCancelled: isCancelled).map {
                    Page(attributed: $0.attributed, range: NSRange(location: segment.range.location + $0.range.location, length: $0.range.length))
                }
            }
        }
        return result
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
