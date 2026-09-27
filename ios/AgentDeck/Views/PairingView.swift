import Security
import SwiftUI
import UIKit

/// First-run screen: scan (or paste) the pairing code shown by the desktop's
/// pairing page, then verify against `/api/pair/verify`.
struct PairingView: View {
    @Environment(AppState.self) private var app
    @State private var showScanner = false
    @State private var manualText = ""
    @State private var pendingOffer: PairingOffer?
    @State private var parseError: String?

    var body: some View {
        VStack(spacing: 0) {
            Spacer()
            brand
            Spacer()
            instructions
            Spacer()
            controls
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.background)
        .fullScreenCover(isPresented: $showScanner) {
            ScannerView { code in
                guard let offer = PairingOfferParser.parse(code) else {
                    parseError = "That doesn't look like an AgentDeck pairing code. Codes look like http://<your-computer>:9120/mobile/pair?offer=…"
                    return
                }
                // Give the cover a beat to finish dismissing before presenting
                // the confirmation sheet.
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
                    pendingOffer = offer
                }
            }
        }
        .sheet(item: $pendingOffer) { offer in
            PairingConfirmSheet(offer: offer)
        }
    }

    private var brand: some View {
        VStack(spacing: 12) {
            ZStack {
                RoundedRectangle(cornerRadius: 20)
                    .fill(
                        LinearGradient(
                            colors: [Theme.accent, Theme.accentHover],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                    .frame(width: 84, height: 84)
                    .shadow(color: Theme.accent.opacity(0.35), radius: 12, y: 6)
                Text("AD")
                    .font(.system(size: 30, weight: .bold, design: .monospaced))
                    .foregroundStyle(Theme.accentInk)
            }
            .accessibilityHidden(true)
            Text("AgentDeck")
                .font(.largeTitle.weight(.bold))
                .foregroundStyle(Theme.ink)
            Text("Control the agents on your machine from anywhere.")
                .font(.subheadline)
                .foregroundStyle(Theme.ink2)
                .multilineTextAlignment(.center)
        }
    }

    private var instructions: some View {
        VStack(alignment: .leading, spacing: 14) {
            InstructionRow(number: "1", text: "Open AgentDeck on your computer")
            InstructionRow(number: "2", text: "Open the pairing page and generate a code")
            InstructionRow(number: "3", text: "Scan it here")
        }
        .padding(.horizontal, 8)
    }

    private var controls: some View {
        VStack(spacing: 12) {
            if let parseError {
                Text(parseError)
                    .font(.footnote)
                    .foregroundStyle(Theme.red)
                    .multilineTextAlignment(.center)
            }
            Button {
                showScanner = true
            } label: {
                Label("Scan pairing code", systemImage: "qrcode.viewfinder")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)

            DisclosureGroup("Paste a link instead") {
                VStack(alignment: .leading, spacing: 8) {
                    TextField("http://192.168.1.5:9120/mobile/pair?offer=…&secret=…", text: $manualText)
                        .font(.caption)
                        .textFieldStyle(.roundedBorder)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                    Button("Pair with link") {
                        if let offer = PairingOfferParser.parse(manualText) {
                            parseError = nil
                            pendingOffer = offer
                        } else {
                            parseError = "Couldn't read that link. Copy it straight from the desktop pairing page."
                        }
                    }
                    .disabled(manualText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
                .padding(.top, 6)
            }
            .font(.subheadline)
        }
    }
}

private struct InstructionRow: View {
    let number: String
    let text: String

    var body: some View {
        HStack(spacing: 12) {
            Text(number)
                .font(.subheadline.weight(.bold))
                .frame(width: 26, height: 26)
                .background(Circle().fill(Theme.accentTint))
                .overlay(Circle().stroke(Theme.accent.opacity(0.3), lineWidth: 1))
                .foregroundStyle(Theme.accent)
            Text(text)
                .font(.subheadline)
                .foregroundStyle(Theme.ink2)
        }
    }
}

// MARK: - Offer parsing

/// A pairing offer extracted from a scanned QR / pasted link.
struct PairingOffer: Identifiable {
    let id = UUID()
    let baseURL: URL
    let host: String
    let offerId: String
    let secret: String
}

enum PairingOfferParser {
    /// Parses `http://<host>[:port][/prefix]/mobile/pair?offer=<id>&secret=<secret>`.
    static func parse(_ text: String) -> PairingOffer? {
        guard let url = URL(string: text.trimmingCharacters(in: .whitespacesAndNewlines)),
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let scheme = components.scheme?.lowercased(),
              scheme == "http" || scheme == "https",
              let host = components.host,
              let queryItems = components.queryItems
        else { return nil }

        guard let offer = queryItems.first(where: { $0.name == "offer" })?.value,
              let secret = queryItems.first(where: { $0.name == "secret" })?.value,
              !offer.isEmpty, !secret.isEmpty,
              components.path.hasSuffix("/mobile/pair")
        else { return nil }

        var base = URLComponents()
        base.scheme = scheme
        base.host = host
        if let port = components.port {
            base.port = port
        }
        // Strip the /mobile/pair suffix but keep any path prefix.
        var path = components.path
        if let range = path.range(of: "/mobile/pair") {
            path = String(path[..<range.lowerBound])
        }
        base.path = path

        guard let baseURL = base.url else { return nil }
        return PairingOffer(baseURL: baseURL, host: host, offerId: offer, secret: secret)
    }
}

// MARK: - Confirm + verify

private struct PairingConfirmSheet: View {
    let offer: PairingOffer
    @Environment(AppState.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var verifying = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            VStack(spacing: 20) {
                Image(systemName: "desktopcomputer.and.iphone")
                    .font(.system(size: 44))
                    .foregroundStyle(Theme.accent)
                    .accessibilityHidden(true)
                Text("Pair with your desktop?")
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(Theme.ink)
                Text(offer.baseURL.absoluteString)
                    .font(.footnote.monospaced())
                    .foregroundStyle(Theme.ink2)
                    .textSelection(.enabled)
                Text("This device will be able to start, watch, and stop agents on that machine.")
                    .font(.subheadline)
                    .foregroundStyle(Theme.ink2)
                    .multilineTextAlignment(.center)

                if let error {
                    Text(error)
                        .font(.footnote)
                        .foregroundStyle(Theme.red)
                        .multilineTextAlignment(.center)
                }

                Button {
                    verify()
                } label: {
                    if verifying {
                        ProgressView()
                            .frame(maxWidth: .infinity)
                    } else {
                        Text("Pair")
                            .font(.headline)
                            .frame(maxWidth: .infinity)
                    }
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .disabled(verifying)

                Spacer()
            }
            .padding(24)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .disabled(verifying)
                }
            }
        }
        .interactiveDismissDisabled(verifying)
    }

    private func verify() {
        verifying = true
        error = nil
        let deviceName = UIDevice.current.name
        Task {
            do {
                let pairing = try await Self.verify(offer: offer, deviceName: deviceName)
                app.completePairing(
                    response: pairing,
                    baseURL: offer.baseURL,
                    deviceName: deviceName
                )
                dismiss()
            } catch {
                verifying = false
                self.error = (error as? APIError)?.message
                    ?? "Pairing failed. The code may have expired — generate a new one on the desktop."
            }
        }
    }

    /// `/api/pair/verify` is unauthenticated, so this call uses an empty
    /// bearer token.
    private static func verify(offer: PairingOffer, deviceName: String) async throws -> PairVerifyResponse {
        var bytes = [UInt8](repeating: 0, count: 32)
        let status = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        guard status == errSecSuccess else {
            throw APIError(message: "Could not generate a device key", status: nil)
        }
        let deviceKey = Data(bytes).base64EncodedString()
        let client = APIClient(baseURL: offer.baseURL, token: "")
        let request = PairVerifyRequest(
            offerId: offer.offerId,
            secret: offer.secret,
            deviceKey: deviceKey,
            deviceName: deviceName
        )
        let response: PairVerifyResponse = try await client.post("/api/pair/verify", body: request)
        guard response.verified, response.token != nil else {
            throw APIError(message: response.error ?? "Invalid or expired pairing offer", status: nil)
        }
        return response
    }
}
