import XCTest
@testable import ZhiZhouCore

final class ThoughtAnchorTests: XCTestCase {
    func testMovedParagraphUsesFingerprintInsteadOfOldIndex() {
        let original = "她把信纸展开。"
        XCTAssertEqual(ThoughtAnchor.resolve(index: 0, hash: IllustrationAnchor.contentHash(original), selection: "信纸",
                                            paragraphs: ["新插入的开场。", original], sourceText: ""), 1)
    }

    func testChangedAndAmbiguousParagraphsAreNotMisattached() {
        let hash = IllustrationAnchor.contentHash("原文")
        XCTAssertNil(ThoughtAnchor.resolve(index: 0, hash: hash, selection: "原文", paragraphs: ["别的文字"], sourceText: ""))
        XCTAssertNil(ThoughtAnchor.resolve(index: 0, hash: hash, selection: "原文", paragraphs: ["开场", "原文", "原文"], sourceText: ""))
        XCTAssertEqual(ThoughtAnchor.resolve(index: 1, hash: hash, selection: "原文", paragraphs: ["开场", "原文", "原文"], sourceText: ""), 1)
    }

    func testLegacyWithoutFingerprintRequiresValidIndex() {
        XCTAssertEqual(ThoughtAnchor.resolve(index: 0, hash: "", selection: "", paragraphs: ["原文"], sourceText: ""), 0)
        XCTAssertNil(ThoughtAnchor.resolve(index: 2, hash: "", selection: "", paragraphs: ["原文"], sourceText: ""))
    }

    func testHistoricalWholeSourceAnchorRelocatesUniqueQuote() {
        let source = "庭院落雨。\r她展开信纸。"
        XCTAssertEqual(ThoughtAnchor.resolve(index: 0, hash: IllustrationAnchor.contentHash(source), selection: "展开信纸",
                                            paragraphs: ["庭院落雨。", "她展开信纸。"], sourceText: source), 1)
    }

    func testWebNormalizedQuoteMapsBackToOriginalWhitespaceAndEmoji() {
        let text = "猫🐱把信纸\u{3000}  展开，\n 字迹清晰。"
        let quote = "🐱把信纸 展开， 字迹"
        let expected = (text as NSString).range(of: "🐱把信纸\u{3000}  展开，\n 字迹")
        XCTAssertEqual(ReaderTextHighlight.ranges(in: text, matching: [quote, quote]), [expected])
    }

    func testNormalizationStillMarksRepeatedQuotesInUTF16Coordinates() {
        let text = "信纸  展开；信纸\n展开"
        XCTAssertEqual(ReaderTextHighlight.ranges(in: text, matching: ["信纸 展开"]),
                       [(text as NSString).range(of: "信纸  展开"), (text as NSString).range(of: "信纸\n展开")])
    }

    func testThoughtWithoutQuoteMarksWholeParagraphButEmptyThoughtListDoesNot() {
        XCTAssertEqual(ReaderTextHighlight.ranges(in: "整段想法🐱", matching: [""], includeParagraph: true),
                       [NSRange(location: 0, length: "整段想法🐱".utf16.count)])
        XCTAssertTrue(ReaderTextHighlight.ranges(in: "正文", matching: []).isEmpty)
    }
}
