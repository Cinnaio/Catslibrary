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

    private var automaticCacheBytes: Int64 {
        fontStore.storage.imageCacheBytes + chapterCacheBytes
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                AccountSettingsHeading("存储管理")
                usageOverview
                    .readingSpaceEntrance()
                automaticCacheSection
                    .readingSpaceEntrance(1)
                offlineSection
                    .readingSpaceEntrance(2)
                fontsSection
                    .readingSpaceEntrance(3)
            }
            .padding(.horizontal, 24)
            .padding(.top, 20)
            .padding(.bottom, 32)
            .frame(maxWidth: 700, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .center)
        }
        .background(ReadingSpace.profilePaper)
        .readingSpaceNavigation()
        .tint(AppTheme.primary)
        .buttonStyle(.plain)
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

    private var usageOverview: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("本机应用数据")
                .font(.subheadline)
                .foregroundStyle(ReadingSpace.summarySecondary)
            Text(storageSize(fontStore.storage.totalDataBytes))
                .font(.system(.largeTitle, design: .rounded).weight(.medium))
                .monospacedDigit()
                .foregroundStyle(ReadingSpace.onSummary)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityLabel("本机应用数据，\(storageSize(fontStore.storage.totalDataBytes))")
            Text("应用本体另占 \(storageSize(fontStore.storage.appBundleBytes))")
                .font(.footnote)
                .foregroundStyle(ReadingSpace.summarySecondary)
                .fixedSize(horizontal: false, vertical: true)
            Text("下方可管理缓存、离线章节和字体；总量还包含设置等其他应用数据。")
                .font(.caption)
                .foregroundStyle(ReadingSpace.summarySecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(ReadingSpace.summary, in: RoundedRectangle(cornerRadius: ReadingSpace.panelRadius))
        .accessibilityIdentifier("storage.overview")
    }

    private var automaticCacheSection: some View {
        storageSection("自动缓存") {
            VStack(alignment: .leading, spacing: 12) {
                StorageValueRow(title: "已用空间", value: storageSize(automaticCacheBytes))
                ProgressView(value: min(1, max(0, Double(automaticCacheBytes) / Double(cacheSettings.policy.totalBytes))))
                    .tint(AppTheme.primary)
                    .accessibilityLabel("自动缓存额度使用情况")
                    .accessibilityValue("已用 \(storageSize(automaticCacheBytes))，上限 \(cacheSettings.policy.megabytes) MB")
                VStack(spacing: 4) {
                    StorageValueRow(title: "图片", value: storageSize(fontStore.storage.imageCacheBytes))
                    StorageValueRow(title: "章节", value: storageSize(chapterCacheBytes))
                }
            }
            .padding(16)
            .background(ReadingSpace.profileFill, in: RoundedRectangle(cornerRadius: 18))

            Button {
                showCacheLimit = true
            } label: {
                StorageValueRow(title: "自动缓存上限", value: "\(cacheSettings.policy.megabytes) MB", showsChevron: true)
                    .padding(.vertical, 6)
                    .frame(minHeight: AppLayout.minimumTouchTarget)
                    .contentShape(Rectangle())
            }
            .accessibilityLabel("自动缓存上限")
            .accessibilityValue("\(cacheSettings.policy.megabytes) MB")
            .accessibilityIdentifier("storage.cacheLimit")
            .disabled(cacheSettings.isApplying || isClearingCaches)

            Button(role: .destructive) {
                showClearCachesConfirm = true
            } label: {
                StorageActionLabel(
                    title: isClearingCaches ? "正在清理缓存…" : "清理图片和章节缓存",
                    symbol: "trash", isWorking: isClearingCaches, destructive: true
                )
            }
            .disabled(isClearingCaches || cacheSettings.isApplying)
            .accessibilityIdentifier("storage.clearCache")

            storageNote("上限按设备保存，调低后会清理较旧的自动缓存。字体和主动下载的离线章节另计，清理时会保留。")
        }
    }

    private var offlineSection: some View {
        storageSection("离线阅读") {
            if !offlineStore.books.isEmpty {
                NavigationLink {
                    OfflineReadingView()
                } label: {
                    offlineSummary
                }
                .accessibilityHint("管理已下载的离线章节")
            } else {
                offlineSummary
            }
            storageNote("下载的章节可在无网络时阅读，进入离线书库可按作品或章节管理。")
        }
    }

    private var offlineSummary: some View {
        HStack(alignment: .center, spacing: 14) {
            Image(systemName: "books.vertical")
                .font(.title2)
                .foregroundStyle(ReadingSpace.profileMuted)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 5) {
                Text(offlineStore.books.isEmpty ? "还没有离线章节" : "\(offlineStore.books.count) 本作品")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(ReadingSpace.ink)
                Text("\(offlineStore.totalChapterCount) 章 · \(storageSize(offlineBytes))")
                    .font(.footnote)
                    .monospacedDigit()
                    .foregroundStyle(ReadingSpace.profileMuted)
            }
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            if !offlineStore.books.isEmpty {
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(ReadingSpace.profileMuted)
                    .accessibilityHidden(true)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, minHeight: AppLayout.minimumTouchTarget, alignment: .leading)
        .background(ReadingSpace.profileFill, in: RoundedRectangle(cornerRadius: 18))
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    private var fontsSection: some View {
        storageSection("阅读字体") {
            StorageValueRow(title: "字体缓存", value: storageSize(fontStore.storage.fontBytes))
            VStack(spacing: 4) {
                ForEach(RemoteFontAsset.allCases) { asset in
                    StorageValueRow(title: asset.title, value: fontSize(for: asset))
                }
            }

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
                StorageActionLabel(
                    title: fontStore.isDownloading ? "正在下载并注册字体…"
                        : (fontStore.hasDownloadedFonts ? "重新检查字体" : "下载并启用宋体"),
                    symbol: "arrow.down.circle", isWorking: fontStore.isDownloading
                )
            }
            .disabled(fontStore.isDownloading)

            Button(role: .destructive) {
                showDeleteFontsConfirm = true
            } label: {
                StorageActionLabel(title: "删除字体缓存", symbol: "trash", destructive: true)
            }
            .disabled(fontStore.storage.fontBytes == 0 || fontStore.isDownloading)

            if let lastError = fontStore.lastError {
                Text(lastError)
                    .font(.footnote)
                    .foregroundStyle(AppTheme.danger)
                    .fixedSize(horizontal: false, vertical: true)
                    .textSelection(.enabled)
            }
            storageNote("字体保存在本机，删除后可以重新下载；无网络且未下载时，阅读器使用系统字体。")
        }
    }

    private func storageSection<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title)
                .font(serifFont(.title3, .medium))
                .foregroundStyle(ReadingSpace.ink)
                .accessibilityAddTraits(.isHeader)
            content()
        }
    }

    private func storageNote(_ text: String) -> some View {
        Text(text)
            .font(.footnote)
            .foregroundStyle(ReadingSpace.profileMuted)
            .lineSpacing(4)
            .fixedSize(horizontal: false, vertical: true)
    }

    private func storageSize(_ bytes: Int64) -> String {
        ByteCountFormatter.string(fromByteCount: bytes, countStyle: .file)
    }

    private func refreshUsage() async {
        await offlineStore.refresh()
        let usage = await ChapterDiskCache.shared.usage()
        chapterCacheBytes = usage.automaticBytes
        offlineBytes = usage.offlineBytes
        fontStore.refresh()
    }

    private func fontSize(for asset: RemoteFontAsset) -> String {
        let bytes = fontStore.downloadedBytes(for: asset)
        return bytes > 0
            ? ByteCountFormatter.string(fromByteCount: bytes, countStyle: .file)
            : "未下载"
    }
}

