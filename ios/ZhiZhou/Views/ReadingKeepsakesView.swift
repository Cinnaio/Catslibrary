import SwiftUI

private struct KeepsakeMoment: Decodable, Identifiable {
    let id: String
    let chapterTitle: String
    let selectedText: String
    let thoughtText: String
}

private struct ReadingKeepsake: Decodable, Identifiable {
    let id: String
    let novelId: String
    let title: String
    let author: String
    let coverUrl: String
    let startedAt: Double?
    let savedAt: Double
    let closing: String
    let moments: [KeepsakeMoment]

    var exportText: String {
        var lines = ["合上书以后", "《\(title)》" + (author.isEmpty ? "" : " · \(author)")]
        if let startedAt { lines.append("阅读记录起于 \(keepsakeDate(startedAt))") }
        lines.append("留于 \(keepsakeDate(savedAt))")
        for moment in moments {
            lines.append("")
            if !moment.selectedText.isEmpty { lines.append("“\(moment.selectedText)”") }
            lines.append("—— \(moment.chapterTitle)")
            lines.append(moment.thoughtText)
        }
        if !closing.isEmpty { lines += ["", "这本书留给我的是……", closing] }
        return lines.joined(separator: "\n")
    }
}

private struct KeepsakeContext: Decodable {
    struct Book: Decodable { let title: String; let author: String; let coverUrl: String }
    let novel: Book
    let latestId: String?
    let startedAt: Double?
    let candidates: [KeepsakeMoment]
    let candidatesLimited: Bool
}
private struct KeepsakePage: Decodable { let items: [ReadingKeepsake]; let nextCursor: String? }
private struct SavedKeepsake: Decodable { let item: ReadingKeepsake }
private struct KeepsakeInput: Encodable {
    let id: String
    let previousId: String?
    let momentIds: [String]
    let closing: String
    enum CodingKeys: String, CodingKey { case id, previousId, momentIds, closing }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        if let previousId { try c.encode(previousId, forKey: .previousId) }
        else { try c.encodeNil(forKey: .previousId) }
        try c.encode(momentIds, forKey: .momentIds)
        try c.encode(closing, forKey: .closing)
    }
}

private func keepsakeDate(_ milliseconds: Double) -> String {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "zh_CN")
    formatter.timeZone = TimeZone(identifier: "Asia/Shanghai")
    formatter.dateFormat = "yyyy年M月d日"
    return formatter.string(from: Date(timeIntervalSince1970: milliseconds / 1000))
}

struct ReadingKeepsakesView: View {
    let novelId: String
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var context: KeepsakeContext?
    @State private var items: [ReadingKeepsake] = []
    @State private var cursor: String?
    @State private var selected: ReadingKeepsake?
    @State private var draft = false
    @State private var closing = ""
    @State private var selectedIds: [String] = []
    @State private var pending: KeepsakeInput?
    @State private var busy = false
    @State private var error: String?
    @State private var unavailable = false
    @State private var confirmDelete = false
    @State private var generation = UUID()
    @State private var loadedRevision: UUID?
    @State private var requestTask: Task<Void, Never>?

    private var valid: Bool { loadedRevision == ContentAccessStore.shared.revision && appState.user != nil }
    private var preview: ReadingKeepsake? {
        guard valid else { return nil }
        if draft, let context {
            return ReadingKeepsake(id: "draft", novelId: novelId, title: context.novel.title,
                author: context.novel.author, coverUrl: context.novel.coverUrl, startedAt: context.startedAt,
                savedAt: Date().timeIntervalSince1970 * 1000, closing: closing.trimmingCharacters(in: .whitespacesAndNewlines),
                moments: selectedIds.compactMap { id in context.candidates.first { $0.id == id } })
        }
        return selected
    }

