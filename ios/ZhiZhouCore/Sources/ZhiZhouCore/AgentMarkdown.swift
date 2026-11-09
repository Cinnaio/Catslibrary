import Foundation

/// Lightweight block layout for native chat. Inline Markdown is rendered by Foundation, never a web view.
public enum AgentMarkdownBlock: Equatable, Sendable {
    case paragraph(String)
    case heading(Int, String)
    case item(marker: String, text: String, indent: Int)
    case quote(String)
    case code(language: String, text: String)
    case table([[String]])
    case rule
}

public enum AgentMarkdown {
    public static func blocks(_ source: String) -> [AgentMarkdownBlock] {
        let lines = source.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n")
        var output: [AgentMarkdownBlock] = []
        var paragraph: [String] = []
        var index = 0
        func flush() {
            if !paragraph.isEmpty { output.append(.paragraph(paragraph.joined(separator: "\n"))); paragraph.removeAll() }
        }
        while index < lines.count {
            let raw = lines[index]
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.isEmpty { flush(); index += 1; continue }
            if let fence = fenceStart(line) {
                flush()
                let language = String(line.dropFirst(fence.count)).trimmingCharacters(in: .whitespaces)
                var code: [String] = []
                index += 1
                while index < lines.count {
                    let candidate = lines[index].trimmingCharacters(in: .whitespaces)
                    if candidate.hasPrefix(fence) && candidate.allSatisfy({ $0 == fence.first }) { index += 1; break }
                    code.append(lines[index]); index += 1
                }
                output.append(.code(language: language, text: code.joined(separator: "\n")))
                continue
            }
            if index + 1 < lines.count, line.contains("|"), isTableDivider(lines[index + 1]) {
                flush()
                var rows = [cells(line)]
                index += 2
                while index < lines.count, lines[index].contains("|"), !lines[index].trimmingCharacters(in: .whitespaces).isEmpty {
                    rows.append(cells(lines[index])); index += 1
                }
                output.append(.table(rows)); continue
            }
            if index + 1 < lines.count, let level = setextLevel(lines[index + 1]), paragraph.isEmpty {
                output.append(.heading(level, line)); index += 2; continue
            }
            if isRule(line) { flush(); output.append(.rule); index += 1; continue }
            let hashes = line.prefix { $0 == "#" }.count
            if (1...6).contains(hashes), line.dropFirst(hashes).first == " " {
                flush()
                let title = String(line.dropFirst(hashes + 1)).replacingOccurrences(of: #"\s+#+\s*$"#, with: "", options: .regularExpression)
                output.append(.heading(hashes, title)); index += 1; continue
            }
            if line.hasPrefix(">") {
                flush()
                var quote: [String] = []
                while index < lines.count {
                    let part = lines[index].trimmingCharacters(in: .whitespaces)
                    guard part.hasPrefix(">") else { break }
                    quote.append(String(part.dropFirst()).trimmingCharacters(in: .whitespaces)); index += 1
                }
                output.append(.quote(quote.joined(separator: "\n"))); continue
            }
            if let item = listItem(raw) {
                flush(); output.append(item); index += 1; continue
            }
            paragraph.append(raw)
            index += 1
        }
        flush()
        return output
    }

    private static func fenceStart(_ line: String) -> String? {
        guard let first = line.first, first == "`" || first == "~" else { return nil }
        let run = line.prefix { $0 == first }
        return run.count >= 3 ? String(run) : nil
    }
    private static func isRule(_ line: String) -> Bool {
        let compact = line.filter { !$0.isWhitespace }
        guard compact.count >= 3, let first = compact.first, ["-", "*", "_"].contains(String(first)) else { return false }
        return compact.allSatisfy { $0 == first }
    }
    private static func setextLevel(_ raw: String) -> Int? {
        let line = raw.trimmingCharacters(in: .whitespaces)
        guard !line.isEmpty else { return nil }
        if line.allSatisfy({ $0 == "=" }) { return 1 }
        if line.allSatisfy({ $0 == "-" }) { return 2 }
        return nil
    }
    private static func listItem(_ raw: String) -> AgentMarkdownBlock? {
        let line = raw.trimmingCharacters(in: .whitespaces)
        let indent = min(6, raw.prefix { $0 == " " || $0 == "\t" }.count / 2)
        var marker: String
        var text: String
        if ["- ", "* ", "+ "].contains(where: { line.hasPrefix($0) }) {
            marker = "•"; text = String(line.dropFirst(2))
        } else if let range = line.range(of: #"^\d+[.)]\s+"#, options: .regularExpression) {
            marker = String(line[range]).trimmingCharacters(in: .whitespaces)
            text = String(line[range.upperBound...])
        } else { return nil }
        if text.hasPrefix("[ ] ") { marker = "☐"; text = String(text.dropFirst(4)) }
        else if text.lowercased().hasPrefix("[x] ") { marker = "☑"; text = String(text.dropFirst(4)) }
        return .item(marker: marker, text: text, indent: indent)
    }
    private static func cells(_ raw: String) -> [String] {
        var line = raw.trimmingCharacters(in: .whitespaces)
        if line.hasPrefix("|") { line.removeFirst() }
        if line.hasSuffix("|") && !line.hasSuffix("\\|") { line.removeLast() }
        var output: [String] = [], cell = ""
        var escaped = false
        for character in line {
            if escaped {
                if character != "|" { cell.append("\\") }
                cell.append(character); escaped = false
            } else if character == "\\" { escaped = true }
            else if character == "|" { output.append(cell.trimmingCharacters(in: .whitespaces)); cell = "" }
            else { cell.append(character) }
        }
        if escaped { cell.append("\\") }
        output.append(cell.trimmingCharacters(in: .whitespaces))
        return output
    }
    private static func isTableDivider(_ line: String) -> Bool {
        let values = cells(line)
        return !values.isEmpty && values.allSatisfy {
            $0.range(of: #"^:?-{3,}:?$"#, options: .regularExpression) != nil
        }
    }
}
