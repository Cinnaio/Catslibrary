import SwiftUI

/// AI 已生成内容：列表 / 类型与状态筛选 / 批量删除 / 草稿编辑 / 发布 / 撤销发布 / 删除。
/// 对齐 Web 端 admin ai AiGenerationsPanel（/api/ai/generations、/api/ai/writing/drafts|batches）。
struct AdminAIGenerationsView: View {
    @State private var items: [AiGeneration] = []
    @State private var totalCount = 0
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var actionError: String?

    // 筛选
    @State private var kindFilter = "all"
    @State private var statusFilter = "all"
    @State private var scopeFilter = "all"

    // 分页
    @State private var offset = 0
    private let pageSize = 50

    // 批量
    @State private var selectionMode = false
    @State private var selectedIds = Set<String>()
    @State private var batchBusy = false
    @State private var lastDeletedIds: [String] = []

    // 详情
    @State private var viewing: AiGeneration?

    var body: some View {
        List {
            filterSection
            if isLoading && items.isEmpty {
                Section {
                    ProgressView("加载中…")
                        .frame(maxWidth: .infinity, minHeight: 160)
                        .listRowBackground(Color.clear)
                }
            } else if let errorMessage, items.isEmpty {
                Section {
                    ContentUnavailableView {
                        Label("加载失败", systemImage: "wifi.slash")
                    } description: {
                        Text(errorMessage)
                    } actions: {
                        Button("重试") { Task { await load() } }
                    }
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
                }
            } else if items.isEmpty {
                Section {
                    ContentUnavailableView {
                        Label("暂无内容", systemImage: "tray")
                    } description: {
                        Text("当前筛选条件下没有 AI 生成内容。")
                    }
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
                }
            } else {
                if selectionMode {
                    Section {
                        HStack {
                            Text("已选 \(selectedIds.count) 条")
                                .font(.subheadline)
                                .foregroundStyle(AppTheme.textSecondary)
                            Spacer()
                            Button("全选") {
                                selectedIds = Set(items.map { $0.id })
                            }
                            .font(.subheadline)
                            .disabled(batchBusy)
                            Button("删除所选", role: .destructive) {
                                Task { await batchDelete() }
                            }
                            .font(.subheadline)
                            .disabled(selectedIds.isEmpty || batchBusy)
                        }
                        .listRowBackground(Color.clear)
                    }
                }
                if !lastDeletedIds.isEmpty {
                    Section {
                        Button {
                            Task { await restoreDeleted() }
                        } label: {
                            Label("撤销上次删除（\(lastDeletedIds.count) 条）", systemImage: "arrow.uturn.backward")
                        }
                        .disabled(batchBusy)
                        .listRowBackground(Color.clear)
                    }
                }
                Section("共 \(totalCount) 条") {
                    ForEach(items) { item in
                        generationRow(item)
                    }
                    if offset + pageSize < totalCount {
                        Button {
                            Task { await loadMore() }
                        } label: {
                            HStack {
                                Spacer()
                                Text("加载更多（\(items.count)/\(totalCount)）")
                                    .font(.subheadline)
                                    .foregroundStyle(AppTheme.primary)
                                Spacer()
                            }
                        }
                        .listRowBackground(Color.clear)
                    }
                }
            }
        }
        .scrollContentBackground(.hidden)
        .pageBackground()
        .navigationTitle("已生成内容")
        .navigationBarTitleDisplayMode(.large)
        .refreshable { await load() }
        .task { await load() }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button(selectionMode ? "完成" : "选择") {
                    selectionMode.toggle()
                    selectedIds = []
                }
            }
        }
        .sheet(item: $viewing) { item in
            GenerationDetailSheet(item: item) { refresh in
                viewing = nil
                if refresh { Task { await load() } }
            }
        }
        .alert("操作失败", isPresented: errorAlertBinding) {
            Button("好", role: .cancel) {}
        } message: {
            Text(actionError ?? "")
        }
    }

    // MARK: - 筛选

    private var filterSection: some View {
        Section {
            Picker("范围", selection: $scopeFilter) {
                Text("全部").tag("all")
                Text("读者侧").tag("reader")
                Text("创作侧").tag("writing")
            }
            .pickerStyle(.segmented)
            Picker("类型", selection: $kindFilter) {
                Text("全部").tag("all")
                Text("前情提要").tag("summary")
                Text("回顾总结").tag("catchup")
                Text("续写").tag("continue")
                Text("创作大纲").tag("write_outline")
                Text("创作章节").tag("write_chapter")
            }
            Picker("状态", selection: $statusFilter) {
                Text("已发布").tag("published")
                Text("草稿").tag("draft")
                Text("已拒绝").tag("rejected")
                Text("全部").tag("all")
            }
            .onChange(of: kindFilter) { _, _ in
                offset = 0
                Task { await load() }
            }
            .onChange(of: scopeFilter) { _, _ in
                offset = 0
                Task { await load() }
            }
            .onChange(of: statusFilter) { _, _ in
                offset = 0
                Task { await load() }
            }
            .listRowBackground(Color.clear)
        }
    }

    // MARK: - 行

    private func generationRow(_ item: AiGeneration) -> some View {
        HStack(alignment: .top, spacing: 10) {
            if selectionMode {
                Button {
                    toggleSelect(item.id)
                } label: {
                    Image(systemName: selectedIds.contains(item.id) ? "checkmark.circle.fill" : "circle")
                        .font(.title3)
                        .foregroundStyle(selectedIds.contains(item.id) ? AppTheme.primary : AppTheme.textMuted)
                }
                .buttonStyle(.plain)
            }
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(AdminFormat.aiTaskKind(item.kind ?? ""))
                        .font(.caption2)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(AppTheme.primary.opacity(0.12), in: Capsule())
                        .foregroundStyle(AppTheme.primary)
                    if item.isDraft {
                        Text("草稿")
                            .font(.caption2)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(AppTheme.warning.opacity(0.15), in: Capsule())
                            .foregroundStyle(AppTheme.warning)
                    } else if item.isPublished {
                        Text("已发布")
                            .font(.caption2)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(AppTheme.success.opacity(0.15), in: Capsule())
                            .foregroundStyle(AppTheme.success)
                    }
                    Spacer()
                    Text(AdminFormat.relativeTime(item.createdAt ?? 0))
                        .font(.caption2)
                        .foregroundStyle(AppTheme.textMuted)
                }
                Text(item.novelTitle ?? "—")
                    .font(.subheadline)
                    .fontWeight(.medium)
                    .foregroundStyle(AppTheme.textPrimary)
                    .lineLimit(1)
                if let chapter = item.chapterTitle, !chapter.isEmpty {
                    Text(chapter)
                        .font(.caption)
                        .foregroundStyle(AppTheme.textSecondary)
                        .lineLimit(1)
                }
                if let result = item.result, !result.isEmpty {
                    Text(result)
                        .font(.caption)
                        .foregroundStyle(AppTheme.textMuted)
                        .lineLimit(2)
                }
                HStack(spacing: 12) {
                    Button("查看") { viewing = item }
                        .font(.caption)
                    if item.isDraft, let novelId = item.novelId, !novelId.isEmpty {
                        Button("发布") { viewing = item }
                            .font(.caption)
                    }
                    if item.isPublished {
                        Button("撤销发布") { Task { await unpublish(item) } }
                            .font(.caption)
                            .foregroundStyle(AppTheme.warning)
                    }
                    Button("删除", role: .destructive) { Task { await delete(item) } }
                        .font(.caption)
                }
            }
        }
        .padding(.vertical, 2)
        .contentShape(Rectangle())
    }

    private func toggleSelect(_ id: String) {
        if selectedIds.contains(id) {
            selectedIds.remove(id)
        } else {
            selectedIds.insert(id)
        }
    }

    // MARK: - 数据

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            let result = try await AdminAPI.aiGenerations(
                kind: kindFilter,
                scope: scopeFilter,
                status: statusFilter,
                limit: pageSize,
                offset: 0
            )
            items = result.items
            totalCount = result.total ?? items.count
            offset = 0
            errorMessage = nil
        } catch {
            errorMessage = AppCopy.friendlyError(error)
        }
    }

    private func loadMore() async {
        do {
            let next = offset + pageSize
            let result = try await AdminAPI.aiGenerations(
                kind: kindFilter,
                scope: scopeFilter,
                status: statusFilter,
                limit: pageSize,
                offset: next
            )
            items += result.items
            offset = next
            totalCount = result.total ?? items.count
        } catch {
            actionError = AppCopy.friendlyError(error)
        }
    }

    private func delete(_ item: AiGeneration) async {
        do {
            try await AdminAPI.aiDeleteGeneration(id: item.id)
            items.removeAll { $0.id == item.id }
        } catch {
            actionError = AppCopy.friendlyError(error)
        }
    }

    private func unpublish(_ item: AiGeneration) async {
        do {
            try await AdminAPI.aiUnpublishDraft(id: item.id)
            await load()
        } catch {
            actionError = AppCopy.friendlyError(error)
        }
    }

    private func batchDelete() async {
        guard !selectedIds.isEmpty, !batchBusy else { return }
        batchBusy = true
        defer { batchBusy = false }
        do {
            let ids = Array(selectedIds)
            let result = try await AdminAPI.aiDeleteGenerations(ids: ids)
            lastDeletedIds = ids
            selectedIds = []
            if (result.deleted ?? 0) > 0 {
                await load()
            }
        } catch {
            actionError = AppCopy.friendlyError(error)
        }
    }

    private func restoreDeleted() async {
        guard !lastDeletedIds.isEmpty, !batchBusy else { return }
        batchBusy = true
        defer { batchBusy = false }
        do {
            _ = try await AdminAPI.aiRestoreGenerations(ids: lastDeletedIds)
            lastDeletedIds = []
            await load()
        } catch {
            actionError = AppCopy.friendlyError(error)
        }
    }

    private var errorAlertBinding: Binding<Bool> {
        Binding(
            get: { actionError != nil },
            set: { if !$0 { actionError = nil } }
        )
    }
}

