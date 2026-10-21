import SwiftUI
import UIKit

/// 可选中的正文文本：保留 iOS 原生选区手柄、复制菜单和选择反馈，
/// 并在选区菜单中增加“写段评”。
struct SelectableTextView: UIViewRepresentable {
    let attributedText: NSAttributedString
    let textColor: UIColor
    let menuTitle: String
    let isThoughtActionEnabled: Bool
    var accessibilityID: String? = nil
    var thoughtCount: Int = 0
    var thoughtMarkerColor: UIColor = .secondaryLabel
    var onThoughtMarkerTap: (() -> Void)? = nil
    var onBodyTap: ((CGPoint) -> Void)? = nil
    var onSelectionChange: ((Bool) -> Void)? = nil
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
        view.accessibilityIdentifier = accessibilityID
        if view.textColor?.isEqual(textColor) != true {
            view.textColor = textColor
        }
        view.onThought = onThought
        view.onThoughtMarkerTap = onThoughtMarkerTap
        view.onBodyTap = onBodyTap
        view.onSelectionChange = onSelectionChange
        let sameAttributedText = view.configuredAttributedText === attributedText
            || view.configuredAttributedText?.isEqual(to: attributedText) == true
        let needsTextUpdate = !sameAttributedText
            || view.configuredTextColor?.isEqual(textColor) != true
            || view.configuredThoughtCount != thoughtCount
            || view.thoughtMarkerButton.tintColor.isEqual(thoughtMarkerColor) != true
        if needsTextUpdate {
            view.isApplyingTextUpdate = true
            defer { view.isApplyingTextUpdate = false }
            let renderedText = NSMutableAttributedString(attributedString: attributedText)
            if renderedText.length > 0 {
                renderedText.addAttribute(
                    .foregroundColor,
                    value: textColor,
                    range: NSRange(location: 0, length: renderedText.length)
                )
            }
            view.setBodyText(renderedText, thoughtCount: thoughtCount, markerColor: thoughtMarkerColor)
            view.configuredAttributedText = attributedText
            view.configuredTextColor = textColor
            // 字体或容器宽度变化会让 UITextView 暂时保留旧的横向偏移；正文不可横向滚动，
            // 每次真正重排后都把它归零，避免切换字号时文字整体向左漂移。
            view.setContentOffset(.zero, animated: false)
            view.invalidateIntrinsicContentSize()
        }
    }
}

