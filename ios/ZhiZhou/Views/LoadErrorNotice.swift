import SwiftUI

struct LoadErrorNotice: View {
    let message: String
    let isLoading: Bool
    let retry: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(message, systemImage: "wifi.exclamationmark")
                .font(.footnote)
                .foregroundStyle(AppTheme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            Button(action: retry) {
                Label("重试", systemImage: "arrow.clockwise")
                    .font(.subheadline.weight(.semibold))
                    .frame(minWidth: AppLayout.minimumTouchTarget, minHeight: AppLayout.minimumTouchTarget)
            }
            .disabled(isLoading)
        }
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityIdentifier("load.error")
    }
}
