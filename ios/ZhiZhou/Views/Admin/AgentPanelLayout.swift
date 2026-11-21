import SwiftUI

/// 创作面板共用连续纸面，标题在内容区，导航栏只承载操作。
struct AgentPanelPage<Content: View>: View {
    private let content: Content

    init(@ViewBuilder content: () -> Content) { self.content = content() }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 28) { content }
                .padding(.horizontal, 22)
                .padding(.top, 20)
                .padding(.bottom, 32)
                .frame(maxWidth: 760, alignment: .leading)
                .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
        .agentPanelSurface()
    }
}

struct AgentPanelHeading: View {
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
            if !detail.isEmpty {
                Text(detail).font(.subheadline).foregroundStyle(ReadingSpace.profileMuted)
                    .lineSpacing(4)
            }
        }
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct AgentPanelSection<Content: View>: View {
    let title: String
    let count: Int?
    private let content: Content

    init(_ title: String, count: Int? = nil, @ViewBuilder content: () -> Content) {
        self.title = title
        self.count = count
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(title).font(serifFont(.title3, .medium))
                if let count {
                    Text(count, format: .number).font(.subheadline.monospacedDigit())
                        .foregroundStyle(ReadingSpace.profileMuted)
                }
            }
            .foregroundStyle(ReadingSpace.ink)
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isHeader)
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct AgentPanelNotice: View {
    let text: String
    var isError = false

    init(_ text: String, isError: Bool = false) {
        self.text = text
        self.isError = isError
    }

    var body: some View {
        Label {
            Text(text).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
        } icon: {
            Image(systemName: isError ? "exclamationmark.circle" : "info.circle").accessibilityHidden(true)
        }
        .font(.footnote)
        .foregroundStyle(isError ? Color.red : ReadingSpace.profileMuted)
        .lineSpacing(3)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct AgentPanelFact: View {
    let title: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.caption).foregroundStyle(ReadingSpace.profileMuted)
            Text(value).font(.body).foregroundStyle(ReadingSpace.ink).textSelection(.enabled)
        }
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

struct AgentPanelField<Content: View>: View {
    let title: String
    let isFocused: Bool
    private let content: Content
    @Environment(\.colorSchemeContrast) private var contrast

    init(_ title: String, isFocused: Bool = false, @ViewBuilder content: () -> Content) {
        self.title = title
        self.isFocused = isFocused
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).font(.subheadline.weight(.medium)).foregroundStyle(ReadingSpace.ink)
            content
                .font(.body).foregroundStyle(ReadingSpace.ink)
                .textFieldStyle(.plain)
                .padding(16)
                .frame(maxWidth: .infinity, minHeight: 52, alignment: .leading)
                .background(ReadingSpace.profileFill, in: RoundedRectangle(cornerRadius: 16))
                .overlay {
                    RoundedRectangle(cornerRadius: 16)
                        .strokeBorder(isFocused ? AppTheme.primary : contrast == .increased ? ReadingSpace.profileMuted : ReadingSpace.profileLine,
                                      lineWidth: isFocused || contrast == .increased ? 1.5 : 0.75)
                        .allowsHitTesting(false)
                }
        }
    }
}

struct AgentPanelButtonStyle: ButtonStyle {
    var prominent = false
    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.colorSchemeContrast) private var contrast

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.subheadline.weight(.medium))
            .foregroundStyle(prominent ? ReadingSpace.onSummary : ReadingSpace.ink)
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

private struct AgentPanelSurface: ViewModifier {
    func body(content: Content) -> some View {
        content
            .background(ReadingSpace.profilePaper)
            .readingSpaceTopEdge(opaque: false)
            .scrollEdgeEffectHidden(true, for: .top)
            .navigationTitle("")
            .navigationBarTitleDisplayMode(.inline)
            .tint(AppTheme.primary)
    }
}

extension View {
    func agentPanelSurface() -> some View { modifier(AgentPanelSurface()) }
}
