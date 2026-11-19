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
            case warning
            case error

            var systemImage: String {
                switch self {
                case .success: return "checkmark.circle.fill"
                case .info: return "info.circle.fill"
                case .warning: return "exclamationmark.triangle.fill"
                case .error: return "exclamationmark.triangle.fill"
                }
            }

            var tint: Color {
                switch self {
                case .success: return AppTheme.success
                case .info: return AppTheme.primary
                case .warning: return AppTheme.warning
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
        UIAccessibility.post(notification: .announcement, argument: trimmed)
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

    static func success(_ message: String? = nil, using center: AppFeedbackCenter? = nil) {
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        let center = center ?? AppFeedbackCenter.shared
        if let message {
            center.show(message)
        } else {
            center.dismiss()
        }
    }

    static func warning(_ message: String? = nil) {
        UINotificationFeedbackGenerator().notificationOccurred(.warning)
        if let message {
            AppFeedbackCenter.shared.show(message, kind: .warning)
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
    var edge: VerticalEdge = .top
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            if let message = center.message {
                AppFeedbackBanner(message: message, showsCloseIcon: edge == .bottom) {
                    center.dismiss()
                }
                .padding(.horizontal, AppLayout.pageInset)
                .padding(.vertical, edge == .bottom ? 8 : 0)
                .transition(
                    reduceMotion
                        ? .opacity
                        : .offset(y: edge == .bottom ? 8 : -8).combined(with: .opacity)
                )
            }
        }
        .frame(maxWidth: .infinity)
        .animation(
            reduceMotion ? AppMotion.micro : AppMotion.press,
            value: center.message?.id
        )
    }
}

private struct AppFeedbackBanner: View {
    let message: AppFeedbackCenter.Message
    let showsCloseIcon: Bool
    let onDismiss: () -> Void

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: AppTheme.fieldCornerRadius)

        Button(action: onDismiss) {
            HStack(spacing: 12) {
                Image(systemName: message.kind.systemImage)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(message.kind.tint)
                    .padding(6)
                    .background(message.kind.tint.opacity(0.12), in: Circle())
                    .accessibilityHidden(true)

                Text(message.text)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(AppTheme.textPrimary)
                    .multilineTextAlignment(.leading)
                    .appTextLineLimit(2)
                    .frame(maxWidth: showsCloseIcon ? .infinity : nil, alignment: .leading)

                if showsCloseIcon {
                    Image(systemName: "xmark")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(AppTheme.textSecondary)
                        .padding(6)
                        .accessibilityHidden(true)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .frame(minHeight: AppLayout.minimumTouchTarget)
            .background(AppTheme.surface, in: shape)
            .overlay {
                shape.strokeBorder(AppTheme.border.opacity(0.75), lineWidth: 1)
                    .allowsHitTesting(false)
            }
            .contentShape(shape)
            .shadow(color: AppTheme.cardShadow, radius: 14, y: 5)
        }
        .frame(maxWidth: 380)
        .buttonStyle(ScaleButtonStyle(pressedScale: 0.985))
        .accessibilityLabel(message.text)
        .accessibilityHint("点按关闭提示")
    }
}
