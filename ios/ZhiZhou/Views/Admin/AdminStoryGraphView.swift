import SwiftUI
import ZhiZhouCore

struct AdminStoryGraphView: View {
    let novelID: String
    let novelTitle: String
    var afterChapterID: String? = nil
    @Environment(AppState.self) private var appState

    private struct Scope: Hashable {
        let novelID: String
        let anchor: String?
        let account: UUID
        let server: URL?
    }

    var body: some View {
        Group {
            if appState.user?.isAdmin == true {
                StoryGraphWorkspace(novelID: novelID, novelTitle: novelTitle, anchor: afterChapterID)
                    .id(Scope(novelID: novelID, anchor: afterChapterID, account: ContentAccessStore.shared.accountRevision,
                              server: ServerConfig.shared.baseURL))
            } else {
                ContentUnavailableView("需要管理员权限", systemImage: "lock.shield")
            }
        }
        .background(ReadingSpace.profilePaper)
        .readingSpaceNavigation()
    }
}

enum StoryGraphSelection: Identifiable {
    case person(String), relationship(String), thread(String)
    var id: String {
        switch self {
        case .person(let id): return "person:" + id
        case .relationship(let id): return "relationship:" + id
        case .thread(let id): return "thread:" + id
        }
    }
}

private struct StoryGraphWorkspace: View {
    let novelID: String
    let novelTitle: String
    let anchor: String?
    @State private var model = AdminStoryGraphModel()
    @State private var query = ""
    @State private var focus: Set<String> = []
    @State private var selection: StoryGraphSelection?
    @State private var selectedRelationshipID: String?
    @State private var selectedThreadID: String?
    @State private var showThreads = false
    @State private var tab = "人物"
    @FocusState private var searching: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        AdminWorkspaceList {
            AdminWorkspaceHeading("故事星图", detail: model.response?.novel.title ?? novelTitle)
            if let response = model.response {
                VStack(alignment: .leading, spacing: 4) {
                    Text(response.anchor.map { "截至第 \($0.ordinal) 章 · \($0.title)" } ?? "暂无可用的章节范围")
                    if response.updatedAt > 0 { Text("上次生成 · " + AdminFormat.dateTime(response.updatedAt)) }
                }
                .font(.footnote)
                .foregroundStyle(ReadingSpace.profileMuted)
                .textSelection(.enabled)
            }
            if model.generating {
                ProgressView(model.progress).accessibilityIdentifier("storyGraph.progress")
            } else if model.busy && model.response == nil { ProgressView("读取故事星图…") }
            if let error = model.error {
                LoadErrorNotice(message: error, isLoading: model.busy) { Task { await refresh() } }
            }
            if let response = model.response {
                if let graph = response.readyGraph {
                    mapSection(graph)
                    Picker("探索星图", selection: $tab) {
                        ForEach(["人物", "关系", "线索", "报告"], id: \.self) { Text($0).tag($0) }
                    }
                    .accessibleSegmentedPicker()
                    .accessibilityIdentifier("storyGraph.tabs")
                    indexSection(graph, response: response)
                } else {
                    ContentUnavailableView {
                        Label(response.status == "ready" ? "暂不支持这份星图" : response.status == "outdated" ? "星图需要更新" : "从一个名字开始", systemImage: "point.3.connected.trianglepath.dotted")
                    } description: {
                        Text(response.status == "ready" ? "星图格式已更新，请更新客户端后重试；当前仍可查看文字报告。" : response.status == "outdated" ? "正文、报告或章节范围已变化。重新生成后再展开人物关系。" :
                             "用当前章节范围内的分析报告，整理人物、关系与还未解开的线索。")
                    }
                    if response.status != "ready" && !response.canGenerate {
                        AccountSettingsNote("当前范围没有可用的关系或情节报告，请先在小说分析中生成或更新报告。")
                    }
                    reportSection(response)
                }
                if response.readyGraph == nil { generationSection(response) }
            }
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("刷新星图", systemImage: "arrow.clockwise") { Task { await refresh() } }
                    .labelStyle(.iconOnly)
                    .disabled(model.busy)
                    .accessibilityIdentifier("storyGraph.refresh")
            }
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("完成") { searching = false }
            }
        }
        .refreshable { await refresh() }
        .task { await refresh() }
        .onDisappear { model.cancel() }
        .onChange(of: model.response) { _, response in
            selection = nil
            selectedRelationshipID = nil
            selectedThreadID = nil
            focus = []
            if response?.readyGraph == nil { query = "" }
        }
        .sheet(item: $selection) { item in
            if let response = model.response, let graph = response.readyGraph {
                NavigationStack {
                    StoryGraphDetailView(selection: item, graph: graph, response: response) { select($0, graph: graph) }
                        .toolbar {
                            ToolbarItem(placement: .confirmationAction) { Button("完成") { selection = nil } }
                        }
                }
            }
        }
        .transaction { if reduceMotion { $0.animation = nil } }
    }

    private func refresh() async { await model.refresh(novelID: novelID, anchor: anchor) }

    @ViewBuilder private func mapSection(_ graph: StoryGraph) -> some View {
        let visible = graph.visiblePeople(query: query, focus: focus)
        AccountSettingsField("寻找人物", isFocused: searching) {
            HStack {
                Image(systemName: "magnifyingglass").foregroundStyle(ReadingSpace.profileMuted)
                TextField("姓名或别名", text: $query)
                    .focused($searching)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                    .submitLabel(.search)
                    .onSubmit { searching = false }
                    .accessibilityIdentifier("storyGraph.search")
                if !query.isEmpty {
                    Button("清除搜索", systemImage: "xmark.circle.fill") { query = "" }
                        .labelStyle(.iconOnly)
                        .frame(minWidth: 48, minHeight: 48)
                }
            }
        }
        if !focus.isEmpty || !query.isEmpty {
            Button("回到全景", systemImage: "arrow.uturn.backward") {
                query = ""; focus = []; selectedRelationshipID = nil; selectedThreadID = nil; searching = false
            }
            .frame(minHeight: 48, alignment: .leading)
        }
        if !graph.threads.isEmpty && !dynamicTypeSize.isAccessibilitySize {
            Toggle("显示情节线索", isOn: $showThreads)
                .frame(minHeight: 48)
                .accessibilityIdentifier("storyGraph.showThreads")
        }
        if visible.isEmpty && (!showThreads || graph.threads.isEmpty || !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) {
            AccountSettingsNote(graph.people.isEmpty ? "当前报告尚无人物节点，可以查看下方线索与报告。" : "没有找到这个名字，试试别名或清除搜索。")
        } else if !dynamicTypeSize.isAccessibilitySize {
            let ids = Set(visible.map(\.id))
            let all = focus.isEmpty && query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            let threads = showThreads ? graph.threads.filter {
                all || $0.id == selectedThreadID || !$0.people.filter { ids.contains($0) }.isEmpty
            } : []
            StoryGraphCanvas(graph: graph, people: visible, threads: threads, focus: focus,
                             selectedRelationshipID: selectedRelationshipID, selectedThreadID: selectedThreadID,
                             onSelect: { select(.person($0.id), graph: graph) },
                             onSelectThread: { select(.thread($0.id), graph: graph) })
            AccountSettingsNote("拖动画布，双指缩放。箭头表示关系方向，虚线关系尚非确认事实；线索点线仅表示涉及人物。完整分类可在详情中核对。")
        } else {
            AccountSettingsNote("大字体模式以人物与关系列表展开星图，全部线索和来源仍可查看。")
        }
        Text("\(visible.count) / \(graph.people.count) 位人物 · \(graph.relationships.count) 条关系 · \(graph.threads.count) 条线索")
            .font(.caption)
            .foregroundStyle(ReadingSpace.profileMuted)
    }

    @ViewBuilder private func indexSection(_ graph: StoryGraph, response: StoryGraphResponse) -> some View {
        let visible = graph.visiblePeople(query: query, focus: focus)
        let ids = Set(visible.map(\.id))
        switch tab {
        case "人物":
            let people = query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? visible : graph.matchingPeople(query)
            if people.isEmpty { AccountSettingsNote("当前范围没有人物条目。") }
            ForEach(Array(people.enumerated()), id: \.element.id) { index, person in
                Button { select(.person(person.id), graph: graph) } label: {
                    StoryGraphIndexRow(title: person.name, detail: person.summary,
                                       annotation: person.aliases.isEmpty ? nil : person.aliases.joined(separator: "、"))
                }
                .buttonStyle(.plain)
                .readingSpaceEntrance(index)
            }
        case "关系":
            let edges = graph.relationships.filter { ids.contains($0.from) && ids.contains($0.to) }
            if edges.isEmpty { AccountSettingsNote("当前范围没有人物关系。") }
            ForEach(Array(edges.enumerated()), id: \.element.id) { index, edge in
                Button { select(.relationship(edge.id), graph: graph) } label: {
                    StoryGraphIndexRow(title: StoryGraphCopy.people(edge, graph: graph), detail: edge.label,
                                       annotation: StoryGraphCopy.certainty(edge.certainty))
                }
                .buttonStyle(.plain)
                .readingSpaceEntrance(index)
            }
        case "线索":
            let all = focus.isEmpty && query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            let threads = graph.threads.filter { all || !$0.people.filter { ids.contains($0) }.isEmpty }
            if threads.isEmpty { AccountSettingsNote("当前范围没有相关线索。") }
            ForEach(Array(threads.enumerated()), id: \.element.id) { index, thread in
                Button { select(.thread(thread.id), graph: graph) } label: {
                    StoryGraphIndexRow(title: thread.title, detail: thread.summary,
                                       annotation: StoryGraphCopy.thread(thread.kind) + " · " + StoryGraphCopy.certainty(thread.certainty))
                }
                .buttonStyle(.plain)
                .readingSpaceEntrance(index)
            }
        default: reportSection(response)
        }
    }

    private func reportSection(_ response: StoryGraphResponse) -> some View {
        Group {
            AccountSettingsNote("这里是分析材料，可能包含推断。报告摘录不等同于章节原文。")
            ForEach(Array(response.archives.enumerated()), id: \.offset) { _, archive in
                DisclosureGroup {
                    Text("覆盖至第 \(archive.chaptersThrough) 章 · " + StoryGraphCopy.eligibility(archive.eligibility))
                        .font(.footnote).foregroundStyle(ReadingSpace.profileMuted)
                    if archive.content.isEmpty { AccountSettingsNote("尚无报告内容。") }
                    else { AgentMarkdownView(content: archive.content) }
                } label: {
                    Text(archive.kind == "relationship" ? "关系分析报告" : "情节分析报告")
                        .font(serifFont(.headline, .medium))
                        .frame(minHeight: 48)
                }
            }
            if let url = analysisURL {
                Link("阅读与修订分析报告", destination: url).frame(minHeight: 48, alignment: .leading)
            }
        }
    }

    private func generationSection(_ response: StoryGraphResponse) -> some View {
        AdminWorkspaceSection("整理星图") {
            AccountSettingsNote("生成会调用模型并计入使用量。打开页面和刷新只读取已保存的结果。")
            Button(response.status == "outdated" ? "更新故事星图" : "生成故事星图", systemImage: "sparkles") {
                searching = false
                model.generate(novelID: novelID, anchor: anchor)
            }
            .buttonStyle(AgentPanelButtonStyle(prominent: true))
            .disabled(model.busy || !response.canGenerate)
            .accessibilityIdentifier("storyGraph.generate")
        }
    }

    private var analysisURL: URL? {
        guard let base = ServerConfig.shared.baseURL else { return nil }
        var url = URLComponents(url: base.appendingPathComponent("admin/ai"), resolvingAgainstBaseURL: false)
        url?.queryItems = [URLQueryItem(name: "sub", value: "writing"), URLQueryItem(name: "view", value: "analysis"),
                           URLQueryItem(name: "novel", value: novelID)]
        if let anchor, !anchor.isEmpty { url?.queryItems?.append(URLQueryItem(name: "afterChapterId", value: anchor)) }
        return url?.url
    }

    private func select(_ item: StoryGraphSelection, graph: StoryGraph) {
        searching = false
        query = ""
        selectedRelationshipID = nil
        selectedThreadID = nil
        switch item {
        case .person(let id): focus = [id]
        case .relationship(let id):
            if let edge = graph.relationships.first(where: { $0.id == id }) { focus = [edge.from, edge.to] }
            selectedRelationshipID = id
        case .thread(let id):
            showThreads = true
            selectedThreadID = id
            focus = Set(graph.threads.first(where: { $0.id == id })?.people ?? [])
        }
        selection = item
    }
}

