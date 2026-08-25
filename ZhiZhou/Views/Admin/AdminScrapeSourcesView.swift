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
    @State private var connectivityText: String?
    @State private var deleteTarget: ScrapeSourceRow?
    @State private var showDeleteUnreachable = false
    @State private var testResultText: String?
    @State private var actionError: String?

    var body: some View {
        List {
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
                } label: {
                    Label("更多", systemImage: "ellipsis.circle")
                }
            }
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

    // MARK: - 行

    private func sourceRow(_ source: ScrapeSourceRow) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                Text(source.name)
                    .font(.subheadline)
                    .fontWeight(.medium)
                    .foregroundStyle(AppTheme.textPrimary)
                    .lineLimit(1)
                Spacer()
                connectivityBadge(source)
                Toggle("", isOn: Binding(
                    get: { source.enabled ?? true },
                    set: { newValue in
                        Task { await toggle(source, enabled: newValue) }
                    }
                ))
                .labelsHidden()
                .disabled(togglingHost == source.host)
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
            Text("可达")
                .font(.caption2)
                .foregroundStyle(AppTheme.success)
        case "unreachable":
            Text("不可达")
                .font(.caption2)
                .foregroundStyle(AppTheme.danger)
        default:
            Text("未检测")
                .font(.caption2)
                .foregroundStyle(AppTheme.textMuted)
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
        do {
            let result = try await AdminAPI.deleteUnreachableSources()
            connectivityText = "已删除 \(result.deleted ?? 0) 个不可达书源。"
            await load()
        } catch {
            actionError = AppCopy.friendlyError(error)
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
