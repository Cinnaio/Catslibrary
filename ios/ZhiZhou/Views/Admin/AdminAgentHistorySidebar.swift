import SwiftUI
import ZhiZhouCore

/// History stays in its own paper surface while the current conversation remains mounted.
struct AdminAgentHistorySidebar: View {
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
    let canDiscover: Bool
    let onNewConversation: () -> Void
    let onOpen: (AIAgentSession) -> Void
    let onDelete: (AIAgentSession) -> Void
    let onRefresh: () async -> Void
    let onLoadMore: () async -> Void
    let onDiscovery: () -> Void

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
        List {
            Group {
                Section {
                    Button(action: onNewConversation) {
                        Label("新建对话", systemImage: "square.and.pencil")
                            .font(.body.weight(.medium))
                            .foregroundStyle(ReadingSpace.ink)
                            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("agent.history.new")
                    searchField
                    if hasCurrentNovel {
                        Picker("对话范围", selection: $filterByBook) {
                            Text("全部作品").tag(false)
                            Text("当前作品").tag(true)
                        }
                        .accessibleSegmentedPicker()
                        if filterByBook {
                            Text(currentNovelTitle)
                                .font(.caption)
                                .foregroundStyle(ReadingSpace.profileMuted)
                                .appTextLineLimit(2)
                        }
                    }
                } header: {
                    Text("对话记录")
                        .font(serifFont(.title3, .semibold))
                        .foregroundStyle(ReadingSpace.ink)
                        .textCase(nil)
                        .padding(.vertical, 8)
                        .accessibilityAddTraits(.isHeader)
                }

                if let error {
                    LoadErrorNotice(message: error, isLoading: loading) { Task { await onRefresh() } }
                }
                if let deleteError {
                    Text(deleteError).font(.footnote).foregroundStyle(AppTheme.danger).textSelection(.enabled)
                }
                if loading {
                    ProgressView(sessions.isEmpty ? "正在读取对话…" : "正在更新对话…")
                        .font(.footnote)
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                }
                if matches.isEmpty && !loading && error == nil {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(searchTerm.isEmpty ? (filterByBook ? "这本书还没有对话" : "还没有对话") : "未找到匹配的对话")
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(ReadingSpace.ink)
                        Text(searchTerm.isEmpty ? "新建对话，开始这本书的创作。"
                             : (hasMore ? "可以加载更早的记录后继续查找。" : "试试其他标题、作品名或章节名。"))
                            .font(.footnote)
                            .foregroundStyle(ReadingSpace.profileMuted)
                    }
                    .padding(.vertical, 16)
                }

                ForEach(sections) { section in
                    Section {
                        ForEach(Array(section.sessions.enumerated()), id: \.element.id) { index, session in
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
                    } header: {
                        Text(section.period.title)
                            .font(.caption.weight(.medium))
                            .foregroundStyle(ReadingSpace.profileMuted)
                            .textCase(nil)
                    }
                }
                .id("\(filterByBook):\(searchTerm)")

                if hasMore {
                    Button("加载更早对话") { Task { await onLoadMore() } }
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                        .disabled(loading)
                        .foregroundStyle(AppTheme.primary)
                }
            }
            .listRowInsets(EdgeInsets(top: 6, leading: 16, bottom: 6, trailing: 16))
            .listRowBackground(Color.clear)
            .listRowSeparator(.hidden)
            .listSectionSeparator(.hidden)
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .contentMargins(.top, 0, for: .scrollContent)
        .scrollDismissesKeyboard(.interactively)
        .background(ReadingSpace.profileFill)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if canDiscover {
                Button(action: onDiscovery) {
                    Label("找书入库", systemImage: "magnifyingglass")
                        .font(.subheadline)
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .foregroundStyle(AppTheme.primary)
                .padding(.horizontal, 20)
                .padding(.vertical, 8)
                .background(ReadingSpace.profileFill)
            }
        }
        .refreshable { await onRefresh() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("对话历史侧栏")
    }

    private var searchField: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").accessibilityHidden(true)
            TextField("搜索已载入的对话", text: $search)
                .font(.subheadline)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .accessibilityLabel("搜索已载入的对话")
                .accessibilityIdentifier("agent.history.search")
            if !search.isEmpty {
                Button("清除搜索", systemImage: "xmark.circle.fill") { search = "" }
                    .labelStyle(.iconOnly)
                    .frame(minWidth: 44, minHeight: 44)
                    .buttonStyle(.plain)
            }
        }
        .foregroundStyle(ReadingSpace.profileMuted)
        .padding(.leading, 12)
        .padding(.trailing, search.isEmpty ? 12 : 0)
        .frame(minHeight: 44)
        .background(ReadingSpace.paper, in: RoundedRectangle(cornerRadius: 12))
    }

    private func sessionButton(_ session: AIAgentSession) -> some View {
        let isSelected = selectedSessionID == session.id
        return Button { onOpen(session) } label: {
            VStack(alignment: .leading, spacing: 6) {
                Text(session.title.isEmpty ? "新的对话" : session.title)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(ReadingSpace.ink)
                    .appTextLineLimit(2)
                if !session.novelTitle.isEmpty {
                    Text(session.novelTitle)
                        .font(.caption)
                        .foregroundStyle(ReadingSpace.profileMuted)
                        .appTextLineLimit(1)
                }
                AppAdaptiveRow(spacing: 8) {
                    Text(session.anchorTitle.isEmpty ? "从头创作" : "续写起点 · \(session.anchorTitle)")
                        .appTextLineLimit(1)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Text(Date(timeIntervalSince1970: Double(session.updatedAt) / 1000), format: .dateTime.month().day())
                        .accessibilityLabel("更新于 \(Date(timeIntervalSince1970: Double(session.updatedAt) / 1000).formatted(.dateTime.year().month().day()))")
                }
                .font(.caption2)
                .foregroundStyle(ReadingSpace.profileMuted)
            }
            .padding(12)
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .background(isSelected ? AppTheme.primaryLight : Color.clear, in: RoundedRectangle(cornerRadius: 14))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isSelected ? [.isSelected] : [])
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
