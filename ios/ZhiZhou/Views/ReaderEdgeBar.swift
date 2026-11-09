import SwiftUI

/// Observes timer updates here, without making ReaderView subscribe to session ticks.
struct ReaderEdgeBar: View {
    let store: ReaderEdgeStore
    let open: () -> Void
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    var body: some View {
        if store.authorized, let session = store.session {
            let layout = dynamicTypeSize.isAccessibilitySize
                ? AnyLayout(VStackLayout(alignment: .leading, spacing: 4))
                : AnyLayout(HStackLayout(spacing: 6))
            VStack(alignment: .leading, spacing: 2) {
                layout {
                    Button(action: open) {
                        HStack(spacing: 8) {
                            ReaderEdgePulse(session: session)
                            Text(session.phaseTitle).font(.subheadline.weight(.medium))
                            if store.data?.settings.hiddenRemaining != true {
                                Text(readerEdgeTime(session.remainingMs)).font(.subheadline.monospacedDigit())
                            }
                        }
                        .frame(minHeight: 44).contentShape(Rectangle())
                    }
                    .accessibilityLabel("打开节拍指令，\(session.phaseTitle)")
                    .accessibilityValue(store.data?.settings.hiddenRemaining == true
                                        ? "剩余时间已隐藏" : "剩余 \(readerEdgeTime(session.remainingMs))")
                    if !dynamicTypeSize.isAccessibilitySize { Spacer(minLength: 0) }
                    if horizontalSizeClass == .regular && session.bpm > 0 && session.isAdvancing {
                        Text("\(session.bpm) BPM").font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                    }
                    HStack(spacing: 2) { actions(session) }
                }
                Text(session.status == .finished ? (store.catalog?.endings[session.ending ?? ""] ?? "本次结束") : session.command)
                    .font(.subheadline)
                    .fixedSize(horizontal: false, vertical: true)
                if session.isActive {
                    let summary = [
                        session.settings.acts ? store.catalog?.acts[session.act] : nil,
                        session.feedback.sprinting ? "冲刺" : nil,
                        session.settings.bank ? "银行 \(session.bank) 点" : nil,
                    ].compactMap { $0 }.joined(separator: " · ")
                    if !summary.isEmpty {
                        Text(summary).font(.caption).foregroundStyle(.secondary)
                    }
                    if let hint = session.feedback.timingHint {
                        Text(hint).font(.caption).foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            .buttonStyle(.plain)
            .frame(maxWidth: 520)
            .padding(.horizontal, 16)
            .padding(.bottom, 10)
            .frame(maxWidth: .infinity)
        }
    }

    @ViewBuilder
    private func actions(_ session: ReaderEdgeSession) -> some View {
        if session.isActive {
            if session.status == .permit {
                icon("checkmark", title: "按下了", action: store.reportCompletion)
            } else if session.status == .running || session.status == .cooldown {
                icon("checkmark", title: "忍住了", action: { store.declareEdge() })
                    .disabled(!session.canDeclare)
            }
            icon(session.status == .paused ? "play.fill" : "pause.fill",
                 title: session.status == .paused ? "继续节拍" : "暂停节拍",
                 action: session.status == .paused ? store.resume : store.pause)
        } else {
            icon("xmark", title: "清掉结果", action: store.reset)
        }
        icon("slider.horizontal.3", title: "打开节拍面板", action: open)
    }

    private func icon(_ name: String, title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: name).font(.system(size: 15, weight: .medium))
                .frame(width: 44, height: 44).contentShape(Rectangle())
        }
        .accessibilityLabel(title)
    }
}
