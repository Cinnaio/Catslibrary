import SwiftUI
import ZhiZhouCore

/// 应用存储管理：查看数据占用，下载/删除远程字体，清理图片和章节缓存。
struct StorageManagerView: View {
    @Environment(FontStore.self) private var fontStore
    @Environment(OfflineReadingStore.self) private var offlineStore

    @State private var showDeleteFontsConfirm = false
    @State private var showClearCachesConfirm = false
    @State private var isClearingCaches = false
    @State private var cacheSettings = CacheSettingsStore.shared
    @State private var showCacheLimit = false
    @State private var storageError: String?
    @State private var chapterCacheBytes: Int64 = 0
    @State private var offlineBytes: Int64 = 0

    var body: some View {
        List {
            Section("占用概览") {
                storageRow("应用本体", bytes: fontStore.storage.appBundleBytes)
                storageRow("应用数据", bytes: fontStore.storage.totalDataBytes)
                storageRow("字体缓存", bytes: fontStore.storage.fontBytes)
                storageRow("图片缓存", bytes: fontStore.storage.imageCacheBytes)
                storageRow("章节缓存", bytes: chapterCacheBytes)
                storageRow("离线章节文件", bytes: offlineBytes)
            }

            Section("宋体字体") {
                ForEach(RemoteFontAsset.allCases) { asset in
                    LabeledContent(asset.title) {
                        Text(fontSize(for: asset))
                            .foregroundStyle(AppTheme.textSecondary)
                    }
                }

                if fontStore.isDownloading {
                    HStack(spacing: 10) {
                        ProgressView()
                        Text("正在下载并注册字体…")
                            .foregroundStyle(AppTheme.textSecondary)
                    }
                } else {
                    Button {
                        Task {
                            await fontStore.downloadAndRegisterFonts()
                            if fontStore.lastError == nil {
                                AppFeedback.success("宋体已启用")
                            } else {
                                AppFeedback.error()
                            }
                        }
                    } label: {
                        Label(
                            fontStore.hasDownloadedFonts ? "重新检查字体" : "下载并启用宋体",
                            systemImage: "arrow.down.circle"
                        )
                    }
                }

                Button("删除字体缓存", role: .destructive) {
                    showDeleteFontsConfirm = true
                }
                .disabled(fontStore.storage.fontBytes == 0 || fontStore.isDownloading)

                if let lastError = fontStore.lastError {
                    Text(lastError)
                        .font(.footnote)
                        .foregroundStyle(AppTheme.danger)
                }
            }

            Section {
                Button {
                    showCacheLimit = true
                } label: {
                    LabeledContent("自动缓存上限", value: "\(cacheSettings.policy.megabytes) MB")
                }
                .accessibilityIdentifier("storage.cacheLimit")
                .disabled(cacheSettings.isApplying || isClearingCaches)
                storageRow("自动缓存已用", bytes: fontStore.storage.imageCacheBytes + chapterCacheBytes)

                Button("清理图片和章节缓存", role: .destructive) {
                    showClearCachesConfirm = true
                }
                .disabled(isClearingCaches || cacheSettings.isApplying)
                .accessibilityIdentifier("storage.clearCache")

                if isClearingCaches {
                    HStack(spacing: 10) {
                        ProgressView()
                        Text("正在清理缓存…")
                            .foregroundStyle(AppTheme.textSecondary)
                    }
                }
            } header: {
                Text("自动缓存")
            } footer: {
                Text("上限控制图片和章节的磁盘自动缓存，按设备保存。调低后会清理较旧的自动缓存；字体与主动下载的离线章节单独保存，不计入此上限。")
            }

            Section("离线阅读") {
                if !offlineStore.books.isEmpty {
                    NavigationLink {
                        OfflineReadingView()
                    } label: {
                        LabeledContent("已下载章节", value: "\(offlineStore.totalChapterCount) 章")
                    }
                    .accessibilityHint("管理已下载的离线章节")
                } else {
                    LabeledContent("已下载章节", value: "0 章")
                }
            }

            Section {
                Text("字体会保存到应用的持久化数据目录；删除后可以再次从服务器下载。无网络时，阅读器会回退到系统字体。")
                    .font(.footnote)
                    .foregroundStyle(AppTheme.textSecondary)
                    .lineSpacing(3)
            }
        }
        .appListStyle(.settings)
        .navigationTitle("存储管理")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            fontStore.registerCachedFonts()
            fontStore.refresh()
            await refreshUsage()
        }
        .refreshable { await refreshUsage() }
        .sheet(isPresented: $showCacheLimit) {
            CacheLimitEditor(current: cacheSettings.policy.megabytes) { megabytes in
                try await cacheSettings.setMegabytes(megabytes)
                await refreshUsage()
            }
        }
        .alert("存储操作失败", isPresented: Binding(
            get: { storageError != nil }, set: { if !$0 { storageError = nil } }
        )) {
            Button("好", role: .cancel) {}
        } message: { Text(storageError ?? "") }
        .confirmationDialog(
            "删除已下载的字体？",
            isPresented: $showDeleteFontsConfirm,
            titleVisibility: .visible
        ) {
            Button("删除字体", role: .destructive) {
                fontStore.deleteDownloadedFonts()
                AppFeedback.success("字体缓存已删除")
            }
        }
        .confirmationDialog(
            "清理图片和章节缓存？",
            isPresented: $showClearCachesConfirm,
            titleVisibility: .visible
        ) {
            Button("清理缓存", role: .destructive) {
                Task { @MainActor in
                    isClearingCaches = true
                    defer { isClearingCaches = false }
                    do {
                        try await fontStore.clearCaches()
                        await refreshUsage()
                        AppFeedback.success("缓存已清理，离线下载已保留")
                    } catch {
                        storageError = "无法保留离线章节，请检查可用存储空间后重试。"
                        AppFeedback.error()
                    }
                }
            }
        } message: {
            Text("保留已下载的离线章节和字体。需要时，自动缓存的内容会重新下载。")
        }
    }

    private func refreshUsage() async {
        await offlineStore.refresh()
        let usage = await ChapterDiskCache.shared.usage()
        chapterCacheBytes = usage.automaticBytes
        offlineBytes = usage.offlineBytes
        fontStore.refresh()
    }

    private func storageRow(_ title: String, bytes: Int64) -> some View {
        LabeledContent(title) {
            Text(ByteCountFormatter.string(fromByteCount: bytes, countStyle: .file))
                .contentTransition(.numericText())
                .foregroundStyle(AppTheme.textSecondary)
        }
    }

    private func fontSize(for asset: RemoteFontAsset) -> String {
        let bytes = fontStore.downloadedBytes(for: asset)
        return bytes > 0
            ? ByteCountFormatter.string(fromByteCount: bytes, countStyle: .file)
            : "未下载"
    }
}

