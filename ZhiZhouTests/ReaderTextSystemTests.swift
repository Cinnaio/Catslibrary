import XCTest
import UIKit
@testable import ZhiZhou

/// Run with -O as well as Debug: the original initializer could lose its TextKit root
/// at the end of an inner scope before calling UITextView.init(frame:textContainer:).
final class ReaderTextSystemTests: XCTestCase {
    @MainActor
    func testDefaultReaderTextViewSurvivesInitializationAndLayout() {
        weak var storage: NSTextStorage?
        weak var manager: NSLayoutManager?
        let view = autoreleasepool {
            let view = ThoughtSelectableTextView()
            storage = view.textStorage
            manager = view.layoutManager
            return view
        }
        XCTAssertNotNil(storage)
        XCTAssertNotNil(manager)
        XCTAssertTrue(view.layoutManager is ThoughtWaveLayoutManager)
        XCTAssertTrue(view.layoutManager.textStorage === view.textStorage)
        XCTAssertTrue(view.textContainer.layoutManager === view.layoutManager)

        view.attributedText = NSAttributedString(string: "没有段评的普通章节。\n第二段正文。", attributes: [.font: UIFont.systemFont(ofSize: 22)])
        for width: CGFloat in [320, 390, 768] {
            view.frame = CGRect(x: 0, y: 0, width: width, height: 600)
            let size = view.sizeThatFits(CGSize(width: width, height: CGFloat.greatestFiniteMagnitude))
            XCTAssertTrue(size.height.isFinite)
            XCTAssertGreaterThan(size.height, 0)
            view.layoutIfNeeded()
        }
    }

    @MainActor
    func testThoughtWaveCanDrawAfterInitializerLocalsHaveGoneAway() {
        let view = autoreleasepool {
            ThoughtSelectableTextView(frame: CGRect(x: 0, y: 0, width: 320, height: 240), textContainer: nil)
        }
        view.attributedText = NSAttributedString(string: "引用文字含表情🌊，换行后仍能显示波浪线。", attributes: [
            .font: UIFont.systemFont(ofSize: 28),
            .underlineStyle: NSUnderlineStyle.single.rawValue,
            .underlineColor: UIColor.systemOrange,
            .readerThoughtWave: true,
        ])
        view.layoutManager.ensureLayout(for: view.textContainer)
        let range = view.layoutManager.glyphRange(for: view.textContainer)
        XCTAssertGreaterThan(range.length, 0)
        _ = UIGraphicsImageRenderer(size: view.bounds.size).image { _ in
            view.layoutManager.drawGlyphs(forGlyphRange: range, at: .zero)
        }
        XCTAssertEqual(view.textStorage.string, view.attributedText.string)
    }

