import Foundation
import ZhiZhouCore

enum ReaderMediaAPI {
    static func illustrations(chapterID: String) async throws -> ChapterIllustrationsResponse {
        try await APIClient.shared.getReader(
            "/api/chapters/\(pathSegment(chapterID))/illustrations", auth: true
        )
    }

    static func pathSegment(_ value: String) -> String {
        value.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? value
    }

    /// 图片不进入封面或离线缓存；授权、账号、模式变化后丢弃迟到结果。
    @MainActor
    static func image(path: String) async throws -> Data {
        let access = ContentAccessStore.shared
        let revision = access.revision
        let token = APIClient.shared.token
        let mode = access.mode
        do {
            let data = try await APIClient.shared.data(ContentPolicy.readerPath(path, mode: mode), auth: true)
            try Task.checkCancellation()
            guard revision == access.revision, token == APIClient.shared.token else { throw CancellationError() }
            return data
        } catch let error as APIError {
            if revision == access.revision, mode == "adult", case .http(let status, _) = error, status == 403 {
                access.revoke(message: "图片访问授权已失效，请同步账号状态。")
            }
            throw error
        }
    }
}