private struct CacheLimitEditor: View {
    @Environment(\.dismiss) private var dismiss
    @State private var value: String
    @State private var isSaving = false
    @State private var error: String?
    let save: (Int) async throws -> Void

    init(current: Int, save: @escaping (Int) async throws -> Void) {
        _value = State(initialValue: String(current))
        self.save = save
    }

    private var validValue: Int? {
        guard let number = Int(value), CacheStoragePolicy.allowedMegabytes.contains(number) else { return nil }
        return number
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("缓存大小（MB）", text: $value)
                        .keyboardType(.numberPad)
                        .accessibilityIdentifier("storage.cacheLimit.value")
                    ForEach(CacheStoragePolicy.presets, id: \.self) { amount in
                        Button {
                            value = String(amount)
                        } label: {
                            HStack {
                                Text("\(amount) MB")
                                Spacer()
                                if Int(value) == amount { Image(systemName: "checkmark") }
                            }
                        }
                        .accessibilityAddTraits(Int(value) == amount ? [.isSelected] : [])
                    }
                } header: {
                    Text("自动缓存上限")
                } footer: {
                    Text("可输入 32–8192 MB。系统会在上限内自动管理图片与章节缓存；离线下载和字体另计。")
                }
                if let error { Section { Text(error).foregroundStyle(AppTheme.danger) } }
            }
            .disabled(isSaving)
            .navigationTitle("缓存大小")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }.disabled(isSaving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("保存") {
                        guard let amount = validValue else { return }
                        isSaving = true
                        Task { @MainActor in
                            defer { isSaving = false }
                            do {
                                try await save(amount)
                                AppFeedback.success("缓存上限已更新")
                                dismiss()
                            } catch {
                                self.error = "无法保留离线章节，请检查可用存储空间后重试。"
                            }
                        }
                    }
                    .disabled(validValue == nil || isSaving)
                    .accessibilityIdentifier("storage.cacheLimit.save")
                }
            }
            .interactiveDismissDisabled(isSaving)
        }
    }
}
