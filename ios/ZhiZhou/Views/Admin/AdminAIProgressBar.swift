import SwiftUI

/// 长度只反映服务端进度；流光只表示任务活跃，不推进已完成比例。
struct AdminAIProgressBar: View {
    let fraction: Double?
    let isRunning: Bool
    var tint: Color = AppTheme.primary
    var label = "任务进度"

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase

    private var animates: Bool { isRunning && !reduceMotion && scenePhase == .active }

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30, paused: !animates)) { context in
            GeometryReader { geometry in
                let width = geometry.size.width
                let phase = animates ? context.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 2.6) / 2.6 : 0.5
                ZStack(alignment: .leading) {
                    Capsule().fill(AppTheme.controlFill)
                    if let fraction {
                        Capsule()
                            .fill(tint)
                            .frame(width: width * min(1, max(0, fraction)))
                            .overlay {
                                if animates {
                                    GeometryReader { fill in
                                        LinearGradient(
                                            colors: [.clear, AppTheme.surface.opacity(0.45), .clear],
                                            startPoint: .leading, endPoint: .trailing
                                        )
                                        .offset(x: fill.size.width * (phase * 2 - 1))
                                    }
                                    .clipShape(Capsule())
                                }
                            }
                            .animation(reduceMotion ? nil : .easeInOut(duration: 0.35), value: fraction)
                    } else if isRunning {
                        Capsule().fill(tint)
                            .frame(width: width * 0.28)
                            .offset(x: animates ? width * (phase * 1.28 - 0.28) : width * 0.36)
                    }
                }
                .clipShape(Capsule())
            }
        }
        .frame(height: 5)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
        .accessibilityValue(fraction.map { "\(Int(min(1, max(0, $0)) * 100))%" } ?? (isRunning ? "处理中，总量未知" : "暂无进度"))
    }
}
