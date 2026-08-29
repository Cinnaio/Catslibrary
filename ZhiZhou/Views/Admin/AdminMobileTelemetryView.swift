import SwiftUI

/// 移动端远程问题追踪：查看匿名客户端事件并推进处理状态。
struct AdminMobileTelemetryView: View {
    @State private var response: AdminMobileTelemetryResponse?
    @State private var statusFilter = "open"
    @State private var search = ""
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var busyEventID: String?

    var body: some View {
        List {
            Section {
                AdminFilterBar {
                    AdminFilterMenu("状态", value: statusLabel) {
                        Picker("状态", selection: $statusFilter) {
                            ForEach(statusOptions, id: \.value) { option in
                                Text(option.label).tag(option.value)
                            }
                        }
                    }
                }
            }

            if let summary = response?.summary {
                Section("近 30 天") {
                    summaryRow("待查看", value: summary.open, tint: summary.open > 0 ? AppTheme.warning : AppTheme.success)
                    summaryRow("错误", value: summary.errors, tint: summary.errors > 0 ? AppTheme.danger : AppTheme.success)
                    summaryRow("诊断/性能", value: summary.diagnostics, tint: AppTheme.primary)
                    summaryRow("匿名安装", value: summary.installs, tint: AppTheme.primary)
                }
            }

            if isLoading && response == nil {
                Section {
                    ProgressView("加载客户端事件…")
                        .frame(maxWidth: .infinity, minHeight: 120)
                        .listRowBackground(Color.clear)
                }
            } else if let errorMessage, response?.events.isEmpty != false {
                Section {
                    ContentUnavailableView {
                        Label("客户端监控加载失败", systemImage: "wifi.slash")
                    } description: {
                        Text(errorMessage)
                    } actions: {
                        Button("重试") { Task { await load() } }
                    }
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
                }
            } else if let events = response?.events, events.isEmpty {
                Section {
                    ContentUnavailableView(
                        statusFilter == "open" ? "当前没有待查看问题" : "暂无客户端事件",
                        systemImage: "checkmark.circle",
                        description: Text("用户需要在“我的 → 隐私与诊断”打开授权后，才会产生匿名事件。")
                    )
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
                    .frame(maxWidth: .infinity, minHeight: 180)
                }
            } else if let events = response?.events {
                Section("事件（\(response?.total ?? events.count)）") {
                    ForEach(events) { event in
                        eventRow(event)
                    }
                }
            }
        }
        .scrollContentBackground(.hidden)
        .pageBackground()
        .navigationTitle("客户端监控")
        .navigationBarTitleDisplayMode(.large)
        .searchable(text: $search, prompt: "搜索事件名、系统或设备")
        .task(id: search) {
            try? await Task.sleep(for: .milliseconds(350))
            guard !Task.isCancelled else { return }
            await load()
        }
        .onChange(of: statusFilter) { _, _ in
            Task { await load() }
        }
        .refreshable { await load() }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                if isLoading {
                    AdminInlineProgress()
                } else {
                    Button("刷新", systemImage: "arrow.clockwise") { Task { await load() } }
                }
            }
        }
    }

    private var statusOptions: [(label: String, value: String)] {
        [("待查看", "open"), ("已确认", "acknowledged"), ("已解决", "resolved"), ("已忽略", "ignored"), ("全部", "all")]
    }

    private var statusLabel: String {
        statusOptions.first { $0.value == statusFilter }?.label ?? "筛选"
    }

    private func summaryRow(_ title: String, value: Int, tint: Color) -> some View {
        HStack {
            Text(title)
            Spacer()
            Text("\(value)")
                .font(.headline.monospacedDigit())
                .foregroundStyle(tint)
        }
    }

    private func eventRow(_ event: AdminMobileTelemetryEvent) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(event.name)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(AppTheme.textPrimary)
                    .lineLimit(1)
                Spacer(minLength: 0)
                statusMenu(for: event)
            }
            HStack(spacing: 6) {
                AdminStatusBadge(typeLabel(event.type), tint: event.type == "error" ? AppTheme.danger : AppTheme.primary)
                Text("\(event.appVersion.isEmpty ? "未知版本" : event.appVersion)\(event.buildVersion.isEmpty ? "" : " (\(event.buildVersion))")")
                    .font(.caption)
                    .foregroundStyle(AppTheme.textSecondary)
            }
            Text("\(event.osVersion.isEmpty ? "系统未知" : event.osVersion) · \(event.deviceModel.isEmpty ? "设备未知" : event.deviceModel) · \(AdminFormat.relativeTime(event.receivedAt))")
                .font(.caption)
                .foregroundStyle(AppTheme.textMuted)

            DisclosureGroup("查看诊断属性") {
                ScrollView(.horizontal, showsIndicators: false) {
                    Text(prettyProperties(event.properties))
                        .font(.caption2.monospaced())
                        .foregroundStyle(AppTheme.textSecondary)
                        .textSelection(.enabled)
                        .padding(.vertical, 6)
                }
            }
            .font(.caption)
            .tint(AppTheme.primary)
        }
        .padding(.vertical, 4)
        .opacity(busyEventID == event.id ? 0.55 : 1)
    }

    @ViewBuilder
    private func statusMenu(for event: AdminMobileTelemetryEvent) -> some View {
        Menu {
            ForEach(statusOptions.filter { $0.value != "all" }, id: \.value) { option in
                Button(option.label) {
                    Task { await update(event: event, status: option.value) }
                }
            }
        } label: {
            AdminStatusBadge(statusLabel(for: event.status), tint: statusTint(event.status))
        }
        .disabled(busyEventID != nil)
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            response = try await AdminAPI.mobileTelemetry(status: statusFilter, search: search)
            errorMessage = nil
        } catch {
            errorMessage = AppCopy.friendlyError(error)
        }
    }

    private func update(event: AdminMobileTelemetryEvent, status: String) async {
        guard status != event.status else { return }
        busyEventID = event.id
        defer { busyEventID = nil }
        do {
            try await AdminAPI.updateMobileTelemetry(id: event.id, status: status, adminNote: event.adminNote)
            AppFeedback.success("已更新问题状态")
            await load()
        } catch {
            AppFeedback.error(AppCopy.friendlyError(error))
        }
    }

    private func typeLabel(_ type: String) -> String {
        switch type {
        case "error": return "错误"
        case "metric": return "性能"
        case "diagnostic": return "诊断"
        default: return "事件"
        }
    }

    private func statusLabel(for status: String) -> String {
        statusOptions.first { $0.value == status }?.label ?? status
    }

    private func statusTint(_ status: String) -> Color {
        switch status {
        case "open": return AppTheme.warning
        case "resolved": return AppTheme.success
        case "ignored": return AppTheme.textMuted
        default: return AppTheme.primary
        }
    }

    private func prettyProperties(_ value: String) -> String {
        guard let data = value.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data),
              let pretty = try? JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .sortedKeys]),
              let text = String(data: pretty, encoding: .utf8)
        else { return value.isEmpty ? "{}" : value }
        return text
    }
}