/// 较大字号纵排数值，普通字号保留清晰的左右对照。
private struct StorageValueRow: View {
    let title: String
    let value: String
    var showsChevron = false
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.isEnabled) private var isEnabled

    var body: some View {
        let layout = dynamicTypeSize >= .xxxLarge
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 5))
            : AnyLayout(HStackLayout(alignment: .firstTextBaseline, spacing: 12))
        layout {
            Text(title)
                .foregroundStyle(ReadingSpace.ink)
                .frame(maxWidth: .infinity, alignment: .leading)
            HStack(spacing: 8) {
                Text(value)
                    .monospacedDigit()
                if showsChevron {
                    Image(systemName: "chevron.right")
                        .font(.caption.weight(.semibold))
                        .accessibilityHidden(true)
                }
            }
            .foregroundStyle(ReadingSpace.profileMuted)
        }
        .font(.subheadline)
        .fixedSize(horizontal: false, vertical: true)
        .padding(.vertical, 4)
        .opacity(isEnabled ? 1 : 0.45)
        .accessibilityElement(children: .combine)
    }
}

/// 操作中的进度留在原按钮内，不额外插入一行推动后续内容。
private struct StorageActionLabel: View {
    let title: String
    let symbol: String
    var isWorking = false
    var destructive = false
    @Environment(\.isEnabled) private var isEnabled

    var body: some View {
        HStack(spacing: 12) {
            Group {
                if isWorking { ProgressView() }
                else { Image(systemName: symbol) }
            }
            .frame(width: AppLayout.iconSlot)
            .accessibilityHidden(true)
            Text(title)
                .fixedSize(horizontal: false, vertical: true)
        }
        .font(.subheadline)
        .foregroundStyle(destructive ? AppTheme.danger : ReadingSpace.ink)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, minHeight: AppLayout.minimumTouchTarget, alignment: .leading)
        .contentShape(Rectangle())
        .opacity(isEnabled || isWorking ? 1 : 0.45)
    }
}

