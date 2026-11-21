import SwiftUI

/// 阅读与创作空间的纸面层次；系统表单和阅读器自选底色独立保留。
enum ReadingSpace {
    static let canvas = Color(light: "F6F3EC", dark: "211F1C")
    static let paper = Color(light: "FFFCF5", dark: "2C2925")
    static let line = Color(light: "E7E1D8", dark: "48443C")
    static let fill = Color(light: "F0ECE5", dark: "35322D")
    static let ink = Color(light: "302C26", dark: "EEE7DA")
    static let summary = Color(light: "292724", dark: "181917")
    static let onSummary = Color(hex: "F4EDE2")
    static let summarySecondary = Color(hex: "CCC1B0")
    // 个人书房、书架和创作首页共用连续纸面与深色重点区。
    static let profilePaper = Color(light: "FAF8F4", dark: "242320")
    static let profileMuted = Color(light: "756F65", dark: "B6AFA2")
    static let profileLine = Color(light: "E7E1D8", dark: "48443C")
    static let profileFill = Color(light: "F0ECE5", dark: "35322D")
    static let profileReadDay = Color(hex: "474139")
    static let profileToday = Color(hex: "D9C4A1")
    static let userMessage = Color(light: "EEDFD2", dark: "49372D")
    static let panelRadius: CGFloat = 24
}

/// 摘录沿纸面左缘标记，供想法列表和段评来源共用。
struct ReadingSpaceQuote: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.subheadline)
            .foregroundStyle(ReadingSpace.profileMuted)
            .lineSpacing(4)
            .appTextLineLimit(3)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 8)
            .padding(.leading, 14)
            .overlay(alignment: .leading) {
                Rectangle().fill(ReadingSpace.profileLine).frame(width: 2)
            }
    }
}

/// 原生 List 保留复用、侧滑和刷新，所有行落在同一张纸上。
struct ReadingSpaceRoomListStyle: ViewModifier {
    func body(content: Content) -> some View {
        content
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .contentMargins(.top, 0, for: .scrollContent)
            .contentMargins(.horizontal, 0, for: .scrollContent)
            .environment(\.defaultMinListRowHeight, AppLayout.minimumTouchTarget)
            .background(ReadingSpace.profilePaper)
    }
}

extension View {
    func readingSpaceTopEdge() -> some View {
        modifier(ReadingSpaceTopEdge())
    }

    func readingSpaceEntrance(_ index: Int = 0) -> some View {
        modifier(ReadingSpaceEntrance(index: index))
    }
}

/// 子页共用原生柔和顶部过渡，辅助功能模式保留清晰边界。
private struct ReadingSpaceTopEdge: ViewModifier {
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.colorSchemeContrast) private var contrast

    func body(content: Content) -> some View {
        content
            .scrollEdgeEffectStyle(reduceTransparency || contrast == .increased ? .hard : .soft, for: .top)
    }
}

private struct ReadingSpaceEntrance: ViewModifier {
    let index: Int
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var appeared = false

    func body(content: Content) -> some View {
        content
            .opacity(appeared || reduceMotion ? 1 : 0)
            .offset(y: appeared || reduceMotion ? 0 : 6)
            .onAppear {
                withAnimation(reduceMotion ? nil : .easeOut(duration: 0.24).delay(min(Double(index) * 0.035, 0.21))) {
                    appeared = true
                }
            }
    }
}
