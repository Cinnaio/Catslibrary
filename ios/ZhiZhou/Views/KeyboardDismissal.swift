import SwiftUI
import UIKit

/// 在 App 根窗口监听外部点击，统一收起当前输入控件的键盘。
/// 文本输入控件自身的点击会被忽略，保证切换输入位置时键盘不会闪退。
struct GlobalKeyboardDismissal: UIViewRepresentable {
    func makeUIView(context: Context) -> KeyboardDismissalHostView {
        KeyboardDismissalHostView()
    }

    func updateUIView(_ uiView: KeyboardDismissalHostView, context: Context) {}
}

final class KeyboardDismissalHostView: UIView, UIGestureRecognizerDelegate {
    private weak var attachedWindow: UIWindow?
    private lazy var tapGesture: UITapGestureRecognizer = {
        let gesture = UITapGestureRecognizer(target: self, action: #selector(handleTap(_:)))
        gesture.cancelsTouchesInView = false
        gesture.delegate = self
        return gesture
    }()

    override init(frame: CGRect) {
        super.init(frame: frame)
        isUserInteractionEnabled = false
        isAccessibilityElement = false
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
        isUserInteractionEnabled = false
        isAccessibilityElement = false
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        guard attachedWindow !== window else { return }
        attachedWindow?.removeGestureRecognizer(tapGesture)
        attachedWindow = window
        window?.addGestureRecognizer(tapGesture)
    }

    deinit {
        attachedWindow?.removeGestureRecognizer(tapGesture)
    }

    @objc private func handleTap(_ gesture: UITapGestureRecognizer) {
        guard gesture.state == .ended else { return }
        attachedWindow?.endEditing(true)
    }

    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
        var view = touch.view
        while let current = view {
            if current is UITextField || current is UITextView {
                return false
            }
            view = current.superview
        }
        return true
    }
}
