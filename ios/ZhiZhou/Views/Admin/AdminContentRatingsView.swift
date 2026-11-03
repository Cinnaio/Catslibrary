import SwiftUI
import ZhiZhouCore

// MARK: - 内容分级后台

fileprivate enum AdminContentRatingModule: String, CaseIterable, Identifiable {
    case ratings = "分级"
    case rules = "规则候选"
    case ai = "LLM 建议"

    var id: String { rawValue }
}

struct AdminContentRatingsView: View {
    @State private var section: AdminContentRatingModule = .ratings

    var body: some View {
        Group {
            switch section {
            case .ratings:
                AdminContentRatingCatalogView(module: $section)
            case .rules:
                AdminContentRatingRuleCandidatesView(module: $section)
            case .ai:
                AdminContentRatingAISuggestionsView(module: $section)
            }
        }
        .navigationTitle("分级管理")
        .navigationBarTitleDisplayMode(.large)
    }
}

fileprivate struct AdminContentRatingModulePicker: View {
    @Binding var selection: AdminContentRatingModule

    var body: some View {
        Picker("分级管理模块", selection: $selection) {
            ForEach(AdminContentRatingModule.allCases) { item in
                Text(item.rawValue).tag(item)
            }
        }
        .accessibleSegmentedPicker()
    }
}

fileprivate struct AdminContentRatingQuery: Equatable {
    let rating: String
    let source: String
    let search: String
    let page: Int
}

fileprivate struct AdminContentRatingRuleQuery: Equatable {
    let status: String
    let kind: String
    let search: String
    let page: Int
}

fileprivate struct AdminContentRatingAIQuery: Equatable {
    let status: String
    let search: String
    let page: Int
}

fileprivate func contentRatingTint(_ rating: AdminContentRatingValue) -> Color {
    switch rating {
    case .general: return AppTheme.primary
    case .restricted: return AppTheme.danger
    case .unknown: return AppTheme.warning
    }
}

fileprivate func contentRatingSourceTitle(_ source: String) -> String {
    AdminContentRatingSource(rawValue: source)?.title ?? (source.isEmpty ? "—" : source)
}

fileprivate func evidenceSummary(_ evidence: [AdminContentRatingEvidence]) -> String {
    evidence.map { item in
        let key = item.field ?? item.type
        let value = item.value ?? item.rule ?? ""
        return value.isEmpty ? key : "\(key)=\(value)"
    }.joined(separator: "；")
}

fileprivate func contentRatingBadge(_ rating: AdminContentRatingValue) -> some View {
    AdminStatusBadge(rating.title, tint: contentRatingTint(rating))
}

fileprivate func ruleStatusBadge(_ status: AdminContentRatingRuleStatus) -> some View {
    let tint: Color
    switch status {
    case .pending: tint = AppTheme.warning
    case .approved: tint = AppTheme.primary
    case .rejected: tint = AppTheme.textSecondary
    }
    return AdminStatusBadge(status.title, tint: tint)
}

fileprivate func aiSuggestionStatusBadge(_ status: AdminContentRatingAISuggestionStatus) -> some View {
    let tint: Color
    switch status {
    case .pending: tint = AppTheme.warning
    case .approved: tint = AppTheme.primary
    case .rejected, .stale, .failed: tint = AppTheme.textSecondary
    }
    return AdminStatusBadge(status.title, tint: tint)
}

fileprivate func contentRatingTaskTint(_ status: String) -> Color {
    switch status {
    case "completed": return AppTheme.primary
    case "failed", "cancelled": return AppTheme.danger
    default: return AppTheme.warning
    }
}

fileprivate struct EvidenceList: View {
    let evidence: [AdminContentRatingEvidence]
    let compact: Bool

    init(_ evidence: [AdminContentRatingEvidence], compact: Bool = false) {
        self.evidence = evidence
        self.compact = compact
    }

    var body: some View {
        if evidence.isEmpty {
            EmptyView()
        } else {
            VStack(alignment: .leading, spacing: compact ? 3 : 5) {
                ForEach(Array(evidence.enumerated()), id: \.offset) { _, item in
                    Label {
                        Text(evidenceLine(item))
                            .appTextLineLimit(compact ? 2 : 4)
                    } icon: {
                        Image(systemName: "checkmark.circle")
                            .foregroundStyle(AppTheme.primary)
                    }
                    .font(compact ? .caption2 : .caption)
                    .foregroundStyle(AppTheme.textSecondary)
                }
            }
        }
    }

    private func evidenceLine(_ item: AdminContentRatingEvidence) -> String {
        let key = item.field ?? item.type
        let value = item.value ?? item.rule ?? ""
        return value.isEmpty ? key : "\(key)：\(value)"
    }
}

// MARK: - 作品分级列表

private struct AdminContentRatingCatalogView: View {
    private let pageSize = 20

    @Binding private var module: AdminContentRatingModule
    @State private var requests = ListRequestGuard<AdminContentRatingQuery>()
    @State private var items: [AdminContentRatingItem] = []
    @State private var counts = AdminContentRatingCounts(general: 0, restricted: 0, unknown: 0)
    @State private var total = 0
    @State private var page = 0
    @State private var ratingFilter = ""
    @State private var sourceFilter = ""
    @State private var searchInput = ""
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var editing: AdminContentRatingItem?
    @State private var historyItem: AdminContentRatingItem?
    @State private var candidateItem: AdminContentRatingItem?

    init(module: Binding<AdminContentRatingModule>) {
        self._module = module
    }

    private var query: AdminContentRatingQuery {
        AdminContentRatingQuery(rating: ratingFilter, source: sourceFilter, search: searchInput.trimmingCharacters(in: .whitespacesAndNewlines), page: page)
    }

    private var pageCount: Int {
        max(1, Int(ceil(Double(total) / Double(pageSize))))
    }

