import SwiftUI

/// 应用存储管理：查看数据占用，下载/删除远程字体，清理图片和章节缓存。
struct StorageManagerView: View {
    @Environment(FontStore.self) private var fontStore
    @Environment(OfflineReadingStore.self) private var offlineStore

    @State private var showDeleteFontsConfirm = false
    @State private var showClearCachesConfirm = false
    @State private var isClearingCaches = false

    var body: some View {
        List {
            Section("占用概览") {
                storageRow("应用本体", bytes: fontStore.storage.appBundleBytes)
                storageRow("应用数据", bytes: fontStore.storage.totalDataBytes)
                storageRow("字体缓存", bytes: fontStore.storage.fontBytes)
                storageRow("图片缓存", bytes: fontStore.storage.imageCacheBytes)
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
                        .foregroundStyle(.red)
                }
            }

            Section("缓存") {
                LabeledContent("缓存目录") {
                    Text(ByteCountFormatter.string(
                        fromByteCount: Int64(fontStore.storage.cachesBytes),
                        countStyle: .file
                    ))
                    .foregroundStyle(AppTheme.textSecondary)
                }

                Button("清理图片和章节缓存", role: .destructive) {
                    showClearCachesConfirm = true
                }
                .disabled(fontStore.storage.cachesBytes == 0 || isClearingCaches)

                if isClearingCaches {
                    HStack(spacing: 10) {
                        ProgressView()
                        Text("正在清理缓存…")
                            .foregroundStyle(AppTheme.textSecondary)
                    }
                }
            }

            Section("离线阅读") {
                LabeledContent("已下载章节", value: "\(offlineStore.totalChapterCount) 章")

                if !offlineStore.books.isEmpty {
                    NavigationLink {
                        OfflineReadingView()
                    } label: {
                        Label("管理离线章节", systemImage: "arrow.down.circle.fill")
                    }
                }
            }

            Section {
                Text("字体会保存到应用的持久化数据目录；删除后可以再次从服务器下载。无网络时，阅读器会回退到系统字体。")
                    .font(.footnote)
                    .foregroundStyle(AppTheme.textSecondary)
                    .lineSpacing(3)
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .pageBackground()
        .navigationTitle("存储管理")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            fontStore.registerCachedFonts()
            fontStore.refresh()
            await offlineStore.refresh()
        }
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
                    await fontStore.clearCaches()
                    offlineStore.forgetAll()
                    isClearingCaches = false
                    AppFeedback.success("缓存已清理")
                }
            }
        }
    }

    private func storageRow(_ title: String, bytes: Int64) -> some View {
        LabeledContent(title) {
            Text(ByteCountFormatter.string(fromByteCount: bytes, countStyle: .file))
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
