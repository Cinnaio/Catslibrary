import SwiftUI
import ZhiZhouCore

struct AgentWritingStudioView: View {
    let model: AdminAIAgentConversationModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var cards: [AIAgentWritingCard] = []
    @State private var omitted: [String] = []
    @State private var kind: AIAgentStudioKind = .scene
    @State private var query = ""
    @State private var selectedID = ""
    @State private var editor: AIAgentWritingCard?
    @State private var versions: [AIAgentWritingVersion]?
    @State private var instruction = ""
    @State private var assembling = false
    @State private var assemblyTitle = ""
    @State private var assemblyScenes: [AIAgentWritingCard] = []
    @State private var busy = false
    @State private var loading = false
    @State private var loaded = false
    @State private var active = false
    @State private var requestID = UUID()
    @State private var error: String?
    @State private var notice: String?
    @State private var removing: AIAgentWritingCard?
    @State private var discardEditing = false

    private var blocked: Bool { busy || loading || !loaded || !model.canChangeChapterPlan }
    private var scenes: [AIAgentWritingCard] { cards.filter { $0.kind == .scene && $0.status == "active" } }
    private var filtered: [AIAgentWritingCard] {
        cards.filter { $0.kind == kind && (query.isEmpty || ($0.title + $0.values.values.joined(separator: " ")).localizedCaseInsensitiveContains(query)) }
    }
    private var selected: AIAgentWritingCard? { filtered.first { $0.id == selectedID } ?? filtered.first }