    var body: some View {
        List {
            Section {
                AdminContentRatingModulePicker(selection: $module)
            }

            if let errorMessage, !items.isEmpty {
                LoadErrorNotice(message: errorMessage, isLoading: isLoading) {
                    Task { await load() }
                }
            }

            Section {
                AdminFilterBar {
                    AdminFilterMenu("分级", value: ratingFilterTitle) {
                        Button("全部") { changeRatingFilter("") }
                        ForEach(AdminContentRatingValue.allCases) { value in
                            Button(value.title) { changeRatingFilter(value.rawValue) }
                        }
                    }
                    AdminFilterMenu("来源", value: sourceFilterTitle) {
                        Button("全部") { changeSourceFilter("") }
                        ForEach(AdminContentRatingSource.allCases) { source in
                            Button(source.title) { changeSourceFilter(source.rawValue) }
                        }
                    }
                }
            }

            Section {
                HStack(spacing: 8) {
                    summaryChip("一般", count: counts.general, tint: AppTheme.primary)
                    summaryChip("限制级", count: counts.restricted, tint: AppTheme.danger)
                    summaryChip("未标注", count: counts.unknown, tint: AppTheme.warning)
                }
            } header: {
                Text("全量分布 · 共 \(total) 部")
            }

            if isLoading && items.isEmpty {
                Section {
                    ProgressView("加载中…")
                        .frame(maxWidth: .infinity, minHeight: 160)
                        .listRowBackground(Color.clear)
                }
            } else if let errorMessage, items.isEmpty {
                Section {
                    ContentUnavailableView {
                        Label("分级列表加载失败", systemImage: "wifi.slash")
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
                        Label("没有匹配的作品", systemImage: "checkmark.shield")
                    } description: {
                        Text("可以清除筛选条件，或搜索作品标题、作者和最近分级理由。")
                    }
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
                }
            } else {
                Section("作品分级") {
                    ForEach(items) { item in
                        ratingRow(item)
                    }
                }
            }

            if total > 0 {
                Section {
                    pagination
                }
            }
        }
        .scrollContentBackground(.hidden)
        .appListStyle(.settings)
        .searchable(text: $searchInput, prompt: "搜索作品、作者或分级理由")
        .onSubmit(of: .search) {
            page = 0
            Task { await load() }
        }
        .refreshable { await load() }
        .scrollDismissesKeyboard(.interactively)
        .task { await load() }
        .sheet(item: $editing) { item in
            AdminContentRatingEditSheet(item: item) {
                Task { await load() }
            }
        }
        .sheet(item: $historyItem) { item in
            AdminContentRatingHistorySheet(item: item)
        }
        .sheet(item: $candidateItem) { item in
            AdminContentRatingCandidateSheet(item: item) {
                Task { await load() }
            }
        }
    }

    private var ratingFilterTitle: String {
        ratingFilter.isEmpty ? "全部" : AdminContentRatingValue(rawValue: ratingFilter)?.title ?? ratingFilter
    }

    private var sourceFilterTitle: String {
        sourceFilter.isEmpty ? "全部" : contentRatingSourceTitle(sourceFilter)
    }

    private func changeRatingFilter(_ value: String) {
        ratingFilter = value
        page = 0
        Task { await load() }
    }

    private func changeSourceFilter(_ value: String) {
        sourceFilter = value
        page = 0
        Task { await load() }
    }

    private func load() async {
        let currentQuery = query
        let ticket = requests.begin(currentQuery)
        isLoading = true
        errorMessage = nil
        var succeeded = false
        defer {
            if requests.accepts(ticket, query: currentQuery) {
                requests.finish(ticket, succeeded: succeeded)
                isLoading = false
            }
        }

        do {
            let response = try await AdminAPI.contentRatings(
                rating: currentQuery.rating,
                source: currentQuery.source,
                search: currentQuery.search,
                limit: pageSize,
                offset: currentQuery.page * pageSize
            )
            guard !Task.isCancelled, requests.accepts(ticket, query: currentQuery) else { return }
            items = response.items
            counts = response.counts
            total = response.total
            let lastPage = max(0, Int(ceil(Double(response.total) / Double(pageSize))) - 1)
            if page > lastPage { page = lastPage }
            succeeded = true
        } catch {
            guard !Task.isCancelled, requests.accepts(ticket, query: currentQuery) else { return }
            errorMessage = AppCopy.friendlyError(error)
        }
    }

    private func summaryChip(_ title: String, count: Int, tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(.caption2)
                .foregroundStyle(AppTheme.textSecondary)
            Text(count.formatted())
                .font(.headline.monospacedDigit())
                .foregroundStyle(tint)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 2)
    }

    private var pagination: some View {
        HStack {
            Button("上一页", systemImage: "chevron.left") {
                page = max(0, page - 1)
                Task { await load() }
            }
            .disabled(page == 0 || isLoading)

            Spacer()
            Text("\(page + 1) / \(pageCount)")
                .font(.caption.monospacedDigit())
                .foregroundStyle(AppTheme.textSecondary)
            Spacer()

            Button("下一页", systemImage: "chevron.right") {
                page = min(pageCount - 1, page + 1)
                Task { await load() }
            }
            .disabled(page >= pageCount - 1 || isLoading)
        }
        .labelStyle(.titleAndIcon)
    }

    private func ratingRow(_ item: AdminContentRatingItem) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(item.title.isEmpty ? "未命名作品" : item.title)
                    .font(.headline)
                    .foregroundStyle(AppTheme.textPrimary)
                    .appTextLineLimit(2)
                Spacer(minLength: 4)
                contentRatingBadge(item.contentRating)
            }

            Text("\(item.author.isEmpty ? "未知作者" : item.author) · \(item.chapterCount) 章")
                .font(.caption)
                .foregroundStyle(AppTheme.textSecondary)
                .appTextLineLimit(1)

            AppAdaptiveRow(spacing: 8) {
                Text("来源：\(contentRatingSourceTitle(item.source))")
                Text("修订：\(item.revision)")
                Spacer(minLength: 4)
                Text(AdminFormat.relativeTime(item.contentRatingUpdatedAt))
            }
            .font(.caption2)
            .foregroundStyle(AppTheme.textSecondary)

            if !item.reason.isEmpty {
                Text("理由：\(item.reason)")
                    .font(.caption)
                    .foregroundStyle(AppTheme.textSecondary)
                    .appTextLineLimit(3)
            }

            if !item.evidence.isEmpty {
                EvidenceList(item.evidence, compact: true)
            }

            HStack {
                Spacer(minLength: 8)
                Menu {
                    Button("编辑分级", systemImage: "pencil") { editing = item }
                    Button("查看审计历史", systemImage: "clock.arrow.circlepath") { historyItem = item }
                    if item.contentRating == .restricted, item.source == AdminContentRatingSource.manual.rawValue {
                        Button("沉淀规则候选", systemImage: "line.3.horizontal.decrease.circle") { candidateItem = item }
                    }
                } label: {
                    Label("操作", systemImage: "ellipsis.circle")
                        .font(.caption)
                }
            }
        }
        .padding(.vertical, 3)
    }
}

// MARK: - 分级编辑与历史

private struct AdminContentRatingEditSheet: View {
    let item: AdminContentRatingItem
    let onSaved: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var rating: AdminContentRatingValue
    @State private var reason = ""
    @State private var isSaving = false
    @State private var errorMessage: String?

