import SwiftUI
import ZhiZhouCore

struct StoryGraphDetailView: View {
    let selection: StoryGraphSelection
    let graph: StoryGraph
    let response: StoryGraphResponse
    let onSelect: (StoryGraphSelection) -> Void
    @AccessibilityFocusState private var headingFocused: Bool

    var body: some View {
        AdminWorkspaceList {
            switch selection {
            case .person(let id):
                if let person = graph.people.first(where: { $0.id == id }) { personDetail(person) }
            case .relationship(let id):
                if let edge = graph.relationships.first(where: { $0.id == id }) { relationshipDetail(edge) }
            case .thread(let id):
                if let thread = graph.threads.first(where: { $0.id == id }) { threadDetail(thread) }
            }
        }
        .id(selection.id)
        .task(id: selection.id) { headingFocused = true }
    }

    private func heading(_ title: String, detail: String = "") -> some View {
        AdminWorkspaceHeading(title, detail: detail)
            .accessibilityFocused($headingFocused)
    }

    @ViewBuilder private func personDetail(_ person: StoryPerson) -> some View {
        heading(person.name, detail: person.aliases.isEmpty ? "人物" : "又名 · " + person.aliases.joined(separator: "、"))
        summary(person.summary)
        let edges = graph.relationships.filter { $0.from == person.id || $0.to == person.id }
        if !edges.isEmpty {
            AdminWorkspaceSection("人物关系") {
                ForEach(edges) { edge in
                    Button { onSelect(.relationship(edge.id)) } label: {
                        StoryGraphIndexRow(title: StoryGraphCopy.people(edge, graph: graph), detail: edge.label,
                                           annotation: StoryGraphCopy.certainty(edge.certainty))
                    }.buttonStyle(.plain)
                }
            }
        }
        let threads = graph.threads.filter { $0.people.contains(person.id) }
        if !threads.isEmpty {
            AdminWorkspaceSection("相关线索") {
                ForEach(threads) { thread in
                    Button { onSelect(.thread(thread.id)) } label: {
                        StoryGraphIndexRow(title: thread.title, detail: thread.summary,
                                           annotation: StoryGraphCopy.thread(thread.kind) + " · " + StoryGraphCopy.certainty(thread.certainty))
                    }.buttonStyle(.plain)
                }
            }
        }
        evidence(person.evidence)
    }

    @ViewBuilder private func relationshipDetail(_ edge: StoryRelationship) -> some View {
        heading(edge.label, detail: StoryGraphCopy.people(edge, graph: graph))
        Text(StoryGraphCopy.certainty(edge.certainty)).font(.subheadline).foregroundStyle(AppTheme.primary)
        summary(edge.summary)
        AdminWorkspaceSection(edge.directed ? "关系方向：前者指向后者" : "关系双方") {
            personLinks([edge.from, edge.to])
        }
        evidence(edge.evidence)
    }

    @ViewBuilder private func threadDetail(_ thread: StoryThread) -> some View {
        heading(thread.title, detail: StoryGraphCopy.thread(thread.kind))
        Text(StoryGraphCopy.certainty(thread.certainty)).font(.subheadline).foregroundStyle(AppTheme.primary)
        summary(thread.summary)
        if !thread.people.isEmpty {
            AdminWorkspaceSection("涉及人物") { personLinks(thread.people) }
        }
        evidence(thread.evidence)
    }

    private func summary(_ text: String) -> some View {
        Text(text).font(.body).lineSpacing(5).textSelection(.enabled)
    }

    private func personLinks(_ ids: [String]) -> some View {
        ForEach(graph.people.filter { ids.contains($0.id) }) { person in
            Button { onSelect(.person(person.id)) } label: {
                StoryGraphIndexRow(title: person.name, detail: person.summary)
            }.buttonStyle(.plain)
        }
    }

    private func evidence(_ items: [StoryEvidence]) -> some View {
        AdminWorkspaceSection("分析报告摘录") {
            AccountSettingsNote("以下文字来自分析报告，可能包含推断。请打开来源章节核对原文。")
            if items.isEmpty { AccountSettingsNote("暂无报告摘录。") }
            ForEach(Array(items.enumerated()), id: \.offset) { index, item in
                VStack(alignment: .leading, spacing: 12) {
                    Text(item.kind == "relationship" ? "关系分析" : "情节分析")
                        .font(.caption).foregroundStyle(ReadingSpace.profileMuted)
                    Text(item.quote)
                        .font(serifFont(.body, .regular))
                        .lineSpacing(5)
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                    ForEach(response.chapters.filter { item.chapterIds.contains($0.id) }) { chapter in
                        NavigationLink {
                            SavedChapterDestination(novelID: response.novel.id, chapterID: chapter.id)
                        } label: {
                            Label("回到原文 · " + chapter.title, systemImage: "book")
                                .font(.subheadline)
                                .frame(minHeight: 48, alignment: .leading)
                        }
                    }
                    if item.chapterIds.contains(where: { id in !response.chapters.contains(where: { $0.id == id }) }) {
                        AccountSettingsNote("部分来源章节已不在当前范围内。")
                    }
                }
                .padding(.vertical, 8)
                .readingSpaceEntrance(index)
            }
        }
    }
}
