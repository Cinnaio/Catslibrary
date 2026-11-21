import SwiftUI
import ZhiZhouCore

/// A separate paper panel keeps history compact without replacing the mounted conversation.
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
        VStack(spacing: 4) {
            List {
                heading
                    .listRowInsets(EdgeInsets(top: 18, leading: 20, bottom: 8, trailing: 20))
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
                Group {
                    Section {
                        searchField.padding(.horizontal, 4)
                        if hasCurrentNovel { scopeMenu.padding(.horizontal, 4) }
                        if !searchTerm.isEmpty {
                            Text("仅搜索已载入的记录")
                                .font(.caption2)
                                .foregroundStyle(ReadingSpace.profileMuted)
                                .padding(.horizontal, 4)
                        }
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
                            .padding(.horizontal, 8)
                    }
                    if matches.isEmpty && !loading && error == nil {
                        emptyState
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
                                .font(.caption2.weight(.medium))
                                .foregroundStyle(ReadingSpace.profileMuted)
                                .textCase(nil)
                                .padding(.leading, 8)
                                .padding(.top, 8)
                        }
                    }
                    .id("\(filterByBook):\(searchTerm)")

                    if hasMore {
                        Button { Task { await onLoadMore() } } label: {
                            HStack(spacing: 8) {
                                Text("加载更早对话")
                                Spacer(minLength: 8)
                                Image(systemName: "arrow.down").accessibilityHidden(true)
                            }
                            .font(.caption)
                            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                            .padding(.horizontal, 12)
                        }
                        .buttonStyle(.plain)
                        .disabled(loading)
                        .foregroundStyle(ReadingSpace.profileMuted)
                    }
                }
                .listRowInsets(EdgeInsets(top: 4, leading: 12, bottom: 4, trailing: 12))
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
                .listSectionSeparator(.hidden)
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .contentMargins(.top, 0, for: .scrollContent)
            .contentMargins(.bottom, 12, for: .scrollContent)
            .scrollDismissesKeyboard(.interactively)
            .refreshable { await onRefresh() }

            if canDiscover {
                Button(action: onDiscovery) {
                    HStack(spacing: 10) {
                        Image(systemName: "books.vertical")
                            .foregroundStyle(AppTheme.primary)
                            .accessibilityHidden(true)
                        Text("找书入库").foregroundStyle(ReadingSpace.ink)
                        Spacer(minLength: 8)
                        Image(systemName: "arrow.up.right")
                            .foregroundStyle(ReadingSpace.profileMuted)
                            .accessibilityHidden(true)
                    }
                    .font(.subheadline)
                    .padding(.horizontal, 14)
                    .frame(maxWidth: .infinity, minHeight: 48, alignment: .leading)
                    .background(ReadingSpace.paper, in: RoundedRectangle(cornerRadius: 14))
                    .contentShape(RoundedRectangle(cornerRadius: 14))
                }
                .buttonStyle(.plain)
                .padding(.horizontal, 16)
                .padding(.top, 4)
                .padding(.bottom, 16)
            }
        }
        .frame(maxHeight: .infinity)
        .background(ReadingSpace.profileFill)
        .clipShape(RoundedRectangle(cornerRadius: ReadingSpace.panelRadius))
        .overlay {
            RoundedRectangle(cornerRadius: ReadingSpace.panelRadius)
                .strokeBorder(ReadingSpace.profileLine, lineWidth: 0.5)
                .allowsHitTesting(false)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("对话历史侧栏")
    }

    private var heading: some View {
        AppAdaptiveRow(spacing: 12) {
            Text("对话记录")
                .font(serifFont(.title2, .medium))
                .foregroundStyle(ReadingSpace.ink)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityAddTraits(.isHeader)
            Button(action: onNewConversation) {
                Label("新对话", systemImage: "square.and.pencil")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(ReadingSpace.onSummary)
                    .padding(.horizontal, 12)
                    .frame(minHeight: 44)
                    .background(ReadingSpace.summary, in: RoundedRectangle(cornerRadius: 12))
            }
            .buttonStyle(ScaleButtonStyle())
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityLabel("新建对话")
            .accessibilityIdentifier("agent.history.new")
        }
    }

    private var scopeMenu: some View {
        Menu {
            Picker("对话范围", selection: $filterByBook) {
                Text("全部作品").tag(false)
                Text("当前作品").tag(true)
            }
        } label: {
            AppAdaptiveRow(spacing: 8) {
                HStack(spacing: 5) {
                    Text(filterByBook ? "当前作品" : "全部作品")
                    Image(systemName: "chevron.down")
                        .font(.caption2)
                        .accessibilityHidden(true)
                }
                .font(.caption.weight(.medium))
                .foregroundStyle(ReadingSpace.ink)
                .frame(maxWidth: .infinity, alignment: .leading)
                if filterByBook {
                    Text(currentNovelTitle)
                        .font(.caption)
                        .foregroundStyle(ReadingSpace.profileMuted)
                        .appTextLineLimit(1)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("对话范围")
        .accessibilityValue(filterByBook ? "当前作品，\(currentNovelTitle)" : "全部作品")
    }

    private var emptyState: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(searchTerm.isEmpty ? (filterByBook ? "这本书还没有对话" : "还没有对话") : "未找到匹配的对话")
                .font(serifFont(.headline, .medium))
                .foregroundStyle(ReadingSpace.ink)
            Text(searchTerm.isEmpty ? "点击新对话，开始一段创作。"
                 : (hasMore ? "可以加载更早的记录后继续查找。" : "试试其他标题、作品名或章节名。"))
                .font(.footnote)
                .foregroundStyle(ReadingSpace.profileMuted)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 24)
    }

    private var searchField: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(ReadingSpace.profileMuted)
                .accessibilityHidden(true)
            TextField("搜索对话", text: $search)
                .font(.subheadline)
                .foregroundStyle(ReadingSpace.ink)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .accessibilityLabel("搜索已载入的对话")
                .accessibilityHint("搜索已载入记录的标题、作品与续写起点")
                .accessibilityIdentifier("agent.history.search")
            if !search.isEmpty {
                Button("清除搜索", systemImage: "xmark.circle.fill") { search = "" }
                    .labelStyle(.iconOnly)
                    .foregroundStyle(ReadingSpace.profileMuted)
                    .frame(minWidth: 44, minHeight: 44)
                    .buttonStyle(.plain)
            }
        }
        .padding(.leading, 12)
        .padding(.trailing, search.isEmpty ? 12 : 0)
        .frame(minHeight: 44)
        .background(ReadingSpace.paper, in: RoundedRectangle(cornerRadius: 12))
    }

    private func sessionButton(_ session: AIAgentSession) -> some View {
        let isSelected = selectedSessionID == session.id
        let updated = Date(timeIntervalSince1970: Double(session.updatedAt) / 1000)
        return Button { onOpen(session) } label: {
            VStack(alignment: .leading, spacing: 8) {
                Text(session.title.isEmpty ? "新的对话" : session.title)
                    .font(serifFont(.body, .medium))
                    .foregroundStyle(ReadingSpace.ink)
                    .appTextLineLimit(2)
                AppAdaptiveRow(spacing: 8) {
                    Text(session.novelTitle.isEmpty ? "未命名作品" : session.novelTitle)
                        .font(.caption)
                        .appTextLineLimit(1)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Text(updated, format: .dateTime.month().day())
                        .font(.caption2)
                        .monospacedDigit()
                        .accessibilityLabel("更新于 \(updated.formatted(.dateTime.year().month().day()))")
                }
                .foregroundStyle(ReadingSpace.profileMuted)
                if isSelected {
                    Text(session.anchorTitle.isEmpty ? "从头创作" : "续写起点 · \(session.anchorTitle)")
                        .font(.caption2)
                        .foregroundStyle(ReadingSpace.profileMuted)
                        .appTextLineLimit(1)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .background(isSelected ? ReadingSpace.paper : Color.clear,
                        in: RoundedRectangle(cornerRadius: 16))
            .overlay(alignment: .leading) {
                if isSelected {
                    Capsule().fill(AppTheme.primary).frame(width: 3, height: 24)
                }
            }
            .contentShape(RoundedRectangle(cornerRadius: 16))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isSelected ? [.isSelected] : [])
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