    var body: some View {
        NavigationStack {
            AgentPanelPage {
                AgentPanelHeading("写作工坊", detail: "把一场戏写细，让人物和写法逐渐成形。助手建议经采纳后才参与后续写作。")
                if let error { AgentPanelNotice(error, isError: true) }
                if let notice { AgentPanelNotice(notice) }
                if loading { ProgressView("读取写作资料…") }
                if !omitted.isEmpty { AgentPanelNotice("暂未带入写作：" + omitted.joined(separator: "、") + "。请重新核对来源或移除不再使用的资料。") }
                if editor != nil { editorPage }
                else if assembling { assemblyPage }
                else { libraryPage }
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    if editor != nil { Button("取消编辑") { discardEditing = true }.disabled(busy) }
                    else if assembling { Button("返回") { assembling = false }.disabled(busy) }
                    else { Button("关闭") { dismiss() }.disabled(busy) }
                }
                ToolbarItem(placement: .primaryAction) { Button("刷新", systemImage: "arrow.clockwise") { Task { await load() } }.disabled(busy || loading) }
            }
            .interactiveDismissDisabled(busy || editor != nil)
            .task { active = true; await load() }
            .onDisappear { active = false; requestID = UUID() }
            .confirmationDialog("放弃这次编辑？", isPresented: $discardEditing, titleVisibility: .visible) {
                Button("放弃编辑", role: .destructive) { editor = nil }
                Button("继续编辑", role: .cancel) {}
            }
            .confirmationDialog("移除这项资料？", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible, presenting: removing) { card in
                Button(card.status == "proposed" ? "不采纳这项建议" : "移除资料", role: .destructive) { Task { await change(card, "archive") } }
                Button("取消", role: .cancel) {}
            }
        }
    }
    private var libraryPage: some View {
        VStack(alignment: .leading, spacing: 24) {
            AgentPanelField("分类") {
                Picker("分类", selection: $kind) { ForEach(AIAgentStudioKind.allCases) { Text($0.title).tag($0) } }.pickerStyle(.menu)
            }
            .disabled(busy)
            .onChange(of: kind) { _, _ in selectedID = ""; query = ""; versions = nil; notice = nil }
            AgentPanelNotice(kind.detail)
            AgentPanelField("搜索资料") { TextField("标题或内容", text: $query) }
            AppAdaptiveRow(spacing: 12) {
                if kind != .reading {
                    Button("手动添加", systemImage: "plus") { editor = .blank(kind, position: kind == .scene ? min(9999, (scenes.map(\.position).max() ?? -1) + 1) : 0) }.disabled(blocked)
                }
                if kind == .scene && !scenes.isEmpty {
                    Button("合成章节") { assemblyTitle = ""; assemblyScenes = scenes; assembling = true }.disabled(blocked)
                }
            }.buttonStyle(AgentPanelButtonStyle())
            ForEach(Array(filtered.enumerated()), id: \.element.id) { index, card in
                Button {
                    selectedID = card.id; versions = nil
                } label: {
                    HStack(alignment: .top, spacing: 12) {
                        VStack(alignment: .leading, spacing: 6) {
                            Text(card.title).font(.body.weight(.medium))
                            Text(card.statusLabel + (card.stale == true ? " · 来源已变化" : "")).font(.caption).foregroundStyle(ReadingSpace.profileMuted)
                        }
                        Spacer(minLength: 0)
                        if selected?.id == card.id { Image(systemName: "checkmark").accessibilityHidden(true) }
                    }.frame(maxWidth: .infinity, minHeight: 44, alignment: .leading).contentShape(Rectangle())
                }
                .buttonStyle(.plain).foregroundStyle(ReadingSpace.ink).disabled(busy)
                .accessibilityAddTraits(selected?.id == card.id ? .isSelected : [])
                .readingSpaceEntrance(index)
            }
            .animation(reduceMotion ? nil : .easeOut(duration: 0.16), value: query)
            if let selected { detail(selected) }
            else if loaded { AgentPanelNotice(query.isEmpty ? "还没有这类资料。可填写要求，让助手查阅并整理建议。" : "没有匹配的资料。") }
            requestForm
        }
    }
    @ViewBuilder private func detail(_ card: AIAgentWritingCard) -> some View {
        AgentPanelSection(card.title) {
            Text("\(card.statusLabel) · 第 \(card.revision) 版 · \(card.scope == "personal" ? "个人资料" : card.scope == "book" ? "本书资料" : "本次对话")")
                .font(.caption).foregroundStyle(ReadingSpace.profileMuted)
            if card.stale == true { AgentPanelNotice("来源或版本已变化，请重新核对。这项资料暂不用于后续写作。") }
            if let replacement = card.replaces, let previous = cards.first(where: { $0.id == replacement.id }) {
                DisclosureGroup("对照当前保存的版本") { cardText(previous) }
            }
            cardText(card)
            if !card.evidence.isEmpty {
                DisclosureGroup("来源引文（\(card.evidence.count)）") {
                    VStack(alignment: .leading, spacing: 18) {
                        ForEach(Array(card.evidence.enumerated()), id: \.offset) { _, evidence in
                            VStack(alignment: .leading, spacing: 8) {
                                if let before = evidence.beforeQuote { AgentPanelFact(title: "修改前", value: before) }
                                AgentPanelFact(title: evidence.kind == "edit" ? "采纳后" : "来源原句", value: evidence.quote)
                            }
                        }
                    }.padding(.top, 12)
                }
            }
            AppAdaptiveRow(spacing: 12) {
                if card.status == "proposed" {
                    Button("采纳建议") { Task { await change(card, "accept") } }.disabled(blocked || card.stale == true)
                }
                Button("编辑") { editor = card; versions = nil }.disabled(blocked || card.locked)
                if card.kind == .scene && card.status == "active" {
                    Button(card.locked ? "解锁场景" : "锁定场景") { Task { await change(card, card.locked ? "unlock" : "lock") } }.disabled(blocked)
                }
            }.buttonStyle(AgentPanelButtonStyle())
            AppAdaptiveRow(spacing: 12) {
                Button("历史版本") { Task { await history(card) } }.disabled(blocked)
                Button(card.status == "proposed" ? "不采纳" : "移除") { removing = card }.disabled(blocked || card.locked)
            }.buttonStyle(AgentPanelButtonStyle())
            if let versions {
                ForEach(versions) { version in
                    DisclosureGroup("第 \(version.revision) 版" + (version.revision == card.revision ? " · 当前版本" : "")) {
                        VStack(alignment: .leading, spacing: 16) {
                            cardText(version.card)
                            if version.revision != card.revision && version.card.status != "archived" {
                                Button("恢复这一版内容") { Task { await change(card, "restore", version: version.revision) } }.buttonStyle(AgentPanelButtonStyle()).disabled(blocked || card.locked)
                            }
                        }.padding(.top, 12)
                    }
                }
            }
        }
    }
    private func cardText(_ card: AIAgentWritingCard) -> some View {
        VStack(alignment: .leading, spacing: 18) {
            ForEach(card.kind.fields) { field in
                if let value = card.values[field.id], !value.isEmpty { AgentPanelFact(title: field.title, value: value) }
            }
        }.padding(.vertical, 8)
    }
    private var requestForm: some View {
        AgentPanelSection("这次想怎么写") {
            AgentPanelField("补充要求") { TextField("指定人物、章节、场景或改稿方向", text: $instruction, axis: .vertical).lineLimit(3...8) }
            AgentPanelNotice("带到对话后可继续补充，发送时才调用模型。")
            Button("带到对话中整理") { prepare() }.buttonStyle(AgentPanelButtonStyle()).disabled(blocked || instruction.utf16.count > 3000)
            if let selected, selected.kind == .scene && !selected.locked && selected.status == "active" {
                Button("请助手写这一场") { prepare("请明确开始写这一场，保留其他场景。把完整正文写入 values.prose，并作为替换本场景的待采纳建议。") }.buttonStyle(AgentPanelButtonStyle(prominent: true)).disabled(blocked || instruction.utf16.count > 3000)
            }
            if kind == .scene && scenes.contains(where: { !($0.values["prose"] ?? "").isEmpty }) {
                Button("检查场景衔接") { prepare("请逐一读取已保存场景的正文，按顺序检查视角、时间、情绪和动作衔接。逐项保存 reading 模拟试读建议，附真实原句，暂不改写。") }.buttonStyle(AgentPanelButtonStyle()).disabled(blocked || instruction.utf16.count > 3000)
            }
            if let selected, selected.kind == .voice {
                Button("检查草稿人物口吻") { prepare("请进一步检查指定草稿中这个人物的台词，对照原对白与说话档案，逐项保存 reading 意见，引用待改句与原对白，给出两种可选说法，不直接覆盖草稿。") }.buttonStyle(AgentPanelButtonStyle()).disabled(blocked || selected.stale == true || instruction.utf16.count > 3000)
            }
            if let selected, selected.kind == .reading {
                Button("讨论如何修改") { prepare("请结合这项试读意见，读取来源，使用现有改写工具给出局部修改建议，等待我采纳。") }.buttonStyle(AgentPanelButtonStyle()).disabled(blocked || selected.stale == true || instruction.utf16.count > 3000)
            }
        }
    }
    private var editorPage: some View {
        VStack(alignment: .leading, spacing: 24) {
            AgentPanelField("标题") { TextField("给这项资料取个名字", text: Binding(get: { editor?.title ?? "" }, set: { editor?.title = $0 })) }
            if let item = editor {
                if item.kind == .preference {
                    AgentPanelField("使用范围") { Picker("使用范围", selection: Binding(get: { editor?.scope ?? "book" }, set: { editor?.scope = $0 })) {
                        Text("仅本书").tag("book"); Text("我的所有作品").tag("personal")
                    }.pickerStyle(.menu).disabled(item.replaces != nil) }
                }
                if item.kind == .scene {
                    AgentPanelField("场景顺序") { TextField("顺序", value: Binding(get: { editor?.position ?? 0 }, set: { editor?.position = $0 }), format: .number).keyboardType(.numberPad) }
                }
                ForEach(item.kind.fields) { field in
                    AgentPanelField(field.title + (field.required ? "（必填）" : "")) {
                        if field.options.isEmpty { TextField(field.title, text: valueBinding(field.id), axis: .vertical).lineLimit(field.id == "prose" ? 8...24 : 2...10) }
                        else { Picker(field.title, selection: valueBinding(field.id)) { ForEach(field.options, id: \.self) { Text($0).tag($0) } }.pickerStyle(.menu) }
                    }
                    if (item.values[field.id] ?? "").utf16.count > field.limit { AgentPanelNotice("\(field.title)最多 \(field.limit) 字。", isError: true) }
                }
                if item.stale == true { AgentPanelNotice("来源已变化。请保留手写内容，再让助手重新核对；旧建议不能直接采纳。") }
                Button("保存") { Task { await save(item) } }.buttonStyle(AgentPanelButtonStyle(prominent: true)).disabled(blocked || !item.isValid)
            }
        }.disabled(busy || !model.canChangeChapterPlan)
    }
    private var assemblyPage: some View {
        AgentPanelSection("合成草稿预览") {
            AgentPanelField("章节标题") { TextField("章节标题", text: $assemblyTitle) }
            AgentPanelNotice("勾选的场景按当前顺序合成，正文之间保留空行。合成后可在「产出与采纳」中审阅。")
            ForEach(scenes) { scene in
                Toggle(scene.title + ((scene.values["prose"] ?? "").isEmpty ? " · 尚无正文" : ""), isOn: Binding(
                    get: { assemblyScenes.contains { $0.id == scene.id } },
                    set: { checked in
                        if checked { assemblyScenes = scenes.filter { candidate in candidate.id == scene.id || assemblyScenes.contains(where: { $0.id == candidate.id }) } }
                        else { assemblyScenes.removeAll { $0.id == scene.id } }
                    })).tint(AppTheme.primary).disabled(blocked)
            }
            DisclosureGroup("查看合成正文") { Text(assemblyScenes.map { $0.values["prose"] ?? "" }.joined(separator: "\n\n")).textSelection(.enabled).lineSpacing(5).padding(.top, 12) }
            Button("确认合成草稿") { Task { await assemble() } }.buttonStyle(AgentPanelButtonStyle(prominent: true))
                .disabled(blocked || assemblyTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || assemblyTitle.utf16.count > 160 || assemblyScenes.isEmpty || assemblyScenes.contains { ($0.values["prose"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty })
        }
    }
    private func valueBinding(_ key: String) -> Binding<String> {
        Binding(get: { editor?.values[key] ?? "" }, set: { editor?.values[key] = $0 })
    }
    private func prepare(_ extra: String = "") {
        guard !blocked else { return }
        let target = selected.map { "本次针对《\($0.title)》（cardId=\($0.id)，revision=\($0.revision)）。\n" } ?? ""
        let prompt = "【写作工坊 · \(kind.title)】\n请先 read_writing_studio；\(kind.prompt)用 propose_writing_card 保存待采纳建议。\n\(target)\(instruction)\n\(extra)"
        let previous = model.localDraft.input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard (previous + prompt).utf16.count <= 7900 else { error = "对话输入较长，请先处理已有文字。"; return }
        model.localDraft.input = previous.isEmpty ? prompt : previous + "\n\n" + prompt
        dismiss()
    }
    @MainActor private func load() async {
        guard model.isCurrentAccount, active else { return }
        let request = UUID(); requestID = request; loading = true
        defer { if requestID == request { loading = false } }
        do {
            let result = try await model.api.writingStudio(model.session.id)
            guard active, model.isCurrentAccount, requestID == request, !Task.isCancelled else { return }
            cards = result.cards; omitted = result.contextOmitted; loaded = true
        } catch { if active && model.isCurrentAccount && requestID == request { self.error = error.localizedDescription } }
    }
    @MainActor private func perform(_ action: () async throws -> Void) async {
        guard !blocked, active else { return }
        busy = true; error = nil; notice = nil
        defer { busy = false }
        do { try await action(); guard active, model.isCurrentAccount else { return }; await load(); await model.refresh() }
        catch { if active && model.isCurrentAccount { self.error = error.localizedDescription } }
    }
    @MainActor private func save(_ card: AIAgentWritingCard) async {
        await perform {
            let result = try await model.api.saveWritingCard(model.session.id, card: card)
            guard active, model.isCurrentAccount else { return }
            editor = nil; selectedID = result.id; notice = result.status == "proposed" ? "已保存建议，核对后可采纳。" : "已保存写作资料。"
        }
    }
    @MainActor private func change(_ card: AIAgentWritingCard, _ operation: String, version: Int? = nil) async {
        await perform {
            let result = try await model.api.changeWritingCard(model.session.id, card: card, operation: operation, version: version)
            guard active, model.isCurrentAccount else { return }
            selectedID = result.id; versions = nil; removing = nil; notice = operation == "accept" ? "已采纳。" : "已保存这次调整。"
        }
    }
    @MainActor private func history(_ card: AIAgentWritingCard) async {
        await perform {
            let result = try await model.api.writingCardVersions(model.session.id, cardID: card.id)
            guard active, model.isCurrentAccount else { return }; versions = result
        }
    }
    @MainActor private func assemble() async {
        await perform {
            try await model.api.assembleWritingScenes(model.session.id, title: assemblyTitle, scenes: assemblyScenes)
            guard active, model.isCurrentAccount else { return }
            assembling = false; notice = "草稿已合成，请在「产出与采纳」中查看。"
        }
    }
}
