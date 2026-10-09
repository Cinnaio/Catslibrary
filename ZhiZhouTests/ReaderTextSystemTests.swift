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
