import SwiftUI
import UIKit

/// 爬虫配置导入导出：查看已保存配置 / 导出 JSON / 粘贴导入 / 快速复制。
/// 对齐 Web 端 admin scrape CenterView 的配置导入导出（action=list-configs / import-configs）。
struct AdminScrapeConfigsView: View {
    @State private var configs: [ScrapeConfigRow] = []
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var exportText = ""
    @State private var exportCount = 0
    @State private var exportMessage: String?
    @State private var importText = ""
    @State private var importing = false
    @State private var importMessage: String?
    @State private var actionError: String?
    @State private var pendingImportItems: [ScrapeConfigImportItem] = []
    @State private var pendingDangerousOperation: AdminDangerousOperation?

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
                exportSection
                importSection
                if !configs.isEmpty {
                    Section("已保存配置（\(configs.count)）") {
                        ForEach(configs) { config in
                            configRow(config)
                        }
                    }
                } else {
                    Section {
                        ContentUnavailableView {
                            Label("暂无配置", systemImage: "doc.on.clipboard")
                        } description: {
                            Text("还没有保存过抓取配置，抓取任务会自动保存配置供迁移。")
                        }
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                    }
                }
            }
        }
        .scrollContentBackground(.hidden)
        .pageBackground()
        .navigationTitle("配置导入导出")
        .navigationBarTitleDisplayMode(.large)
        .refreshable { await load() }
        .task { await load() }
        .alert("操作失败", isPresented: errorAlertBinding) {
            Button("好", role: .cancel) {}
        } message: {
            Text(actionError ?? "")
        }
        .adminDangerousOperationConfirmation(
            $pendingDangerousOperation,
            onConfirm: { operation in
                guard operation.action == .importScrapeConfigs else { return }
                let items = pendingImportItems
                pendingImportItems = []
                Task { await importConfigs(items, operationID: operation.operationID) }
            },
            onCancel: { operation in
                if operation.action == .importScrapeConfigs {
                    pendingImportItems = []
                }
            }
        )
    }

    // MARK: - 导出

    private var exportSection: some View {
        Section {
            Button {
                Task { await export() }
            } label: {
                Label("导出全部配置", systemImage: "square.and.arrow.up")
            }
            .disabled(isLoading)

            if let exportMessage {
                Label(exportMessage, systemImage: "checkmark.circle.fill")
                    .font(.subheadline)
                    .foregroundStyle(AppTheme.success)
            }
            if !exportText.isEmpty {
                Text(exportText)
                    .font(.caption2)
                    .foregroundStyle(AppTheme.textSecondary)
                    .lineLimit(6)
                    .textSelection(.enabled)
                Button {
                    UIPasteboard.general.string = exportText
                    exportMessage = "已复制到剪贴板（\(exportCount) 条配置）"
                } label: {
                    Label("复制 JSON 到剪贴板", systemImage: "doc.on.doc")
                }
                .font(.subheadline)
            }
        } header: {
            Text("导出")
        } footer: {
            Text("导出的 JSON 可在其他知舟实例「配置导入导出」中粘贴导入，用于迁移抓取配置。")
        }
    }

    // MARK: - 导入

    private var importSection: some View {
        Section {
            TextEditor(text: $importText)
                .frame(minHeight: 120)
                .font(.callout)
                .scrollContentBackground(.hidden)
                .overlay(
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .strokeBorder(AppTheme.border, lineWidth: 1)
                )
                .padding(.vertical, 4)
            Button {
                requestImportConfigs()
            } label: {
                if importing {
                    HStack {
                        Spacer()
                        ProgressView()
                        Spacer()
                    }
                } else {
                    Label("导入配置", systemImage: "square.and.arrow.down")
                }
            }
            .disabled(importing || importText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

            if let importMessage {
                Label(importMessage, systemImage: "checkmark.circle.fill")
                    .font(.subheadline)
                    .foregroundStyle(AppTheme.success)
            }
        } header: {
            Text("导入")
        } footer: {
            Text("粘贴从其他实例导出的配置 JSON 数组（[{ novelId, sourceUrl, selectors?, encoding? }]）。")
        }
    }

    private func configRow(_ config: ScrapeConfigRow) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(config.novelTitle.isEmpty ? config.novelId : config.novelTitle)
                .font(.subheadline)
                .fontWeight(.medium)
                .foregroundStyle(AppTheme.textPrimary)
                .lineLimit(1)
            Text(config.sourceUrl)
                .font(.caption)
                .foregroundStyle(AppTheme.textSecondary)
                .lineLimit(1)
            HStack(spacing: 8) {
                if !config.encoding.isEmpty {
                    Text(config.encoding)
                        .font(.caption2)
                        .foregroundStyle(AppTheme.textMuted)
                }
                Text("更新于 \(AdminFormat.relativeTime(config.updatedAt))")
                    .font(.caption2)
                    .foregroundStyle(AppTheme.textMuted)
            }
        }
        .padding(.vertical, 2)
    }

    // MARK: - 数据

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            configs = try await AdminAPI.scrapeListConfigs().configs
            errorMessage = nil
        } catch {
            errorMessage = AppCopy.friendlyError(error)
        }
    }

    private func export() async {
        exportMessage = nil
        do {
            let items = try await AdminAPI.scrapeListConfigs().configs
            guard !items.isEmpty else {
                exportMessage = "没有可导出的配置"
                return
            }
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
            let data = try encoder.encode(items)
            exportText = String(data: data, encoding: .utf8) ?? ""
            exportCount = items.count
            exportMessage = "已导出 \(items.count) 条配置"
        } catch {
            actionError = AppCopy.friendlyError(error)
        }
    }

    private func requestImportConfigs() {
        importMessage = nil
        do {
            let trimmed = importText.trimmingCharacters(in: .whitespacesAndNewlines)
            guard let data = trimmed.data(using: .utf8) else {
                actionError = "无法读取输入内容"
                return
            }
            let items = try JSONDecoder().decode([ScrapeConfigImportItem].self, from: data)
            guard !items.isEmpty else {
                actionError = "配置数组为空"
                return
            }
            let existingIDs = Set(configs.map(\.novelId))
            let overwriteCount = items.filter { existingIDs.contains($0.novelId) }.count
            pendingImportItems = items
            pendingDangerousOperation = AdminDangerousOperation(
                action: .importScrapeConfigs,
                kind: .overwrite,
                targetIDs: items.map(\.novelId).sorted(),
                title: "导入并覆盖抓取配置",
                message: "将导入 \(items.count) 条配置，其中 \(overwriteCount) 条会覆盖已有小说的抓取配置。",
                confirmLabel: "确认导入配置"
            )
        } catch {
            actionError = AppCopy.friendlyError(error)
        }
    }

    private func importConfigs(
        _ items: [ScrapeConfigImportItem],
        operationID: String
    ) async {
        guard !items.isEmpty, !importing else { return }
        importing = true
        defer { importing = false }
        importMessage = nil
        do {
            let result = try await AdminAPI.scrapeImportConfigs(
                items,
                operationID: operationID
            )
            importMessage = "成功导入 \(result.imported ?? 0) 条配置"
            importText = ""
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
