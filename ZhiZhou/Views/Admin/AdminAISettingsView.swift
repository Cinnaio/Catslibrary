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
    @State private var coverPlatform = "openai"
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
        Section("前情提要") {
            Toggle("启用前情提要", isOn: $recapEnabled)
            row("每日配额", value: $dailyQuota)
            row("单章最大字符", value: $maxChapterChars)
            row("温度", value: $recapTemperature)
            row("最大 Tokens", value: $recapMaxTokens)
            promptEditor("系统提示词", text: $recapSystemPrompt)
        }
    }

    private var catchupSection: some View {
        Section("回顾总结") {
            Toggle("启用回顾总结", isOn: $catchupEnabled)
            row("过期天数", value: $catchupStaleDays)
            row("最多回顾章节", value: $catchupMaxChapters)
            row("温度", value: $catchupTemperature)
            row("最大 Tokens", value: $catchupMaxTokens)
        }
    }

    private var writingSection: some View {
        Section("AI 创作") {
            row("创作温度", value: $writingTemperature)
            row("创作最大 Tokens", value: $writingMaxTokens)
            promptEditor("创作系统提示词", text: $writingSystemPrompt)
            row("风格画像 Tokens", value: $styleProfileMaxTokens)
            row("情节状态 Tokens", value: $plotStateMaxTokens)
            row("关系画像 Tokens", value: $relationshipProfileMaxTokens)
            row("标题 Tokens", value: $titleMaxTokens)
            row("最大并发创作任务", value: $maxConcurrentWritingTasks)
        }
    }

    private var coverSection: some View {
        Section("AI 封面") {
            TextField("图像尺寸（如 1024x1024）", text: $imageSize)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            TextField("图像质量（low / medium / high）", text: $imageQuality)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            TextField("返回格式（url / b64_json）", text: $imageResponseFormat)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            TextField("封面尺寸（如 1024x1536）", text: $coverImageSize)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            Toggle("封面渲染标题", isOn: $coverRenderTitle)
            TextField("封面平台", text: $coverPlatform)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
        }
    }

    private var opsSection: some View {
        Section("运维与审计") {
            row("任务保留天数", value: $taskRetentionDays)
            Toggle("记录 IP 地址", isOn: $logIpAddress)
            Toggle("记录 User-Agent", isOn: $logUserAgent)
        }
    }

    private func row(_ label: String, value: Binding<Int>) -> some View {
        HStack {
            Text(label)
                .foregroundStyle(AppTheme.textPrimary)
            Spacer()
            TextField(label, value: value, format: .number)
                .keyboardType(.numberPad)
                .multilineTextAlignment(.trailing)
                .foregroundStyle(AppTheme.textSecondary)
                .frame(maxWidth: 120)
                .focused($focusedField, equals: label)
        }
    }

    private func row(_ label: String, value: Binding<Double>) -> some View {
        HStack {
            Text(label)
                .foregroundStyle(AppTheme.textPrimary)
            Spacer()
            TextField(label, value: value, format: .number)
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
                .frame(minHeight: 60)
                .font(.subheadline)
                .focused($focusedField, equals: label)
        }
        .padding(.vertical, 2)
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
        taskRetentionDays = s.taskRetentionDays ?? taskRetentionDays
        logIpAddress = s.logIpAddress ?? logIpAddress
        logUserAgent = s.logUserAgent ?? logUserAgent
    }

    private func save() async {
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

    private var errorAlertBinding: Binding<Bool> {
        Binding(
            get: { actionError != nil },
            set: { if !$0 { actionError = nil } }
        )
    }
}
