import SwiftUI

/// 运行参数：前情提要 / 回顾总结 / AI 创作 / 封面 / 运维审计 全部可编辑项。
struct AdminAISettingsView: View {
    // 前情提要
    @State private var recapEnabled = false
    @State private var dailyQuota = 20
    @State private var maxChapterChars = 6000
    @State private var recapTemperature = 0.7
    @State private var recapMaxTokens = 1200
    @State private var recapSystemPrompt = ""
    // 回顾总结
    @State private var catchupEnabled = false
    @State private var catchupStaleDays = 3
    @State private var catchupMaxChapters = 10
    @State private var catchupTemperature = 0.7
    @State private var catchupMaxTokens = 1600
    // AI 创作
    @State private var writingTemperature = 1.1
    @State private var writingMaxTokens = 4000
    @State private var writingSystemPrompt = ""
    @State private var styleProfileMaxTokens = 2000
    @State private var plotStateMaxTokens = 2000
    @State private var relationshipProfileMaxTokens = 2000
    @State private var titleMaxTokens = 500
    @State private var maxConcurrentWritingTasks = 1
    // AI 封面
    @State private var imageSize = "1024x1024"
    @State private var imageQuality = "high"
    @State private var imageResponseFormat = "url"
    @State private var coverImageSize = "1024x1536"
    @State private var coverRenderTitle = true
    @State private var coverPlatform = "default"
    @State private var coverPromptMaxChars = 2000
    // 运维与审计
    @State private var taskRetentionDays = 30
    @State private var logIpAddress = true
    @State private var logUserAgent = false

    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var saving = false
    @State private var saveMessage: String?
    @State private var actionError: String?
    @FocusState private var focusedField: String?
    @State private var recapExpanded = true
    @State private var catchupExpanded = false
    @State private var writingExpanded = false
    @State private var coverExpanded = false
    @State private var opsExpanded = false

    private let imageSizeOptions: [(value: String, label: String)] = [
        ("1024x1024", "1024 × 1024（方形）"),
        ("1792x1024", "1792 × 1024（横向）"),
        ("1024x1792", "1024 × 1792（纵向）"),
        ("1024x1536", "1024 × 1536（竖版）"),
        ("768x1024", "768 × 1024（竖版）"),
        ("512x512", "512 × 512（方形）"),
    ]

    private let coverImageSizeOptions: [(value: String, label: String)] = [
        ("1024x1536", "1024 × 1536（竖版 2:3）"),
        ("768x1024", "768 × 1024（竖版 3:4）"),
        ("1024x1792", "1024 × 1792（长竖版）"),
        ("1024x1024", "1024 × 1024（方形）"),
    ]

