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


/// 照片和纸面在列表的首行内交叠，保留列表自身的导航安全区。
struct ReadingSpaceRoomHeader: View {
    let title: String
    let symbol: String

    var body: some View {
        VStack(spacing: 0) {
            GeometryReader { geometry in
                Image("ReadingWindow")
                    .resizable()
                    .scaledToFill()
                    .frame(width: geometry.size.width, height: geometry.size.height)
                    .clipped()
                    .overlay(Color.black.opacity(0.22))
                    .accessibilityHidden(true)
            }
            .frame(height: 182)
            .overlay(alignment: .top) {
                LinearGradient(colors: [ReadingSpace.profilePaper.opacity(0.8), .clear],
                               startPoint: .top, endPoint: .bottom)
                    .frame(height: 18)
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
            }

            Text(title)
                .font(serifFont(.title, .medium))
                .foregroundStyle(ReadingSpace.ink)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
                .padding(.horizontal, 22)
                .padding(.top, 42)
                .padding(.bottom, 14)
                .frame(maxWidth: .infinity)
                .background {
                    UnevenRoundedRectangle(topLeadingRadius: 32, topTrailingRadius: 32)
                        .fill(ReadingSpace.profilePaper)
                }
                .overlay(alignment: .top) {
                    Image(systemName: symbol)
                        .font(.system(size: 24, weight: .light))
                        .foregroundStyle(ReadingSpace.ink)
                        .frame(width: 58, height: 58)
                        .background(ReadingSpace.profileFill, in: Circle())
                        .padding(5)
                        .background(ReadingSpace.profilePaper, in: Circle())
                        .offset(y: -34)
                        .accessibilityHidden(true)
                }
                .padding(.top, -26)
        }
        .listRowInsets(EdgeInsets())
        .listRowBackground(Color.clear)
        .listRowSeparator(.hidden)
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
