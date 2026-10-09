import Foundation

/// Resolves stored thought selections back into a paragraph's UTF-16 coordinates.
///
/// The thoughts API stores the selected text but not its original character offset.
/// When the same selection appears more than once, every exact occurrence is marked
/// so an existing thought never becomes invisible in the reader.
public enum ReaderTextHighlight {
    public static func ranges(in text: String, matching selections: [String], includeParagraph: Bool = false) -> [NSRange] {
        // Web normalizes whitespace when saving a quote. Map normalized UTF-16 back to the displayed text.
        let raw = text as NSString
        if includeParagraph { return raw.length == 0 ? [] : [NSRange(location: 0, length: raw.length)] }
        var normalized = ""
        var starts: [Int] = []
        var ends: [Int] = []
        let expression = try! NSRegularExpression(pattern: "[\\s\\uFEFF]+|[^\\s\\uFEFF]", options: [])
        for match in expression.matches(in: text, range: NSRange(location: 0, length: raw.length)) {
            let chunk = raw.substring(with: match.range)
            let whitespace = chunk.unicodeScalars.allSatisfy { CharacterSet.whitespacesAndNewlines.contains($0) || $0.value == 0xFEFF }
            let value = whitespace ? " " : chunk
            normalized += value
            for _ in value.utf16 {
                starts.append(match.range.location)
                ends.append(NSMaxRange(match.range))
            }
        }
        let source = normalized as NSString
        guard source.length > 0 else { return [] }

        var seenSelections: Set<String> = []
        var matchedRanges: Set<NSRange> = []

        for rawSelection in selections {
            let selection = IllustrationAnchor.normalize(rawSelection)
            guard !selection.isEmpty, seenSelections.insert(selection).inserted else { continue }

            var searchRange = NSRange(location: 0, length: source.length)
            while searchRange.length > 0 {
                let match = source.range(of: selection, options: [], range: searchRange)
                guard match.location != NSNotFound, match.length > 0 else { break }
                let start = starts[match.location]
                let end = ends[NSMaxRange(match) - 1]
                matchedRanges.insert(NSRange(location: start, length: end - start))

                let nextLocation = match.location + match.length
                guard nextLocation < source.length else { break }
                searchRange = NSRange(
                    location: nextLocation,
                    length: source.length - nextLocation
                )
            }
        }

        return matchedRanges.sorted {
            if $0.location != $1.location { return $0.location < $1.location }
            return $0.length < $1.length
        }
    }
}
