import SwiftUI

/// Root switch: pairing → main UI, with revoked and toast overlays.
struct RootView: View {
    @Environment(AppState.self) private var app
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        ZStack {
            switch app.phase {
            case .unpaired:
                PairingView()
            case .revoked:
                RevokedView()
            case .ready:
                HomeView()
            }

            if let toast = app.toast {
                VStack {
                    ToastView(text: toast)
                    Spacer()
                }
                .padding(.top, 8)
                .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .animation(.easeInOut(duration: 0.25), value: app.toast)
        .onAppear {
            app.activate()
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active {
                app.wake()
            }
        }
        .task(id: app.toast) {
            // Auto-dismiss toasts.
            guard app.toast != nil else { return }
            try? await Task.sleep(for: .seconds(2.5))
            app.toast = nil
        }
    }
}

struct RevokedView: View {
    @Environment(AppState.self) private var app

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "person.crop.circle.badge.exclamationmark")
                .font(.system(size: 52))
                .foregroundStyle(.red)
                .accessibilityHidden(true)
            Text("Device unpaired")
                .font(.title3.weight(.semibold))
            Text("This device was revoked from your desktop's device list. Generate a new pairing code and scan it to reconnect.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
            Button("Unpair and start over") {
                app.unpair()
            }
            .buttonStyle(.borderedProminent)
            .padding(.top, 8)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.background)
    }
}

struct ToastView: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.footnote.weight(.medium))
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .background(.ultraThinMaterial, in: Capsule())
            .overlay(Capsule().strokeBorder(Color.primary.opacity(0.08)))
            .shadow(radius: 8, y: 2)
    }
}
