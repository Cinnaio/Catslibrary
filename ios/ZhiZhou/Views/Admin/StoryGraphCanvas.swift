import SwiftUI
import ZhiZhouCore

/// The canvas is complemented by full native lists for VoiceOver and large text.
struct StoryGraphCanvas: View {
    let graph: StoryGraph
    let people: [StoryPerson]
    let threads: [StoryThread]
    let focus: Set<String>
    let selectedRelationshipID: String?
    let selectedThreadID: String?
    let onSelect: (StoryPerson) -> Void
    let onSelectThread: (StoryThread) -> Void
    @State private var zoom: CGFloat = 1
    @State private var offset = CGSize.zero
    @GestureState private var drag = CGSize.zero
    @GestureState private var magnification: CGFloat = 1

    private var positions: [String: StoryGraphPoint] {
        let cast = StoryGraphLayout.positions(people: people, relationships: graph.relationships,
                                             centerID: focus.count == 1 ? focus.first : nil)
        return cast.merging(StoryGraphLayout.threadPositions(threads: threads, people: cast)) { person, _ in person }
    }

    var body: some View {
        VStack(spacing: 0) {
            GeometryReader { geometry in
                let points = positions
                let scale = fittedScale(points, size: geometry.size) * zoom * magnification
                let screenPoints = points.mapValues { point in
                    CGPoint(x: geometry.size.width / 2 + CGFloat(point.x) * scale + offset.width + drag.width,
                            y: geometry.size.height / 2 + CGFloat(point.y) * scale + offset.height + drag.height)
                }
                let visibleEdges = graph.relationships.filter { screenPoints[$0.from] != nil && screenPoints[$0.to] != nil }
                let lanes = edgeLanes(visibleEdges)
                ZStack {
                    ReadingSpace.profileFill.opacity(0.45)
                    Canvas { context, size in
                        drawPaper(context: &context, size: size)
                        for thread in threads {
                            guard let origin = screenPoints[thread.id] else { continue }
                            for id in thread.people {
                                guard let end = screenPoints[id] else { continue }
                                var spoke = Path()
                                spoke.move(to: origin)
                                spoke.addLine(to: end)
                                context.stroke(spoke, with: .color(ReadingSpace.profileMuted.opacity(0.45)),
                                               style: StrokeStyle(lineWidth: 1, dash: [1, 5]))
                            }
                        }
                        for edge in visibleEdges {
                            guard let from = screenPoints[edge.from], let to = screenPoints[edge.to] else { continue }
                            drawEdge(edge, from: from, to: to, lane: lanes[edge.id] ?? 0,
                                     showLabel: visibleEdges.count <= 12 || selectedRelationshipID == edge.id, context: &context)
                        }
                    }
                    .accessibilityHidden(true)
                    ForEach(people) { person in
                        if let point = screenPoints[person.id] {
                            Button { onSelect(person) } label: {
                                VStack(spacing: 4) {
                                    Text(String(person.name.prefix(1)))
                                        .font(serifFont(.title3, .medium))
                                        .frame(width: 44, height: 44)
                                        .background(focus.contains(person.id) ? AppTheme.primary : ReadingSpace.profilePaper, in: Circle())
                                        .foregroundStyle(focus.contains(person.id) ? Color.white : ReadingSpace.ink)
                                        .overlay(Circle().strokeBorder(AppTheme.primary.opacity(focus.contains(person.id) ? 1 : 0.35), lineWidth: 1))
                                    Text(person.name)
                                        .font(.caption)
                                        .lineLimit(1)
                                        .frame(width: 90)
                                        .foregroundStyle(ReadingSpace.ink)
                                }
                                .frame(minWidth: 48, minHeight: 64)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .position(point)
                            .accessibilityLabel(person.name)
                            .accessibilityHint("展开人物周边与线索详情")
                            .accessibilityIdentifier("storyGraph.person.\(person.id)")
                        }
                    }
                    ForEach(threads) { thread in
                        if let point = screenPoints[thread.id] {
                            Button { onSelectThread(thread) } label: {
                                VStack(spacing: 4) {
                                    Image(systemName: "sparkle").font(.title3)
                                    Text(thread.title).font(.caption).lineLimit(1)
                                }
                                .frame(width: 100, height: 52)
                                .background(ReadingSpace.profilePaper, in: RoundedRectangle(cornerRadius: 10))
                                .overlay(RoundedRectangle(cornerRadius: 10)
                                    .strokeBorder(selectedThreadID == thread.id ? AppTheme.primary : ReadingSpace.profileLine, lineWidth: 1))
                                .foregroundStyle(selectedThreadID == thread.id ? AppTheme.primary : ReadingSpace.ink)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .position(point)
                            .accessibilityLabel(thread.title)
                            .accessibilityHint("查看情节线索及相关人物")
                        }
                    }
                }
                .contentShape(Rectangle())
                .clipped()
                .gesture(DragGesture(minimumDistance: 12)
                    .updating($drag) { value, state, _ in state = value.translation }
                    .onEnded { value in
                        offset.width += value.translation.width
                        offset.height += value.translation.height
                    })
                .simultaneousGesture(MagnificationGesture()
                    .updating($magnification) { value, state, _ in state = value }
                    .onEnded { value in zoom = min(12, max(0.5, zoom * value)) })
            }
            .frame(height: 340)
            .accessibilityElement(children: .contain)
            .accessibilityLabel("人物关系图，可通过下方人物索引浏览全部信息")
            HStack(spacing: 4) {
                Button("缩小", systemImage: "minus.magnifyingglass") { zoom = max(0.5, zoom / 1.3) }
                    .labelStyle(.iconOnly)
                    .frame(minWidth: 48, minHeight: 48)
                Button("放大", systemImage: "plus.magnifyingglass") { zoom = min(12, zoom * 1.3) }
                    .labelStyle(.iconOnly)
                    .frame(minWidth: 48, minHeight: 48)
                Spacer(minLength: 4)
                Button("适应画布", systemImage: "arrow.up.left.and.arrow.down.right") { reset() }
                    .font(.footnote)
                    .frame(minHeight: 48)
            }
            .padding(.horizontal, 12)
            .buttonStyle(.borderless)
            .background(ReadingSpace.profilePaper.opacity(0.8))
        }
        .clipShape(RoundedRectangle(cornerRadius: 20))
        .overlay(RoundedRectangle(cornerRadius: 20).strokeBorder(ReadingSpace.profileLine, lineWidth: 1))
        .onChange(of: people.map(\.id)) { _, _ in reset() }
        .onChange(of: focus) { _, _ in reset() }
        .onChange(of: threads.map(\.id)) { _, _ in reset() }
        .onChange(of: graph) { _, _ in reset() }
    }

    private func reset() { zoom = 1; offset = .zero }

    private func fittedScale(_ points: [String: StoryGraphPoint], size: CGSize) -> CGFloat {
        let extentX = points.values.map { abs($0.x) }.max() ?? 0
        let extentY = points.values.map { abs($0.y) }.max() ?? 0
        return min(1, max(1, size.width - 110) / CGFloat(max(1, extentX * 2)),
                   max(1, size.height - 100) / CGFloat(max(1, extentY * 2)))
    }

    private func drawPaper(context: inout GraphicsContext, size: CGSize) {
        var dots = Path()
        for x in stride(from: CGFloat(14), to: size.width, by: 24) {
            for y in stride(from: CGFloat(14), to: size.height, by: 24) {
                dots.addEllipse(in: CGRect(x: x, y: y, width: 1.5, height: 1.5))
            }
        }
        context.fill(dots, with: .color(ReadingSpace.profileMuted.opacity(0.2)))
    }

    private func edgeLanes(_ edges: [StoryRelationship]) -> [String: CGFloat] {
        let groups = Dictionary(grouping: edges) { [$0.from, $0.to].sorted() }
        var lanes: [String: CGFloat] = [:]
        for group in groups.values {
            for (index, edge) in group.sorted(by: { $0.id < $1.id }).enumerated() {
                lanes[edge.id] = CGFloat(index) - CGFloat(group.count - 1) / 2
            }
        }
        return lanes
    }

    private func drawEdge(_ edge: StoryRelationship, from: CGPoint, to: CGPoint,
                          lane: CGFloat, showLabel: Bool, context: inout GraphicsContext) {
        let dx = to.x - from.x, dy = to.y - from.y
        let distance = max(1, hypot(dx, dy))
        guard distance > 60 else { return }
        let start = CGPoint(x: from.x + dx / distance * 27, y: from.y + dy / distance * 27)
        let end = CGPoint(x: to.x - dx / distance * 27, y: to.y - dy / distance * 27)
        // Use a canonical normal so reversed directed edges occupy different lanes.
        let direction: CGFloat = edge.from < edge.to ? 1 : -1
        let bend = (24 + lane * 60) * direction
        let control = CGPoint(x: (start.x + end.x) / 2 - dy / distance * bend,
                              y: (start.y + end.y) / 2 + dx / distance * bend)
        var path = Path()
        path.move(to: start)
        path.addQuadCurve(to: end, control: control)
        let active = selectedRelationshipID == edge.id
        let color = active ? AppTheme.primary : ReadingSpace.profileMuted.opacity(0.65)
        context.stroke(path, with: .color(color), style: StrokeStyle(lineWidth: active ? 2 : 1,
                        dash: edge.certainty == "fact" ? [] : [4, 4]))
        if edge.directed {
            let angle = atan2(end.y - control.y, end.x - control.x)
            var arrow = Path()
            arrow.move(to: CGPoint(x: end.x - cos(angle - 0.45) * 9, y: end.y - sin(angle - 0.45) * 9))
            arrow.addLine(to: end)
            arrow.addLine(to: CGPoint(x: end.x - cos(angle + 0.45) * 9, y: end.y - sin(angle + 0.45) * 9))
            context.stroke(arrow, with: .color(color), lineWidth: active ? 2 : 1)
        }
        if showLabel {
            let midpoint = CGPoint(x: (start.x + 2 * control.x + end.x) / 4, y: (start.y + 2 * control.y + end.y) / 4)
            let label = context.resolve(Text(edge.label).font(.caption2).foregroundColor(ReadingSpace.ink))
            let measured = label.measure(in: CGSize(width: 130, height: 38))
            let rect = CGRect(x: midpoint.x - measured.width / 2 - 4, y: midpoint.y - measured.height / 2 - 2,
                              width: measured.width + 8, height: measured.height + 4)
            context.fill(Path(roundedRect: rect, cornerRadius: 4), with: .color(ReadingSpace.profilePaper))
            context.draw(label, in: rect.insetBy(dx: 4, dy: 2))
        }
    }
}
