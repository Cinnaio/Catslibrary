import Observation
import SwiftUI
import UIKit

/// 全局的轻量操作结果提示：短暂出现，不打断阅读或改变当前导航位置。
@MainActor
@Observable
final class AppFeedbackCenter {
    static let shared = AppFeedbackCenter()

    struct Message: Identifiable, Equatable {
        enum Kind: Equatable {
            case success
            case info
            case error

            var systemImage: String {
                switch self {
                case .success: return "checkmark.circle.fill"
                case .info: return "info.circle.fill"
                case .error: return "exclamationmark.triangle.fill"
                }
            }

            var tint: Color {
                switch self {
                case .success: return AppTheme.success
                case .info: return AppTheme.primary
                case .error: return AppTheme.danger
                }
            }
        }

        let id: UUID
        let text: String
        let kind: Kind

        init(text: String, kind: Kind) {
            id = UUID()
            self.text = text
            self.kind = kind
        }
    }

    private(set) var message: Message?
    private var dismissTask: Task<Void, Never>?

    func show(_ text: String, kind: Message.Kind = .success) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        let next = Message(text: trimmed, kind: kind)
        message = next
        dismissTask?.cancel()
        dismissTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 2_400_000_000)
            guard !Task.isCancelled else { return }
            guard self?.message?.id == next.id else { return }
            self?.message = nil
        }
    }

    func dismiss() {
        dismissTask?.cancel()
        dismissTask = nil
        message = nil
    }
}

/// 触觉与短消息成对出现：触觉确认结果，消息给出可读的具体内容。
@MainActor
enum AppFeedback {
    static func selection() {
        UISelectionFeedbackGenerator().selectionChanged()
    }

    static func success(_ message: String? = nil) {
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        if let message {
            AppFeedbackCenter.shared.show(message)
        } else {
            AppFeedbackCenter.shared.dismiss()
        }
    }

    static func warning(_ message: String? = nil) {
        UINotificationFeedbackGenerator().notificationOccurred(.warning)
        if let message {
            AppFeedbackCenter.shared.show(message, kind: .info)
        } else {
            AppFeedbackCenter.shared.dismiss()
        }
    }

    static func error(_ message: String? = nil) {
        UINotificationFeedbackGenerator().notificationOccurred(.error)
        if let message {
            AppFeedbackCenter.shared.show(message, kind: .error)
        } else {
            AppFeedbackCenter.shared.dismiss()
        }
    }
}

@MainActor
struct AppFeedbackOverlay: View {
    let center: AppFeedbackCenter
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack(alignment: .top) {
            if let message = center.message {
                AppFeedbackBanner(message: message) {
                    center.dismiss()
                }
                .padding(.horizontal, 16)
                .transition(
                    reduceMotion
                        ? .opacity
                        : .move(edge: .top).combined(with: .opacity)
                )
            }
        }
        .frame(maxWidth: .infinity)
        .animation(
            reduceMotion ? nil : .spring(response: 0.28, dampingFraction: 1),
            value: center.message?.id
        )
    }
}

private struct AppFeedbackBanner: View {
    let message: AppFeedbackCenter.Message
    let onDismiss: () -> Void

    var body: some View {
        Button(action: onDismiss) {
            HStack(spacing: 10) {
                Image(systemName: message.kind.systemImage)
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(message.kind.tint)

                Text(message.text)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(AppTheme.textPrimary)
                    .multilineTextAlignment(.leading)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .frame(minHeight: 48)
            .contentShape(Capsule())
            .background(AppTheme.surface, in: Capsule())
            .overlay {
                Capsule()
                    .strokeBorder(AppTheme.border.opacity(0.65), lineWidth: 0.5)
            }
            .shadow(color: Color.black.opacity(0.12), radius: 12, y: 4)
        }
        .frame(maxWidth: 360)
        .buttonStyle(ScaleButtonStyle(pressedScale: 0.985))
        .accessibilityLabel(message.text)
        .accessibilityHint("点按关闭提示")
        .accessibilityAddTraits(.updatesFrequently)
    }
}
