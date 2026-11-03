import SwiftUI

/// Keeps the sampling task separate from the reader's large layout expression.
struct ReaderStatisticsModifier: ViewModifier {
    let owner: UUID
    let novelID: String
    let chapterID: String?
    let mode: String
    let visible: Bool

    private struct Context: Hashable {
        let novelID: String
        let chapterID: String?
        let mode: String
        let visible: Bool
    }

    func body(content: Content) -> some View {
        content
            .task(id: Context(novelID: novelID, chapterID: chapterID, mode: mode, visible: visible)) {
                guard visible else {
                    ReadingStatsStore.shared.pause(owner: owner)
                    return
                }
                ReadingStatsStore.shared.activity(owner: owner)
                var ticks = 0
                while !Task.isCancelled {
                    ReadingStatsStore.shared.update(owner: owner, novel: novelID,
                        chapter: chapterID, mode: mode, visible: true)
                    ticks += 1
                    if ticks % 30 == 0 { Task { await ReadingStatsStore.shared.flush() } }
                    do { try await Task.sleep(for: .seconds(1)) } catch { break }
                }
            }
            .onChange(of: visible) { _, value in
                if !value { ReadingStatsStore.shared.pause(owner: owner) }
            }
            .onDisappear { ReadingStatsStore.shared.pause(owner: owner) }
    }
}
