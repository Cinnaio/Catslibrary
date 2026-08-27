import SwiftUI

/// 源管理：书源列表（搜索 / 启停 / 删除 / 测试 / 连通性检查 / 清理不可达）。
/// 对齐 Web 端 admin scrape SourcesView。
struct AdminScrapeSourcesView: View {
    @State private var sources: [ScrapeSourceRow] = []
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var searchText = ""
    @State private var togglingHost: String?
    @State private var testingHost: String?
    @State private var checkingConnectivity = false
    @State private var deletingHost: String?
    @State private var cleaningUnreachable = false
    @State private var connectivityText: String?
    @State private var deleteTarget: ScrapeSourceRow?
    @State private var showDeleteUnreachable = false
    @State private var testResultText: String?
    @State private var actionError: String?

    // 批量操作
    @State private var selectionMode = false
    @State private var selectedHosts = Set<String>()
    @State private var batchBusy = false
    @State private var showBatchToggle = false
    @State private var showBatchDelete = false

    // Legado 导入
    @State private var showLegadoImport = false
    @State private var legadoUrl = ""
    @State private var legadoText = ""
    @State private var legadoImporting = false
    @State private var legadoResult: String?

    var body: some View {
        List {
            listContent
        }
        .scrollContentBackground(.hidden)
        .pageBackground()
        .navigationTitle("源管理")
        .navigationBarTitleDisplayMode(.large)
        .searchable(text: $searchText, prompt: "搜索主机 / 名称")
        .refreshable { await load() }
        .task(id: searchText) {
            try? await Task.sleep(nanoseconds: 350_000_000)
            guard !Task.isCancelled else { return }
            await load()
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button("检查全部连通性", systemImage: "antenna.radiowaves.left.and.right") {
                        Task { await checkAll() }
                    }
                    Button("删除不可达书源", systemImage: "trash", role: .destructive) {
                        showDeleteUnreachable = true
                    }
                    Divider()
                    Button(selectionMode ? "退出批量选择" : "批量选择", systemImage: "checkmark.circle") {
                        selectionMode.toggle()
                        selectedHosts = []
                    }
                    Button("导入 Legado 书源", systemImage: "square.and.arrow.down") {
                        showLegadoImport = true
                    }
                } label: {
                    if checkingConnectivity || cleaningUnreachable {
                        AdminInlineProgress()
                    } else {
                        Label("更多", systemImage: "ellipsis.circle")
                    }
                }
                .disabled(checkingConnectivity || cleaningUnreachable || batchBusy)
            }
        }
        .sheet(isPresented: $showLegadoImport) {
            LegadoImportSheet(
                url: $legadoUrl,
                text: $legadoText,
                importing: legadoImporting,
                result: legadoResult,
                onImport: { Task { await importLegado() } },
                onClose: {
                    showLegadoImport = false
                    legadoUrl = ""
                    legadoText = ""
                    legadoResult = nil
                }
            )
        }
        .confirmationDialog(
            "批量启停书源",
            isPresented: Binding(
                get: { showBatchToggle },
                set: { if !$0 { showBatchToggle = false } }
            ),
            titleVisibility: .visible
        ) {
            Button("启用所选（\(selectedHosts.count)）") { Task { await batchToggle(enabled: true) } }
            Button("禁用所选（\(selectedHosts.count)）") { Task { await batchToggle(enabled: false) } }
            Button("取消", role: .cancel) { showBatchToggle = false }
        } message: {
            Text("将对选中的 \(selectedHosts.count) 个书源批量修改启停状态。")
        }
        .confirmationDialog(
            "批量删除书源",
            isPresented: Binding(
                get: { showBatchDelete },
                set: { if !$0 { showBatchDelete = false } }
            ),
            titleVisibility: .visible
        ) {
            Button("删除所选（\(selectedHosts.count)）", role: .destructive) {
                Task { await batchDelete() }
            }
            Button("取消", role: .cancel) { showBatchDelete = false }
        } message: {
            Text("将删除选中的 \(selectedHosts.count) 个书源，不可恢复。")
        }
        .confirmationDialog(
            "删除书源",
            isPresented: Binding(
                get: { deleteTarget != nil },
                set: { if !$0 { deleteTarget = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button("删除「\(deleteTarget?.host ?? "")」", role: .destructive) {
                guard let target = deleteTarget else { return }
                Task { await delete(target) }
            }
            Button("取消", role: .cancel) {}
        } message: {
            Text("删除后该书源将不再参与识别。")
        }
        .confirmationDialog(
            "删除不可达书源",
            isPresented: $showDeleteUnreachable,
            titleVisibility: .visible
        ) {
            Button("删除全部不可达", role: .destructive) {
                Task { await deleteUnreachable() }
            }
            Button("取消", role: .cancel) {}
        } message: {
            Text("将删除所有连通性检测为不可达的书源。")
        }
        .alert("测试结果", isPresented: testResultAlertBinding) {
            Button("好", role: .cancel) {}
        } message: {
            Text(testResultText ?? "")
        }
        .alert("操作失败", isPresented: errorAlertBinding) {
            Button("好", role: .cancel) {}
        } message: {
            Text(actionError ?? "")
        }
    }

    // MARK: - 列表内容（拆分以降低 Release 类型检查开销）

    @ViewBuilder
    private var listContent: some View {
        if isLoading && sources.isEmpty {
            Section {
                ProgressView("加载中…")
                    .frame(maxWidth: .infinity, minHeight: 160)
                    .listRowBackground(Color.clear)
            }
        } else if let errorMessage, sources.isEmpty {
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
        } else {
            if sources.isEmpty {
                Section {
                    ContentUnavailableView {
                        Label("暂无书源", systemImage: "antenna.radiowaves.left.and.right")
                    } description: {
                        Text("当前条件下没有匹配的书源。")
                    }
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
                }
            } else {
                if selectionMode && !sources.isEmpty {
                    batchBarSection
                }
                Section("书源（\(sources.count)）") {
                    ForEach(sources) { source in
                        sourceRow(source)
                    }
                }
            }
            if let connectivityText {
                Section {
                    Label(connectivityText, systemImage: "antenna.radiowaves.left.and.right")
                        .font(.subheadline)
                        .foregroundStyle(AppTheme.textSecondary)
                }
            }
        }
    }

    private var batchBarSection: some View {
        Section {
            HStack {
                Text("已选 \(selectedHosts.count) 个")
                    .font(.subheadline)
                    .foregroundStyle(AppTheme.textSecondary)
                Spacer()
                if batchBusy {
                    AdminInlineProgress()
                } else {
                    Button(selectedHosts.count == sources.count ? "全不选" : "全选") {
                        selectedHosts = selectedHosts.count == sources.count ? [] : Set(sources.map { $0.host })
                    }
                    .font(.subheadline)
                    Button("启停") { showBatchToggle = true }
                        .font(.subheadline)
                        .disabled(selectedHosts.isEmpty)
                    Button("删除", role: .destructive) { showBatchDelete = true }
                        .font(.subheadline)
                        .disabled(selectedHosts.isEmpty)
                }
            }
            .listRowBackground(Color.clear)
        }
    }

    // MARK: - 行

    private func sourceRow(_ source: ScrapeSourceRow) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                if selectionMode {
                    Button {
                        toggleSelected(source.host)
                    } label: {
                        Image(systemName: selectedHosts.contains(source.host) ? "checkmark.circle.fill" : "circle")
                            .font(.title3)
                            .foregroundStyle(selectedHosts.contains(source.host) ? AppTheme.primary : AppTheme.textMuted)
                            .frame(width: 44, height: 44)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(selectedHosts.contains(source.host) ? "取消选择\(source.name)" : "选择\(source.name)")
                    .accessibilityValue(selectedHosts.contains(source.host) ? "已选择" : "未选择")
                }
                Text(source.name)
                    .font(.subheadline)
                    .fontWeight(.medium)
                    .foregroundStyle(AppTheme.textPrimary)
                    .lineLimit(2)
            }
            HStack(spacing: 10) {
                if testingHost == source.host {
                    AdminInlineProgress()
                } else {
                    connectivityBadge(source)
                }
                Spacer(minLength: 8)
                if !selectionMode {
                    if deletingHost == source.host {
                        AdminInlineProgress()
                    } else {
                        if togglingHost == source.host {
                            AdminInlineProgress()
                        } else {
                            Toggle("", isOn: Binding(
                                get: { source.enabled ?? true },
                                set: { newValue in
                                    Task { await toggle(source, enabled: newValue) }
                                }
                            ))
                            .labelsHidden()
                            .accessibilityLabel("启用\(source.name)")
                            .accessibilityValue((source.enabled ?? true) ? "已启用" : "已停用")
                        }
                        Menu {
                            Button("测试书源", systemImage: "checkmark.seal") {
                                Task { await testSource(source) }
                            }
                            Button("删除", systemImage: "trash", role: .destructive) {
                                deleteTarget = source
                            }
                        } label: {
                            Image(systemName: "ellipsis.circle")
                                .font(.title3)
                                .frame(width: 36, height: 36)
                        }
                        .disabled(deletingHost != nil || testingHost != nil || togglingHost != nil || batchBusy)
                        .accessibilityLabel("书源操作")
                    }
                }
            }
            Text(source.host)
                .font(.caption)
                .foregroundStyle(AppTheme.textSecondary)
                .lineLimit(1)
            HStack(spacing: 8) {
                if let support = source.support, !support.isEmpty {
                    Text(support)
                        .font(.caption2)
                        .foregroundStyle(AppTheme.textMuted)
                }
                if let encoding = source.encoding, !encoding.isEmpty {
                    Text("编码 \(encoding)")
                        .font(.caption2)
                        .foregroundStyle(AppTheme.textMuted)
                }
                if let list = source.chapterList, !list.isEmpty {
                    Text("列表 ✓")
                        .font(.caption2)
                        .foregroundStyle(AppTheme.success)
                }
                if let content = source.chapterContent, !content.isEmpty {
                    Text("正文 ✓")
                        .font(.caption2)
                        .foregroundStyle(AppTheme.success)
                }
            }
            if let error = source.connectivityError, !error.isEmpty {
                Text(error)
                    .font(.caption2)
                    .foregroundStyle(AppTheme.danger)
                    .lineLimit(1)
            }
        }
        .padding(.vertical, 2)
        .contextMenu {
            Button("测试书源", systemImage: "checkmark.seal") {
                Task { await testSource(source) }
            }
            Button("删除", systemImage: "trash", role: .destructive) {
                deleteTarget = source
            }
        }
    }

    @ViewBuilder
    private func connectivityBadge(_ source: ScrapeSourceRow) -> some View {
        switch source.connectivity {
        case "reachable":
            AdminStatusBadge("可达", tint: AppTheme.success, systemImage: "checkmark")
        case "unreachable":
            AdminStatusBadge("不可达", tint: AppTheme.danger, systemImage: "xmark")
        default:
            AdminStatusBadge("未检测", tint: AppTheme.textMuted, systemImage: "questionmark")
        }
    }

    // MARK: - 数据

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            let trimmed = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
            let r = try await AdminAPI.scrapeSources(page: 1, pageSize: 100)
            let all = r.sources
            sources = trimmed.isEmpty ? all : all.filter {
                $0.host.localizedCaseInsensitiveContains(trimmed) || $0.name.localizedCaseInsensitiveContains(trimmed)
            }
            errorMessage = nil
        } catch {
            errorMessage = AppCopy.friendlyError(error)
        }
    }

    private func toggle(_ source: ScrapeSourceRow, enabled: Bool) async {
        guard togglingHost == nil else { return }
        togglingHost = source.host
        defer { togglingHost = nil }
        do {
            try await AdminAPI.toggleScrapeSource(host: source.host, enabled: enabled)
            await load()
        } catch {
            actionError = AppCopy.friendlyError(error)
            await load()
        }
    }

    private func delete(_ source: ScrapeSourceRow) async {
        guard deletingHost == nil else { return }
        deletingHost = source.host
        defer { deletingHost = nil }
        do {
            try await AdminAPI.deleteScrapeSource(host: source.host)
            sources.removeAll { $0.host == source.host }
        } catch {
            actionError = AppCopy.friendlyError(error)
        }
    }

    private func testSource(_ source: ScrapeSourceRow) async {
        guard testingHost == nil else { return }
        testingHost = source.host
        defer { testingHost = nil }
        do {
            let result = try await AdminAPI.testScrapeSource(host: source.host)
            if let links = result.links, !links.isEmpty {
                let samples = result.sampleChapters ?? []
                let sampleOk = samples.filter { $0.ok == true }.count
                testResultText = "\(source.name)：识别到 \(links.count) 个章节链接，样章 \(sampleOk)/\(samples.count) 可读。"
            } else {
                testResultText = result.error ?? "\(source.name)：未识别到章节链接。"
            }
        } catch {
            testResultText = AppCopy.friendlyError(error)
        }
    }

    private func checkAll() async {
        guard !checkingConnectivity else { return }
        checkingConnectivity = true
        connectivityText = "正在检查全部书源…"
        defer { checkingConnectivity = false }
        do {
            let result = try await AdminAPI.checkSourceConnectivity(hosts: [])
            connectivityText = "检查完成：共 \(result.checked ?? 0) 个，可达 \(result.reachable ?? 0)，不可达 \(result.unreachable ?? 0)。"
            await load()
        } catch {
            actionError = AppCopy.friendlyError(error)
        }
    }

    private func deleteUnreachable() async {
        guard !cleaningUnreachable else { return }
        cleaningUnreachable = true
        defer { cleaningUnreachable = false }
        do {
            let result = try await AdminAPI.deleteUnreachableSources()
            connectivityText = "已删除 \(result.deleted ?? 0) 个不可达书源。"
            await load()
        } catch {
            actionError = AppCopy.friendlyError(error)
        }
    }

    // MARK: - 批量操作

    private func toggleSelected(_ host: String) {
        if selectedHosts.contains(host) {
            selectedHosts.remove(host)
        } else {
            selectedHosts.insert(host)
        }
    }

    private func batchToggle(enabled: Bool) async {
        guard !selectedHosts.isEmpty, !batchBusy else { return }
        batchBusy = true
        defer { batchBusy = false }
        do {
            let hosts = Array(selectedHosts)
            let result = try await AdminAPI.batchToggleSources(hosts: hosts, enabled: enabled)
            connectivityText = "已\(enabled ? "启用" : "禁用") \(result.updated ?? 0) 个书源。"
            selectedHosts = []
            showBatchToggle = false
            await load()
        } catch {
            actionError = AppCopy.friendlyError(error)
        }
    }

    private func batchDelete() async {
        guard !selectedHosts.isEmpty, !batchBusy else { return }
        batchBusy = true
        defer { batchBusy = false }
        do {
            let hosts = Array(selectedHosts)
            let result = try await AdminAPI.batchDeleteSources(hosts: hosts)
            connectivityText = "已删除 \(result.deleted ?? 0) 个书源。"
            selectedHosts = []
            showBatchDelete = false
            await load()
        } catch {
            actionError = AppCopy.friendlyError(error)
        }
    }

    // MARK: - Legado 导入

    private func importLegado() async {
        guard !legadoImporting else { return }
        legadoImporting = true
        defer { legadoImporting = false }
        do {
            let url = legadoUrl.trimmingCharacters(in: .whitespacesAndNewlines)
            let text = legadoText.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !url.isEmpty || !text.isEmpty else {
                legadoResult = "请填写书源池 URL 或粘贴书源 JSON。"
                return
            }
            let payload: [String: Any] = url.isEmpty ? ["text": text] : ["url": url]
            let result = try await AdminAPI.scrapeImportLegado(payload: payload)
            legadoResult = "导入完成：新增 \(result.imported ?? 0)，更新 \(result.updated ?? 0)。\(result.parseErrorCount.map { "解析失败 \($0) 条。" } ?? "")"
            await load()
        } catch {
            legadoResult = AppCopy.friendlyError(error)
        }
    }

    private var testResultAlertBinding: Binding<Bool> {
        Binding(
            get: { testResultText != nil },
            set: { if !$0 { testResultText = nil } }
        )
    }

    private var errorAlertBinding: Binding<Bool> {
        Binding(
            get: { actionError != nil },
            set: { if !$0 { actionError = nil } }
        )
    }
}

