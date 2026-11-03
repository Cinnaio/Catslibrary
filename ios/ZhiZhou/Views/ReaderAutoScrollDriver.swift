import SwiftUI
import UIKit
import ZhiZhouCore

/// Drives the native scroll view without publishing each frame through SwiftUI.
struct ReaderAutoScrollDriver: UIViewRepresentable {
    let active: Bool
    let speed: ReaderAutoScrollSpeed
    let onPause: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator() }
    func makeUIView(context: Context) -> UIView {
        let view = UIView()
        view.isUserInteractionEnabled = false
        view.accessibilityElementsHidden = true
        context.coordinator.anchor = view
        return view
    }
    func updateUIView(_ uiView: UIView, context: Context) {
        context.coordinator.speed = speed
        context.coordinator.onPause = onPause
        context.coordinator.setActive(active && speed != .off)
    }
    static func dismantleUIView(_ uiView: UIView, coordinator: Coordinator) { coordinator.setActive(false) }

    @MainActor
    final class Coordinator: NSObject {
        weak var anchor: UIView?
        var speed: ReaderAutoScrollSpeed = .off
        var onPause: (() -> Void)?
        private var displayLink: CADisplayLink?
        private var lastTimestamp: CFTimeInterval?

        func setActive(_ active: Bool) {
            if active {
                guard displayLink == nil else { return }
                lastTimestamp = nil
                let link = CADisplayLink(target: self, selector: #selector(tick(_:)))
                link.add(to: .main, forMode: .common)
                displayLink = link
            } else {
                displayLink?.invalidate()
                displayLink = nil
                lastTimestamp = nil
            }
        }

        @objc private func tick(_ link: CADisplayLink) {
            var ancestor = anchor?.superview
            while let view = ancestor, !(view is UIScrollView) { ancestor = view.superview }
            guard let scroll = ancestor as? UIScrollView else { lastTimestamp = nil; return }
            if scroll.isTracking || scroll.isDragging || scroll.isDecelerating || UIAccessibility.isVoiceOverRunning || hasPresentedContent {
                pause()
                return
            }
            let minimum = -scroll.adjustedContentInset.top
            let maximum = max(minimum, scroll.contentSize.height - scroll.bounds.height + scroll.adjustedContentInset.bottom)
            guard scroll.contentSize.height > 0, scroll.bounds.height > 0 else { return }
            if scroll.contentOffset.y >= maximum - 0.5 { pause(); return }
            defer { lastTimestamp = link.timestamp }
            guard let previous = lastTimestamp else { return }
            let offset = speed.nextOffset(current: Double(scroll.contentOffset.y), maximum: Double(maximum), elapsed: link.timestamp - previous)
            scroll.setContentOffset(CGPoint(x: scroll.contentOffset.x, y: CGFloat(offset)), animated: false)
        }

        private func pause() {
            setActive(false)
            onPause?()
        }

        /// Image previews present from a child hosting controller, independently of reader sheet state.
        private var hasPresentedContent: Bool {
            var responder: UIResponder? = anchor
            while let current = responder {
                if let controller = current as? UIViewController {
                    var ancestor: UIViewController? = controller
                    while let candidate = ancestor {
                        if candidate.presentedViewController != nil { return true }
                        ancestor = candidate.parent
                    }
                    return false
                }
                responder = current.next
            }
            return false
        }
    }
}
