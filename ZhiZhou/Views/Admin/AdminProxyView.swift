import SwiftUI

/// 代理设置：运行时代理配置（proxyBase / proxyBypass）+ 代理连通性测试 + 最近代理日志。
/// 对齐 Web 端 admin scrape ProxyView。
struct AdminProxyView: View {
    @State private var proxyBase = ""
    @State private var proxyBypass = ""
    @State private var effectiveHost = ""
    @State private var noProxy = ""
    @State private var configured = false
    @State private var source = ""
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var saving = false
    @State private var saveMessage: String?
    @State private var testUrl = ""
    @State private var testing = false
    @State private var testResult: ScrapeProxyTestResponse?
    @State private var logs: [ScrapeProxyLogItem] = []
    @State private var logsLoaded = false
    @State private var actionError: String?

    var body: some View {
        List {
            if isLoading {
                Section {
                    ProgressView("加载中…")
                        .frame(maxWidth: .infinity, minHeight: 160)
                        .listRowBackground(Color.clear)
                }
            } else if let errorMessage {
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
                configSection
                testSection
                if logsLoaded && !logs.isEmpty {
                    Section("最近代理日志（\(logs.count)）") {
                        ForEach(logs) { log in
                            logRow(log)
                        }
                    }
                }
            }
        }
        .scrollContentBackground(.hidden)
        .pageBackground()
        .navigationTitle("代理设置")
        .navigationBarTitleDisplayMode(.large)
        .refreshable { await load() }
        .task { await load() }
        .alert("操作失败", isPresented: errorAlertBinding) {
            Button("好", role: .cancel) {}
        } message: {
            Text(actionError ?? "")
        }
    }

    // MARK: - 配置

    private var configSection: some View {
        Section("代理配置") {
            TextField("代理地址（如 http://host:port）", text: $proxyBase)
                .keyboardType(.URL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            TextField("绕过列表（逗号分隔）", text: $proxyBypass)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            Button {
                Task { await save() }
            } label: {
                if saving {
                    HStack {
                        Spacer()
                        ProgressView()
                        Spacer()
                    }
                } else {
                    Label("保存配置", systemImage: "checkmark.circle")
                }
            }
            .disabled(saving)

            if let saveMessage {
                Label(saveMessage, systemImage: "checkmark.circle.fill")
                    .font(.subheadline)
                    .foregroundStyle(AppTheme.success)
            }
            LabeledContent("已配置") {
                Text(configured ? "是" : "否")
                    .foregroundStyle(configured ? AppTheme.success : AppTheme.textMuted)
            }
            LabeledContent("配置来源") {
                Text(sourceLabel(source))
                    .foregroundStyle(AppTheme.textSecondary)
            }
            if !effectiveHost.isEmpty {
                LabeledContent("生效地址") {
                    Text(effectiveHost)
                        .font(.caption)
                        .foregroundStyle(AppTheme.textSecondary)
                }
            }
            if !noProxy.isEmpty {
                LabeledContent("NO_PROXY") {
                    Text(noProxy)
                        .font(.caption)
                        .foregroundStyle(AppTheme.textSecondary)
                        .lineLimit(2)
                }
            }
        }
    }

    // MARK: - 测试

    private var testSection: some View {
        Section("代理测试") {
            TextField("测试网址（如 https://example.com）", text: $testUrl)
                .keyboardType(.URL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            Button {
                Task { await test() }
            } label: {
                if testing {
                    HStack {
                        Spacer()
                        ProgressView()
                        Spacer()
                    }
                } else {
                    Label("测试代理连通性", systemImage: "antenna.radiowaves.left.and.right")
                }
            }
            .disabled(testing || testUrl.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

            if let testResult {
                if testResult.ok == true {
                    Label("连接成功", systemImage: "checkmark.circle.fill")
                        .foregroundStyle(AppTheme.success)
                    LabeledContent("目标") {
                        Text(testResult.targetHost ?? "—")
                            .foregroundStyle(AppTheme.textSecondary)
                    }
                    LabeledContent("代理") {
                        Text(testResult.proxyHost ?? "—")
                            .foregroundStyle(AppTheme.textSecondary)
                    }
                    if let encoding = testResult.encoding, !encoding.isEmpty {
                        LabeledContent("编码") {
                            Text(encoding)
                                .foregroundStyle(AppTheme.textSecondary)
                        }
                    }
                    LabeledContent("耗时") {
                        Text("\(testResult.elapsedMs ?? 0) ms")
                            .foregroundStyle(AppTheme.textSecondary)
                    }
                } else {
                    Label("连接失败", systemImage: "xmark.octagon")
                        .foregroundStyle(AppTheme.danger)
                    if let error = testResult.error, !error.isEmpty {
                        Text(error)
                            .font(.caption)
                            .foregroundStyle(AppTheme.danger)
                    }
                }
            }
        }
    }

    private func logRow(_ log: ScrapeProxyLogItem) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 6) {
                Text(log.method ?? "GET")
                    .font(.caption2)
                    .foregroundStyle(AppTheme.textMuted)
                Text(log.targetHost ?? log.target ?? "—")
                    .font(.subheadline)
                    .foregroundStyle(AppTheme.textPrimary)
                    .lineLimit(1)
                Spacer()
                Text(log.ok == true ? "成功" : "失败")
                    .font(.caption2)
                    .foregroundStyle(log.ok == true ? AppTheme.success : AppTheme.danger)
            }
            HStack(spacing: 8) {
                if let status = log.status {
                    Text("HTTP \(status)")
                        .font(.caption2)
                        .foregroundStyle(AppTheme.textMuted)
                }
                if let duration = log.durationMs {
                    Text("\(duration) ms")
                        .font(.caption2)
                        .foregroundStyle(AppTheme.textMuted)
                }
                if let proxy = log.proxyHost, !proxy.isEmpty {
                    Text("via \(proxy)")
                        .font(.caption2)
                        .foregroundStyle(AppTheme.textMuted)
                }
                Text(AdminFormat.relativeTime(log.timestamp))
                    .font(.caption2)
                    .foregroundStyle(AppTheme.textMuted)
            }
            if let error = log.error, !error.isEmpty {
                Text(error)
                    .font(.caption2)
                    .foregroundStyle(AppTheme.danger)
                    .lineLimit(2)
            }
        }
        .padding(.vertical, 2)
    }