// MARK: - Legado 导入 Sheet

private struct LegadoImportSheet: View {
    @Binding var url: String
    @Binding var text: String
    let importing: Bool
    let result: String?
    let onImport: () -> Void
    let onClose: () -> Void

    var body: some View {
        NavigationStack {
            List {
                Section {
                    TextField("https://example.com/legado.json", text: $url)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                } header: {
                    Text("书源池 URL")
                } footer: {
                    Text("填写公开的书源池 JSON 地址，从远端拉取。")
                }
                Section("或粘贴书源 JSON") {
                    TextEditor(text: $text)
                        .frame(minHeight: 140)
                        .font(.caption2)
                        .scrollContentBackground(.hidden)
                        .overlay(
                            RoundedRectangle(cornerRadius: 10, style: .continuous)
                                .strokeBorder(AppTheme.border, lineWidth: 1)
                        )
                        .padding(.vertical, 4)
                }
                if let result {
                    Section {
                        Label(result, systemImage: importing ? "hourglass" : "checkmark.circle.fill")
                            .font(.subheadline)
                            .foregroundStyle(importing ? AppTheme.textSecondary : AppTheme.success)
                    }
                }
                Section {
                    Button {
                        onImport()
                    } label: {
                        if importing {
                            HStack {
                                Spacer()
                                ProgressView()
                                Spacer()
                            }
                        } else {
                            Label("开始导入", systemImage: "square.and.arrow.down")
                        }
                    }
                    .disabled(importing || (url.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty))
                }
            }
            .scrollContentBackground(.hidden)
            .pageBackground()
            .navigationTitle("导入 Legado 书源")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("关闭", action: onClose)
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}
