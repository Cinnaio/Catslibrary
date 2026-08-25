import SwiftUI

/// 抓取中心：采集向导 —— 输入源站 URL → 智能分析 → 确认/创建小说 → 配置选择器 → 测试 → 启动抓取。
/// 对齐 Web 端 admin scrape CenterView；任务进度在「任务管理」查看。
struct AdminScrapeCenterView: View {
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
    @State private var skippedCreate = false

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
    @State private var startMessage: String?
    @State private var showStartConfirm = false
    @State private var actionError: String?

    private var showConfirmStep: Bool { meta != nil }
    private var showConfigStep: Bool { createdNovelId != nil || skippedCreate }

    var body: some View {
        List {
            analyzeSection
            if showConfirmStep {
                confirmSection
            }
            if showConfigStep {
                configSection
            }
            if let startMessage {
                Section {
                    Label(startMessage, systemImage: "checkmark.circle.fill")
                        .font(.subheadline)
                        .foregroundStyle(AppTheme.success)
                }
            }
        }
        .scrollContentBackground(.hidden)
        .pageBackground()
        .navigationTitle("爬虫抓取中心")
        .navigationBarTitleDisplayMode(.large)
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

    // MARK: - ① 智能分析

    private var analyzeSection: some View {
        Section("① 智能分析") {
            TextField("粘贴小说目录页网址", text: $sourceUrl)
                .keyboardType(.URL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            Button {
                Task { await analyze() }
            } label: {
                if analyzing {
                    HStack {
                        Spacer()
                        ProgressView()
                        Spacer()
                    }
                } else {
                    Label("开始分析", systemImage: "wand.and.stars")
                }
            }
            .disabled(analyzing || sourceUrl.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

            if let analyzeError {
                Text(analyzeError)
                    .font(.caption)
                    .foregroundStyle(AppTheme.danger)
            }
            if let meta {
                LabeledContent("站点", value: meta.site?.name ?? "通用站点")
                LabeledContent("章节数", value: meta.chapterCount.map { "\($0) 章" } ?? "—")
                LabeledContent("编码", value: meta.encoding?.isEmpty == false ? meta.encoding! : "utf-8")
                LabeledContent("目录页") {
                    Text(meta.chapterListUrl ?? sourceUrl)
                        .font(.caption)
                        .foregroundStyle(AppTheme.textSecondary)
                        .lineLimit(1)
                }
            }
        }
    }

    // MARK: - ② 确认小说

    private var confirmSection: some View {
        Section("② 确认小说") {
            TextField("书名 *", text: $title)
            TextField("作者 *", text: $author)
            Picker("状态", selection: $status) {
                Text("连载").tag("ongoing")
                Text("完结").tag("completed")
            }
            .pickerStyle(.menu)
            TextField("分类（逗号分隔）", text: $categories)
            TextField("封面 URL", text: $coverUrl)
            TextField("简介", text: $descriptionText, axis: .vertical)
                .lineLimit(2...4)
            Button {
                Task { await confirmNovel() }
            } label: {
                if creating {
                    HStack {
                        Spacer()
                        ProgressView()
                        Spacer()
                    }
                } else {
                    Label("创建小说并继续", systemImage: "plus.circle")
                }
            }
            .disabled(creating)
            Button("跳过创建，直接配置") {
                skippedCreate = true
            }
            .font(.subheadline)
        }
    }

    // MARK: - ③ 抓取配置

    private var configSection: some View {
        Section("③ 抓取配置") {
            TextField("章节列表页 URL", text: $chapterListUrl)
                .keyboardType(.URL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            TextField("编码（如 gbk / utf-8，留空自动）", text: $encoding)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            TextField("章节列表选择器", text: $chapterListSelector)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            TextField("章节标题选择器（可空）", text: $chapterTitleSelector)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            TextField("章节正文选择器", text: $chapterContentSelector)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            TextField("翻页选择器（可空）", text: $nextPageSelector)
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
                    Label("测试选择器", systemImage: "checkmark.seal")
                }
            }
            .disabled(testing)

            if let testResult {
                testChecksSection(result: testResult)
            }
            if let testError {
                Text(testError)
                    .font(.caption)
                    .foregroundStyle(AppTheme.danger)
            }

            Button {
                showStartConfirm = true
            } label: {
                if starting {
                    HStack {
                        Spacer()
                        ProgressView()
                        Spacer()
                    }
                } else {
                    Label("开始抓取", systemImage: "play.fill")
                }
            }
            .disabled(starting || createdNovelId == nil)
            if createdNovelId == nil {
                Text("需先创建小说后才能开始抓取。")
                    .font(.caption)
                    .foregroundStyle(AppTheme.textMuted)
            }
        }
    }

    private func testChecksSection(result: ScrapeTestResponse) -> some View {
        Group {
            if let links = result.links, !links.isEmpty {
                let diag = result.diagnostics
                let samples = result.sampleChapters ?? []
                let sampleOk = samples.filter { $0.ok == true }.count
                LabeledContent("章节链接") {
                    Text("\(links.count) 个")
                        .foregroundStyle(AppTheme.success)
                }
                LabeledContent("重复链接") {
                    Text("\(diag?.duplicateCount ?? 0) 个")
                        .foregroundStyle((diag?.duplicateCount ?? 0) > 0 ? AppTheme.danger : AppTheme.success)
                }
                LabeledContent("空标题") {
                    Text("\(diag?.emptyTitleCount ?? 0) 个")
                        .foregroundStyle((diag?.emptyTitleCount ?? 0) > 0 ? AppTheme.danger : AppTheme.success)
                }
                LabeledContent("样章内容") {
                    Text("\(sampleOk)/\(samples.count) 可读")
                        .foregroundStyle(sampleOk > 0 ? AppTheme.success : AppTheme.danger)
                }
            } else {
                LabeledContent("测试结果") {
                    Text(result.error ?? "未识别到章节链接")
                        .foregroundStyle(AppTheme.danger)
                }
            }
        }
    }

    // MARK: - 数据

    private func analyze() async {
        let s = sourceUrl.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !s.isEmpty else { return }
        analyzing = true
        defer { analyzing = false }
        do {
            let result = try await AdminAPI.scrapeDetectMeta(sourceUrl: s)
            meta = result
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
            skippedCreate = false
            createdNovelId = nil
            testResult = nil
            testError = nil
            startMessage = nil
        } catch {
            analyzeError = AppCopy.friendlyError(error)
        }
    }

    private func confirmNovel() async {
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
            startMessage = nil
        } catch {
            actionError = AppCopy.friendlyError(error)
        }
    }

    private func test() async {
        let src = chapterListUrl.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !src.isEmpty, !chapterListSelector.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            actionError = "请填写章节列表页 URL 和章节列表选择器"
            return
        }
        testing = true
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
        defer { starting = false }
        do {
            _ = try await AdminAPI.scrapeStart(
                novelId: novelId,
                sourceUrl: chapterListUrl.trimmingCharacters(in: .whitespacesAndNewlines),
                encoding: encoding,
                selectors: currentSelectors
            )
            startMessage = "抓取任务已启动，可在「任务管理」查看进度。"
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
