import Foundation

/// A dynamically-typed JSON value.
///
/// Used for open-ended payloads — `AgentEvent.payload` in particular, whose
/// shape depends on the event `kind` and changes as new event kinds are added
/// on the backend. Unknown shapes must decode without failing.
enum JSONValue {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])
}

extension JSONValue: Codable {
    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([JSONValue].self) {
            self = .array(value)
        } else if let value = try? container.decode([String: JSONValue].self) {
            self = .object(value)
        } else {
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Unsupported JSON value"
            )
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .null: try container.encodeNil()
        case .bool(let value): try container.encode(value)
        case .number(let value): try container.encode(value)
        case .string(let value): try container.encode(value)
        case .array(let value): try container.encode(value)
        case .object(let value): try container.encode(value)
        }
    }
}

extension JSONValue {
    /// Converts a `JSONSerialization` object tree (used when parsing raw
    /// WebSocket frames) into `JSONValue`s.
    static func from(any: Any) -> JSONValue? {
        switch any {
        case is NSNull:
            return .null
        case let number as NSNumber:
            if CFGetTypeID(number) == CFBooleanGetTypeID() {
                return .bool(number.boolValue)
            }
            return .number(number.doubleValue)
        case let string as String:
            return .string(string)
        case let array as [Any]:
            let values = array.compactMap { JSONValue.from(any: $0) }
            return .array(values)
        case let object as [String: Any]:
            var mapped: [String: JSONValue] = [:]
            for (key, value) in object {
                if let converted = JSONValue.from(any: value) {
                    mapped[key] = converted
                }
            }
            return .object(mapped)
        default:
            return nil
        }
    }

    subscript(key: String) -> JSONValue? {
        if case .object(let fields) = self {
            return fields[key]
        }
        return nil
    }

    var stringValue: String? {
        if case .string(let value) = self { return value }
        return nil
    }

    var boolValue: Bool? {
        if case .bool(let value) = self { return value }
        return nil
    }

    var doubleValue: Double? {
        if case .number(let value) = self { return value }
        return nil
    }

    var intValue: Int? {
        if case .number(let value) = self { return Int(value) }
        return nil
    }

    var arrayValue: [JSONValue]? {
        if case .array(let value) = self { return value }
        return nil
    }

    /// A short human-readable rendering used for activity detail lines.
    var displayString: String? {
        switch self {
        case .string(let value):
            return value
        case .bool(let value):
            return value ? "true" : "false"
        case .number(let value):
            return value == value.rounded() && abs(value) < 1e15
                ? String(Int64(value))
                : String(value)
        case .null:
            return nil
        case .array, .object:
            return nil
        }
    }
}
