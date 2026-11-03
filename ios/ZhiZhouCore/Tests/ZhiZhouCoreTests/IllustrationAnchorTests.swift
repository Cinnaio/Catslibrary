import XCTest
@testable import ZhiZhouCore

final class IllustrationAnchorTests: XCTestCase {
    func testMediaSegmentsKeepEveryUTF16CharacterExactlyOnceAndStableImageOrder() {
        let text = "正文😀后续文字" as NSString
        let segments = ReaderMediaLayout.segments(textLength: text.length, insertions: [
            .init(id: "end", offset: text.length, order: 1),
            .init(id: "second", offset: 4, order: 2),
            .init(id: "start", offset: 0, order: 1),
            .init(id: "first", offset: 4, order: 1),
        ])
        let ranges = segments.filter { $0.illustrationID == nil }.map(\.range)
        XCTAssertEqual(ranges, [NSRange(location: 0, length: 4), NSRange(location: 4, length: text.length - 4)])
        XCTAssertEqual(ranges.map { text.substring(with: $0) }.joined(), text as String)
        XCTAssertEqual(segments.compactMap(\.illustrationID), ["start", "first", "second", "end"])
        XCTAssertTrue(segments.filter { $0.illustrationID != nil }.allSatisfy { $0.range.length == 0 })
        XCTAssertEqual(ReaderMediaLayout.segments(textLength: text.length, insertions: []).map(\.range), [NSRange(location: 0, length: text.length)])
    }

    func testMediaOffsetsOutsideTextAreClampedWithoutLosingText() {
        let segments = ReaderMediaLayout.segments(textLength: 3, insertions: [.init(id: "before", offset: -10, order: 0), .init(id: "after", offset: 100, order: 0)])
        XCTAssertEqual(segments.map(\.range), [NSRange(location: 0, length: 0), NSRange(location: 0, length: 3), NSRange(location: 3, length: 0)])
    }

    func testStartAndEndAreIndependentOfParagraphEdits() {
        XCTAssertEqual(IllustrationAnchor(position: "start", paragraphIndex: 0, paragraphText: "").resolve(in: ["正文"], sameRevision: false), -1)
        XCTAssertEqual(IllustrationAnchor(position: "end", paragraphIndex: 0, paragraphText: "").resolve(in: ["正文", "末段"], sameRevision: false), 2)
    }

    func testChangedChapterLocatesUniqueTextInsteadOfOldIndex() {
        let anchor = IllustrationAnchor(position: "after", paragraphIndex: 0, paragraphText: "目标\n段落")
        XCTAssertEqual(anchor.resolve(in: ["新段落", "目标 段落"], sameRevision: false), 1)
    }

    func testRepeatedParagraphsRequireUniqueContextAfterRevisionChange() {
        let anchor = IllustrationAnchor(position: "after", paragraphIndex: 1, paragraphText: "重复", previousText: "乙", nextText: "末尾")
        XCTAssertEqual(anchor.resolve(in: ["甲", "重复", "乙", "重复", "末尾"], sameRevision: false), 3)
        XCTAssertNil(anchor.resolve(in: ["甲", "重复", "甲", "重复"], sameRevision: false))
    }

    func testSameRevisionCanUseVerifiedIndexForDuplicateParagraphs() {
        let anchor = IllustrationAnchor(position: "after", paragraphIndex: 2, paragraphText: "重复")
        XCTAssertEqual(anchor.resolve(in: ["重复", "中间", "重复"], sameRevision: true), 2)
        XCTAssertNil(anchor.resolve(in: ["重复", "中间", "重复"], sameRevision: false))
    }

    func testMissingOrUnknownAnchorIsNeverPlacedAtAnArbitraryPosition() {
        XCTAssertNil(IllustrationAnchor(position: "after", paragraphIndex: 99, paragraphText: "已删除").resolve(in: ["正文"], sameRevision: true))
        XCTAssertNil(IllustrationAnchor(position: "invalid", paragraphIndex: 0, paragraphText: "正文").resolve(in: ["正文"], sameRevision: true))
    }

    func testHashMatchesJavaScriptUTF16AndWhitespaceProtocol() {
        XCTAssertEqual(IllustrationAnchor.contentHash("  a\n\tb  "), "4m7u2a")
        XCTAssertEqual(IllustrationAnchor.contentHash("猫😀"), "18w6hgv")
    }

    func testIllustrationPreferenceDefaultsOnAndSurvivesLWWAndLocalRestore() {
        let defaults = ReaderSettingsState()
        XCTAssertEqual(defaults.values["readerIllustrations"], "on")
        var local = ReaderSettingsState()
        local.set("readerIllustrations", "off", timestamp: 200)
        let older = ReaderSettingsSnapshot(values: ["readerIllustrations": "on"], updatedAt: ["readerIllustrations": 100])
        let result = ReaderSettingsMerge.merge(local: local.snapshot, remote: older, knownKeys: ReaderSettingsState.knownKeys)
        XCTAssertEqual(result.snapshot.values["readerIllustrations"], "off")
        XCTAssertTrue(result.shouldUpload)
        XCTAssertEqual(ReaderSettingsState(snapshot: result.snapshot).values["readerIllustrations"], "off")
        let newer = ReaderSettingsSnapshot(values: ["readerIllustrations": "on"], updatedAt: ["readerIllustrations": 300])
        let merged = ReaderSettingsMerge.merge(local: result.snapshot, remote: newer, knownKeys: ReaderSettingsState.knownKeys)
        XCTAssertEqual(merged.snapshot.values["readerIllustrations"], "on")
        XCTAssertFalse(merged.snapshot.dirtyKeys.contains("readerIllustrations"))
    }
}
