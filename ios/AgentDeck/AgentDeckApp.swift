import SwiftUI

@main
struct AgentDeckApp: App {
    @State private var app = AppState()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(app)
        }
    }
}
