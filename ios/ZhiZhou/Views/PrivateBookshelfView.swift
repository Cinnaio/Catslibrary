import SwiftUI

struct PrivateShelfGroup: Decodable, Identifiable {
    let id: String
    let name: String
    let count: Int
}
struct PrivateShelfGroups: Decodable { let groups: [PrivateShelfGroup] }
private struct ShelfEditPayload: Encodable {
    let novelIds: [String]
    var note: String? = nil
    var pinned: Bool? = nil
    var groupIds: [String]? = nil
    var addGroupIds: [String]? = nil
    var removeGroupIds: [String]? = nil
    var expectedVersion: Int? = nil
}

struct PrivateBookshelfView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var books: [FavoriteItem] = []
    @State private var groups: [PrivateShelfGroup] = []
    @State private var selected = Set<String>()
    @State private var groupID = ""
    @State private var batchGroup = ""
    @State private var groupName = ""
    @State private var renameID = ""
    @State private var deleting: PrivateShelfGroup?
    @State private var editing: FavoriteItem?
    @State private var note = ""
    @State private var memberships = Set<String>()
    @State private var showGroups = false
    @State private var busy = false
    @State private var loaded = false
    @State private var error: String?
    @State private var generation = 0
    private var scope: String { "\(APIClient.shared.token ?? "")|\(ContentAccessStore.shared.mode)|\(ServerConfig.serverURL)" }
    private var visible: [FavoriteItem] { books.filter { groupID.isEmpty || ($0.groupIds ?? []).contains(groupID) } }
    private var selectedIDs: [String] { books.map(\.novelId).filter { selected.contains($0) } }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text("把喜欢的书，放在自己的位置。")
                        .font(serifFont(.title2, .semibold)).foregroundStyle(ReadingSpace.ink)
                    Picker("私人分组", selection: $groupID) {
                        Text("全部收藏").tag("")
                        ForEach(groups) { Text($0.name).tag($0.id) }
                    }
                    Button("管理私人分组", systemImage: "folder.badge.gearshape") { showGroups = true }
                }
                if let error { Section { Text(error).foregroundStyle(.red); Button("重新读取") { Task { await run { try await fetch() } } } } }
                if busy && !loaded { AppLoadingState("正在打开书架…") }
                if !selectedIDs.isEmpty {
                    Section("已选 \(selectedIDs.count) 本") {
                        Picker("批量归入", selection: $batchGroup) {
                            Text("选择分组").tag("")
                            ForEach(groups) { Text($0.name).tag($0.id) }
                        }
                        HStack {
                            Button("加入分组") { edit(ShelfEditPayload(novelIds: selectedIDs, addGroupIds: [batchGroup]), clearSelection: true) }
                            Button("移出分组") { edit(ShelfEditPayload(novelIds: selectedIDs, removeGroupIds: [batchGroup]), clearSelection: true) }
                        }.disabled(batchGroup.isEmpty)
                        HStack {
                            Button("置顶") { edit(ShelfEditPayload(novelIds: selectedIDs, pinned: true), clearSelection: true) }
                            Button("取消选择") { selected.removeAll() }
                        }
                    }
                }
                Section {
                    ForEach(Array(visible.enumerated()), id: \.element.id) { index, book in
                        bookRow(book, index: index)
                            .modifier(ShelfRowEntrance(identity: groupID, index: index))
                    }
                    if loaded && visible.isEmpty { Text("这个分组还没有书。可以在全部收藏中选书加入。 ").foregroundStyle(.secondary) }
                } footer: { Text("分组与收藏理由仅自己可见；每次最多批量整理 100 本。") }
            }
            .scrollContentBackground(.hidden)
            .background(ReadingSpace.profilePaper)
            .animation(reduceMotion ? nil : AppMotion.micro, value: groupID)
            .navigationTitle("整理书架")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("完成") { dismiss() }.disabled(busy) } }
            .disabled(busy)
            .task(id: scope) {
                generation += 1; busy = false; books = []; groups = []; selected.removeAll(); editing = nil; loaded = false
                await run { try await fetch() }
            }
            .onChange(of: groupID) { _, _ in selected.removeAll() }
            .onDisappear { generation += 1 }
            .sheet(isPresented: $showGroups) { groupManager }
            .sheet(item: $editing) { book in editor(book) }
        }
    }

    private func bookRow(_ book: FavoriteItem, index: Int) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top) {
                Button {
                    if selected.contains(book.id) { selected.remove(book.id) }
                    else if selected.count < 100 { selected.insert(book.id) }
                } label: { Image(systemName: selected.contains(book.id) ? "checkmark.circle.fill" : "circle").frame(minWidth: AppLayout.minimumTouchTarget, minHeight: AppLayout.minimumTouchTarget) }
                .accessibilityLabel("选择《\(book.title)》")
                .accessibilityAddTraits(selected.contains(book.id) ? .isSelected : [])
                VStack(alignment: .leading, spacing: 4) {
                    Text(book.title).font(serifFont(.headline, .semibold))
                    if let note = book.note, !note.isEmpty { Text(note).font(.subheadline).foregroundStyle(.secondary).appTextLineLimit(3) }
                    let names = groups.filter { (book.groupIds ?? []).contains($0.id) }.map(\.name)
                    if !names.isEmpty { Text(names.joined(separator: " · ")).font(.caption).foregroundStyle(AppTheme.primary) }
                }
                Spacer(minLength: 0)
                if book.pinned == true { Image(systemName: "pin.fill").foregroundStyle(AppTheme.primary).accessibilityLabel("已置顶") }
            }
            HStack {
                Button("分组与收藏理由") { note = book.note ?? ""; memberships = Set(book.groupIds ?? []); error = nil; editing = book }
                Spacer()
                Menu {
                    Button(book.pinned == true ? "取消置顶" : "置顶", systemImage: "pin") { edit(ShelfEditPayload(novelIds: [book.id], pinned: book.pinned != true)) }
                    Button("上移", systemImage: "arrow.up") { move(book, direction: "up") }
                        .disabled(index == 0 || visible[index - 1].pinned != book.pinned)
                    Button("下移", systemImage: "arrow.down") { move(book, direction: "down") }
                        .disabled(index == visible.count - 1 || visible[index + 1].pinned != book.pinned)
                } label: { Image(systemName: "ellipsis").frame(minWidth: AppLayout.minimumTouchTarget, minHeight: AppLayout.minimumTouchTarget) }
                .accessibilityLabel("整理《\(book.title)》")
            }.font(.subheadline)
        }.buttonStyle(.borderless).padding(.vertical, 6)
    }

    private func editor(_ book: FavoriteItem) -> some View {
        NavigationStack {
            Form {
                if let error { Text(error).foregroundStyle(.red) }
                Section("放进分组") {
                    if groups.isEmpty { Text("先在管理分组中创建一个分组。") }
                    ForEach(groups) { g in
                        Toggle(g.name, isOn: Binding(get: { memberships.contains(g.id) }, set: { value in
                            if value { memberships.insert(g.id) } else { memberships.remove(g.id) }
                        }))
                    }
                }
                Section {
                    TextEditor(text: $note).frame(minHeight: 120)
                        .accessibilityLabel("我的收藏理由")
                    Text("\(note.utf16.count) / 500").font(.caption)
                        .foregroundStyle(note.utf16.count > 500 ? AppTheme.danger : ReadingSpace.profileMuted)
                    if note.utf16.count > 500 {
                        Text("收藏理由超过 500 字，请缩短后保存。表情等字符可能占用多个字数。")
                            .font(.footnote).foregroundStyle(AppTheme.danger)
                    }
                } header: { Text("我的收藏理由") } footer: { Text("只有你自己可见，换一台设备也能接着整理。") }
            }
            .scrollContentBackground(.hidden).background(ReadingSpace.profilePaper)
            .navigationTitle(book.title).navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("取消") { editing = nil }.disabled(busy) }
                ToolbarItem(placement: .confirmationAction) {
                    Button("保存") { edit(ShelfEditPayload(novelIds: [book.id], note: note, groupIds: Array(memberships), expectedVersion: book.organizationVersion ?? 0), closeEditor: true) }
                        .disabled(busy || note.utf16.count > 500)
                }
            }.disabled(busy).interactiveDismissDisabled(busy)
        }
    }
    private var groupManager: some View {
        NavigationStack {
            Form {
                if let error { Text(error).foregroundStyle(.red) }
                Section(renameID.isEmpty ? "新建分组" : "修改名称") {
                    TextField("例如：睡前读、想二刷", text: $groupName)
                    Button(renameID.isEmpty ? "创建分组" : "保存名称") {
                        let id = renameID, name = groupName.trimmingCharacters(in: .whitespacesAndNewlines)
                        Task { await run {
                            try await send(id.isEmpty ? "POST" : "PATCH", "/groups" + (id.isEmpty ? "" : "/\(id)"), ["name": name])
                            try await fetch(); groupName = ""; renameID = ""
                        } }
                    }.disabled(groupName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || groupName.utf16.count > 30)
                    if !renameID.isEmpty { Button("取消改名") { renameID = ""; groupName = "" } }
                }
                Section {
                    ForEach(groups) { g in
                        HStack {
                            Text(g.name); Spacer(); Text("\(g.count) 本").foregroundStyle(.secondary)
                            Menu {
                                Button("改名") { renameID = g.id; groupName = g.name }
                                Button("删除分组", role: .destructive) { deleting = g }
                            } label: { Image(systemName: "ellipsis").frame(minWidth: AppLayout.minimumTouchTarget, minHeight: AppLayout.minimumTouchTarget) }
                        }
                    }
                } footer: { Text("删除分组仅解除归类，书籍与收藏理由都会保留。最多 40 个分组。") }
            }
            .scrollContentBackground(.hidden).background(ReadingSpace.profilePaper)
            .navigationTitle("私人分组").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("完成") { showGroups = false }.disabled(busy) } }
            .disabled(busy).interactiveDismissDisabled(busy)
            .confirmationDialog("删除这个分组？", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), presenting: deleting) { g in
                Button("删除「\(g.name)」", role: .destructive) {
                    Task { await run {
                        try await send("DELETE", "/groups/\(g.id)", [String: String]())
                        if groupID == g.id { groupID = "" }; if batchGroup == g.id { batchGroup = "" }
                        try await fetch()
                    } }
                }
            }
        }
    }
    private func path(_ suffix: String) -> String { "/api/bookshelf/organization\(suffix)?contentMode=\(ContentAccessStore.shared.mode)" }
    private func send(_ method: String, _ suffix: String, _ body: some Encodable) async throws {
        let captured = scope, request = generation
        try await APIClient.shared.requestVoid(method, path(suffix), body: try APIClient.shared.jsonBody(body), auth: true)
        guard captured == scope, request == generation, !Task.isCancelled else { throw CancellationError() }
    }
    private func edit(_ payload: ShelfEditPayload, clearSelection: Bool = false, closeEditor: Bool = false) {
        Task { await run {
            try await send("PATCH", "/entries", payload)
            try await fetch()
            if clearSelection { selected.removeAll() }
            if closeEditor { editing = nil }
        } }
    }
    private func move(_ book: FavoriteItem, direction: String) {
        Task { await run { try await send("POST", "/move", ["novelId": book.id, "direction": direction, "groupId": groupID]); try await fetch() } }
    }
    private func fetch() async throws {
        let captured = scope, request = generation
        let nextGroups: PrivateShelfGroups = try await APIClient.shared.getReader(path("/groups"), auth: true)
        var all: [FavoriteItem] = [], offset = 0
        while true {
            try Task.checkCancellation()
            guard captured == scope, request == generation else { throw CancellationError() }
            let page: BookshelfResponse = try await APIClient.shared.getReader("/api/bookshelf?limit=50&offset=\(offset)&sort=manual", auth: true)
            all += page.favorites
            offset += page.favorites.count
            if page.favorites.isEmpty || offset >= (page.totals?.favorites ?? offset) { break }
        }
        guard captured == scope, request == generation, !Task.isCancelled else { throw CancellationError() }
        groups = nextGroups.groups; books = all; loaded = true
        if !groupID.isEmpty && !groups.contains(where: { $0.id == groupID }) { groupID = "" }
    }
    private func run(_ operation: () async throws -> Void) async {
        guard !busy else { return }
        let captured = scope
        generation += 1; let request = generation
        busy = true; error = nil
        defer { if request == generation { busy = false } }
        do { try await operation() }
        catch is CancellationError { }
        catch { if captured == scope, request == generation { self.error = error.localizedDescription } }
    }
}

private struct ShelfRowEntrance: ViewModifier {
    let identity: String
    let index: Int
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var visible = false
    func body(content: Content) -> some View {
        content.opacity(visible ? 1 : 0).offset(y: visible || reduceMotion ? 0 : 5)
            .task(id: identity) {
                guard !reduceMotion else { visible = true; return }
                visible = false
                withAnimation(.easeOut(duration: 0.18).delay(min(0.24, Double(index) * 0.018))) { visible = true }
            }
    }
}