// MARK: - 详情 Sheet（查看 / 编辑草稿 / 发布）

private struct GenerationDetailSheet: View {
    let item: AiGeneration
    let onClose: (Bool) -> Void

    @State private var draftText: String?
    @State private var publishTitle = ""
    @State private var titleCandidates: [String] = []
    @State private var generatingTitles = false
    @State private var saving = false
    @State private var actionError: String?

    private var isEditableDraft: Bool {
        item.isDraft && ["write_chapter", "continue", "write_outline"].contains(item.kind ?? "")
    }

    var body: some View {
        NavigationStack {
            List {
                Section("信息") {
                    LabeledContent("类型", value: AdminFormat.aiTaskKind(item.kind ?? ""))
                    if let novel = item.novelTitle, !novel.isEmpty {
                        LabeledContent("小说", value: novel)
                    }
                    if let chapter = item.chapterTitle, !chapter.isEmpty {
                        LabeledContent("章节", value: chapter)
                    }
                    if let model = item.model, !model.isEmpty {
                        LabeledContent("模型", value: model)
                    }
                    LabeledContent("状态") {
                        Text(item.isDraft ? "草稿" : item.isPublished ? "已发布" : "已拒绝")
                            .foregroundStyle(item.isDraft ? AppTheme.warning : item.isPublished ? AppTheme.success : AppTheme.textSecondary)
                    }
                }

                Section("内容") {
                    if draftText != nil {
                        TextEditor(text: Binding(
                            get: { draftText ?? "" },
                            set: { draftText = $0 }
                        ))
                        .frame(minHeight: 260)
                        .font(.subheadline)
                        .scrollContentBackground(.hidden)
                        .overlay(
                            RoundedRectangle(cornerRadius: 10, style: .continuous)
                                .strokeBorder(AppTheme.border, lineWidth: 1)
                        )
                        .padding(.vertical, 4)
                    } else {
                        Text(item.result ?? "（无内容）")
                            .font(.subheadline)
                            .foregroundStyle(AppTheme.textSecondary)
                            .textSelection(.enabled)
                    }
                }

                if isEditableDraft {
                    Section("草稿操作") {
                        if draftText == nil {
                            Button("编辑草稿") { draftText = item.result ?? "" }
                        } else {
                            Button("保存修改") { Task { await saveDraft() } }
                                .disabled(saving)
                            Button("放弃编辑") { draftText = nil }
                        }
                    }
                    Section("发布为正式章节") {
                        TextField("章节标题", text: $publishTitle)
                        Button("AI 生成标题") { Task { await generateTitles() } }
                            .disabled(generatingTitles)
                        if generatingTitles {
                            HStack {
                                Spacer()
                                ProgressView()
                                Spacer()
                            }
                        }
                        if !titleCandidates.isEmpty {
                            ForEach(titleCandidates, id: \.self) { title in
                                Button(title) { publishTitle = title }
                                    .font(.subheadline)
                                    .foregroundStyle(AppTheme.textPrimary)
                            }
                        }
                        Button {
                            Task { await publish() }
                        } label: {
                            Label("发布", systemImage: "paperplane.fill")
                        }
                        .disabled(publishTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || saving)
                        .buttonStyle(.borderedProminent)
                        .tint(AppTheme.primary)
                    }
                } else if item.isPublished {
                    Section {
                        Button("撤销发布", role: .destructive) { Task { await unpublish() } }
                    }
                }

                if let actionError {
                    Section {
                        Text(actionError)
                            .font(.caption)
                            .foregroundStyle(AppTheme.danger)
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .pageBackground()
            .navigationTitle(item.draftTitle?.isEmpty == false ? item.draftTitle! : "生成内容")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("关闭") { onClose(false) }
                }
            }
        }
        .presentationDetents([.large])
        .onAppear {
            publishTitle = item.draftTitle ?? ""
        }
    }

    private func saveDraft() async {
        guard let text = draftText?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else { return }
        saving = true
        defer { saving = false }
        do {
            _ = try await AdminAPI.aiUpdateDraft(id: item.id, result: text)
            draftText = nil
        } catch {
            actionError = AppCopy.friendlyError(error)
        }
    }

    private func generateTitles() async {
        guard let result = item.result, !result.isEmpty else {
            actionError = "草稿内容为空，无法生成标题"
            return
        }
        generatingTitles = true
        defer { generatingTitles = false }
        do {
            let r = try await AdminAPI.aiWritingTitles(content: result, novelId: item.novelId ?? "", contextTitle: item.chapterTitle ?? "")
            titleCandidates = r.titles ?? []
        } catch {
            actionError = AppCopy.friendlyError(error)
        }
    }

    private func publish() async {
        let title = publishTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty, let novelId = item.novelId else {
            actionError = "请填写章节标题"
            return
        }
        saving = true
        defer { saving = false }
        do {
            _ = try await AdminAPI.aiPublishDraft(id: item.id, novelId: novelId, title: title)
            onClose(true)
        } catch {
            actionError = AppCopy.friendlyError(error)
        }
    }

    private func unpublish() async {
        saving = true
        defer { saving = false }
        do {
            try await AdminAPI.aiUnpublishDraft(id: item.id)
            onClose(true)
        } catch {
            actionError = AppCopy.friendlyError(error)
        }
    }
}
