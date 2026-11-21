import SwiftUI
import ZhiZhouCore

/// Flat history sits behind the conversation surface rather than inside another card.
struct AdminAgentHistorySidebar: View {
    let isPresented: Bool
    let sessions: [AIAgentSession]
    let selectedSessionID: String?
    let currentNovelTitle: String
    let hasCurrentNovel: Bool
    @Binding var filterByBook: Bool
    @Binding var search: String
    let loading: Bool
    let hasMore: Bool
    let deleting: Bool
    let error: String?
    let deleteError: String?
    let onNewConversation: () -> Void
    let onOpen: (AIAgentSession) -> Void
    let onDelete: (AIAgentSession) -> Void
    let onRefresh: () async -> Void
    let onLoadMore: () async -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var isSearching = false
    @State private var loadingEarlier = false
    @FocusState private var searchFocused: Bool

    private var searchTerm: String { search.trimmingCharacters(in: .whitespacesAndNewlines) }

    private var matches: [AIAgentSession] {
        guard !searchTerm.isEmpty else { return sessions }
        return sessions.filter {
            [$0.title, $0.novelTitle, $0.anchorTitle].contains { $0.localizedCaseInsensitiveContains(searchTerm) }
        }
    }

    private var sections: [AgentHistorySection] {
        let calendar = Calendar.current
        let today = calendar.startOfDay(for: Date())
        let yesterday = calendar.date(byAdding: .day, value: -1, to: today) ?? today
        let week = calendar.date(byAdding: .day, value: -7, to: today) ?? yesterday
        let grouped = Dictionary(grouping: matches) { session -> AgentHistoryPeriod in
            let date = Date(timeIntervalSince1970: Double(session.updatedAt) / 1000)
            if date >= today { return .today }
            if date >= yesterday { return .yesterday }
            if date >= week { return .week }
            return .earlier
        }
        return AgentHistoryPeriod.allCases.compactMap { period in
            guard let items = grouped[period], !items.isEmpty else { return nil }
            return AgentHistorySection(period: period, sessions: items)
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            List {
                Group {
                    Text("Cat’s Library")
                        .font(.system(.title2, design: .serif).weight(.semibold))
                        .foregroundStyle(ReadingSpace.ink)
                        .padding(.top, 8)
                        .padding(.bottom, 12)
                        .accessibilityAddTraits(.isHeader)

                    Button(action: onNewConversation) {
                        Label("对话", systemImage: "bubble.left.and.bubble.right")
                            .font(.body)
                            .frame(maxWidth: .infinity, minHeight: 48, alignment: .leading)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(ReadingSpace.ink)

                    if isSearching || !search.isEmpty {
                        searchField
                    } else {
                        Button {
                            withAnimation(reduceMotion ? nil : AppMotion.state) { isSearching = true }
                        } label: {
                            Label("搜索对话", systemImage: "magnifyingglass")
                                .font(.body)
                                .frame(maxWidth: .infinity, minHeight: 48, alignment: .leading)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(ReadingSpace.ink)
                        .accessibilityIdentifier("agent.history.search.open")
                    }
                    if hasCurrentNovel { scopeMenu }
                    if !searchTerm.isEmpty {
                        Text("仅搜索已载入的记录")
                            .font(.caption)
                            .foregroundStyle(ReadingSpace.profileMuted)
                    }

                    Text(searchTerm.isEmpty ? "最近对话" : "搜索结果")
                        .font(.caption)
                        .foregroundStyle(ReadingSpace.profileMuted)
                        .padding(.top, 20)
                        .padding(.bottom, 6)
                        .accessibilityAddTraits(.isHeader)

                    if let error {
                        LoadErrorNotice(message: error, isLoading: loading) { Task { await onRefresh() } }
                    }
                    if let deleteError {
                        Text(deleteError).font(.footnote).foregroundStyle(AppTheme.danger).textSelection(.enabled)
                    }
                    if loading && !loadingEarlier && (sessions.isEmpty || error != nil) {
                        ProgressView(error == nil ? "正在读取对话…" : "正在重试…")
                            .font(.footnote)
                            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                    }
                    if matches.isEmpty && (!loading || !sessions.isEmpty) && error == nil { emptyState }

                    ForEach(Array(sections.flatMap(\.sessions).enumerated()), id: \.element.id) { index, session in
                        sessionButton(session)
                            .readingSpaceEntrance(index)
                            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                                Button("删除", systemImage: "trash", role: .destructive) { onDelete(session) }
                                    .disabled(deleting)
                            }
                            .contextMenu {
                                Button("删除对话", systemImage: "trash", role: .destructive) { onDelete(session) }
                                    .disabled(deleting)
                            }
                    }
                    .id("\(filterByBook):\(searchTerm)")

                    if hasMore {
                        Button {
                            guard !loading, !loadingEarlier else { return }
                            loadingEarlier = true
                            Task {
                                defer { loadingEarlier = false }
                                await onLoadMore()
                            }
                        } label: {
                            HStack(spacing: 8) {
                                if loadingEarlier { ProgressView().controlSize(.small) }
                                Text(loadingEarlier ? "正在加载更早对话…" : "加载更早对话")
                            }
                            .font(.subheadline)
                            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(ReadingSpace.profileMuted)
                        .disabled(loading || loadingEarlier)
                    }
                }
                .listRowInsets(EdgeInsets(top: 2, leading: 24, bottom: 2, trailing: 20))
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .contentMargins(.top, 8, for: .scrollContent)
            .contentMargins(.bottom, 16, for: .scrollContent)
            .scrollDismissesKeyboard(.interactively)
            .scrollEdgeEffectHidden(true, for: .top)
            .refreshable { await onRefresh() }

            footer
                .padding(.horizontal, 24)
                .padding(.top, 12)
                .padding(.bottom, 16)
        }
        .frame(maxHeight: .infinity)
        .background(ReadingSpace.canvas)
        .onChange(of: isSearching) { _, value in searchFocused = value && isPresented }
        .onChange(of: isPresented) { _, value in
            if !value { searchFocused = false }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("对话历史侧栏")
    }

    private var footer: some View {
        Button(action: onNewConversation) {
            Label("新建对话", systemImage: "plus")
                .font(.subheadline.weight(.medium))
                .foregroundStyle(ReadingSpace.onSummary)
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .frame(minHeight: 44)
                .background(ReadingSpace.summary, in: Capsule())
        }
        .buttonStyle(ScaleButtonStyle())
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityIdentifier("agent.history.new")
        .frame(maxWidth: .infinity, alignment: .trailing)
    }

    private var scopeMenu: some View {
        Menu {
            Picker("对话范围", selection: $filterByBook) {
                Text("全部作品").tag(false)
                Text("当前作品").tag(true)
            }
        } label: {
            AppAdaptiveRow(spacing: 8) {
                HStack(spacing: 12) {
                    Image(systemName: "books.vertical").accessibilityHidden(true)
                    Text(filterByBook ? "当前作品" : "全部作品")
                    Image(systemName: "chevron.down")
                        .font(.caption2)
                        .foregroundStyle(ReadingSpace.profileMuted)
                        .accessibilityHidden(true)
                }
                .font(.body)
                .foregroundStyle(ReadingSpace.ink)
                .frame(maxWidth: .infinity, alignment: .leading)
                if filterByBook {
                    Text(currentNovelTitle)
                        .font(.caption)
                        .foregroundStyle(ReadingSpace.profileMuted)
                        .appTextLineLimit(1)
                }
            }
            .frame(maxWidth: .infinity, minHeight: 48, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("对话范围")
        .accessibilityValue(filterByBook ? "当前作品，\(currentNovelTitle)" : "全部作品")
    }

    private var emptyState: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(searchTerm.isEmpty ? (filterByBook ? "这本书还没有对话" : "还没有对话") : "未找到匹配的对话")
                .font(.subheadline)
                .foregroundStyle(ReadingSpace.ink)
            Text(searchTerm.isEmpty ? "新建对话，开始一段创作。"
                 : (hasMore ? "可以加载更早的记录后继续查找。" : "试试其他标题、作品名或章节名。"))
                .font(.footnote)
                .foregroundStyle(ReadingSpace.profileMuted)
        }
        .padding(.vertical, 12)
    }

    private var searchField: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(ReadingSpace.profileMuted)
                .accessibilityHidden(true)
            TextField("搜索已载入的对话", text: $search)
                .font(.subheadline)
                .foregroundStyle(ReadingSpace.ink)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .focused($searchFocused)
                .accessibilityLabel("搜索已载入的对话")
                .accessibilityIdentifier("agent.history.search")
            Button("清除并收起搜索", systemImage: "xmark") {
                search = ""
                searchFocused = false
                withAnimation(reduceMotion ? nil : AppMotion.state) { isSearching = false }
            }
            .labelStyle(.iconOnly)
            .foregroundStyle(ReadingSpace.profileMuted)
            .frame(minWidth: 44, minHeight: 44)
            .buttonStyle(.plain)
        }
        .padding(.leading, 12)
        .frame(minHeight: 48)
        .background(ReadingSpace.profileFill, in: RoundedRectangle(cornerRadius: 12))
    }

    private func sessionButton(_ session: AIAgentSession) -> some View {
        let isSelected = selectedSessionID == session.id
        let updated = Date(timeIntervalSince1970: Double(session.updatedAt) / 1000)
        return Button { onOpen(session) } label: {
            VStack(alignment: .leading, spacing: 4) {
                Text(session.title.isEmpty ? "新的对话" : session.title)
                    .font(.subheadline)
                    .foregroundStyle(ReadingSpace.ink)
                    .appTextLineLimit(1)
                if !filterByBook && !session.novelTitle.isEmpty {
                    Text(session.novelTitle)
                        .font(.caption)
                        .foregroundStyle(ReadingSpace.profileMuted)
                        .appTextLineLimit(1)
                }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .background(isSelected ? ReadingSpace.profileFill : Color.clear,
                        in: RoundedRectangle(cornerRadius: 10))
            .padding(.horizontal, -10)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isSelected ? [.isSelected] : [])
        .accessibilityValue("\(session.novelTitle)，更新于 \(updated.formatted(.dateTime.year().month().day()))")
        .accessibilityHint(session.anchorTitle.isEmpty ? "从头创作" : "续写起点：\(session.anchorTitle)")
        .accessibilityIdentifier("agent.history.session.\(session.id)")
    }
}

private enum AgentHistoryPeriod: Int, CaseIterable, Hashable {
    case today, yesterday, week, earlier

    var title: String {
        switch self {
        case .today: "今天"
        case .yesterday: "昨天"
        case .week: "近七天"
        case .earlier: "更早"
        }
    }
}

private struct AgentHistorySection: Identifiable {
    let period: AgentHistoryPeriod
    let sessions: [AIAgentSession]
    var id: AgentHistoryPeriod { period }
}
