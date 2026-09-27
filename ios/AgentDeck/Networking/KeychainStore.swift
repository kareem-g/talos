import Foundation
import Security

/// The credential bundle that survives relaunches.
struct Pairing: Codable, Equatable {
    /// Base URL of the desktop daemon, e.g. `http://192.168.1.5:9120` or a
    /// Cloudflare tunnel URL. No trailing slash.
    var baseURL: String
    /// Bearer token — 43-char base64url secret, shown once at pairing time.
    var token: String
    var deviceId: String
    var deviceName: String
    var fingerprint: String?
    var pairedAt: Date?

    var url: URL? { URL(string: baseURL) }
}

/// Keychain-backed storage for the device pairing.
///
/// The token is the only thing that can drive the desktop's mobile API, so it
/// belongs in the Keychain, not UserDefaults.
enum KeychainStore {
    private static let service = "app.agentdeck.ios"
    private static let account = "device"

    static func save(_ pairing: Pairing) {
        guard let data = try? JSONEncoder().encode(pairing) else { return }
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
        var attributes = query
        attributes[kSecValueData as String] = data
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(attributes as CFDictionary, nil)
    }

    static func load() -> Pairing? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess, let data = result as? Data else { return nil }
        return try? JSONDecoder().decode(Pairing.self, from: data)
    }

    static func delete() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
    }
}
