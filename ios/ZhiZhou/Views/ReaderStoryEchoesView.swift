import SwiftUI

struct StoryEchoInput: Encodable, Identifiable {
    let chapterId: String
    let paragraphIndex: Int
    let paragraphHash: String
    let selectedText: String
    let sourceFormat = "text"
    var id: String { "\(chapterId):\(paragraphIndex):\(paragraphHash):\(selectedText)" }
}

struct StoryEchoSource: Decodable {
    let chapterId: String
    let chapterTitle: String
    let chapterOrder: Int
    let paragraphIndex: Int
    let paragraphHash: String
    let quote: String
}

private struct StoryEchoResponse: Decodable {
    struct Echo: Decodable {
        let source: StoryEchoSource
        let explanation: String
    }
    let anchor: StoryEchoSource
    let items: [Echo]
    let cached: Bool
    let generated: Bool
    let searchedChapters: Int
    let candidateCount: Int
    let limited: Bool
    let omitted: Int
}

struct ReaderStoryEchoesView: View {
    let input: StoryEchoInput
    let chapterTitle: String
    let onSource: (StoryEchoSource) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var result: StoryEchoResponse?
    @State private var busy = false
    @State private var error: String?
    @State private var mustReselect = false
    @State private var remaining: Int?
    @State private var generation = UUID()
    @State private var requestTask: Task<Void, Never>?

    var body: some View {
        NavigationStack {
            ReaderPanelPage {
                ReaderPanelHeading("故事里的回声", detail: "从这一句话，回望前文留下的细节。")
                VStack(alignment: .leading, spacing: 12) {
                    ReaderPanelNote("读到这里 · \(chapterTitle)")
                    quote(input.selectedText)
                }
                ReaderPanelNote("只检索这处选段之前的正文，不读取本章后文、后续章节或全书摘要。关联解释为 AI 推测，请以原文为准。")
                if result == nil {
                    VStack(alignment: .leading, spacing: 12) {
                        Button {
                            guard !busy else { return }
                            requestTask = Task { await find() }
                        } label: {
                            HStack(spacing: 8) {
                                if busy { ProgressView().controlSize(.small) }
                                Text(busy ? "正在回望前文…" : error == nil ? "查找前文的回声" : "重试查找")
                            }
                        }
                        .buttonStyle(ReaderPanelButtonStyle(prominent: true))
                        .disabled(busy || mustReselect)
                        if let remaining {
                            ReaderPanelNote("今日剩余 \(remaining) 次 AI 额度；复用结果不计次数。")
                        } else {
                            ReaderPanelNote("生成新结果使用读者 AI 额度；短期内复用结果不计次数。")
                        }
                        if remaining == 0 { ReaderPanelNote("额度用完后仍可查看已缓存的结果。") }
                    }
                }
                if busy { ReaderPanelNote("正在查找相关片段并核对引文，可以关闭面板继续阅读。") }
                if let error {
                    ReaderPanelNote(error + (mustReselect ? " 请关闭面板后重新选择正文。" : ""), color: AppTheme.danger)
                }
                if let result { results(result) }
            }
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("关闭") { dismiss() } } }
            .task(id: ContentAccessStore.shared.revision) { await loadStatus() }
            .onDisappear { generation = UUID(); requestTask?.cancel() }
        }
        .presentationBackground(ReadingSpace.profilePaper)
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
    }

    private func quote(_ text: String) -> some View {
        Text(text)
            .font(serifFont(.body))
            .foregroundStyle(ReadingSpace.ink)
            .lineSpacing(6)
            .fixedSize(horizontal: false, vertical: true)
            .textSelection(.enabled)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.leading, 16)
            .overlay(alignment: .leading) { Rectangle().fill(ReadingSpace.profileLine).frame(width: 2) }
    }

    @ViewBuilder private func results(_ result: StoryEchoResponse) -> some View {
        if result.items.isEmpty {
            ReaderPanelSection("这次还没有找到有充分依据的回声") {
                ReaderPanelNote("可以选择更具体的人物动作、对白或物件再试；没有找到，并不代表前文没有呼应。")
            }
        }
        ForEach(result.items.indices, id: \.self) { index in
            let item = result.items[index]
            VStack(alignment: .leading, spacing: 16) {
                ReaderPanelNote("前文 · \(item.source.chapterTitle)")
                quote(item.source.quote)
                VStack(alignment: .leading, spacing: 8) {
                    Text("可能的呼应").font(.caption).foregroundStyle(AppTheme.primary)
                    Text(item.explanation)
                        .font(.body).foregroundStyle(ReadingSpace.ink).lineSpacing(5)
                        .fixedSize(horizontal: false, vertical: true).textSelection(.enabled)
                }
                Button("回到这处原文", systemImage: "arrow.uturn.backward") {
                    onSource(item.source)
                    dismiss()
                }
                .buttonStyle(ReaderPanelButtonStyle())
                .accessibilityLabel("回到原文：\(item.source.chapterTitle)")
            }
            .readingSpaceEntrance(index)
        }
        VStack(alignment: .leading, spacing: 8) {
            ReaderPanelNote("从 \(result.searchedChapters) 个相关前文章节及本章选段之前的文字中，核对了 \(result.candidateCount) 处候选片段。检索按关键词筛选，可能遗漏其他呼应。")
            if result.limited { ReaderPanelNote("相关片段较多，本次优先检查其中的一部分。") }
            if result.omitted > 0 { ReaderPanelNote("部分条目未通过引文核验，已省略。") }
            if result.cached { ReaderPanelNote("本次复用了近期结果，未使用新的 AI 额度。") }
            if !result.generated && !result.cached { ReaderPanelNote("未找到可核对的候选片段，本次未调用 AI。") }
        }
    }

    private func loadStatus() async {
        let request = generation
        let revision = ContentAccessStore.shared.revision
        let token = APIClient.shared.token
        let status: ReaderAIStatus? = try? await APIClient.shared.get("/api/ai/status", auth: true)
        guard !Task.isCancelled, generation == request, revision == ContentAccessStore.shared.revision, token == APIClient.shared.token else { return }
        if let quota = status?.quota, quota.limit >= 0 { remaining = max(0, quota.limit - quota.used) }
    }

    private func find() async {
        guard !busy, let token = APIClient.shared.token else { return }
        let request = UUID(), revision = ContentAccessStore.shared.revision
        generation = request
        busy = true
        error = nil
        defer { if generation == request { busy = false } }
        do {
            let response: StoryEchoResponse = try await APIClient.shared.request(
                "POST", "/api/ai/story-echoes", body: APIClient.shared.jsonBody(input),
                auth: true, expectedToken: token, timeout: 180
            )
            guard !Task.isCancelled, generation == request, revision == ContentAccessStore.shared.revision,
                  token == APIClient.shared.token else { return }
            result = response
            if response.generated && !response.cached, let count = remaining { remaining = max(0, count - 1) }
        } catch {
            guard !Task.isCancelled, generation == request, revision == ContentAccessStore.shared.revision,
                  token == APIClient.shared.token else { return }
            if case APIError.http(let status, _) = error {
                mustReselect = [401, 403, 404, 409].contains(status)
                if status == 429 { remaining = 0 }
            }
            self.error = AppCopy.friendlyError(error)
        }
    }
}