struct StoryGraphIndexRow: View {
    let title: String
    let detail: String
    var annotation: String? = nil

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                Text(title).font(serifFont(.headline, .medium)).foregroundStyle(ReadingSpace.ink)
                if let annotation, !annotation.isEmpty {
                    Text(annotation).font(.caption).foregroundStyle(AppTheme.primary)
                }
                if !detail.isEmpty {
                    Text(detail).font(.subheadline).foregroundStyle(ReadingSpace.profileMuted).appTextLineLimit(3)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Image(systemName: "chevron.right").font(.caption).foregroundStyle(ReadingSpace.profileMuted).padding(.top, 6)
        }
        .padding(.vertical, 6)
        .frame(minHeight: 48)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

enum StoryGraphCopy {
    static func certainty(_ value: String) -> String {
        ["fact": "已确认事实", "belief": "人物认知", "clue": "未解线索", "possibility": "可选方向", "inference": "分析推断"][value] ?? "未标注"
    }
    static func thread(_ value: String) -> String {
        ["state": "角色状态", "conflict": "待解决冲突", "clue": "未解伏笔", "item": "关键物品", "place": "重要地点"][value] ?? "情节线索"
    }
    static func eligibility(_ value: String) -> String {
        ["usable": "可用", "missing": "尚未提取", "stale": "需要更新", "beyond_anchor": "晚于当前起点", "source_changed": "正文已变化",
         "legacy_unknown": "需要完整初始化", "rebuilding": "待重建"][value] ?? "暂不可用"
    }
    static func people(_ edge: StoryRelationship, graph: StoryGraph) -> String {
        let from = graph.people.first { $0.id == edge.from }?.name ?? "未知人物"
        let to = graph.people.first { $0.id == edge.to }?.name ?? "未知人物"
        return from + (edge.directed ? " → " : " ↔ ") + to
    }
}
