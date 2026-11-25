import SwiftUI
import UIKit

/// 页面内的原生搜索输入框，与书单共用宽度；保留中文输入、清除、搜索键和读屏语义。
struct ReadingSpaceSearchField: UIViewRepresentable {
    @Binding var text: String
    @Binding var isFocused: Bool
    let prompt: String
    let accessibilityID: String
    var onSubmit: () -> Void = {}

    func makeUIView(context: Context) -> UISearchTextField {
        let field = UISearchTextField()
        field.delegate = context.coordinator
        field.addTarget(context.coordinator, action: #selector(Coordinator.textChanged(_:)), for: .editingChanged)
        field.returnKeyType = .search
        field.clearButtonMode = .whileEditing
        field.autocapitalizationType = .none
        field.autocorrectionType = .no
        field.adjustsFontForContentSizeCategory = true
        field.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        return field
    }

    func updateUIView(_ field: UISearchTextField, context: Context) {
        context.coordinator.parent = self
        field.placeholder = prompt
        field.accessibilityLabel = prompt
        field.accessibilityIdentifier = accessibilityID
        field.textColor = UIColor(ReadingSpace.ink)
        field.tintColor = UIColor(AppTheme.primary)
        field.font = UIFont.preferredFont(forTextStyle: .body, compatibleWith: field.traitCollection)
        // 不改写正在组词的文本，以免拼音候选被异步查询更新打断。
        if field.markedTextRange == nil, field.text != text { field.text = text }
        if isFocused, !field.isFirstResponder {
            DispatchQueue.main.async { [weak field, weak coordinator = context.coordinator] in
                guard let field, field.window != nil, coordinator?.parent.isFocused == true else { return }
                field.becomeFirstResponder()
            }
        } else if !isFocused, field.isFirstResponder {
            field.resignFirstResponder()
        }
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: UISearchTextField, context: Context) -> CGSize? {
        guard let width = proposal.width else { return nil }
        let lineHeight = uiView.font?.lineHeight ?? 22
        return CGSize(width: width, height: max(AppLayout.minimumTouchTarget, ceil(lineHeight) + 20))
    }

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, UITextFieldDelegate {
        var parent: ReadingSpaceSearchField

        init(_ parent: ReadingSpaceSearchField) { self.parent = parent }

        @objc func textChanged(_ field: UISearchTextField) {
            guard field.markedTextRange == nil else { return }
            let value = field.text ?? ""
            if parent.text != value { parent.text = value }
        }

        func textFieldDidBeginEditing(_ textField: UITextField) {
            if !parent.isFocused { parent.isFocused = true }
        }

        func textFieldDidEndEditing(_ textField: UITextField) {
            let value = textField.text ?? ""
            if parent.text != value { parent.text = value }
            if parent.isFocused { parent.isFocused = false }
        }

        func textFieldShouldReturn(_ textField: UITextField) -> Bool {
            let value = textField.text ?? ""
            if parent.text != value { parent.text = value }
            parent.onSubmit()
            textField.resignFirstResponder()
            return true
        }
    }
}
