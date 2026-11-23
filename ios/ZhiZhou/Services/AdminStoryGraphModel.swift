import Foundation
import Observation
import ZhiZhouCore

@MainActor @Observable
final class AdminStoryGraphModel {
    private(set) var response: StoryGraphResponse?
    private(set) var busy = false
    private(set) var generating = false
    private(set) var progress = ""
    private(set) var error: String?
    private var requestID = UUID()
    private var generationTask: Task<Void, Never>?

    func refresh(novelID: String, anchor: String?) async {
        guard let token = APIClient.shared.token else { return }
        await request(novelID: novelID, anchor: anchor, generate: false, token: token)
    }

    func generate(novelID: String, anchor: String?) {
        guard !busy, response?.canGenerate == true, let token = APIClient.shared.token else { return }
        // Reserve synchronously so two taps cannot create untracked generation tasks.
        busy = true
        generating = true
        generationTask = Task { await request(novelID: novelID, anchor: anchor, generate: true, token: token) }
    }

    func cancel() {
        requestID = UUID()
        generationTask?.cancel()
        generationTask = nil
        busy = false
        generating = false
        progress = ""
    }

    private func request(novelID: String, anchor: String?, generate: Bool, token: String) async {
        guard !Task.isCancelled, generate || !busy else { return }
        guard APIClient.shared.token == token else {
            if generate { busy = false; generating = false }
            return
        }
        let id = UUID()
        let server = ServerConfig.shared.baseURL
        requestID = id
        busy = true
        generating = generate
        progress = generate ? "正在整理人物与线索…" : ""
        error = nil
        defer {
            if requestID == id { busy = false; generating = false; progress = "" }
        }
        func isCurrent() -> Bool {
            !Task.isCancelled && requestID == id && APIClient.shared.token == token && ServerConfig.shared.baseURL == server
        }
        do {
            let result: StoryGraphResponse
            if generate {
                result = try await AdminAPI.generateStoryGraph(novelID: novelID, afterChapterID: anchor, token: token) { phase, characters in
                    guard isCurrent() else { return }
                    self.progress = phase == "thinking" ? "正在梳理人物关系…" : "正在绘制星图 · 已生成 \(characters) 字符"
                }
            } else {
                result = try await AdminAPI.storyGraph(novelID: novelID, afterChapterID: anchor, token: token)
            }
            guard isCurrent() else { return }
            guard result.novel.id == novelID, anchor == nil || anchor?.isEmpty == true || result.anchor?.id == anchor else {
                throw APIError.invalidResponse
            }
            response = result
        } catch is CancellationError {
            // Scope changes and navigation cancel local delivery, never replay generation.
        } catch {
            guard isCurrent() else { return }
            if case APIError.http(let status, _) = error, [401, 403, 404].contains(status) { response = nil }
            self.error = AppCopy.friendlyError(error)
            if generate {
                self.error = (self.error ?? "星图生成失败") + " 请先刷新确认是否已有结果，重新生成可能再次计入用量。"
            }
        }
    }
}