    init(item: AdminContentRatingItem, onSaved: @escaping () -> Void) {
        self.item = item
        self.onSaved = onSaved
        _rating = State(initialValue: item.contentRating)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("当前分级") {
                    LabeledContent("作品") {
                        Text(item.title)
                            .appTextLineLimit(2)
                            .multilineTextAlignment(.trailing)
                    }
                    LabeledContent("当前结果") { contentRatingBadge(item.contentRating) }
                    LabeledContent("来源", value: contentRatingSourceTitle(item.source))
                    LabeledContent("修订", value: "\(item.revision)")
                    if !item.reason.isEmpty {
                        Text("最近理由：\(item.reason)")
                            .font(.caption)
                            .foregroundStyle(AppTheme.textSecondary)
                    }
                    if !item.evidence.isEmpty {
                        EvidenceList(item.evidence)
                    }
                }

                Section {
                    Picker("新的分级", selection: $rating) {
                        ForEach(AdminContentRatingValue.allCases) { value in
                            Text(value.title).tag(value)
                        }
                    }
                    TextField("修改理由（必填）", text: $reason, axis: .vertical)
                        .lineLimit(3...7)
                } header: {
                    Text("人工修改")
                } footer: {
                    Text("修改理由会进入分级审计历史；提交时会校验作品修订号，避免覆盖其他管理员的更新。")
                }

                if let errorMessage {
                    Section {
                        Text(errorMessage)
                            .font(.caption)
                            .foregroundStyle(AppTheme.danger)
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .appListStyle(.settings)
            .navigationTitle("编辑分级")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isSaving ? "保存中…" : "保存") {
                        Task { await save() }
                    }
                    .disabled(isSaving || reason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
        .interactiveDismissDisabled(isSaving)
    }

    private func save() async {
        let normalizedReason = reason.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedReason.isEmpty else {
            errorMessage = "请填写本次修改的理由。"
            return
        }
        isSaving = true
        errorMessage = nil
        defer { isSaving = false }
        do {
            _ = try await AdminAPI.updateContentRating(
                novelID: item.id,
                rating: rating.rawValue,
                reason: normalizedReason,
                expectedRevision: item.revision
            )
            AppFeedback.success("作品分级已更新")
            onSaved()
            dismiss()
        } catch {
            errorMessage = AppCopy.friendlyError(error)
        }
    }
}

private struct AdminContentRatingHistorySheet: View {
    let item: AdminContentRatingItem

    @Environment(\.dismiss) private var dismiss
    @State private var history: [AdminContentRatingHistoryItem] = []
    @State private var isLoading = true
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            List {
                if isLoading {
                    ProgressView("加载审计历史…")
                        .frame(maxWidth: .infinity, minHeight: 120)
                        .listRowBackground(Color.clear)
                } else if let errorMessage {
                    ContentUnavailableView {
                        Label("历史加载失败", systemImage: "wifi.slash")
                    } description: {
                        Text(errorMessage)
                    } actions: {
                        Button("重试") { Task { await load() } }
                    }
                    .listRowBackground(Color.clear)
                } else if history.isEmpty {
                    ContentUnavailableView {
                        Label("暂无分级历史", systemImage: "clock")
                    } description: {
                        Text("这本作品还没有可展示的分级审计记录。")
                    }
                    .listRowBackground(Color.clear)
                } else {
                    Section("《\(item.title)》") {
                        ForEach(history) { entry in
                            historyRow(entry)
                        }
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .appListStyle(.settings)
            .navigationTitle("分级历史")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("关闭") { dismiss() }
                }
            }
            .task { await load() }
        }
    }

    private func load() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            history = try await AdminAPI.contentRatingHistory(novelID: item.id)
        } catch {
            errorMessage = AppCopy.friendlyError(error)
        }
    }

    private func historyRow(_ entry: AdminContentRatingHistoryItem) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack {
                contentRatingBadge(entry.fromRating)
                Image(systemName: "arrow.right")
                    .font(.caption)
                    .foregroundStyle(AppTheme.textSecondary)
                contentRatingBadge(entry.toRating)
                Spacer()
                Text(AdminFormat.relativeTime(entry.createdAt))
                    .font(.caption2)
                    .foregroundStyle(AppTheme.textSecondary)
            }
            Text("来源：\(contentRatingSourceTitle(entry.source)) · 操作者：\(entry.actorName.isEmpty ? "系统" : entry.actorName)")
                .font(.caption)
                .foregroundStyle(AppTheme.textSecondary)
            if !entry.reason.isEmpty {
                Text(entry.reason)
                    .font(.callout)
                    .foregroundStyle(AppTheme.textPrimary)
                    .appTextLineLimit(5)
            }
            if !entry.evidence.isEmpty {
                EvidenceList(entry.evidence, compact: true)
            }
            if !entry.ruleVersion.isEmpty {
                Text("规则版本：\(entry.ruleVersion)")
                    .font(.caption2)
                    .foregroundStyle(AppTheme.textSecondary)
            }
        }
        .padding(.vertical, 3)
    }
}

private struct AdminContentRatingCandidateSheet: View {
    let item: AdminContentRatingItem
    let onSaved: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var kind: AdminContentRatingRuleKind = .category
    @State private var value = ""
    @State private var reason = ""
    @State private var isSaving = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    LabeledContent("作品") {
                        Text(item.title)
                            .appTextLineLimit(2)
                            .multilineTextAlignment(.trailing)
                    }
                    LabeledContent("人工来源") { contentRatingBadge(item.contentRating) }
                    Text("只有人工确认的 restricted 作品可以沉淀规则候选；本次操作不会立即修改其他作品。")
                        .font(.caption)
                        .foregroundStyle(AppTheme.textSecondary)
                }

                Section {
                    Picker("候选类型", selection: $kind) {
                        ForEach(AdminContentRatingRuleKind.allCases) { value in
                            Text(value.title).tag(value)
                        }
                    }
                    TextField(kind == .category ? "分类标签" : "文本短语", text: $value, axis: .vertical)
                        .lineLimit(2...4)
                    TextField("候选理由（必填）", text: $reason, axis: .vertical)
                        .lineLimit(3...7)
                } header: {
                    Text("候选内容")
                } footer: {
                    Text(kind == .category ? "分类候选按完整标签匹配，不做模糊子串匹配。" : "文本候选以字面短语保存，批准前可以预览可能命中的未标注作品。")
                }

                if let errorMessage {
                    Section {
                        Text(errorMessage)
                            .font(.caption)
                            .foregroundStyle(AppTheme.danger)
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .appListStyle(.settings)
            .navigationTitle("沉淀规则候选")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isSaving ? "保存中…" : "保存") {
                        Task { await save() }
                    }
                    .disabled(isSaving || value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || reason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
        .interactiveDismissDisabled(isSaving)
    }

    private func save() async {
        let normalizedValue = value.trimmingCharacters(in: .whitespacesAndNewlines)
        let normalizedReason = reason.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedValue.isEmpty else {
            errorMessage = "请填写分类标签或文本短语。"
            return
        }
        guard !normalizedReason.isEmpty else {
            errorMessage = "请填写为什么这个值可以作为限制级判断依据。"
            return
        }
        isSaving = true
        errorMessage = nil
        defer { isSaving = false }
        do {
            let result = try await AdminAPI.createContentRatingRuleCandidate(
                novelID: item.id,
                kind: kind.rawValue,
                value: normalizedValue,
                reason: normalizedReason
            )
            AppFeedback.success(result.created ? "已生成待审核规则候选" : "候选已存在，已尝试补充人工例证")
            onSaved()
            dismiss()
        } catch {
            errorMessage = AppCopy.friendlyError(error)
        }
    }
}

// MARK: - 动态规则候选

private struct AdminContentRatingRuleCandidatesView: View {
    private let pageSize = 20

