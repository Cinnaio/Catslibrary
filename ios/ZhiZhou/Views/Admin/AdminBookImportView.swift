import SwiftUI
import ZhiZhouCore

struct AdminBookImportView: View {
    var discoverySourceURL: String? = nil
    var discoveryToken: String? = nil
    @Environment(AppState.self) private var appState
    @State private var sourceURL = ""
    @State private var preview: BookImportPreview?
    @State private var selectedChapters: Set<String> = []
    @State private var selectedMetadata: Set<String> = []
    @State private var busy = false
    @State private var error: String?
    @State private var result: BookImportResult?
    @State private var pendingOperation: AdminDangerousOperation?
    @State private var pendingImport: ImportSnapshot?
    @State private var operationKey = UUID().uuidString
    @State private var requestID = UUID()
    @State private var openedConversation: AIAgentSession?
    @State private var showConversation = false
    private var discovery: Bool { discoverySourceURL != nil }

    private func matchingBooks(_ preview: BookImportPreview) -> [BookImportPreview.Candidate] {
        func known(_ author: String) -> Bool { !author.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && author != "未知作者" }
        return preview.candidates.filter { $0.matchReason != "title" || !known(preview.book.author) || !known($0.novel.author) }
    }

    private var targetConfirmed: Bool {
        guard let preview else { return false }
        if discovery { return preview.targetNovelId == nil && matchingBooks(preview).isEmpty }
        return preview.candidates.isEmpty || preview.targetNovelId != nil
    }

    var body: some View {
        Form {
            Section("URL 导入") {
                TextField("书籍目录地址", text: $sourceURL)
                    .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                    .disabled(discovery)
                    .accessibilityIdentifier("admin.import.url")
                Button("读取导入预览") { Task { await makePreview() } }
                    .disabled(!validURL || busy)
                    .accessibilityIdentifier("admin.import.preview")
                if busy { ProgressView("处理中…") }
            }
            if let error { Text(error).foregroundStyle(AppTheme.danger) }
            if let result {
                Section("导入结果") {
                    Text("新增 \(result.created) 章，更新 \(result.updated) 章，跳过 \(result.skipped) 章")
                        .accessibilityIdentifier("admin.import.result")
                    ForEach(result.conflicts, id: \.id) { conflict in
                        Text("\(conflict.title)：\(conflict.reason)").foregroundStyle(AppTheme.warning)
                    }
                    if discovery && result.created > 0 {
                        Button("开始对话", systemImage: "bubble.left") { Task { await openBook(result.novelId) } }
                    } else {
                        NavigationLink("查看小说管理") { AdminNovelsView() }
                    }
                }
            }
            if let preview {
                previewSections(preview)
            }
            Section {
                NavigationLink("我的导入历史") { AdminImportHistoryView() }
                AdminWebLink(title: "在 Web 导入文件或撤回导入", path: "/admin/novels")
            } footer: {
                Text("支持源站目录 URL。读取预览不会修改作品；提交只应用勾选内容。文件导入与历史撤回可在 Web 完成。")
            }
        }
        .appListStyle(.settings)
        .navigationTitle("书籍导入")
        .disabled(busy)
        .onChange(of: sourceURL) { _, _ in
            guard !busy else { return }
            preview = nil; result = nil; selectedChapters = []; selectedMetadata = []
        }
        .task(id: ContentAccessStore.shared.accountRevision) {
            if discovery && APIClient.shared.token == discoveryToken && sourceURL == discoverySourceURL { return }
            requestID = UUID(); preview = nil; result = nil; error = nil; busy = false
            selectedChapters = []; selectedMetadata = []; sourceURL = ""
            openedConversation = nil; showConversation = false
            pendingOperation = nil; pendingImport = nil
            if let discoverySourceURL, APIClient.shared.token == discoveryToken {
                sourceURL = discoverySourceURL
                await makePreview()
            }
        }
        .navigationDestination(isPresented: $showConversation) {
            if let openedConversation, let user = appState.user, let token = discoveryToken, token == APIClient.shared.token {
                AdminAIAgentConversationView(session: openedConversation, userID: user.id, token: token)
            }
        }
        .adminDangerousOperationConfirmation($pendingOperation, onConfirm: { operation in
            guard let snapshot = pendingImport else { return }
            pendingImport = nil
            Task { await commit(snapshot, operation: operation) }
        }, onCancel: { _ in pendingImport = nil })
    }