private struct CacheLimitEditor: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @FocusState private var isEditingValue: Bool
    @ScaledMetric(relativeTo: .subheadline) private var presetMinimumWidth: CGFloat = 104
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
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    editorHeading
                    valueField
                    presetsPicker

                    Text("调低上限会清理较旧的自动缓存。已下载的离线章节和字体单独保存，不受影响。")
                        .font(.footnote)
                        .foregroundStyle(ReadingSpace.profileMuted)
                        .lineSpacing(4)
                        .fixedSize(horizontal: false, vertical: true)

                    if let error {
                        Text(error)
                            .font(.footnote)
                            .foregroundStyle(AppTheme.danger)
                            .fixedSize(horizontal: false, vertical: true)
                            .textSelection(.enabled)
                    }
                }
                .padding(.horizontal, 24)
                .padding(.top, 20)
                .padding(.bottom, 32)
                .frame(maxWidth: 600, alignment: .leading)
                .frame(maxWidth: .infinity, alignment: .center)
            }
            .background(ReadingSpace.profilePaper)
            .readingSpaceNavigation()
            .tint(AppTheme.primary)
            .disabled(isSaving)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }.disabled(isSaving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
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
                    } label: {
                        if isSaving { ProgressView().accessibilityLabel("正在保存") }
                        else { Text("保存") }
                    }
                    .disabled(validValue == nil || isSaving)
                    .accessibilityLabel(isSaving ? "正在保存" : "保存")
                    .accessibilityIdentifier("storage.cacheLimit.save")
                }
            }
            .interactiveDismissDisabled(isSaving)
        }
    }

    private var editorHeading: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("给自动缓存留多少空间")
                .font(serifFont(.title2, .medium))
                .foregroundStyle(ReadingSpace.ink)
                .accessibilityAddTraits(.isHeader)
            Text("按这台设备保存，图片与章节共用额度。")
                .font(.subheadline)
                .foregroundStyle(ReadingSpace.profileMuted)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var valueField: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("自定义大小")
                .font(.subheadline.weight(.medium))
                .foregroundStyle(ReadingSpace.ink)
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                TextField("缓存大小（MB）", text: $value)
                    .font(.system(.title2, design: .rounded).weight(.medium))
                    .monospacedDigit()
                    .foregroundStyle(ReadingSpace.ink)
                    .keyboardType(.numberPad)
                    .focused($isEditingValue)
                    .accessibilityLabel("自动缓存大小，单位 MB")
                    .accessibilityIdentifier("storage.cacheLimit.value")
                Text("MB")
                    .font(.subheadline)
                    .foregroundStyle(ReadingSpace.profileMuted)
                    .accessibilityHidden(true)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .frame(minHeight: AppLayout.fieldMinHeight)
            .background(ReadingSpace.paper, in: RoundedRectangle(cornerRadius: 16))
            .overlay {
                RoundedRectangle(cornerRadius: 16)
                    .strokeBorder(isEditingValue ? AppTheme.primary : ReadingSpace.profileLine, lineWidth: 1)
            }
            Text("可输入 32–8192 MB。")
                .font(.footnote)
                .foregroundStyle(!value.isEmpty && validValue == nil ? AppTheme.danger : ReadingSpace.profileMuted)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var presetsPicker: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("常用大小")
                .font(.subheadline.weight(.medium))
                .foregroundStyle(ReadingSpace.ink)
                .accessibilityAddTraits(.isHeader)
            LazyVGrid(columns: presetColumns, spacing: 10) {
                ForEach(CacheStoragePolicy.presets, id: \.self) { amount in
                    presetButton(amount)
                }
            }
            .animation(reduceMotion ? nil : .easeInOut(duration: 0.18), value: Int(value))
        }
    }

    private var presetColumns: [GridItem] {
        dynamicTypeSize.isAccessibilitySize
            ? [GridItem(.flexible())]
            : [GridItem(.adaptive(minimum: presetMinimumWidth), spacing: 10)]
    }

    private func presetButton(_ amount: Int) -> some View {
        let selected = Int(value) == amount
        return Button {
            value = String(amount)
            isEditingValue = false
        } label: {
            HStack(spacing: 6) {
                Text("\(amount) MB")
                    .monospacedDigit()
                    .fixedSize(horizontal: false, vertical: true)
                Image(systemName: "checkmark")
                    .font(.caption.weight(.semibold))
                    .opacity(selected ? 1 : 0)
                    .accessibilityHidden(true)
            }
            .font(.subheadline.weight(selected ? .medium : .regular))
            .foregroundStyle(selected ? AppTheme.primary : ReadingSpace.ink)
            .padding(.horizontal, 8)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, minHeight: AppLayout.minimumTouchTarget)
            .background(selected ? ReadingSpace.userMessage : ReadingSpace.profileFill,
                        in: RoundedRectangle(cornerRadius: 12))
            .overlay {
                RoundedRectangle(cornerRadius: 12)
                    .strokeBorder(selected ? AppTheme.primary : Color.clear, lineWidth: 1)
            }
            .contentShape(RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? [.isSelected] : [])
    }
}