    @Binding private var module: AdminContentRatingModule
    @State private var requests = ListRequestGuard<AdminContentRatingRuleQuery>()
    @State private var items: [AdminContentRatingRuleCandidate] = []
    @State private var counts = AdminContentRatingRuleCandidateCounts(pending: 0, approved: 0, rejected: 0)
    @State private var total = 0
    @State private var activeRuleVersion = ""
    @State private var page = 0
    @State private var statusFilter = AdminContentRatingRuleStatus.pending.rawValue
    @State private var kindFilter = ""
    @State private var searchInput = ""
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var previewCandidate: AdminContentRatingRuleCandidate?

    init(module: Binding<AdminContentRatingModule>) {
        self._module = module
    }

    private var query: AdminContentRatingRuleQuery {
        AdminContentRatingRuleQuery(
            status: statusFilter,
            kind: kindFilter,
            search: searchInput.trimmingCharacters(in: .whitespacesAndNewlines),
            page: page
        )
    }

    private var pageCount: Int {
        max(1, Int(ceil(Double(total) / Double(pageSize))))
    }

    var body: some View {
        List {
            Section {
                AdminContentRatingModulePicker(selection: $module)
            }

            if let errorMessage, !items.isEmpty {
                LoadErrorNotice(message: errorMessage, isLoading: isLoading) {
                    Task { await load() }
                }
            }

            Section {
                AdminFilterBar {
                    AdminFilterMenu("状态", value: ruleStatusTitle) {
                        Button("全部") { changeStatus("") }
                        ForEach(AdminContentRatingRuleStatus.allCases) { status in
                            Button(status.title) { changeStatus(status.rawValue) }
                        }
                    }
                    AdminFilterMenu("类型", value: ruleKindTitle) {
                        Button("全部") { changeKind("") }
                        ForEach(AdminContentRatingRuleKind.allCases) { kind in
                            Button(kind.title) { changeKind(kind.rawValue) }
                        }
                    }
                }
            }

            Section {
                HStack(spacing: 12) {
                    ruleCount("待审核", value: counts.pending, tint: AppTheme.warning)
                    ruleCount("已批准", value: counts.approved, tint: AppTheme.primary)
                    ruleCount("已拒绝", value: counts.rejected, tint: AppTheme.textSecondary)
                    Spacer(minLength: 0)
                }
                if !activeRuleVersion.isEmpty {
                    Text("当前生效规则版本：\(activeRuleVersion)")
                        .font(.caption)
                        .foregroundStyle(AppTheme.textSecondary)
                }
            } header: {
                Text("动态规则审核")
            }

            if isLoading && items.isEmpty {
                Section {
                    ProgressView("加载规则候选…")
                        .frame(maxWidth: .infinity, minHeight: 140)
                        .listRowBackground(Color.clear)
                }
            } else if let errorMessage, items.isEmpty {
                Section {
                    ContentUnavailableView {
                        Label("规则候选加载失败", systemImage: "wifi.slash")
                    } description: {
                        Text(errorMessage)
                    } actions: {
                        Button("重试") { Task { await load() } }
                    }
                    .listRowBackground(Color.clear)
                }
            } else if items.isEmpty {
                Section {
                    ContentUnavailableView {
                        Label("没有规则候选", systemImage: "line.3.horizontal.decrease.circle")
                    } description: {
                        Text(statusFilter == "pending" ? "人工确认限制级作品后，可以从分级列表沉淀规则候选。" : "当前筛选条件下没有规则候选。")
                    }
                    .listRowBackground(Color.clear)
                }
            } else {
                Section("规则候选") {
                    ForEach(items) { item in
                        candidateRow(item)
                    }
                }
            }

            if total > 0 {
                Section { pagination }
            }
        }
        .scrollContentBackground(.hidden)
        .appListStyle(.settings)
        .searchable(text: $searchInput, prompt: "搜索规则值、例证作品或理由")
        .onSubmit(of: .search) {
            page = 0
            Task { await load() }
        }
        .refreshable { await load() }
        .scrollDismissesKeyboard(.interactively)
        .task { await load() }
        .sheet(item: $previewCandidate) { candidate in
            AdminContentRatingRuleCandidateReviewSheet(candidate: candidate) {
                Task { await load() }
            }
        }
    }

    private var ruleStatusTitle: String {
        statusFilter.isEmpty ? "全部" : AdminContentRatingRuleStatus(rawValue: statusFilter)?.title ?? statusFilter
    }

    private var ruleKindTitle: String {
        kindFilter.isEmpty ? "全部" : AdminContentRatingRuleKind(rawValue: kindFilter)?.title ?? kindFilter
    }

    private func changeStatus(_ value: String) {
        statusFilter = value
        page = 0
        Task { await load() }
    }

    private func changeKind(_ value: String) {
        kindFilter = value
        page = 0
        Task { await load() }
    }

    private func load() async {
        let currentQuery = query
        let ticket = requests.begin(currentQuery)
        isLoading = true
        errorMessage = nil
        var succeeded = false
        defer {
            if requests.accepts(ticket, query: currentQuery) {
                requests.finish(ticket, succeeded: succeeded)
                isLoading = false
            }
        }

        do {
            let response = try await AdminAPI.contentRatingRuleCandidates(
                status: currentQuery.status,
                kind: currentQuery.kind,
                search: currentQuery.search,
                limit: pageSize,
                offset: currentQuery.page * pageSize
            )
            guard !Task.isCancelled, requests.accepts(ticket, query: currentQuery) else { return }
            items = response.items
            counts = response.counts
            total = response.total
            activeRuleVersion = response.activeRuleVersion
            let lastPage = max(0, Int(ceil(Double(response.total) / Double(pageSize))) - 1)
            if page > lastPage { page = lastPage }
            succeeded = true
        } catch {
            guard !Task.isCancelled, requests.accepts(ticket, query: currentQuery) else { return }
            errorMessage = AppCopy.friendlyError(error)
        }
    }

    private func ruleCount(_ title: String, value: Int, tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(.caption2)
                .foregroundStyle(AppTheme.textSecondary)
            Text(value.formatted())
                .font(.headline.monospacedDigit())
                .foregroundStyle(tint)
        }
    }

    private var pagination: some View {
        HStack {
            Button("上一页", systemImage: "chevron.left") {
                page = max(0, page - 1)
                Task { await load() }
            }
            .disabled(page == 0 || isLoading)
            Spacer()
            Text("\(page + 1) / \(pageCount)")
                .font(.caption.monospacedDigit())
                .foregroundStyle(AppTheme.textSecondary)
            Spacer()
            Button("下一页", systemImage: "chevron.right") {
                page = min(pageCount - 1, page + 1)
                Task { await load() }
            }
            .disabled(page >= pageCount - 1 || isLoading)
        }
    }

    private func candidateRow(_ item: AdminContentRatingRuleCandidate) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(item.value)
                    .font(.headline)
                    .foregroundStyle(AppTheme.textPrimary)
                    .appTextLineLimit(2)
                Spacer(minLength: 4)
                ruleStatusBadge(item.status)
            }
            HStack(spacing: 8) {
                Text(item.kind.title)
                Text("例证 \(item.exampleCount)")
                if !item.ruleVersion.isEmpty {
                    Text("规则 \(item.ruleVersion)")
                }
                Spacer(minLength: 4)
                Text(AdminFormat.relativeTime(item.updatedAt))
            }
            .font(.caption)
            .foregroundStyle(AppTheme.textSecondary)

            if let example = item.latestExample {
                Text("最近例证：《\(example.novelTitle)》 · \(example.createdByName.isEmpty ? "管理员" : example.createdByName)")
                    .font(.caption)
                    .foregroundStyle(AppTheme.textSecondary)
                    .appTextLineLimit(2)
            }

            HStack {
                Spacer(minLength: 8)
                Button("预览影响并审核", systemImage: "eye") { previewCandidate = item }
                    .font(.caption)
                    .disabled(item.status != .pending)
            }
        }
        .padding(.vertical, 3)
    }
}