final class ThoughtSelectableTextView: UITextView, UITextViewDelegate {
    var menuTitle = "写段评"
    var isThoughtActionEnabled = true
    var onThought: ((String, NSRange) -> Void)?
    var onSelectionChange: ((Bool) -> Void)?
    var onThoughtMarkerTap: (() -> Void)?
    var onBodyTap: ((CGPoint) -> Void)? {
        didSet { bodyTapRecognizer.isEnabled = onBodyTap != nil }
    }
    private let bodyTapDelegate = ReaderBodyTapDelegate()
    private lazy var bodyTapRecognizer = UITapGestureRecognizer(target: self, action: #selector(tapBody(_:)))
    private(set) var configuredThoughtCount = 0
    let thoughtMarkerButton = UIButton(type: .system)
    private(set) var thoughtMarkerRange: NSRange?
    private var sourceTextLength: Int?
    var isApplyingTextUpdate = false
    /// The incoming attributed text is intentionally tracked separately from
    /// `attributedText`: the rendered UIKit value also contains the bridge's
    /// foreground-color attribute, so comparing the two directly would make
    /// every SwiftUI update look like a text change.
    var configuredAttributedText: NSAttributedString?
    var configuredTextColor: UIColor?
    // NSTextContainer.layoutManager and NSLayoutManager.textStorage are unowned(unsafe).
    // Keep the root alive before UIKit receives the container, including optimized builds.
    private let retainedTextStorage: NSTextStorage?

    override init(frame: CGRect, textContainer: NSTextContainer?) {
        // Use the same TextKit 1 geometry as pagination, with a custom quote underline renderer.
        let container = textContainer ?? NSTextContainer(size: CGSize(width: 0, height: CGFloat.greatestFiniteMagnitude))
        container.widthTracksTextView = true
        if textContainer == nil {
            let storage = NSTextStorage()
            let manager = ThoughtWaveLayoutManager()
            storage.addLayoutManager(manager)
            manager.addTextContainer(container)
            retainedTextStorage = storage
        } else {
            retainedTextStorage = nil
        }
        super.init(frame: frame, textContainer: container)
        configureInteraction()
    }

    required init?(coder: NSCoder) {
        retainedTextStorage = nil
        super.init(coder: coder)
        configureInteraction()
    }

    private func configureInteraction() {
        delegate = self
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
        thoughtMarkerButton.isHidden = true
        thoughtMarkerButton.addTarget(self, action: #selector(openThoughtMarker), for: .touchUpInside)
        addSubview(thoughtMarkerButton)
        bodyTapDelegate.marker = thoughtMarkerButton
        bodyTapRecognizer.delegate = bodyTapDelegate
        bodyTapRecognizer.cancelsTouchesInView = false
        bodyTapRecognizer.isEnabled = false
        addGestureRecognizer(bodyTapRecognizer)
    }

    /// Reserve the marker's width in TextKit, so it follows the last character
    /// and wraps as a unit. The control itself remains a native 44pt button.
    func setBodyText(_ body: NSAttributedString, thoughtCount: Int, markerColor: UIColor) {
        sourceTextLength = body.length
        configuredThoughtCount = thoughtCount
        thoughtMarkerRange = nil
        thoughtMarkerButton.isHidden = thoughtCount <= 0
        thoughtMarkerButton.tintColor = markerColor
        textContainerInset = .zero
        let rendered = NSMutableAttributedString(attributedString: body)
        if thoughtCount > 0, body.length > 0 {
            let font = body.attribute(.font, at: body.length - 1, effectiveRange: nil) as? UIFont
                ?? UIFont.preferredFont(forTextStyle: .body)
            var configuration = UIButton.Configuration.plain()
            configuration.image = UIImage(systemName: "text.bubble")
            configuration.preferredSymbolConfigurationForImage = UIImage.SymbolConfiguration(textStyle: .caption2)
            configuration.title = String(thoughtCount)
            configuration.imagePadding = 4
            configuration.contentInsets = .zero
            configuration.baseForegroundColor = markerColor
            configuration.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { attributes in
                var attributes = attributes
                attributes.font = UIFont.preferredFont(forTextStyle: .caption2)
                return attributes
            }
            thoughtMarkerButton.configuration = configuration
            thoughtMarkerButton.accessibilityLabel = "\(thoughtCount) 条段评"
            thoughtMarkerButton.accessibilityHint = "查看此段落的想法"
            let markerWidth = max(44, thoughtMarkerButton.intrinsicContentSize.width)
            let attachment = NSTextAttachment()
            attachment.bounds = CGRect(x: 0, y: font.descender, width: markerWidth, height: font.lineHeight)
            var attributes: [NSAttributedString.Key: Any] = [.font: font]
            if let style = body.attribute(.paragraphStyle, at: body.length - 1, effectiveRange: nil) {
                attributes[.paragraphStyle] = style
            }
            rendered.append(NSAttributedString(string: " ", attributes: attributes))
            thoughtMarkerRange = NSRange(location: rendered.length, length: 1)
            let placeholder = NSMutableAttributedString(attributedString: NSAttributedString(attachment: attachment))
            placeholder.addAttributes(attributes, range: NSRange(location: 0, length: 1))
            rendered.append(placeholder)
            textContainerInset.bottom = max(0, (44 - font.lineHeight) / 2)
        } else {
            thoughtMarkerButton.isHidden = true
        }
        attributedText = rendered
        invalidateIntrinsicContentSize()
        setNeedsLayout()
    }

    override func sizeThatFits(_ size: CGSize) -> CGSize {
        let fitting = super.sizeThatFits(size)
        return CGSize(width: fitting.width, height: max(fitting.height, thoughtMarkerRange == nil ? 0 : 44))
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        guard let thoughtMarkerRange else { return }
        layoutManager.ensureLayout(for: textContainer)
        let glyphs = layoutManager.glyphRange(forCharacterRange: thoughtMarkerRange, actualCharacterRange: nil)
        let rect = layoutManager.boundingRect(forGlyphRange: glyphs, in: textContainer)
        thoughtMarkerButton.frame = CGRect(
            x: rect.minX + textContainerInset.left,
            y: max(0, rect.midY + textContainerInset.top - 22),
            width: rect.width,
            height: 44
        )
    }

    @objc private func openThoughtMarker() {
        onThoughtMarkerTap?()
    }

    @objc private func tapBody(_ recognizer: UITapGestureRecognizer) {
        guard !hasSelection else { return }
        onBodyTap?(recognizer.location(in: self))
    }

    private var selectedBodyRange: NSRange {
        let length = sourceTextLength ?? textStorage.length
        guard selectedRange.location != NSNotFound, selectedRange.location < length else {
            return NSRange(location: 0, length: 0)
        }
        return NSRange(location: selectedRange.location, length: min(selectedRange.length, length - selectedRange.location))
    }

    private var hasSelection: Bool {
        selectedBodyRange.length > 0
    }

    func textViewDidChangeSelection(_ textView: UITextView) {
        guard !isApplyingTextUpdate else { return }
        onSelectionChange?(hasSelection)
    }

    private var selectedTextValue: String? {
        guard hasSelection else { return nil }
        return (textStorage.string as NSString).substring(with: selectedBodyRange)
    }

    override func copy(_ sender: Any?) {
        guard thoughtMarkerRange != nil else { super.copy(sender); return }
        if let selectedTextValue { UIPasteboard.general.string = selectedTextValue }
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

    @objc func addThoughtFromSelection(_ sender: Any?) {
        guard let selectedText = selectedTextValue, hasSelection else { return }
        onThought?(selectedText, selectedBodyRange)
    }
}

/// The inline marker must never also trigger a reader edge tap or toolbar toggle.
private final class ReaderBodyTapDelegate: NSObject, UIGestureRecognizerDelegate {
    weak var marker: UIButton?

    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
        guard let marker, let touchedView = touch.view else { return true }
        return !touchedView.isDescendant(of: marker)
    }

    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer,
                           shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer) -> Bool {
        true
    }
}
