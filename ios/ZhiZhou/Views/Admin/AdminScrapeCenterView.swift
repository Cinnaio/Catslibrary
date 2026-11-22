import SwiftUI
import UIKit

/// 抓取中心：采集向导 —— 输入源站 URL → 智能分析 → 确认/创建小说 → 配置选择器 → 测试 → 启动抓取。
/// 对齐 Web 端 admin scrape CenterView；任务进度在「任务管理」查看。
struct AdminScrapeCenterView: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @FocusState private var focusedField: String?
    @State private var analyzedSourceURL: String?
    @State private var sourceUrl = ""
    @State private var analyzing = false
    @State private var analyzeError: String?
    @State private var meta: ScrapeDetectedMeta?

    // ② 确认小说
    @State private var title = ""
    @State private var author = ""
    @State private var status = "ongoing"
    @State private var descriptionText = ""
    @State private var coverUrl = ""
    @State private var categories = ""
    @State private var creating = false
    @State private var createdNovelId: String?
    @State private var testingBeforeCreation = false

    // ③ 抓取配置
    @State private var chapterListUrl = ""
    @State private var encoding = ""
    @State private var chapterListSelector = ""
    @State private var chapterTitleSelector = ""
    @State private var chapterContentSelector = ""
    @State private var nextPageSelector = ""
    @State private var testing = false
    @State private var testResult: ScrapeTestResponse?
    @State private var testError: String?
    @State private var starting = false
    @State private var startReceipt: AdminJobActionResponse?
    @State private var showStartConfirm = false
    @State private var actionError: String?

    private var normalizedSourceURL: String {
        sourceUrl.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var showConfirmStep: Bool { meta != nil && analyzedSourceURL == normalizedSourceURL }
    private var showConfigStep: Bool { showConfirmStep && (createdNovelId != nil || testingBeforeCreation) }
    private var isWorking: Bool { analyzing || creating || testing || starting }

    private var configurationValues: [String] {
        [chapterListUrl, encoding, chapterListSelector, chapterTitleSelector, chapterContentSelector, nextPageSelector]
    }

    private var stepTransition: AnyTransition { reduceMotion ? .identity : .opacity }

    var body: some View {
        AdminWorkspaceList {
            AdminWorkspaceHeading("爬虫抓取中心")
            analyzeSection
            if showConfirmStep {
                confirmSection.transition(stepTransition)
            }
            if showConfigStep {
                configSection.transition(stepTransition)
            }
            if let startReceipt, showConfigStep {
                Label("抓取任务已启动。", systemImage: "checkmark.circle.fill")
                    .font(.subheadline)
                    .foregroundStyle(AppTheme.success)
                    .transition(stepTransition)
                if let jobID = startReceipt.jobId, !jobID.isEmpty {
                    NavigationLink("查看本次抓取任务") { AdminJobsView(jobID: jobID) }
                } else {
                    NavigationLink("查看抓取任务") { AdminJobsView() }
                }
            }
        }
        .buttonStyle(.borderless)
        .disabled(isWorking)
        .animation(reduceMotion ? nil : AppMotion.micro, value: showConfirmStep)
        .animation(reduceMotion ? nil : AppMotion.micro, value: showConfigStep)
        .onChange(of: configurationValues) { _, _ in
            testResult = nil
            testError = nil
        }
        .toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("完成") { focusedField = nil }
            }
        }
        .confirmationDialog(
            "开始抓取",
            isPresented: $showStartConfirm,
            titleVisibility: .visible
        ) {
            Button("开始抓取") { Task { await start() } }
            Button("取消", role: .cancel) {}
        } message: {
            Text("源站: \(chapterListUrl)\n列表: \(chapterListSelector)\n正文: \(chapterContentSelector)\n翻页: \(nextPageSelector.isEmpty ? "无" : nextPageSelector)")
        }
        .alert("提示", isPresented: errorAlertBinding) {
            Button("好", role: .cancel) {}
        } message: {
            Text(actionError ?? "")
        }
    }

    private var analyzeSection: some View {
        AdminWorkspaceSection("分析源站") {
            field("源站目录地址", placeholder: "粘贴小说目录页网址", text: $sourceUrl, keyboard: .URL)
            action("开始分析", symbol: "wand.and.stars", working: analyzing) { await analyze() }
                .disabled(normalizedSourceURL.isEmpty)
            if let analyzeError { AccountSettingsNote(analyzeError, isError: true) }
            if let meta, showConfirmStep {
                LabeledContent("站点", value: meta.site?.name ?? "通用站点")
                LabeledContent("章节数", value: meta.chapterCount.map { "\($0) 章" } ?? "未识别")
                LabeledContent("编码", value: meta.encoding?.isEmpty == false ? meta.encoding! : "自动")
                AgentPanelFact(title: "目录页", value: meta.chapterListUrl ?? sourceUrl)
            } else if meta != nil && !analyzing {
                AccountSettingsNote("地址已更改，请重新分析源站。")
            }
        }
    }

    private var confirmSection: some View {
        AdminWorkspaceSection("确认小说") {
            if createdNovelId != nil {
                Label("已创建《\(title)》", systemImage: "checkmark.circle")
                    .font(serifFont(.body, .medium))
                    .foregroundStyle(AppTheme.success)
            } else {
                field("书名", placeholder: "书名 *", text: $title)
                field("作者", placeholder: "作者 *", text: $author)
                Picker("状态", selection: $status) {
                    Text("连载").tag("ongoing")
                    Text("完结").tag("completed")
                }
                .pickerStyle(.menu)
                field("分类", placeholder: "分类（逗号分隔）", text: $categories)
                field("封面地址", placeholder: "封面 URL", text: $coverUrl, keyboard: .URL)
                AccountSettingsField("简介", isFocused: focusedField == "简介") {
                    TextField("简介", text: $descriptionText, axis: .vertical)
                        .lineLimit(2...4)
                        .focused($focusedField, equals: "简介")
                }
                if !testingBeforeCreation {
                    action("创建小说并继续", symbol: "plus.circle", working: creating) { await confirmNovel() }
                    Button("先测试抓取配置") {
                        focusedField = nil
                        testingBeforeCreation = true
                    }
                    .frame(minHeight: AppLayout.minimumTouchTarget, alignment: .leading)
                }
            }
        }
    }

    private var configSection: some View {
        AdminWorkspaceSection("抓取配置") {
            field("章节列表页 URL", text: $chapterListUrl, keyboard: .URL)
            field("编码", placeholder: "如 gbk / utf-8，留空自动识别", text: $encoding)
            field("章节列表选择器", text: $chapterListSelector)
            field("章节标题选择器", placeholder: "可选", text: $chapterTitleSelector)
            field("章节正文选择器", text: $chapterContentSelector)
            field("翻页选择器", placeholder: "可选", text: $nextPageSelector)
            action("测试选择器", symbol: "checkmark.seal", working: testing) { await test() }
            if let testResult {
                testChecksSection(result: testResult).transition(stepTransition)
            }
            if let testError {
                AccountSettingsNote(testError, isError: true).transition(stepTransition)
            }
            if createdNovelId == nil {
                AccountSettingsNote("测试配置无需建书。创建小说后，可用当前配置启动抓取。")
                action("创建小说并继续", symbol: "plus.circle", working: creating) { await confirmNovel() }
            } else {
                Button {
                    focusedField = nil
                    showStartConfirm = true
                } label: {
                    actionLabel("开始抓取", symbol: "play.fill", working: starting)
                }
                .buttonStyle(AgentPanelButtonStyle(prominent: true))
            }
        }
    }

    private func field(_ label: String, placeholder: String? = nil, text: Binding<String>,
                       keyboard: UIKeyboardType = .default) -> some View {
        AccountSettingsField(label, isFocused: focusedField == label) {
            TextField(placeholder ?? label, text: text)
                .keyboardType(keyboard)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .focused($focusedField, equals: label)
        }
    }

    private func action(_ title: String, symbol: String, working: Bool,
                        perform: @escaping @MainActor () async -> Void) -> some View {
        Button {
            focusedField = nil
            Task { await perform() }
        } label: {
            actionLabel(title, symbol: symbol, working: working)
        }
        .buttonStyle(AgentPanelButtonStyle())
    }

    private func actionLabel(_ title: String, symbol: String, working: Bool) -> some View {
        Label {
            Text(title)
        } icon: {
            if working {
                ProgressView().controlSize(.small).accessibilityHidden(true)
            } else {
                Image(systemName: symbol).accessibilityHidden(true)
            }
        }
        .accessibilityValue(working ? "正在处理" : "")
    }

    private func testChecksSection(result: ScrapeTestResponse) -> some View {
        AdminWorkspaceSection("选择器测试结果") {
            if let links = result.links, !links.isEmpty {
                LabeledContent("章节链接", value: "\(links.count) 个")
                if let duplicates = result.diagnostics?.duplicateCount {
                    LabeledContent("重复链接", value: "\(duplicates) 个")
                }
                if let emptyTitles = result.diagnostics?.emptyTitleCount {
                    LabeledContent("空标题", value: "\(emptyTitles) 个")
                }
                if let samples = result.sampleChapters, !samples.isEmpty {
                    LabeledContent("样章内容", value: "\(samples.filter { $0.ok == true }.count)/\(samples.count) 可读")
                }
            } else {
                AccountSettingsNote(result.error ?? "未识别到章节链接", isError: true)
            }
        }
    }

    // MARK: - 数据

    private func analyze() async {
        let s = sourceUrl.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !isWorking, !s.isEmpty else { return }
        analyzeError = nil
        analyzing = true
        defer { analyzing = false }
        do {
            let result = try await AdminAPI.scrapeDetectMeta(sourceUrl: s)
            meta = result
            analyzedSourceURL = s
            analyzeError = nil
            let novel = result.novel
            title = novel?.title ?? ""
            author = novel?.author ?? ""
            let rawStatus = novel?.status ?? ""
            status = (rawStatus == "completed" || rawStatus == "完结") ? "completed" : "ongoing"
            descriptionText = novel?.description ?? ""
            coverUrl = novel?.coverUrl ?? ""
            var cats: [String] = []
            if let list = novel?.categories, !list.isEmpty {
                cats = list
            } else if let single = novel?.category, !single.isEmpty {
                cats = [single]
            }
            categories = cats.joined(separator: "，")
            chapterListUrl = result.chapterListUrl ?? s
            encoding = result.encoding ?? ""
            chapterListSelector = result.selectors?.chapterList ?? ""
            chapterTitleSelector = result.selectors?.chapterTitle ?? ""
            chapterContentSelector = result.selectors?.chapterContent ?? ""
            nextPageSelector = result.selectors?.nextPage ?? ""
            testingBeforeCreation = false
            createdNovelId = nil
            testResult = nil
            testError = nil
            startReceipt = nil
        } catch {
            analyzeError = AppCopy.friendlyError(error)
        }
    }

    private func confirmNovel() async {
        guard showConfirmStep, !isWorking, createdNovelId == nil else { return }
        let t = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let a = author.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty, !a.isEmpty else {
            actionError = "书名和作者不能为空"
            return
        }
        creating = true
        defer { creating = false }
        do {
            let novel = try await AdminAPI.createNovel([
                "title": t,
                "author": a,
                "status": status,
                "description": descriptionText,
                "coverUrl": coverUrl.trimmingCharacters(in: .whitespacesAndNewlines),
                "categories": AdminFormat.parseCategories(categories),
                "sourceUrl": sourceUrl.trimmingCharacters(in: .whitespacesAndNewlines),
            ])
            createdNovelId = novel.id
            testingBeforeCreation = false
            startReceipt = nil
        } catch {
            actionError = AppCopy.friendlyError(error)
        }
    }

    private func test() async {
        guard showConfigStep, !isWorking else { return }
        let src = chapterListUrl.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !src.isEmpty, !chapterListSelector.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            actionError = "请填写章节列表页 URL 和章节列表选择器"
            return
        }
        testing = true
        testResult = nil
        testError = nil
        defer { testing = false }
        do {
            let result = try await AdminAPI.scrapeTest(
                sourceUrl: src,
                encoding: encoding,
                selectors: currentSelectors
            )
            testResult = result
            testError = nil
        } catch {
            testError = AppCopy.friendlyError(error)
        }
    }

    private func start() async {
        guard showConfigStep, !isWorking else { return }
        guard let novelId = createdNovelId else {
            actionError = "请先创建小说"
            return
        }
        guard !chapterListSelector.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              !chapterContentSelector.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            actionError = "章节列表与正文选择器不能为空"
            return
        }
        starting = true
        startReceipt = nil
        defer { starting = false }
        do {
            startReceipt = try await AdminAPI.scrapeStart(
                novelId: novelId,
                sourceUrl: chapterListUrl.trimmingCharacters(in: .whitespacesAndNewlines),
                encoding: encoding,
                selectors: currentSelectors
            )
        } catch {
            actionError = AppCopy.friendlyError(error)
        }
    }

    private var currentSelectors: ScrapeSelectors {
        ScrapeSelectors(
            chapterList: chapterListSelector,
            chapterTitle: chapterTitleSelector,
            chapterContent: chapterContentSelector,
            nextPage: nextPageSelector
        )
    }

    private var errorAlertBinding: Binding<Bool> {
        Binding(
            get: { actionError != nil },
            set: { if !$0 { actionError = nil } }
        )
    }
}