    private let coverPlatformOptions: [(value: String, label: String)] = [
        ("default", "通用（竖版 2:3）"),
        ("fanqie", "番茄小说"),
        ("qidian", "起点"),
        ("jinjiang", "晋江"),
        ("zhihu", "知乎盐言"),
        ("qimao", "七猫"),
        ("ciweimao", "刺猬猫"),
    ]

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
                Section {
                    Label("修改参数后，点击底部“保存全部参数”统一生效。数字输入会自动限制在允许范围内。", systemImage: "info.circle")
                        .font(.caption)
                        .foregroundStyle(AppTheme.textSecondary)
                }
                recapSection
                catchupSection
                writingSection
                coverSection
                opsSection
                Section {
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
                            Label("保存全部参数", systemImage: "checkmark.circle")
                        }
                    }
                    .disabled(saving)
                    if let saveMessage {
                        Label(saveMessage, systemImage: "checkmark.circle.fill")
                            .font(.subheadline)
                            .foregroundStyle(AppTheme.success)
                    }
                }
            }
        }
        .scrollContentBackground(.hidden)
        .pageBackground()
        .scrollDismissesKeyboard(.interactively)
        .navigationTitle("运行参数")
        .navigationBarTitleDisplayMode(.large)
        .refreshable { await load() }
        .task { await load() }
        .toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("完成") { focusedField = nil }
            }
        }
        .alert("操作失败", isPresented: errorAlertBinding) {
            Button("好", role: .cancel) {}
        } message: {
            Text(actionError ?? "")
        }
    }

    // MARK: - 分区

    private var recapSection: some View {
        DisclosureGroup("前情提要", isExpanded: $recapExpanded) {
            Toggle("启用前情提要", isOn: $recapEnabled)
            row("每日配额（次）", value: $dailyQuota, range: 0...10000)
            row("单章最大字符", value: $maxChapterChars, range: 100...100000)
            row("前情温度（0–2）", value: $recapTemperature, range: 0...2)
            row("前情最大 Tokens", value: $recapMaxTokens, range: 1...64000)
            promptEditor("系统提示词", text: $recapSystemPrompt)
        }
    }

    private var catchupSection: some View {
        DisclosureGroup("回顾总结", isExpanded: $catchupExpanded) {
            Toggle("启用回顾总结", isOn: $catchupEnabled)
            row("过期天数", value: $catchupStaleDays, range: 1...3650)
            row("最多回顾章节", value: $catchupMaxChapters, range: 1...200)
            row("回顾温度（0–2）", value: $catchupTemperature, range: 0...2)
            row("回顾最大 Tokens", value: $catchupMaxTokens, range: 1...64000)
        }
    }

    private var writingSection: some View {
        DisclosureGroup("AI 创作", isExpanded: $writingExpanded) {
            row("创作温度（0–2）", value: $writingTemperature, range: 0...2)
            row("创作最大 Tokens", value: $writingMaxTokens, range: 1...64000)
            promptEditor("创作系统提示词", text: $writingSystemPrompt)
            row("风格画像 Tokens", value: $styleProfileMaxTokens, range: 1...64000)
            row("情节状态 Tokens", value: $plotStateMaxTokens, range: 1...64000)
            row("关系画像 Tokens", value: $relationshipProfileMaxTokens, range: 1...64000)
            row("标题 Tokens", value: $titleMaxTokens, range: 1...8000)
            row("最大并发创作任务", value: $maxConcurrentWritingTasks, range: 1...8)
        }
    }

    private var coverSection: some View {
        DisclosureGroup("AI 封面", isExpanded: $coverExpanded) {
            Picker("图像尺寸", selection: $imageSize) {
                ForEach(imageSizeOptions, id: \.value) { option in
                    Text(option.label).tag(option.value)
                }
            }
            .pickerStyle(.menu)
            Picker("图像质量", selection: $imageQuality) {
                Text("低（low）").tag("low")
                Text("中（medium）").tag("medium")
                Text("高（high）").tag("high")
            }
            .pickerStyle(.menu)
            Picker("返回格式", selection: $imageResponseFormat) {
                Text("URL").tag("url")
                Text("Base64 JSON").tag("b64_json")
            }
            .pickerStyle(.menu)
            Picker("封面尺寸", selection: $coverImageSize) {
                ForEach(coverImageSizeOptions, id: \.value) { option in
                    Text(option.label).tag(option.value)
                }
            }
            .pickerStyle(.menu)
            Toggle("封面渲染标题", isOn: $coverRenderTitle)
            Picker("封面平台", selection: $coverPlatform) {
                ForEach(coverPlatformOptions, id: \.value) { option in
                    Text(option.label).tag(option.value)
                }
            }
            .pickerStyle(.menu)
            Text("通用平台使用竖版 2:3；平台版式会影响封面调性、尺寸和文字安全区。")
                .font(.caption)
                .foregroundStyle(AppTheme.textSecondary)
            row("封面描述词上限", value: $coverPromptMaxChars, range: 100...10000)
            Text("封面生成页可编辑的描述词最大字符数，默认 2000；修改后保存即可生效。")
                .font(.caption)
                .foregroundStyle(AppTheme.textSecondary)
        }
    }

    private var opsSection: some View {
        DisclosureGroup("运维与审计", isExpanded: $opsExpanded) {
            row("任务保留天数", value: $taskRetentionDays, range: 1...3650)
            Toggle("记录 IP 地址", isOn: $logIpAddress)
            Toggle("记录 User-Agent", isOn: $logUserAgent)
        }
    }

    private func row(_ label: String, value: Binding<Int>, range: ClosedRange<Int>) -> some View {
        HStack {
            Text(label)
                .foregroundStyle(AppTheme.textPrimary)
                .lineLimit(2)
            Spacer()
            TextField(label, value: bounded(value, to: range), format: .number)
                .keyboardType(.numberPad)
                .multilineTextAlignment(.trailing)
                .foregroundStyle(AppTheme.textSecondary)
                .frame(maxWidth: 120)
                .focused($focusedField, equals: label)
        }
    }

    private func row(_ label: String, value: Binding<Double>, range: ClosedRange<Double>) -> some View {
        HStack {
            Text(label)
                .foregroundStyle(AppTheme.textPrimary)
                .lineLimit(2)
            Spacer()
            TextField(label, value: bounded(value, to: range), format: .number)
                .keyboardType(.decimalPad)
                .multilineTextAlignment(.trailing)
                .foregroundStyle(AppTheme.textSecondary)
                .frame(maxWidth: 120)
                .focused($focusedField, equals: label)
        }
    }

    private func promptEditor(_ label: String, text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(.subheadline)
                .foregroundStyle(AppTheme.textSecondary)
            TextEditor(text: text)
                .frame(minHeight: 96)
                .font(.subheadline)
                .focused($focusedField, equals: label)
        }
        .padding(.vertical, 2)
    }

    private func bounded(_ value: Binding<Int>, to range: ClosedRange<Int>) -> Binding<Int> {
        Binding(
            get: { boundedValue(value.wrappedValue, to: range) },
            set: { value.wrappedValue = boundedValue($0, to: range) }
        )
    }

    private func bounded(_ value: Binding<Double>, to range: ClosedRange<Double>) -> Binding<Double> {
        Binding(
            get: { boundedValue(value.wrappedValue, to: range) },
            set: { value.wrappedValue = boundedValue($0, to: range) }
        )
    }

    private func boundedValue<T: Comparable>(_ value: T, to range: ClosedRange<T>) -> T {
        min(max(value, range.lowerBound), range.upperBound)
    }

    // MARK: - 数据

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            let r = try await AdminAPI.aiSettings()
            seed(r.settings)
            errorMessage = nil
        } catch {
            errorMessage = AppCopy.friendlyError(error)
        }
    }

    private func seed(_ s: AiSettings?) {
        guard let s else { return }
        recapEnabled = s.recapEnabled ?? recapEnabled
        dailyQuota = s.dailyQuota ?? dailyQuota
        maxChapterChars = s.maxChapterChars ?? maxChapterChars
        recapTemperature = s.recapTemperature ?? recapTemperature
        recapMaxTokens = s.recapMaxTokens ?? recapMaxTokens
        recapSystemPrompt = s.recapSystemPrompt ?? recapSystemPrompt
        catchupEnabled = s.catchupEnabled ?? catchupEnabled
        catchupStaleDays = s.catchupStaleDays ?? catchupStaleDays
        catchupMaxChapters = s.catchupMaxChapters ?? catchupMaxChapters
        catchupTemperature = s.catchupTemperature ?? catchupTemperature
        catchupMaxTokens = s.catchupMaxTokens ?? catchupMaxTokens
        writingTemperature = s.writingTemperature ?? writingTemperature
        writingMaxTokens = s.writingMaxTokens ?? writingMaxTokens
        writingSystemPrompt = s.writingSystemPrompt ?? writingSystemPrompt
        styleProfileMaxTokens = s.styleProfileMaxTokens ?? styleProfileMaxTokens
        plotStateMaxTokens = s.plotStateMaxTokens ?? plotStateMaxTokens
        relationshipProfileMaxTokens = s.relationshipProfileMaxTokens ?? relationshipProfileMaxTokens
        titleMaxTokens = s.titleMaxTokens ?? titleMaxTokens
        maxConcurrentWritingTasks = s.maxConcurrentWritingTasks ?? maxConcurrentWritingTasks
        imageSize = s.imageSize ?? imageSize
        imageQuality = s.imageQuality ?? imageQuality
        imageResponseFormat = s.imageResponseFormat ?? imageResponseFormat
        coverImageSize = s.coverImageSize ?? coverImageSize
        coverRenderTitle = s.coverRenderTitle ?? coverRenderTitle
        coverPlatform = s.coverPlatform ?? coverPlatform
        coverPromptMaxChars = s.coverPromptMaxChars ?? coverPromptMaxChars
        taskRetentionDays = s.taskRetentionDays ?? taskRetentionDays
        logIpAddress = s.logIpAddress ?? logIpAddress
        logUserAgent = s.logUserAgent ?? logUserAgent
    }

    private func save() async {
        normalizeValues()
        saving = true
        defer { saving = false }
        do {
            let patch: [String: Any] = [
                "recapEnabled": recapEnabled,
                "dailyQuota": dailyQuota,
                "maxChapterChars": maxChapterChars,
                "recapTemperature": recapTemperature,
                "recapMaxTokens": recapMaxTokens,
                "recapSystemPrompt": recapSystemPrompt,
                "catchupEnabled": catchupEnabled,
                "catchupStaleDays": catchupStaleDays,
                "catchupMaxChapters": catchupMaxChapters,
                "catchupTemperature": catchupTemperature,
                "catchupMaxTokens": catchupMaxTokens,
                "writingTemperature": writingTemperature,
                "writingMaxTokens": writingMaxTokens,
                "writingSystemPrompt": writingSystemPrompt,
                "styleProfileMaxTokens": styleProfileMaxTokens,
                "plotStateMaxTokens": plotStateMaxTokens,
                "relationshipProfileMaxTokens": relationshipProfileMaxTokens,
                "titleMaxTokens": titleMaxTokens,
                "maxConcurrentWritingTasks": maxConcurrentWritingTasks,
                "imageSize": imageSize,
                "imageQuality": imageQuality,
                "imageResponseFormat": imageResponseFormat,
                "coverImageSize": coverImageSize,
                "coverRenderTitle": coverRenderTitle,
                "coverPlatform": coverPlatform,
                "coverPromptMaxChars": coverPromptMaxChars,
                "taskRetentionDays": taskRetentionDays,
                "logIpAddress": logIpAddress,
                "logUserAgent": logUserAgent,
            ]
            _ = try await AdminAPI.saveAiSettings(patch)
            saveMessage = "参数已保存"
        } catch {
            actionError = AppCopy.friendlyError(error)
        }
    }

    private func normalizeValues() {
        dailyQuota = boundedValue(dailyQuota, to: 0...10000)
        maxChapterChars = boundedValue(maxChapterChars, to: 100...100000)
        coverPromptMaxChars = boundedValue(coverPromptMaxChars, to: 100...10000)
        recapTemperature = boundedValue(recapTemperature, to: 0...2)
        recapMaxTokens = boundedValue(recapMaxTokens, to: 1...64000)
        catchupStaleDays = boundedValue(catchupStaleDays, to: 1...3650)
        catchupMaxChapters = boundedValue(catchupMaxChapters, to: 1...200)
        catchupTemperature = boundedValue(catchupTemperature, to: 0...2)
        catchupMaxTokens = boundedValue(catchupMaxTokens, to: 1...64000)
        writingTemperature = boundedValue(writingTemperature, to: 0...2)
        writingMaxTokens = boundedValue(writingMaxTokens, to: 1...64000)
        styleProfileMaxTokens = boundedValue(styleProfileMaxTokens, to: 1...64000)
        plotStateMaxTokens = boundedValue(plotStateMaxTokens, to: 1...64000)
        relationshipProfileMaxTokens = boundedValue(relationshipProfileMaxTokens, to: 1...64000)
        titleMaxTokens = boundedValue(titleMaxTokens, to: 1...8000)
        maxConcurrentWritingTasks = boundedValue(maxConcurrentWritingTasks, to: 1...8)
        taskRetentionDays = boundedValue(taskRetentionDays, to: 1...3650)
    }

    private var errorAlertBinding: Binding<Bool> {
        Binding(
            get: { actionError != nil },
            set: { if !$0 { actionError = nil } }
        )
    }
}
