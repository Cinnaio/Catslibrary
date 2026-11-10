import SwiftUI
import ZhiZhouCore

struct AgentMarkdownView: View {
    let content: String

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(Array(AgentMarkdown.blocks(content).enumerated()), id: \.offset) { _, block in
                AgentMarkdownBlockView(block: block)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .textSelection(.enabled)
        .tint(AppTheme.primary)
    }
}

private struct AgentMarkdownBlockView: View {
    let block: AgentMarkdownBlock

    var body: some View {
        switch block {
        case .paragraph(let text):
            Text(inline(text)).lineSpacing(5).fixedSize(horizontal: false, vertical: true)
        case .heading(let level, let text):
            Text(inline(text)).font(level <= 2 ? .title3.weight(.semibold) : .headline)
                .accessibilityAddTraits(.isHeader)
        case .item(let marker, let text, let indent):
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(verbatim: marker).foregroundStyle(AppTheme.textSecondary)
                Text(inline(text)).frame(maxWidth: .infinity, alignment: .leading).lineSpacing(4)
            }
            .padding(.leading, CGFloat(indent) * 12)
        case .quote(let text):
            HStack(spacing: 12) {
                Rectangle().fill(AppTheme.border).frame(width: 3)
                Text(inline(text)).foregroundStyle(AppTheme.textSecondary).lineSpacing(4)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .fixedSize(horizontal: false, vertical: true)
        case .code(let language, let text):
            VStack(alignment: .leading, spacing: 8) {
                if !language.isEmpty { Text(verbatim: language).font(.caption).foregroundStyle(AppTheme.textSecondary) }
                ScrollView(.horizontal) { Text(verbatim: text).font(.system(.callout, design: .monospaced)).padding(12) }
                    .background(AppTheme.surfaceSecondary, in: RoundedRectangle(cornerRadius: 12))
            }
        case .table(let rows):
            ScrollView(.horizontal) {
                Grid(alignment: .topLeading, horizontalSpacing: 16, verticalSpacing: 10) {
                    ForEach(Array(rows.enumerated()), id: \.offset) { rowIndex, row in
                        GridRow {
                            ForEach(Array(row.enumerated()), id: \.offset) { _, cell in
                                Text(inline(cell)).fontWeight(rowIndex == 0 ? .semibold : .regular)
                                    .frame(minWidth: 80, maxWidth: 260, alignment: .leading)
                            }
                        }
                    }
                }.padding(12)
            }
            .background(AppTheme.surfaceSecondary, in: RoundedRectangle(cornerRadius: 12))
        case .rule:
            Divider()
        }
    }

    private func inline(_ text: String) -> AttributedString {
        var value = (try? AttributedString(markdown: text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)))
            ?? AttributedString(text)
        // Inline images are never fetched. Root-relative citations stay on the configured site.
        let links = value.runs.compactMap { run -> (Range<AttributedString.Index>, URL)? in
            guard let link = run.link else { return nil }
            return (run.range, link)
        }
        for (range, link) in links {
            if ["https", "http", "mailto"].contains(link.scheme?.lowercased() ?? "") { continue }
            if link.scheme == nil, link.host == nil, link.absoluteString.hasPrefix("/"),
               !link.absoluteString.hasPrefix("//"), let base = ServerConfig.shared.baseURL {
                value[range].link = APIRequestURL.resolve(link.absoluteString, relativeTo: base)
            } else {
                value[range].link = nil
            }
        }
        return value
    }
}
