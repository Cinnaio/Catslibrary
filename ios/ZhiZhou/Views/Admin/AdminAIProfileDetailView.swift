import SwiftUI

struct AdminAIProfileReadingContent {
    let chunks: [String]
    let origin: String

    /// Run away from the main actor; even an unbroken line has a bounded layout cost.
    static func prepare(_ document: AiProfileDocument) -> Self {
        var chunks: [String] = []
        var start = document.content.startIndex
        while start < document.content.endIndex {
            let limit = document.content.index(start, offsetBy: 1200, limitedBy: document.content.endIndex)
                ?? document.content.endIndex
            let end: String.Index
            if limit < document.content.endIndex,
               let newline = document.content[start..<limit].lastIndex(of: "\n"), newline > start {
                end = document.content.index(after: newline)
            } else {
                end = limit
            }
            chunks.append(String(document.content[start..<end]))
            start = end
        }
        let origin: String
        switch document.effectiveOrigin {
        case "manual": origin = "最终使用：人工校正（第 \(document.manualOverride?.revision ?? 0) 版）"
        case "automatic": origin = "最终使用：自动画像"
        default: origin = "当前起点未采用画像，以下为已保存内容"
        }
        return Self(chunks: chunks, origin: origin)
    }
}

struct AdminAIProfileDetailView: View {
    let title: String
    let documentID: String
    let cached: AdminAIProfileReadingContent?
    let loadDocument: () async throws -> AiProfileDocument
    let didLoad: (AdminAIProfileReadingContent) -> Void

    @State private var reading: AdminAIProfileReadingContent?
    @State private var loading = true
    @State private var errorMessage: String?
    @State private var retry = 0

    var body: some View {
        Group {
            if loading {
                ProgressView("正在加载画像…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let errorMessage {
                ContentUnavailableView {
                    Label("画像暂时无法加载", systemImage: "wifi.exclamationmark")
                } description: {
                    Text(errorMessage)
                } actions: {
                    Button("重试") { retry += 1 }
                }
            } else if let reading, !reading.chunks.isEmpty {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        Text(reading.origin)
                            .font(.caption).foregroundStyle(AppTheme.textSecondary)
                            .padding(.bottom, 16)
                        ForEach(reading.chunks.indices, id: \.self) { index in
                            Text(verbatim: reading.chunks[index])
                                .font(.body).foregroundStyle(AppTheme.textPrimary)
                                .textSelection(.enabled)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                    .padding(20)
                    .frame(maxWidth: 760, alignment: .leading)
                    .frame(maxWidth: .infinity)
                }
            } else {
                ContentUnavailableView("暂无画像内容", systemImage: "doc.text", description: Text("返回后刷新画像状态，或继续完成分析。"))
            }
        }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .task(id: "\(documentID)|\(retry)") { await load() }
    }

    @MainActor
    private func load() async {
        loading = true
        errorMessage = nil
        reading = nil
        if let cached {
            reading = cached
            loading = false
            return
        }
        do {
            let document = try await loadDocument()
            try Task.checkCancellation()
            let prepared = await Task.detached(priority: .userInitiated) {
                AdminAIProfileReadingContent.prepare(document)
            }.value
            try Task.checkCancellation()
            reading = prepared
            didLoad(prepared)
            loading = false
        } catch {
            guard !Task.isCancelled else { return }
            errorMessage = AppCopy.friendlyError(error)
            loading = false
        }
    }
}
