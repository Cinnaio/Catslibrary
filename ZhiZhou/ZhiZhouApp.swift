import SwiftUI

@main
struct ZhiZhouApp: App {
    private let appState = AppState.shared
    private let readerSettings = ReaderSettingsStore.shared

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(appState)
                .environment(readerSettings)
        }
    }
}
