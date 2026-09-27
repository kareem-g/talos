import SwiftUI
import UIKit

/// Settings: connection info, device identity, update check, unpair.
struct SettingsView: View {
    @Environment(AppState.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var confirmUnpair = false
    @State private var checkingUpdates = false
    @State private var update: UpdateChecker.Release?

    var body: some View {
        NavigationStack {
            Form {
                if let desktop = app.desktop {
                    Section("Desktop") {
                        LabeledRow(label: "Machine", value: desktop.name)
                        LabeledRow(label: "Version", value: desktop.version)
                    }
                }
                Section("Connection") {
                    LabeledRow(label: "Server", value: app.pairing?.baseURL ?? "—")
                    LabeledRow(label: "Socket", value: app.connection.label)
                    if let syncedAt = app.snapshot?.syncedAt {
                        LabeledRow(label: "Last sync", value: Format.relativeTime(syncedAt))
                    }
                }
                Section("This device") {
                    LabeledRow(label: "Name", value: app.pairing?.deviceName ?? UIDevice.current.name)
                    if let fingerprint = app.pairing?.fingerprint {
                        LabeledRow(label: "Fingerprint", value: fingerprint)
                    }
                    if let pairedAt = app.pairing?.pairedAt {
                        LabeledRow(label: "Paired", value: pairedAt.formatted(date: .abbreviated, time: .shortened))
                    }
                }
                Section("Updates") {
                    LabeledRow(label: "Installed version", value: UpdateChecker.appVersion)
                    Button {
                        checkForUpdates()
                    } label: {
                        if checkingUpdates {
                            HStack {
                                Text("Checking…")
                                Spacer()
                                ProgressView()
                            }
                        } else {
                            Text("Check for updates")
                        }
                    }
                    if let update {
                        if update.isNewer {
                            LabeledRow(label: "Available", value: update.version)
                            Button("Open release page") {
                                if let url = URL(string: update.htmlURL) {
                                    UIApplication.shared.open(url)
                                }
                            }
                        } else {
                            LabeledRow(label: "Status", value: "Up to date")
                        }
                    }
                }
                Section {
                    Button("Unpair this device", role: .destructive) {
                        confirmUnpair = true
                    }
                } footer: {
                    Text("Removes the stored credential from this phone. The desktop can also revoke devices from its device list.")
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .confirmationDialog(
                "Unpair this device?",
                isPresented: $confirmUnpair,
                titleVisibility: .visible
            ) {
                Button("Unpair", role: .destructive) {
                    app.unpair()
                    dismiss()
                }
            }
        }
    }

    private func checkForUpdates() {
        checkingUpdates = true
        update = nil
        Task {
            update = try? await UpdateChecker.latest()
            checkingUpdates = false
        }
    }
}

private struct LabeledRow: View {
    let label: String
    let value: String

    var body: some View {
        HStack {
            Text(label)
                .foregroundStyle(Theme.ink)
            Spacer()
            Text(value)
                .foregroundStyle(Theme.ink2)
                .lineLimit(1)
                .truncationMode(.middle)
        }
    }
}

// MARK: - Update checking

/// Checks GitHub Releases for a newer build. The release pipeline publishes
/// `ios-v*` tags; this app is distributed ad hoc / via TestFlight, so updates
/// open the release page in Safari where the OTA install link lives.
enum UpdateChecker {
    static let repository = "kareem-g/agentdeck-linux"

    struct Release {
        let tag: String
        let version: String
        let htmlURL: String

        var isNewer: Bool {
            UpdateChecker.isVersion(UpdateChecker.appVersion, olderThan: version)
        }
    }

    static var appVersion: String {
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String
        return version ?? "0.0.0"
    }

    static func latest() async throws -> Release {
        guard let url = URL(string: "https://api.github.com/repos/\(repository)/releases/latest") else {
            throw APIError(message: "Invalid update URL", status: nil)
        }
        var request = URLRequest(url: url)
        request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        request.timeoutInterval = 15
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw APIError(message: "Could not reach the update server", status: nil)
        }
        struct Wire: Decodable {
            let tagName: String
            let htmlUrl: String

            enum CodingKeys: String, CodingKey {
                case tagName = "tag_name"
                case htmlUrl = "html_url"
            }
        }
        let wire = try JSONDecoder().decode(Wire.self, from: data)
        let version = wire.tagName.replacingOccurrences(of: "ios-v", with: "")
        return Release(tag: wire.tagName, version: version, htmlURL: wire.htmlUrl)
    }

    /// Component-wise numeric compare of dotted version strings.
    static func isVersion(_ current: String, olderThan other: String) -> Bool {
        let currentParts = current.split(separator: ".").map { Int($0) ?? 0 }
        let otherParts = other.split(separator: ".").map { Int($0) ?? 0 }
        let count = max(currentParts.count, otherParts.count)
        for index in 0..<count {
            let left = index < currentParts.count ? currentParts[index] : 0
            let right = index < otherParts.count ? otherParts[index] : 0
            if left != right {
                return left < right
            }
        }
        return false
    }
}