    // MARK: - 数据

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            let cfg = try await AdminAPI.scrapeProxyConfig()
            proxyBase = cfg.config?.proxyBase ?? ""
            proxyBypass = cfg.config?.proxyBypass ?? ""
            effectiveHost = cfg.effectiveHost ?? ""
            noProxy = cfg.noProxy ?? ""
            configured = cfg.configured ?? false
            source = cfg.source ?? ""
            errorMessage = nil
            if let logs = try? await AdminAPI.scrapeProxyLogs(limit: 50) {
                self.logs = logs
                logsLoaded = true
            }
        } catch {
            errorMessage = AppCopy.friendlyError(error)
        }
    }

    private func save() async {
        saving = true
        defer { saving = false }
        do {
            let cfg = try await AdminAPI.saveProxyConfig(
                proxyBase: proxyBase.trimmingCharacters(in: .whitespacesAndNewlines),
                proxyBypass: proxyBypass.trimmingCharacters(in: .whitespacesAndNewlines)
            )
            effectiveHost = cfg.effectiveHost ?? ""
            noProxy = cfg.noProxy ?? ""
            configured = cfg.configured ?? false
            source = cfg.source ?? ""
            saveMessage = "配置已保存"
        } catch {
            actionError = AppCopy.friendlyError(error)
        }
    }

    private func test() async {
        let url = testUrl.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !url.isEmpty else { return }
        testing = true
        defer { testing = false }
        do {
            testResult = try await AdminAPI.testProxy(sourceUrl: url)
        } catch {
            actionError = AppCopy.friendlyError(error)
        }
    }

    private func sourceLabel(_ source: String) -> String {
        switch source {
        case "environment": return "环境变量"
        case "runtime": return "运行时配置"
        default: return "未配置"
        }
    }

    private var errorAlertBinding: Binding<Bool> {
        Binding(
            get: { actionError != nil },
            set: { if !$0 { actionError = nil } }
        )
    }
}
