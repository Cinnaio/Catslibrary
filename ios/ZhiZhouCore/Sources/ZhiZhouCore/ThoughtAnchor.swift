import Foundation

public enum ThoughtAnchor {
    /// Preserve a verified position; relocate only a unique fingerprint. Never attach changed text by index.
    public static func resolve(index: Int, hash: String, selection: String, paragraphs: [String], sourceText: String,
                               paragraphHashes: [String]? = nil, sourceHash: String? = nil) -> Int? {
        guard !hash.isEmpty else { return paragraphs.indices.contains(index) ? index : nil }
        let hashes = paragraphHashes ?? paragraphs.map(IllustrationAnchor.contentHash)
        if hashes.indices.contains(index), hashes[index] == hash { return index }
        let matches = hashes.indices.filter { hashes[$0] == hash }
        if matches.count == 1 { return matches[0] }
        // Historical CR-only chapters were one source paragraph on Web. Only that verified source may use the quote.
        if hash == (sourceHash ?? IllustrationAnchor.contentHash(sourceText)) {
            let quote = IllustrationAnchor.normalize(selection)
            guard !quote.isEmpty else { return paragraphs.isEmpty ? nil : 0 }
            let quoted = paragraphs.indices.filter { IllustrationAnchor.normalize(paragraphs[$0]).contains(quote) }
            return quoted.count == 1 ? quoted[0] : nil
        }
        return nil
    }
}
