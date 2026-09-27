import Foundation

/// Date handling for AgentDeck's wire format.
///
/// The backend (Rust chrono) emits RFC 3339 timestamps that may or may not
/// carry fractional seconds, so both forms are accepted everywhere a date is
/// decoded.
enum DateCoding {
    static let fractional: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    static let plain: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()

    static func parse(_ text: String) -> Date? {
        fractional.date(from: text) ?? plain.date(from: text)
    }

    /// Shared decoder: flexible RFC 3339 dates, no key transformation.
    /// Models declare explicit coding keys because the wire format mixes
    /// snake_case fields with camelCase capability flags.
    static func decoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let text = try container.decode(String.self)
            guard let date = parse(text) else {
                throw DecodingError.dataCorruptedError(
                    in: container,
                    debugDescription: "Unparseable date: \(text)"
                )
            }
            return date
        }
        return decoder
    }
}