private struct AdminContentRatingRuleCandidateReviewSheet: View {
    let candidate: AdminContentRatingRuleCandidate
    let onReviewed: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var preview: AdminContentRatingRuleCandidatePreviewResponse?
    @State private var isLoading = true
    @State private var isSaving = false
    @State private var errorMessage: String?
    @State private var decision: String?
    @State private var reason = ""

    var body: some View {
        NavigationStack {
            List {
                if isLoading {
                    ProgressView("正在计算影响范围…")
                        .frame(maxWidth: .infinity, minHeight: 150)
                        .listRowBackground(Color.clear)
                } else if let errorMessage {
                    ContentUnavailableView {
                        Label("预览失败", systemImage: "wifi.slash")
                    } description: {
                        Text(errorMessage)
                    } actions: {
                        Button("重试") { Task { await load() } }
                    }
                    .listRowBackground(Color.clear)
                } else if let preview {
                    Section {
                        HStack {
                            AdminStatusBadge(candidate.kind.title, tint: AppTheme.primary)
                            Text(candidate.value)
                                .font(.headline)
                                .foregroundStyle(AppTheme.textPrimary)
                                .appTextLineLimit(2)
                        }
                        LabeledContent("预计影响", value: "\(preview.affectedCount) 部未标注作品")
                        LabeledContent("当前规则", value: preview.currentRuleVersion)
                        LabeledContent("批准后规则", value: preview.prospectiveRuleVersion)
                    } header: {
                        Text("审核摘要")
                    } footer: {
                        Text("批准只会处理仍为 unknown 的作品；一般作品和已人工确认的作品不会被覆盖。")
                    }

                    if preview.items.isEmpty {
                        Section {
                            Text("当前没有命中的未标注作品；批准后规则仍会对后续新作品生效。")
                                .font(.callout)
                                .foregroundStyle(AppTheme.textSecondary)
                        }
                    } else {
                        Section("将被改为限制级的未标注作品") {
                            ForEach(preview.items) { item in
                                VStack(alignment: .leading, spacing: 5) {
                                    Text(item.title)
                                        .font(.subheadline.weight(.medium))
                                        .foregroundStyle(AppTheme.textPrimary)
                                        .appTextLineLimit(2)
                                    Text("\(item.author.isEmpty ? "未知作者" : item.author) · 修订 \(item.revision) · \(item.matchedFields.joined(separator: "、"))")
                                        .font(.caption)
                                        .foregroundStyle(AppTheme.textSecondary)
                                        .appTextLineLimit(2)
                                    EvidenceList(item.evidence, compact: true)
                                }
                                .padding(.vertical, 2)
                            }
                            if preview.affectedCount > preview.items.count {
                                Text("仅展示前 \(preview.items.count) 部，实际影响范围为 \(preview.affectedCount) 部。")
                                    .font(.caption)
                                    .foregroundStyle(AppTheme.textSecondary)
                            }
                        }
                    }

                    if let decision {
                        Section("审核理由") {
                            TextField(decision == "approve" ? "批准理由（必填）" : "拒绝理由（必填）", text: $reason, axis: .vertical)
                                .lineLimit(3...7)
                            Text(decision == "approve" ? "批准后会更新规则版本，并将命中的未标注作品写入分级审计。" : "拒绝只结束这条候选的审核，不修改任何作品。")
                                .font(.caption)
                                .foregroundStyle(AppTheme.textSecondary)
                        }
                    }
                }

                if let errorMessage, preview != nil {
                    Section {
                        Text(errorMessage)
                            .font(.caption)
                            .foregroundStyle(AppTheme.danger)
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .appListStyle(.settings)
            .navigationTitle("规则影响预览")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("关闭") { dismiss() }
                        .disabled(isSaving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    if let decision {
                        Button(isSaving ? "提交中…" : (decision == "approve" ? "确认批准并应用" : "确认拒绝")) {
                            Task { await review() }
                        }
                        .disabled(isSaving || reason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                }
            }
            .safeAreaInset(edge: .bottom) {
                if preview != nil, decision == nil, !isLoading {
                    HStack(spacing: 10) {
                        Button("拒绝候选", systemImage: "xmark.circle") {
                            decision = "reject"
                        }
                        .buttonStyle(.bordered)
                        .tint(AppTheme.textSecondary)
                        Spacer()
                        Button("批准并应用", systemImage: "checkmark.circle") {
                            decision = "approve"
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(AppTheme.primary)
                    }
                    .padding(.horizontal, AppLayout.pageInset)
                    .padding(.vertical, 8)
                    .background(.bar)
                }
            }
            .task { await load() }
        }
        .interactiveDismissDisabled(isSaving)
    }

    private func load() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            preview = try await AdminAPI.previewContentRatingRuleCandidate(candidateID: candidate.id)
        } catch {
            errorMessage = AppCopy.friendlyError(error)
        }
    }

    private func review() async {
        guard let decision, let preview else { return }
        let normalizedReason = reason.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedReason.isEmpty else {
            errorMessage = "请填写审核决定的理由。"
            return
        }
        isSaving = true
        errorMessage = nil
        defer { isSaving = false }
        do {
            let result = try await AdminAPI.reviewContentRatingRuleCandidate(
                candidateID: candidate.id,
                decision: decision,
                expectedRevision: preview.candidate.revision,
                reason: normalizedReason
            )
            if result.decision == "approve" {
                AppFeedback.success("规则已批准并应用，影响 \(result.appliedCount) 部作品")
            } else {
                AppFeedback.success("规则候选已拒绝")
            }
            onReviewed()
            dismiss()
        } catch {
            errorMessage = AppCopy.friendlyError(error)
        }
    }
}

// MARK: - LLM 分级建议与批次进度

private struct AdminContentRatingAISuggestionsView: View {
    private let pageSize = 20

    @Binding private var module: AdminContentRatingModule
    @Environment(\.scenePhase) private var scenePhase
    @State private var requests = ListRequestGuard<AdminContentRatingAIQuery>()
    @State private var items: [AdminContentRatingAISuggestion] = []
    @State private var counts = AdminContentRatingAISuggestionCounts(pending: 0, approved: 0, rejected: 0, stale: 0, failed: 0)
    @State private var total = 0
    @State private var page = 0
    @State private var statusFilter = AdminContentRatingAISuggestionStatus.pending.rawValue
    @State private var searchInput = ""
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var task: AiTaskInfo?
    @State private var progress: AdminContentRatingAITaskProgress?
    @State private var batchLimit = 20
    @State private var isScanning = false
    @State private var isCancelling = false
    @State private var isResuming = false
    @State private var pollTask: Task<Void, Never>?
    @State private var pollingToken = UUID()
    @State private var lastProgressTaskID: String?
    @State private var lastProgressDone = -1
    @State private var reviewingSuggestion: AdminContentRatingAISuggestion?

    init(module: Binding<AdminContentRatingModule>) {
        self._module = module
    }

    private var query: AdminContentRatingAIQuery {
        AdminContentRatingAIQuery(
            status: statusFilter,
            search: searchInput.trimmingCharacters(in: .whitespacesAndNewlines),
            page: page
        )
    }

    private var pageCount: Int {
        max(1, Int(ceil(Double(total) / Double(pageSize))))
    }

    var body: some View {
        List {
            Section {
                AdminContentRatingModulePicker(selection: $module)
            }

            if let errorMessage, !items.isEmpty {
                LoadErrorNotice(message: errorMessage, isLoading: isLoading) {
                    Task { await loadSuggestions() }
                }
            }

            analysisControlSection

            Section {
                AdminFilterBar {
                    AdminFilterMenu("状态", value: aiStatusTitle) {
                        Button("全部") { changeStatus("") }
                        ForEach(AdminContentRatingAISuggestionStatus.allCases) { status in
                            Button(status.title) { changeStatus(status.rawValue) }
                        }
                    }
                }
            }

            if isLoading && items.isEmpty {
                Section {
                    ProgressView("加载 LLM 建议…")
                        .frame(maxWidth: .infinity, minHeight: 140)
                        .listRowBackground(Color.clear)
                }
            } else if let errorMessage, items.isEmpty {
                Section {
                    ContentUnavailableView {
                        Label("LLM 建议加载失败", systemImage: "wifi.slash")
                    } description: {
                        Text(errorMessage)
                    } actions: {
                        Button("重试") { Task { await loadSuggestions() } }
                    }
                    .listRowBackground(Color.clear)
                }
            } else if items.isEmpty {
                Section {
                    ContentUnavailableView {
                        Label("没有待审核的 LLM 建议", systemImage: "sparkles")
                    } description: {
                        Text(statusFilter == "pending" ? "先对未标注作品启动 LLM 分析，生成建议后再逐条人工审核。" : "当前筛选条件下没有建议。")
                    }
                    .listRowBackground(Color.clear)
                }
            } else {
                Section("LLM 分级建议 · 共 \(total) 条") {
                    ForEach(items) { item in
                        suggestionRow(item)
                    }
                }
            }

            if total > 0 {
                Section { pagination }
            }
        }
        .scrollContentBackground(.hidden)
        .appListStyle(.settings)
        .searchable(text: $searchInput, prompt: "搜索作品或作者")
        .onSubmit(of: .search) {
            page = 0
            Task { await loadSuggestions() }
        }
        .refreshable { await refreshAll() }
        .scrollDismissesKeyboard(.interactively)
        .task { await initialLoad() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active {
                if let task, task.isRunning {
                    startPolling(task.id)
                }
            } else if phase == .background {
                stopPolling()
            }
        }
        .onDisappear {
            stopPolling()
        }
        .sheet(item: $reviewingSuggestion) { suggestion in
            AdminContentRatingAISuggestionReviewSheet(suggestion: suggestion) {
                Task { await loadSuggestions() }
            }
        }
    }

    private var aiStatusTitle: String {
        statusFilter.isEmpty ? "全部" : AdminContentRatingAISuggestionStatus(rawValue: statusFilter)?.title ?? statusFilter
    }

    @ViewBuilder
    private var analysisControlSection: some View {
        Section {
            if let progress {
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text("最近批次")
                            .font(.subheadline.weight(.medium))
                        Spacer()
                        AdminStatusBadge(
                            AdminFormat.aiTaskStatus(progress.task.status ?? ""),
                            tint: contentRatingTaskTint(progress.task.status ?? "")
                        )
                    }
                    ProgressView(value: Double(progress.done), total: Double(max(progress.total, 1)))
                        .tint(AppTheme.primary)
                    HStack {
                        Text("已处理 \(progress.done) / \(progress.total)")
                        Spacer()
                        Text("剩余 \(progress.remaining)")
                    }
                    .font(.caption)
                    .foregroundStyle(AppTheme.textSecondary)
                    if let step = progress.task.step, !step.isEmpty {
                        Text(step)
                            .font(.caption)
                            .foregroundStyle(AppTheme.textSecondary)
                            .appTextLineLimit(2)
                    }
                    if let taskError = progress.task.error, !taskError.isEmpty {
                        Text(taskError)
                            .font(.caption)
                            .foregroundStyle(AppTheme.danger)
                            .appTextLineLimit(3)
                    }
                }
            } else {
                Text("LLM 只会分析 contentRating=unknown 的作品，结果会先进入待审核队列，不会直接修改分级。")
                    .font(.callout)
                    .foregroundStyle(AppTheme.textSecondary)
            }

            Picker("本次最多分析", selection: $batchLimit) {
                Text("10 部").tag(10)
                Text("20 部").tag(20)
                Text("50 部").tag(50)
                Text("100 部").tag(100)
            }

            HStack(spacing: 10) {
                Button(isScanning ? "提交中…" : "开始 LLM 分析", systemImage: "sparkles") {
                    Task { await startScan() }
                }
                .buttonStyle(.borderedProminent)
                .tint(AppTheme.primary)
                .disabled(isScanning || task?.isRunning == true)

                if let task, task.isRunning {
                    Button(isCancelling ? "中止中…" : "中止", systemImage: "stop.circle", role: .destructive) {
                        Task { await cancelTask(task) }
                    }
                    .disabled(isCancelling)
                } else if progress?.canResume == true, let task {
                    Button(isResuming ? "恢复中…" : "断点恢复", systemImage: "arrow.clockwise.circle") {
                        Task { await resumeTask(task) }
                    }
                    .disabled(isResuming)
                }
            }

            HStack {
                if let progress, !progress.promptVersion.isEmpty {
                    Text("提示版本：\(progress.promptVersion)")
                        .font(.caption2)
                        .foregroundStyle(AppTheme.textSecondary)
                }
                Spacer()
                if let task {
                    Button("刷新进度", systemImage: "arrow.clockwise") {
                        Task { await loadProgress(task.id) }
                    }
                    .font(.caption)
                    .disabled(isScanning || isCancelling || isResuming)
                }
            }
        } header: {
            Text("LLM 批次分析")
        } footer: {
            Text("中止会保留已生成建议；断点恢复只补未分析或失败的作品，不会重复覆盖已有终态建议。")
        }
    }

    private func changeStatus(_ value: String) {
        statusFilter = value
        page = 0
        Task { await loadSuggestions() }
    }

    private func initialLoad() async {
        await loadSuggestions()
        await loadLatestTask()
    }

    private func refreshAll() async {
        await loadSuggestions()
        await loadLatestTask()
        if let task, task.isRunning {
            startPolling(task.id)
        }
    }

    private func loadSuggestions() async {
        let currentQuery = query
        let ticket = requests.begin(currentQuery)
        isLoading = true
        errorMessage = nil
        var succeeded = false
        defer {
            if requests.accepts(ticket, query: currentQuery) {
                requests.finish(ticket, succeeded: succeeded)
                isLoading = false
            }
        }

        do {
            let response = try await AdminAPI.contentRatingAISuggestions(
                status: currentQuery.status,
                search: currentQuery.search,
                limit: pageSize,
                offset: currentQuery.page * pageSize
            )
            guard !Task.isCancelled, requests.accepts(ticket, query: currentQuery) else { return }
            items = response.items
            total = response.total
            counts = response.counts
            let lastPage = max(0, Int(ceil(Double(response.total) / Double(pageSize))) - 1)
            if page > lastPage { page = lastPage }
            succeeded = true
        } catch {
            guard !Task.isCancelled, requests.accepts(ticket, query: currentQuery) else { return }
            errorMessage = AppCopy.friendlyError(error)
        }
    }

    private func loadLatestTask() async {
        do {
            let latest = try await AdminAPI.latestContentRatingAITask()
            guard !Task.isCancelled else { return }
            task = latest.task
            if let latestTask = latest.task {
                lastProgressTaskID = latestTask.id
                lastProgressDone = latest.done
                progress = AdminContentRatingAITaskProgress(
                    task: latestTask,
                    total: latest.total,
                    done: latest.done,
                    remaining: latest.remaining,
                    canResume: latest.canResume,
                    resumable: latest.resumable,
                    promptVersion: latest.promptVersion
                )
                if latestTask.isRunning, scenePhase == .active {
                    startPolling(latestTask.id)
                }
            } else {
                lastProgressTaskID = nil
                lastProgressDone = -1
                progress = nil
            }
        } catch {
            // 进度对齐失败不阻塞建议队列；用户仍可以手动刷新或提交新的批次。
        }
    }

    /// 应用服务端批次进度，并在 done 前进时把新生成的建议加载进审核列表。
    /// 任务终态仍会强制刷新一次，收敛最后一个结果和失败/取消状态。
    private func applyProgress(_ result: AdminContentRatingAITaskProgress) async {
        let hasNewResult: Bool
        if lastProgressTaskID == result.task.id {
            hasNewResult = result.done > lastProgressDone
        } else {
            hasNewResult = result.done > 0
        }
        lastProgressTaskID = result.task.id
        lastProgressDone = result.done
        task = result.task
        progress = result
        if hasNewResult || !result.task.isRunning {
            await loadSuggestions()
        }
    }

    private func loadProgress(_ taskID: String) async {
        do {
            let result = try await AdminAPI.contentRatingAITaskProgress(taskID: taskID)
            guard !Task.isCancelled else { return }
            await applyProgress(result)
        } catch {
            errorMessage = AppCopy.friendlyError(error)
        }
    }

    private func startScan() async {
        isScanning = true
        errorMessage = nil
        defer { isScanning = false }
        do {
            let result = try await AdminAPI.startContentRatingAIScan(limit: batchLimit)
            guard !Task.isCancelled else { return }
            if result.taskId.isEmpty {
                AppFeedback.success(result.message ?? "当前没有可分析的未标注作品")
                await loadSuggestions()
                return
            }
            task = result.task
            AppFeedback.success("已提交 LLM 分析任务，将生成 \(result.selected) 条待审核建议")
            await loadProgress(result.taskId)
            if scenePhase == .active {
                startPolling(result.taskId)
            }
            await loadSuggestions()
        } catch {
            errorMessage = AppCopy.friendlyError(error)
        }
    }

    private func cancelTask(_ currentTask: AiTaskInfo) async {
        isCancelling = true
        errorMessage = nil
        defer { isCancelling = false }
        do {
            try await AdminAPI.cancelAiTask(id: currentTask.id, operationID: UUID().uuidString)
            stopPolling()
            await loadProgress(currentTask.id)
            await loadSuggestions()
            AppFeedback.success("已中止分析任务，已生成的建议保留在下方列表")
        } catch {
            errorMessage = AppCopy.friendlyError(error)
        }
    }

    private func resumeTask(_ currentTask: AiTaskInfo) async {
        isResuming = true
        errorMessage = nil
        defer { isResuming = false }
        do {
            let result = try await AdminAPI.resumeContentRatingAITask(taskID: currentTask.id)
            guard !Task.isCancelled else { return }
            if result.taskId.isEmpty {
                AppFeedback.success(result.message ?? "没有需要补跑的作品，批次已完成")
                await loadProgress(currentTask.id)
            } else {
                task = result.task
                await loadProgress(result.taskId)
                if scenePhase == .active {
                    startPolling(result.taskId)
                }
                AppFeedback.success("已断点恢复：跳过 \(result.skipped) 部，补跑 \(result.selected) 部")
            }
            await loadSuggestions()
        } catch {
            errorMessage = AppCopy.friendlyError(error)
        }
    }

    private func startPolling(_ taskID: String) {
        pollTask?.cancel()
        let token = UUID()
        pollingToken = token
        pollTask = Task { @MainActor in
            var attempts = 0
            var consecutiveFailures = 0
            while !Task.isCancelled, attempts < 240 {
                if attempts > 0 {
                    try? await Task.sleep(nanoseconds: 2_000_000_000)
                    guard !Task.isCancelled else { return }
                }
                guard pollingToken == token else { return }
                do {
                    let result = try await AdminAPI.contentRatingAITaskProgress(taskID: taskID)
                    guard !Task.isCancelled, pollingToken == token else { return }
                    consecutiveFailures = 0
                    await applyProgress(result)
                    if !result.task.isRunning {
                        pollTask = nil
                        return
                    }
                } catch {
                    guard !Task.isCancelled, pollingToken == token else { return }
                    consecutiveFailures += 1
                    if consecutiveFailures >= 5 {
                        pollTask = nil
                        errorMessage = "LLM 任务仍在服务器运行，查询暂时中断；请稍后刷新进度。"
                        return
                    }
                }
                attempts += 1
            }
            if !Task.isCancelled, pollingToken == token {
                pollTask = nil
                errorMessage = "LLM 任务仍在服务器运行，查询窗口已结束；请手动刷新进度。"
            }
        }
    }

    private func stopPolling() {
        pollTask?.cancel()
        pollTask = nil
        pollingToken = UUID()
    }

    private var pagination: some View {
        HStack {
            Button("上一页", systemImage: "chevron.left") {
                page = max(0, page - 1)
                Task { await loadSuggestions() }
            }
            .disabled(page == 0 || isLoading)
            Spacer()
            Text("\(page + 1) / \(pageCount)")
                .font(.caption.monospacedDigit())
                .foregroundStyle(AppTheme.textSecondary)
            Spacer()
            Button("下一页", systemImage: "chevron.right") {
                page = min(pageCount - 1, page + 1)
                Task { await loadSuggestions() }
            }
            .disabled(page >= pageCount - 1 || isLoading)
        }
    }

    private func suggestionRow(_ item: AdminContentRatingAISuggestion) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(item.title.isEmpty ? "未命名作品" : item.title)
                    .font(.headline)
                    .foregroundStyle(AppTheme.textPrimary)
                    .appTextLineLimit(2)
                Spacer(minLength: 4)
                if item.status == .pending {
                    contentRatingBadge(item.suggestedRating)
                } else {
                    aiSuggestionStatusBadge(item.status)
                }
            }
            HStack(spacing: 8) {
                Text("当前：\(item.currentRating.title)")
                Text("置信度 \(Int((item.confidence * 100).rounded()))%")
                Spacer(minLength: 4)
                Text(AdminFormat.relativeTime(item.updatedAt))
            }
            .font(.caption)
            .foregroundStyle(AppTheme.textSecondary)
            Text(item.reason.isEmpty ? "未记录 LLM 理由" : item.reason)
                .font(.callout)
                .foregroundStyle(AppTheme.textPrimary)
                .appTextLineLimit(4)
            if !item.error.isEmpty {
                Text("错误：\(item.error)")
                    .font(.caption)
                    .foregroundStyle(AppTheme.danger)
                    .appTextLineLimit(3)
            }
            Text("模型：\(item.model.isEmpty ? "未记录" : item.model) · 提示版本：\(item.promptVersion.isEmpty ? "未记录" : item.promptVersion)")
                .font(.caption2)
                .foregroundStyle(AppTheme.textSecondary)
                .appTextLineLimit(2)
            if !item.evidence.isEmpty {
                EvidenceList(item.evidence, compact: true)
            }
            HStack {
                Spacer(minLength: 8)
                Button("审核建议", systemImage: "checkmark.seal") {
                    reviewingSuggestion = item
                }
                .font(.caption)
                .disabled(item.status != .pending)
            }
        }
        .padding(.vertical, 3)
    }
}

