import SwiftUI

struct ReaderAIStatus: Decodable {
    struct Features: Decodable { let recap: Bool; let catchup: Bool; let storyEchoes: Bool?; let characterCards: Bool? }
    struct Quota: Decodable { let used: Int; let limit: Int; let resetAt: Int64 }
    let configured: Bool
    let features: Features
    let quota: Quota?
    let catchupStaleDays: Int
}

private struct ReaderRecapResponse: Decodable {
    let recap: String?
    let cached: Bool
    let reason: String?
}

struct ReaderRecapView: View {
    enum Source {
        case chapter(id: String, title: String)
        case catchup(novelID: String)
    }
    let source: Source
    @Environment(\.dismiss) private var dismiss
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var status: ReaderAIStatus?
    @State private var text = ""
    @State private var message: String?
    @State private var loading = false
    @State private var generating = false
    @State private var error: String?
    @State private var attempt = 0

    private var title: String {
        if case .chapter = source { return "前情提要" }
        return "回来接着读"
    }
    private var enabled: Bool {
        guard let status, status.configured else { return false }
        if case .chapter = source { return status.features.recap }
        return status.features.catchup
    }

    var body: some View {
        NavigationStack {
            ReaderPanelPage {
                ReaderPanelHeading(title)
                if case .chapter(_, let chapterTitle) = source {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("回顾上一章").font(.caption).foregroundStyle(ReadingSpace.profileMuted)
                        Text(chapterTitle)
                            .font(serifFont(.title3, .medium))
                            .foregroundStyle(ReadingSpace.ink)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                if loading {
                    AppLoadingState("正在读取已保存的提要…", placement: .inline)
                }
                if let error {
                    VStack(alignment: .leading, spacing: 12) {
                        ReaderPanelNote(error, color: AppTheme.danger)
                        if status == nil {
                            Button("重试", systemImage: "arrow.clockwise") { attempt += 1 }
                                .buttonStyle(ReaderPanelButtonStyle())
                        }
                    }
                }
                if !text.isEmpty {
                    VStack(alignment: .leading, spacing: 20) {
                        Text(text)
                            .font(.body).foregroundStyle(ReadingSpace.ink)
                            .lineSpacing(6)
                            .fixedSize(horizontal: false, vertical: true)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .textSelection(.enabled)
                        ReaderPanelNote("AI 生成的内容可能遗漏细节，请以原文为准。")
                    }
                } else if let message {
                    ReaderPanelNote(message)
                }
                if !loading && text.isEmpty && enabled && message == nil {
                    VStack(alignment: .leading, spacing: 14) {
                        Button { Task { await generate() } } label: {
                            HStack(spacing: 10) {
                                Group {
                                    if generating { ProgressView() }
                                    else { Image(systemName: "sparkles") }
                                }
                                .frame(width: 20).accessibilityHidden(true)
                                Text("生成\(title)")
                            }
                        }
                        .buttonStyle(ReaderPanelButtonStyle(prominent: true))
                        .disabled(generating)
                        .accessibilityValue(generating ? "正在生成" : "")
                        ReaderPanelNote("点击后请求 AI；命中缓存不计次数，生成新内容会使用今日额度。")
                        if let quota = status?.quota, quota.limit > 0 {
                            ReaderPanelFact(title: "今日已使用", value: "\(quota.used) / \(quota.limit) 次")
                        }
                    }
                }
                if !loading && status != nil && !enabled {
                    ReaderPanelNote("服务器暂未开放此功能。")
                }
            }
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("关闭") { dismiss() } } }
            .task(id: "\(ContentAccessStore.shared.revision):\(attempt)") { await load() }
        }
        .presentationBackground(ReadingSpace.profilePaper)
        .presentationDetents(dynamicTypeSize.isAccessibilitySize ? [.large] : [.medium, .large])
        .presentationDragIndicator(.visible)
    }

    private func load() async {
        let revision = ContentAccessStore.shared.revision
        loading = true
        status = nil
        text = ""
        error = nil
        message = nil
        defer { loading = false }
        do {
            let result: ReaderAIStatus = try await APIClient.shared.get("/api/ai/status", auth: true)
            guard !Task.isCancelled, revision == ContentAccessStore.shared.revision else { return }
            status = result
            if case .chapter(let id, _) = source, result.features.recap {
                let cached: ReaderRecapResponse = try await APIClient.shared.getReader(
                    "/api/ai/recap?" + HomeView.query(["chapterId": id]), auth: true
                )
                guard !Task.isCancelled, revision == ContentAccessStore.shared.revision else { return }
                text = cached.recap ?? ""
            }
        } catch {
            guard !Task.isCancelled, revision == ContentAccessStore.shared.revision else { return }
            self.error = AppCopy.friendlyError(error)
        }
    }

    private func generate() async {
        guard !generating, enabled, let token = APIClient.shared.token else { return }
        let revision = ContentAccessStore.shared.revision
        let path: String
        let payload: [String: String]
        switch source {
        case .chapter(let id, _): path = "/api/ai/recap"; payload = ["chapterId": id]
        case .catchup(let id): path = "/api/ai/catchup"; payload = ["novelId": id]
        }
        generating = true
        error = nil
        defer { generating = false }
        do {
            let body = try APIClient.shared.jsonBody(payload)
            let result: ReaderRecapResponse = try await APIClient.shared.request(
                "POST", path, body: body, auth: true, expectedToken: token, timeout: 180
            )
            guard revision == ContentAccessStore.shared.revision, APIClient.shared.token == token else { return }
            text = result.recap ?? ""
            if text.isEmpty {
                switch result.reason {
                case "no_progress": message = "还没有可回顾的阅读进度。"
                case "not_stale": message = "你最近刚读过这本书，暂时无需回顾。"
                case "insufficient_summaries": message = "已读章节的提要不足，暂时无法生成回顾。"
                default: message = "暂时没有可用的回顾内容。"
                }
            }
        } catch {
            guard revision == ContentAccessStore.shared.revision, APIClient.shared.token == token else { return }
            self.error = AppCopy.friendlyError(error)
        }
    }
}

struct ReaderCatchupEntry: View {
    let novelID: String
    let progress: ReadingProgress?
    @State private var status: ReaderAIStatus?
    @State private var showing = false

    private var eligible: Bool {
        guard let status, status.features.catchup, let progress else { return false }
        return Date().timeIntervalSince1970 * 1000 - Double(progress.updatedAt) >= Double(status.catchupStaleDays) * 86_400_000
    }

    var body: some View {
        Group {
            if eligible {
                Button { showing = true } label: {
                    Label("回来接着读 · 回顾已读内容", systemImage: "sparkles")
                }
            }
        }
        .task(id: ContentAccessStore.shared.revision) {
            status = nil
            let revision = ContentAccessStore.shared.revision
            let result: ReaderAIStatus? = try? await APIClient.shared.get("/api/ai/status", auth: true)
            guard !Task.isCancelled, revision == ContentAccessStore.shared.revision else { return }
            status = result
        }
        .sheet(isPresented: $showing) { ReaderRecapView(source: .catchup(novelID: novelID)) }
    }
}
