import SwiftUI

/// 阅读工具共用连续纸面；标题随正文滚动，导航仅保留原生操作。
struct ReaderPanelPage<Content: View>: View {
    private let content: Content

    init(@ViewBuilder content: () -> Content) { self.content = content() }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) { content }
                .padding(.horizontal, 22)
                .padding(.top, 20)
                .padding(.bottom, 32)
                .frame(maxWidth: 760, alignment: .leading)
                .frame(maxWidth: .infinity)
        }
        .background(ReadingSpace.profilePaper)
        .readingSpaceNavigation()
        .tint(AppTheme.primary)
    }
}

struct ReaderPanelHeading: View {
    let title: String
    var detail: String = ""

    init(_ title: String, detail: String = "") {
        self.title = title
        self.detail = detail
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title)
                .font(serifFont(.title, .medium))
                .foregroundStyle(ReadingSpace.ink)
                .accessibilityAddTraits(.isHeader)
            if !detail.isEmpty { ReaderPanelNote(detail) }
        }
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct ReaderPanelSection<Content: View>: View {
    let title: String
    private let content: Content

    init(_ title: String, @ViewBuilder content: () -> Content) {
        self.title = title
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(title)
                .font(serifFont(.title3, .medium))
                .foregroundStyle(ReadingSpace.ink)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct ReaderPanelNote: View {
    let text: String
    var color: Color = ReadingSpace.profileMuted

    init(_ text: String, color: Color = ReadingSpace.profileMuted) {
        self.text = text
        self.color = color
    }

    var body: some View {
        Text(text)
            .font(.footnote)
            .foregroundStyle(color)
            .lineSpacing(4)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .textSelection(.enabled)
    }
}

/// 较大字阶下上下排列，长值不挤压标签。
struct ReaderPanelFact: View {
    let title: String
    let value: String
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        let layout = dynamicTypeSize >= .xxxLarge
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 6))
            : AnyLayout(HStackLayout(alignment: .firstTextBaseline, spacing: 16))
        layout {
            Text(title).font(.subheadline).foregroundStyle(ReadingSpace.profileMuted)
            if dynamicTypeSize < .xxxLarge { Spacer(minLength: 0) }
            Text(value).font(.body.monospacedDigit()).foregroundStyle(ReadingSpace.ink)
        }
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

struct ReaderPanelButtonStyle: ButtonStyle {
    var prominent = false
    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.colorSchemeContrast) private var contrast

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .fixedSize(horizontal: false, vertical: true)
            .font(.subheadline.weight(.medium))
            .foregroundStyle(prominent ? ReadingSpace.onSummary : configuration.role == .destructive ? AppTheme.danger : ReadingSpace.ink)
            .tint(prominent ? ReadingSpace.onSummary : ReadingSpace.ink)
            .multilineTextAlignment(.center)
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity, minHeight: 48)
            .background(prominent ? ReadingSpace.summary : ReadingSpace.profileFill,
                        in: RoundedRectangle(cornerRadius: 16))
            .overlay {
                RoundedRectangle(cornerRadius: 16)
                    .strokeBorder(contrast == .increased ? ReadingSpace.profileMuted : Color.clear, lineWidth: 1)
                    .allowsHitTesting(false)
            }
            .opacity(!isEnabled ? 0.45 : configuration.isPressed ? 0.75 : 1)
    }
}