private struct AdminContentRatingAISuggestionReviewSheet: View {
    let suggestion: AdminContentRatingAISuggestion
    let onReviewed: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var decision: String?
    @State private var reason = ""
    @State private var isSaving = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            List {
                Section {
                    HStack {
                        Text("AI 建议")
                            .foregroundStyle(AppTheme.textSecondary)
                        Spacer()
                        contentRatingBadge(suggestion.suggestedRating)
                    }
                    LabeledContent("置信度", value: "\(Int((suggestion.confidence * 100).rounded()))%")
                    LabeledContent("当前分级", value: suggestion.currentRating.title)
                    LabeledContent("当前来源", value: contentRatingSourceTitle(suggestion.currentSource))
                    LabeledContent("作品修订", value: "\(suggestion.novelRevision)")
                    LabeledContent("模型", value: suggestion.model.isEmpty ? "未记录" : suggestion.model)
                    LabeledContent("提示版本", value: suggestion.promptVersion.isEmpty ? "未记录" : suggestion.promptVersion)
                } header: {
                    Text(suggestion.title)
                } footer: {
                    Text("LLM 不能直接发布分级；只有管理员批准限制级建议时才会写入分级审计。批准“继续未标注”也不会把作品改为一般。")
                }

                Section("模型理由") {
                    Text(suggestion.reason.isEmpty ? "未记录 LLM 理由" : suggestion.reason)
                        .font(.callout)
                        .foregroundStyle(AppTheme.textPrimary)
                    if !suggestion.evidence.isEmpty {
                        EvidenceList(suggestion.evidence)
                    }
                }

                if let decision {
                    Section {
                        TextField(decision == "approve" ? "批准理由（必填）" : "拒绝理由（必填）", text: $reason, axis: .vertical)
                            .lineLimit(3...7)
                        Text(decision == "approve" && suggestion.suggestedRating == .restricted ? "提交时服务端会再次锁定作品并校验修订号，确认建议仍基于当前内容。" : "本次决定会写入建议审核记录。")
                            .font(.caption)
                            .foregroundStyle(AppTheme.textSecondary)
                    } header: {
                        HStack {
                            Text("审核理由")
                            Spacer(minLength: 12)
                            if decision == "approve", !suggestion.reason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                                Button("复用 AI 建议理由", systemImage: "arrow.down.doc") {
                                    reason = String(suggestion.reason.trimmingCharacters(in: .whitespacesAndNewlines).prefix(500))
                                }
                                .font(.caption)
                                .textCase(nil)
                                .disabled(isSaving)
                            }
                        }
                    }
                }

