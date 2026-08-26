import SwiftUI

@main
struct ZhiZhouApp: App {
    private let appState = AppState.shared
    private let readerSettings = ReaderSettingsStore.shared
    private let fontStore = FontStore.shared

    init() {
        fontStore.registerCachedFonts()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(appState)
                .environment(readerSettings)
                .environment(fontStore)
        }
    }
}
