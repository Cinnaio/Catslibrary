import SwiftUI

@main
@MainActor
struct ZhiZhouApp: App {
    @Environment(\.scenePhase) private var scenePhase

    private let appState = AppState.shared
    private let readerSettings = ReaderSettingsStore.shared
    private let fontStore = FontStore.shared
    private let offlineReadingStore = OfflineReadingStore.shared

    init() {
        fontStore.registerCachedFonts()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(appState)
                .environment(readerSettings)
                .environment(fontStore)
                .environment(offlineReadingStore)
                .background(GlobalKeyboardDismissal())
                .onChange(of: scenePhase) { _, phase in
                    guard phase == .active else { return }
                    Task { @MainActor in
                        await ReaderSettingsStore.shared.flush()
                        await ReaderProgressStore.shared.flush()
                    }
                }
        }
    }
}