    @ViewBuilder private func previewSections(_ value: BookImportPreview) -> some View {
        Section("导入预览") {
            Text(value.book.title).font(.headline)
            Text(value.book.author).foregroundStyle(.secondary)
            Text("新增 \(value.summary.newCount) · 改动 \(value.summary.changedCount) · 无变化 \(value.summary.unchangedCount) · 冲突 \(value.summary.conflictCount)")
            ForEach(value.warnings, id: \.self) { Text($0).foregroundStyle(AppTheme.warning) }
        }
        Section("导入目标") {
            if discovery {
                Text(targetConfirmed ? "新建作品" : "书库可能已收录这本书")
                ForEach(matchingBooks(value)) { candidate in
                    Button("开始对话 · \(candidate.novel.title) · \(candidate.novel.author)") {
                        Task { await openBook(candidate.novel.id) }
                    }
                }
            } else {
                Text(value.targetNovelId == nil ? (value.candidates.isEmpty ? "新建作品" : "请选择已有作品") : "合并到已有作品")
                if !targetConfirmed { Text("发现多个同名作品，请明确选择导入目标。").foregroundStyle(AppTheme.warning) }
                if !value.candidates.isEmpty {
                    ForEach(value.candidates) { candidate in
                        Button {
                            Task { await selectTarget(candidate.novel.id) }
                        } label: {
                            Label("\(candidate.novel.title) · \(candidate.novel.author)", systemImage:
                                  value.targetNovelId == candidate.novel.id ? "checkmark.circle.fill" : "circle")
                        }
                    }
                }
            }
        }
        Section {
            ForEach(value.metadataDiff.filter(\.changed)) { field in
                Toggle(isOn: membership(field.field, in: $selectedMetadata)) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(field.label)
                        Text("当前：\(field.localValue)").font(.caption).foregroundStyle(.secondary)
                        Text("导入：\(field.incomingValue)").font(.caption)
                    }
                }
            }
        } header: { Text("替换元数据") } footer: { Text("只替换勾选字段；未勾选的已有资料保持原值。") }
        Section("章节差异") {
            ForEach(value.chapters) { chapter in
                VStack(alignment: .leading, spacing: 6) {
                    Toggle(isOn: membership(chapter.id, in: $selectedChapters)) {
                        Text("\(chapter.incomingTitle) · \(AdminParityCopy.state(chapter.status))")
                    }
                    .disabled(["unchanged", "conflict"].contains(chapter.status))
                    Text(chapter.reason).font(.caption).foregroundStyle(.secondary)
                    DisclosureGroup("查看正文差异") {
                        if let old = chapter.localContent {
                            Text("当前正文").font(.caption).foregroundStyle(.secondary)
                            Text(old).textSelection(.enabled)
                        }
                        Text("导入正文").font(.caption).foregroundStyle(.secondary)
                        Text(chapter.incomingContent).textSelection(.enabled)
                    }
                }
            }
        }
        Section {
            Button("确认导入（\(selectedChapters.count) 章）") { prepareCommit() }
                .disabled(!targetConfirmed || (selectedChapters.isEmpty && (discovery || selectedMetadata.isEmpty)))
                .accessibilityIdentifier("admin.import.commit")
        }
    }

    private var validURL: Bool {
        guard let url = URL(string: sourceURL.trimmingCharacters(in: .whitespacesAndNewlines)) else { return false }
        return ["https", "http"].contains(url.scheme?.lowercased() ?? "") && url.host != nil
    }
    private func membership(_ id: String, in selection: Binding<Set<String>>) -> Binding<Bool> {
        Binding(get: { selection.wrappedValue.contains(id) }, set: { enabled in
            if enabled { selection.wrappedValue.insert(id) } else { selection.wrappedValue.remove(id) }
            operationKey = UUID().uuidString
        })
    }
    private func apply(_ value: BookImportPreview) {
        preview = value
        selectedChapters = Set(value.chapters.filter { $0.selected && ["new", "changed"].contains($0.status) }.map(\.id))
        selectedMetadata = Set(value.metadataDiff.filter { $0.selected && $0.changed }.map(\.field))
        operationKey = UUID().uuidString
    }
    private func makePreview() async {
        await perform {
            let value = try await AdminAPI.importPreview(url: sourceURL.trimmingCharacters(in: .whitespacesAndNewlines), token: $0)
            return .preview(value)
        }
    }
    private func selectTarget(_ novelID: String) async {
        guard let preview else { return }
        await perform { token in
            .preview(try await AdminAPI.importTarget(runID: preview.runId, novelID: novelID, revision: preview.revision ?? 0, token: token))
        }
    }
    private struct ImportSnapshot {
        let runID: String
        let chapters: Set<String>
        let metadata: Set<String>
        let revision: Int
    }
    private func prepareCommit() {
        guard let preview, targetConfirmed else { return }
        pendingImport = ImportSnapshot(runID: preview.runId, chapters: selectedChapters, metadata: selectedMetadata, revision: preview.revision ?? 0)
        pendingOperation = AdminDangerousOperation(
            action: .commitBookImport, kind: .overwrite, targetIDs: selectedChapters.sorted(),
            title: "确认导入所选内容？",
            message: "将写入 \(selectedChapters.count) 个章节并替换 \(selectedMetadata.count) 项元数据。请先检查章节差异与目标作品。",
            confirmLabel: "提交导入", operationID: operationKey
        )
    }
    private func commit(_ snapshot: ImportSnapshot, operation: AdminDangerousOperation) async {
        guard preview?.runId == snapshot.runID else { return }
        await perform(isCommit: true) { token in
            .committed(try await AdminAPI.commitImport(runID: snapshot.runID, chapters: snapshot.chapters,
                metadata: snapshot.metadata, revision: snapshot.revision, token: token, key: operation.operationID, requireNewBook: discovery))
        }
    }
    private func openBook(_ id: String) async {
        guard !busy, let token = discoveryToken, APIClient.shared.token == token else { return }
        busy = true; error = nil
        defer { busy = false }
        do {
            let session = try await AdminAgentAPI(token: token).startBookConversation(id)
            guard !Task.isCancelled, APIClient.shared.token == token else { return }
            openedConversation = session; showConversation = true
        } catch {
            guard !Task.isCancelled, APIClient.shared.token == token else { return }
            self.error = AppCopy.friendlyError(error)
        }
    }
    private enum Outcome { case preview(BookImportPreview); case committed(BookImportResult) }
    private func perform(isCommit: Bool = false, _ action: (String) async throws -> Outcome) async {
        guard !busy, let token = APIClient.shared.token, !discovery || discoveryToken == token else { return }
        let id = UUID(); requestID = id; busy = true; error = nil
        defer { if requestID == id { busy = false } }
        do {
            let outcome = try await action(token)
            guard !Task.isCancelled, requestID == id, APIClient.shared.token == token else { return }
            switch outcome {
            case .preview(let value): apply(value); result = nil
            case .committed(let value): result = value; preview = nil
            }
        } catch {
            guard !Task.isCancelled, requestID == id, APIClient.shared.token == token else { return }
            self.error = AppCopy.friendlyError(error)
                + (isCommit ? "；提交结果不确定时，请先检查导入历史再操作。" : "")
        }
    }
}

struct AdminImportHistoryView: View {
    var body: some View {
        AdminRecordList(title: "我的导入历史", fetch: { offset in
            let response: AdminRecordPage<BookImportHistory> = try await AdminAPI.parityRequest("GET", "/api/book-import/history?limit=50&offset=\(offset)")
            return response
        }) { item in
            VStack(alignment: .leading, spacing: 6) {
                Text(item.novelTitle).font(.headline)
                Text("\(AdminParityCopy.state(item.status)) · 新增 \(item.created) · 更新 \(item.updated) · 冲突 \(item.conflicts)")
                Text(item.sourceLabel).font(.caption).foregroundStyle(.secondary)
                Text(AdminFormat.dateTime(item.createdAt)).font(.caption).foregroundStyle(.secondary)
            }
        }
    }
}
