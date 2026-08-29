import Foundation

/// Resolves stored thought selections back into a paragraph's UTF-16 coordinates.
///
/// The thoughts API stores the selected text but not its original character offset.
/// When the same selection appears more than once, every exact occurrence is marked
/// so an existing thought never becomes invisible in the reader.
public enum ReaderTextHighlight {
    public static func ranges(in text: String, matching selections: [String]) -> [NSRange] {
        let source = text as NSString
        guard source.length > 0 else { return [] }

        var seenSelections: Set<String> = []
        var matchedRanges: Set<NSRange> = []

        for rawSelection in selections {
            let selection = rawSelection.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !selection.isEmpty, seenSelections.insert(selection).inserted else { continue }

            var searchRange = NSRange(location: 0, length: source.length)
            while searchRange.length > 0 {
                let match = source.range(of: selection, options: [], range: searchRange)
                guard match.location != NSNotFound, match.length > 0 else { break }
                matchedRanges.insert(match)

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
