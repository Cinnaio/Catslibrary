import Foundation
import ZhiZhouCore

extension AdminAPI {
    static func storyGraph(novelID: String, afterChapterID: String?, token: String) async throws -> StoryGraphResponse {
        var path = "/api/ai/writing/story-graph/" + ReaderMediaAPI.pathSegment(novelID)
        if let anchor = afterChapterID, !anchor.isEmpty {
            path += "?" + HomeView.query(["afterChapterId": anchor])
        }
        return try await parityRequest("GET", path, token: token)
    }

    @MainActor
    static func generateStoryGraph(novelID: String, afterChapterID: String?, token: String,
                                   onProgress: (String, Int) -> Void) async throws -> StoryGraphResponse {
        let body = try JSONEncoder().encode(["afterChapterId": afterChapterID ?? ""])
        let path = "/api/ai/writing/story-graph/" + ReaderMediaAPI.pathSegment(novelID)
        for try await line in APIClient.shared.streamLines(path, auth: true, expectedToken: token, method: "POST", body: body) {
            try Task.checkCancellation()
            guard line.hasPrefix("data:") else { continue }
            let data = Data(line.dropFirst(5).trimmingCharacters(in: .whitespaces).utf8)
            let event = try JSONDecoder().decode(StoryGraphStreamEvent.self, from: data)
            switch event {
            case .result(let response): return response
            case .failure(let status, let message):
                if status == 401 { APIClient.shared.invalidateSession(expectedToken: token) }
                throw APIError.http(status: status, message: message)
            case .progress(let phase, let characters): onProgress(phase, characters)
            case .heartbeat, .unknown: break
            }
        }
        throw APIError.network("生成连接已中断，结果可能仍在保存。")
    }
}