                if let errorMessage {
                    Section {
                        Text(errorMessage)
                            .font(.caption)
                            .foregroundStyle(AppTheme.danger)
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .appListStyle(.settings)
            .navigationTitle("审核 LLM 建议")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("关闭") { dismiss() }
                        .disabled(isSaving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    if let decision {
                        Button(isSaving ? "提交中…" : (decision == "approve" ? "确认批准" : "确认拒绝")) {
                            Task { await review() }
                        }
                        .disabled(isSaving || reason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                }
            }
            .safeAreaInset(edge: .bottom) {
                if decision == nil {
                    HStack(spacing: 10) {
                        Button("拒绝建议", systemImage: "xmark.circle") { decision = "reject" }
                            .buttonStyle(.bordered)
                            .tint(AppTheme.textSecondary)
                        Spacer()
                        Button("批准建议", systemImage: "checkmark.circle") { decision = "approve" }
                            .buttonStyle(.borderedProminent)
                            .tint(AppTheme.primary)
                    }
                    .padding(.horizontal, AppLayout.pageInset)
                    .padding(.vertical, 8)
                    .background(.bar)
                }
            }
        }
        .interactiveDismissDisabled(isSaving)
    }

    private func review() async {
        guard let decision else { return }
        let normalizedReason = reason.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedReason.isEmpty else {
            errorMessage = "请填写审核决定的理由。"
            return
        }
        isSaving = true
        errorMessage = nil
        defer { isSaving = false }
        do {
            let result = try await AdminAPI.reviewContentRatingAISuggestion(
                suggestionID: suggestion.id,
                decision: decision,
                expectedRevision: suggestion.revision,
                reason: normalizedReason
            )
            if result.applied {
                AppFeedback.success("LLM 建议已批准并写入限制级分级")
            } else {
                AppFeedback.success(decision == "approve" ? "LLM 建议已记录，未直接改为一般" : "LLM 建议已拒绝")
            }
            onReviewed()
            dismiss()
        } catch {
            errorMessage = AppCopy.friendlyError(error)
        }
    }
}