    @MainActor
    func testInlineThoughtMarkerFollowsTextAndWrapsInsideTheParagraph() throws {
        for width: CGFloat in [160, 320, 600] {
            for fontSize: CGFloat in [22, 34] {
                let view = ThoughtSelectableTextView()
                let body = NSAttributedString(
                    string: "她把信纸展开，字迹仍然清晰，仿佛写信的人刚刚离开。",
                    attributes: [.font: UIFont.systemFont(ofSize: fontSize)]
                )
                view.setBodyText(body, thoughtCount: 12, markerColor: .systemOrange)
                let fitting = view.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude))
                view.frame = CGRect(x: 0, y: 0, width: width, height: fitting.height)
                view.layoutIfNeeded()
                let markerRange = try XCTUnwrap(view.thoughtMarkerRange)
                let markerGlyphs = view.layoutManager.glyphRange(forCharacterRange: markerRange, actualCharacterRange: nil)
                let markerRect = view.layoutManager.boundingRect(forGlyphRange: markerGlyphs, in: view.textContainer)
                let bodyGlyphs = view.layoutManager.glyphRange(forCharacterRange: NSRange(location: body.length - 1, length: 1), actualCharacterRange: nil)
                let bodyEnd = view.layoutManager.boundingRect(forGlyphRange: bodyGlyphs, in: view.textContainer)
                XCTAssertEqual(view.thoughtMarkerButton.frame.minX, markerRect.minX, accuracy: 1)
                XCTAssertGreaterThanOrEqual(markerRect.minY, bodyEnd.minY - 1)
                if abs(markerRect.minY - bodyEnd.minY) < 1 {
                    XCTAssertGreaterThanOrEqual(markerRect.minX, bodyEnd.maxX)
                }
                XCTAssertLessThanOrEqual(view.thoughtMarkerButton.frame.maxX, width + 1)
                XCTAssertLessThanOrEqual(view.thoughtMarkerButton.frame.maxY, fitting.height + 1)
                XCTAssertGreaterThanOrEqual(view.thoughtMarkerButton.bounds.width, 44)
                XCTAssertEqual(view.thoughtMarkerButton.bounds.height, 44)
                XCTAssertEqual(view.thoughtMarkerButton.configuration?.title, "12")
                XCTAssertEqual(view.thoughtMarkerButton.accessibilityLabel, "12 条段评")
            }
        }
    }

    @MainActor
    func testInlineMarkerNeverEntersQuotedTextAndCanBeRemoved() {
        let view = ThoughtSelectableTextView()
        let body = NSAttributedString(string: "引用文字🌊", attributes: [.font: UIFont.systemFont(ofSize: 22)])
        view.setBodyText(body, thoughtCount: 1, markerColor: .systemOrange)
        var quote: String?
        var quoteRange: NSRange?
        view.onThought = { quote = $0; quoteRange = $1 }
        view.selectedRange = NSRange(location: 0, length: view.textStorage.length)
        view.addThoughtFromSelection(nil)
        XCTAssertEqual(quote, body.string)
        XCTAssertEqual(quoteRange, NSRange(location: 0, length: body.length))

        var opened = false
        view.onThoughtMarkerTap = { opened = true }
        view.thoughtMarkerButton.sendActions(for: .touchUpInside)
        XCTAssertTrue(opened)

        view.setBodyText(body, thoughtCount: 0, markerColor: .systemOrange)
        XCTAssertNil(view.thoughtMarkerRange)
        XCTAssertTrue(view.thoughtMarkerButton.isHidden)
        XCTAssertEqual(view.attributedText.string, body.string)
        XCTAssertEqual(view.textContainerInset, .zero)
    }

    @MainActor
    func testPagedThoughtQuoteHasWaveWithoutBackgroundFill() {
        let spec = ChapterPaginator.Spec(
            bodyFont: .systemFont(ofSize: 22), titleFont: .systemFont(ofSize: 28),
            lineSpacing: 12, paragraphSpacing: 20, title: "章节",
            paragraphs: ["她把信纸展开。"], thoughtSelectionsByParagraph: [0: ["信纸"]],
            thoughtUnderlineColor: .systemOrange
        )
        let text = ChapterPaginator.attributedString(for: spec)
        let quoteRange = (text.string as NSString).range(of: "信纸")
        XCTAssertNotEqual(quoteRange.location, NSNotFound)
        XCTAssertEqual(text.attribute(.readerThoughtWave, at: quoteRange.location, effectiveRange: nil) as? Bool, true)
        XCTAssertNil(text.attribute(.backgroundColor, at: quoteRange.location, effectiveRange: nil))
    }

    @MainActor
    func testCallerSuppliedTextSystemIsPreserved() {
        let storage = NSTextStorage(string: "外部文本系统")
        let manager = NSLayoutManager()
        let container = NSTextContainer(size: CGSize(width: 320, height: 600))
        storage.addLayoutManager(manager)
        manager.addTextContainer(container)
        let view = ThoughtSelectableTextView(frame: .zero, textContainer: container)
        XCTAssertTrue(view.textStorage === storage)
        XCTAssertTrue(view.layoutManager === manager)
        XCTAssertTrue(view.textContainer === container)
    }

    @MainActor
    func testOwnedTextSystemCanBeReleasedWithView() {
        weak var releasedView: ThoughtSelectableTextView?
        weak var releasedStorage: NSTextStorage?
        weak var releasedManager: NSLayoutManager?
        autoreleasepool {
            let view = ThoughtSelectableTextView(frame: .zero, textContainer: nil)
            releasedView = view
            releasedStorage = view.textStorage
            releasedManager = view.layoutManager
        }
        XCTAssertNil(releasedView)
        XCTAssertNil(releasedStorage)
        XCTAssertNil(releasedManager)
    }
}
