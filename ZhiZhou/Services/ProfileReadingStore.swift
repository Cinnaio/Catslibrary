import Foundation
import Observation

@Observable
@MainActor
final class ProfileReadingStore {
    private(set) var recent: [RecentItem] = []
    private(set) var hasLoaded = false
    private(set) var isLoading = false
    private(set) var errorMessage: String?

    func refresh() async {
        guard !isLoading, let token = APIClient.shared.token else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            await ReaderProgressStore.shared.flush()
            try Task.checkCancellation()
            let response: BookshelfResponse = try await APIClient.shared.request(
                "GET", "/api/bookshelf", auth: true, expectedToken: token
            )
            guard APIClient.shared.token == token else { return }
            recent = response.recent.filter { !$0.chapterId.isEmpty && $0.chapterOrder > 0 }
            hasLoaded = true
            errorMessage = nil
        } catch is CancellationError {
        } catch {
            guard APIClient.shared.token == token else { return }
            errorMessage = AppCopy.friendlyError(error)
        }
    }
}