    var body: some View {
        NavigationStack {
            ReaderPanelPage {
                ReaderPanelHeading("合上书以后", detail: "为这次阅读，留一页余温。只有你能看到，日后还可以再留一张。")
                if busy { ProgressView("正在整理这一页…").font(.footnote) }
                if let error { ReaderPanelNote(error, color: AppTheme.danger) }
                if context == nil && !busy && !unavailable {
                    Button("重新打开") { requestTask = Task { await load() } }
                        .buttonStyle(ReaderPanelButtonStyle())
                }
                if valid && !unavailable {
                    if !draft {
                        HStack {
                            Button("再留一页") { requestTask = Task { await load(makeDraft: true) } }
                                .buttonStyle(ReaderPanelButtonStyle())
                                .disabled(busy)
                            if let selected {
                                ShareLink(item: selected.exportText) { Label("分享文字", systemImage: "square.and.arrow.up") }
                                    .buttonStyle(ReaderPanelButtonStyle())
                            }
                        }
                    }
                    if let preview { keepsakeCard(preview) }
                    if draft, let context { editor(context) }
                    if !draft && !items.isEmpty { history }
                }
            }
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("关闭") { dismiss() } } }
            .task { await load() }
            .onChange(of: ContentAccessStore.shared.revision) { _, _ in invalidate() }
            .onChange(of: appState.user?.id) { _, _ in invalidate() }
            .onDisappear { generation = UUID(); requestTask?.cancel() }
            .confirmationDialog("删除这张藏书票？原来的想法仍会保留，删除后无法恢复。", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("删除藏书票", role: .destructive) { requestTask = Task { await remove() } }
                Button("取消", role: .cancel) {}
            }
        }
        .presentationBackground(ReadingSpace.profilePaper)
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
    }

    private func keepsakeCard(_ item: ReadingKeepsake) -> some View {
        VStack(alignment: .leading, spacing: 22) {
            Text(draft ? "待留存 · 藏书票预览" : "我的藏书票")
                .font(.caption).tracking(2).foregroundStyle(AppTheme.primary)
            HStack(alignment: .center, spacing: 18) {
                CachedAsyncImage(url: APIClient.shared.coverURL(novelId: novelId, updatedAt: 0), targetSize: CGSize(width: 64, height: 90)) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    Image(systemName: "book.closed").font(.title).foregroundStyle(AppTheme.primary)
                }
                .frame(width: 64, height: 90).clipped().clipShape(RoundedRectangle(cornerRadius: 5))
                .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 8) {
                    Text(item.title).font(serifFont(.title2, .medium)).foregroundStyle(ReadingSpace.ink)
                    if !item.author.isEmpty { ReaderPanelNote(item.author) }
                }
            }
            VStack(alignment: .leading, spacing: 4) {
                if let start = item.startedAt { ReaderPanelNote("阅读记录起于 \(keepsakeDate(start))") }
                ReaderPanelNote("\(draft ? "准备留于" : "留于") \(keepsakeDate(item.savedAt))")
            }
            Divider().overlay(ReadingSpace.profileLine)
            ForEach(item.moments) { moment in
                VStack(alignment: .leading, spacing: 10) {
                    if !moment.selectedText.isEmpty { quote(moment.selectedText) }
                    ReaderPanelNote("—— \(moment.chapterTitle)")
                    Text(moment.thoughtText).font(.subheadline).lineSpacing(5).foregroundStyle(ReadingSpace.ink).textSelection(.enabled)
                }
            }
            if !item.closing.isEmpty {
                VStack(alignment: .leading, spacing: 12) {
                    Text("这本书留给我的是……").font(.caption).foregroundStyle(AppTheme.primary)
                    Text(item.closing).font(serifFont(.body)).lineSpacing(6).foregroundStyle(ReadingSpace.ink).textSelection(.enabled)
                }
            } else if item.moments.isEmpty {
                ReaderPanelNote("故事暂时停在这里。把还留在心里的那一句，写在下面。")
            }
        }
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(22)
        .background(ReadingSpace.profileFill, in: RoundedRectangle(cornerRadius: 18))
        .overlay { RoundedRectangle(cornerRadius: 18).strokeBorder(ReadingSpace.profileLine, lineWidth: 1) }
    }

    private func quote(_ text: String) -> some View {
        Text(text).font(serifFont(.body)).lineSpacing(6).textSelection(.enabled)
            .foregroundStyle(ReadingSpace.ink).frame(maxWidth: .infinity, alignment: .leading)
            .padding(.leading, 14)
            .overlay(alignment: .leading) { Rectangle().fill(ReadingSpace.profileLine).frame(width: 2) }
    }

    private func editor(_ context: KeepsakeContext) -> some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("这本书留给我的是……").font(.headline).foregroundStyle(ReadingSpace.ink)
            TextField("比如：原来有些告别，也是另一种陪伴。", text: $closing, axis: .vertical)
                .lineLimit(3...8).padding(14)
                .background(ReadingSpace.profileFill, in: RoundedRectangle(cornerRadius: 12))
                .disabled(busy || pending != nil)
                .accessibilityLabel("这本书留给我的是")
            ReaderPanelNote("\(closing.utf16.count) / 280 · 写一句话，或选择想法，就可以留存。")
            ReaderPanelSection("带走几句，也带走当时的自己") {
                ReaderPanelNote("从自己的想法中选至多三则，划选的原句会一同保存。已选 \(selectedIds.count) / 3。")
                if context.candidates.isEmpty { ReaderPanelNote("还没有留下想法，写下此刻的感受也很好。") }
                if context.candidatesLimited { ReaderPanelNote("这里列出最近的 50 则想法。") }
                ForEach(Array(context.candidates.enumerated()), id: \.element.id) { index, moment in
                    Toggle(isOn: Binding(get: { selectedIds.contains(moment.id) }, set: { checked in
                        if checked { selectedIds.append(moment.id) } else { selectedIds.removeAll { $0 == moment.id } }
                    })) {
                        VStack(alignment: .leading, spacing: 8) {
                            if !moment.selectedText.isEmpty { Text(moment.selectedText).font(serifFont(.subheadline)) }
                            Text(moment.thoughtText).font(.subheadline)
                            Text(moment.chapterTitle).font(.caption).foregroundStyle(ReadingSpace.profileMuted)
                        }
                        .foregroundStyle(ReadingSpace.ink).padding(.vertical, 10)
                    }
                    .disabled(busy || pending != nil || (!selectedIds.contains(moment.id) && selectedIds.count >= 3))
                    .modifier(KeepsakeRowEntrance(index: index))
                }
            }
            ReaderPanelNote("日期采用北京时间。有阅读记录时才显示起点；再次留页时，从上一张之后的记录算起。保存的文字不会随原想法修改。")
            Button(pending != nil ? "重试保存同一页" : "保存这页余温") { requestTask = Task { await save() } }
                .buttonStyle(ReaderPanelButtonStyle(prominent: true))
                .disabled(busy || closing.utf16.count > 280 || (closing.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && selectedIds.isEmpty))
            if pending != nil && !busy {
                ReaderPanelNote("重试会使用同一次保存。也可以关闭后重新打开，确认这张藏书票是否已存好。")
            }
            if !items.isEmpty {
                Button("返回已存藏书票") { draft = false; selected = items.first }
                    .buttonStyle(ReaderPanelButtonStyle()).disabled(busy || pending != nil)
            }
        }
    }

    private var history: some View {
        ReaderPanelSection("以前留下的余温") {
            ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                Button {
                    withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.18)) { selected = item }
                } label: {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(keepsakeDate(item.savedAt)).font(.caption)
                        Text(item.closing.isEmpty ? item.moments.first?.thoughtText ?? "留一页余温" : item.closing)
                            .font(.subheadline).lineLimit(2)
                    }.frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(ReaderPanelButtonStyle(prominent: selected?.id == item.id)).disabled(busy)
                .accessibilityAddTraits(selected?.id == item.id ? [.isSelected] : [])
                .modifier(KeepsakeRowEntrance(index: index))
            }
            if cursor != nil {
                Button("查看更早的藏书票") { requestTask = Task { await more() } }
                    .buttonStyle(ReaderPanelButtonStyle()).disabled(busy)
            }
            if selected != nil {
                Button("删除当前藏书票", role: .destructive) { confirmDelete = true }
                    .buttonStyle(ReaderPanelButtonStyle()).disabled(busy)
            }
        }
    }

    private enum Reply {
        case loaded(KeepsakeContext, KeepsakePage, Bool)
        case saved(ReadingKeepsake)
        case page(KeepsakePage)
        case removed(String)
    }

    @MainActor private func run(_ operation: (String) async throws -> Reply) async {
        guard !busy, let token = APIClient.shared.token else { return }
        let request = UUID(), revision = ContentAccessStore.shared.revision
        generation = request; busy = true; error = nil
        defer { if generation == request { busy = false } }
        do {
            let result = try await operation(token)
            guard !Task.isCancelled, generation == request, token == APIClient.shared.token,
                  revision == ContentAccessStore.shared.revision else { return }
            loadedRevision = revision
            switch result {
            case let .loaded(next, page, makeDraft):
                context = next; items = page.items; cursor = page.nextCursor; selected = makeDraft ? nil : page.items.first
                draft = makeDraft || page.items.isEmpty; closing = ""; selectedIds = []; pending = nil; unavailable = false
            case let .saved(item):
                items.removeAll { $0.id == item.id }; items.insert(item, at: 0); selected = item; draft = false; pending = nil
            case let .page(page):
                let existing = Set(items.map(\.id))
                items += page.items.filter { !existing.contains($0.id) }; cursor = page.nextCursor
            case let .removed(id):
                items.removeAll { $0.id == id }; selected = items.first
            }
        } catch {
            guard !Task.isCancelled, generation == request, token == APIClient.shared.token,
                  revision == ContentAccessStore.shared.revision else { return }
            self.error = AppCopy.friendlyError(error)
            var denied = error as? APIError == .unauthorized
            if case APIError.http(let code, _) = error { denied = [401, 403, 404].contains(code) }
            if denied { context = nil; items = []; selected = nil; closing = ""; selectedIds = []; pending = nil; unavailable = true }
        }
    }

    private func path(_ suffix: String = "") -> String {
        let id = novelId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(CharacterSet(charactersIn: "/?#%"))) ?? novelId
        return "/api/reading-keepsakes/\(id)\(suffix)?contentMode=\(ContentAccessStore.shared.mode)"
    }
    @MainActor private func load(makeDraft: Bool = false) async {
        await run { token in
            let context: KeepsakeContext = try await APIClient.shared.request("GET", path("/context"), auth: true, expectedToken: token)
            let page: KeepsakePage = try await APIClient.shared.request("GET", path(), auth: true, expectedToken: token)
            return .loaded(context, page, makeDraft)
        }
    }
    @MainActor private func save() async {
        guard !busy, let context else { return }
        let input = pending ?? KeepsakeInput(id: UUID().uuidString, previousId: context.latestId, momentIds: selectedIds, closing: closing)
        pending = input
        await run { token in
            let response: SavedKeepsake = try await APIClient.shared.request("POST", path(), body: APIClient.shared.jsonBody(input), auth: true, expectedToken: token)
            return .saved(response.item)
        }
    }
    @MainActor private func more() async {
        guard let cursor else { return }
        await run { token in
            let encoded = cursor.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed.subtracting(CharacterSet(charactersIn: "&+=#%"))) ?? cursor
            let page: KeepsakePage = try await APIClient.shared.request("GET", path() + "&before=\(encoded)", auth: true, expectedToken: token)
            return .page(page)
        }
    }
    @MainActor private func remove() async {
        guard let selected else { return }
        await run { token in
            let _: EmptyResponse = try await APIClient.shared.request("DELETE", path("/\(selected.id)"), auth: true, expectedToken: token)
            return .removed(selected.id)
        }
        if valid && items.isEmpty && error == nil && !unavailable { await load() }
    }
    private func invalidate() {
        generation = UUID(); requestTask?.cancel(); loadedRevision = nil; context = nil; items = []; selected = nil; pending = nil; dismiss()
    }
}


private struct KeepsakeRowEntrance: ViewModifier {
    let index: Int
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var appeared = false

    func body(content: Content) -> some View {
        content
            .opacity(appeared ? 1 : 0)
            .offset(y: appeared || reduceMotion ? 0 : 4)
            .onAppear {
                withAnimation(reduceMotion ? nil : .easeOut(duration: 0.18).delay(Double(min(index, 6)) * 0.035)) {
                    appeared = true
                }
            }
    }
}
