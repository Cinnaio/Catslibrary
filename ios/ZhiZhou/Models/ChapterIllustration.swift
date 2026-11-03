import Foundation
import ZhiZhouCore

struct ChapterIllustration: Codable, Identifiable, Hashable, Sendable {
    let id: String
    let chapterId: String
    let assetId: String
    let width: Int
    let height: Int
    let caption: String
    let size: String
    let anchor: IllustrationAnchor
    let chapterRevision: String
    let version: Int
    let order: Int
    let deleted: Bool

    var imagePath: String {
        "/api/chapters/\(ReaderMediaAPI.pathSegment(chapterId))/illustrations/\(ReaderMediaAPI.pathSegment(id))/image"
    }
}

struct ChapterIllustrationsResponse: Decodable {
    let illustrations: [ChapterIllustration]
    let chapterRevision: String
    let contentHash: String
}
