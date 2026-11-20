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
    // 个人书房采用连续纸面，其余阅读与创作页面保留各自的面板层次。
    static let profilePaper = Color(light: "FAF8F4", dark: "242320")
    static let profileMuted = Color(light: "756F65", dark: "B6AFA2")
    static let profileLine = Color(light: "E7E1D8", dark: "48443C")
    static let profileFill = Color(light: "F0ECE5", dark: "35322D")
    static let profileReadDay = Color(hex: "474139")
    static let profileToday = Color(hex: "D9C4A1")
    static let userMessage = Color(light: "EEDFD2", dark: "49372D")
    static let panelRadius: CGFloat = 24
}

struct ReadingSpaceHeading: View {
    let title: String
    let subtitle: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(serifFont(.largeTitle, .semibold))
                .foregroundStyle(ReadingSpace.ink)
                .accessibilityAddTraits(.isHeader)
            Text(subtitle)
                .font(.subheadline)
                .foregroundStyle(AppTheme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 12)
    }
}

extension View {
    func readingSpaceEntrance(_ index: Int = 0) -> some View {
        modifier(ReadingSpaceEntrance(index: index))
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
