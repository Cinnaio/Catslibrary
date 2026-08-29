import SwiftUI
import UIKit

/// 可选中的正文文本：保留 iOS 原生选区手柄、复制菜单和选择反馈，
/// 并在选区菜单中增加“写段评”。
struct SelectableTextView: UIViewRepresentable {
    let attributedText: NSAttributedString
    let textColor: UIColor
    let menuTitle: String
    let isThoughtActionEnabled: Bool
    let onThought: (String, NSRange) -> Void

    func makeUIView(context: Context) -> ThoughtSelectableTextView {
        let view = ThoughtSelectableTextView()
        configure(view)
        return view
    }

    func updateUIView(_ uiView: ThoughtSelectableTextView, context: Context) {
        configure(uiView)
    }

    @available(iOS 16.0, *)
    func sizeThatFits(
        _ proposal: ProposedViewSize,
        uiView: ThoughtSelectableTextView,
        context: Context
    ) -> CGSize? {
        guard let width = proposal.width, width > 0 else { return nil }
        let fitting = uiView.sizeThatFits(
            CGSize(width: width, height: CGFloat.greatestFiniteMagnitude)
        )
        return CGSize(width: width, height: ceil(fitting.height))
    }

    private func configure(_ view: ThoughtSelectableTextView) {
        view.menuTitle = menuTitle
        view.isThoughtActionEnabled = isThoughtActionEnabled
        view.textColor = textColor
        view.onThought = onThought
        let renderedText = NSMutableAttributedString(attributedString: attributedText)
        if renderedText.length > 0 {
            renderedText.addAttribute(
                .foregroundColor,
                value: textColor,
                range: NSRange(location: 0, length: renderedText.length)
            )
        }
        if view.attributedText?.isEqual(to: renderedText) != true {
            view.attributedText = renderedText
        }
        // 字体或容器宽度变化会让 UITextView 暂时保留旧的横向偏移；正文不可横向滚动，
        // 每次重排后都把它归零，避免切换字号时文字整体向左漂移。
        view.setContentOffset(.zero, animated: false)
        view.invalidateIntrinsicContentSize()
    }
}

final class ThoughtSelectableTextView: UITextView {
    var menuTitle = "写段评"
    var isThoughtActionEnabled = true
    var onThought: ((String, NSRange) -> Void)?

    override init(frame: CGRect, textContainer: NSTextContainer?) {
        super.init(frame: frame, textContainer: textContainer)
        configureInteraction()
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
        configureInteraction()
    }

    private func configureInteraction() {
        isEditable = false
        isSelectable = true
        isScrollEnabled = false
        showsVerticalScrollIndicator = false
        showsHorizontalScrollIndicator = false
        allowsEditingTextAttributes = false
        backgroundColor = .clear
        textContainerInset = .zero
        textContainer.lineFragmentPadding = 0
        setContentCompressionResistancePriority(.required, for: .vertical)
    }

    private var hasSelection: Bool {
        selectedRange.location != NSNotFound && selectedRange.length > 0
    }

    private var selectedTextValue: String? {
        guard hasSelection, let selectedTextRange else { return nil }
        return text(in: selectedTextRange)
    }

    override func canPerformAction(_ action: Selector, withSender sender: Any?) -> Bool {
        if action == #selector(addThoughtFromSelection(_:)) {
            return isThoughtActionEnabled && hasSelection
        }
        return super.canPerformAction(action, withSender: sender)
    }

    override func buildMenu(with builder: UIMenuBuilder) {
        super.buildMenu(with: builder)
        guard isThoughtActionEnabled, hasSelection else { return }

        let command = UICommand(
            title: menuTitle,
            action: #selector(addThoughtFromSelection(_:))
        )
        let thoughtMenu = UIMenu(
            title: "",
            options: .displayInline,
            children: [command]
        )
        builder.insertChild(thoughtMenu, atStartOfMenu: .edit)
    }

    @objc private func addThoughtFromSelection(_ sender: Any?) {
        guard let selectedText = selectedTextValue, hasSelection else { return }
        onThought?(selectedText, selectedRange)
    }
}
