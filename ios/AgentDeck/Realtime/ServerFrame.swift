import Foundation

/// Server → client WebSocket frame.
///
/// Parsed structurally (type + raw payload) so unknown frame types and
/// unknown event kinds never crash the client — typed accessors decode the
/// payload lazily and simply return nil for mismatches.
struct ServerFrame {
    let type: String
    /// Monotonic broadcast event id; doubles as the replay cursor.
    let eventID: UInt64?
    let timestamp: Date?
    let payloadObject: [String: Any]?
    private let payloadData: Data?

    init?(text: String) {
        guard let data = text.data(using: .utf8),
              let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let type = object["type"] as? String
        else { return nil }
        self.type = type
        self.eventID = (object["event_id"] as? NSNumber)?.uint64Value
        self.timestamp = (object["timestamp"] as? String).flatMap(DateCoding.parse)
        if let payload = object["payload"] as? [String: Any] {
            payloadObject = payload
            payloadData = try? JSONSerialization.data(withJSONObject: payload)
        } else {
            payloadObject = nil
            payloadData = nil
        }
    }

    init(type: String, payload: [String: Any]?, eventID: UInt64? = nil) {
        self.type = type
        self.eventID = eventID
        self.timestamp = nil
        self.payloadObject = payload
        self.payloadData = payload.flatMap { try? JSONSerialization.data(withJSONObject: $0) }
    }

    private func decode<T: Decodable>(_ type: T.Type) -> T? {
        guard let data = payloadData else { return nil }
        return try? DateCoding.decoder().decode(T.self, from: data)
    }

    /// Variants like `Message { message }` serialize their payload as
    /// `{"message": {...}}` (serde adjacent tag/content nests struct
    /// fields), so these accessors reach one level in.
    private func decodeNested<T: Decodable>(_ key: String, as type: T.Type) -> T? {
        guard let nested = payloadObject?[key] as? [String: Any],
              let data = try? JSONSerialization.data(withJSONObject: nested)
        else { return nil }
        return try? DateCoding.decoder().decode(T.self, from: data)
    }

    // MARK: Typed payload accessors

    var session: Session? { decodeNested("session", as: Session.self) }
    var message: AgentMessage? { decodeNested("message", as: AgentMessage.self) }
    var agentEvent: AgentEvent? { decodeNested("event", as: AgentEvent.self) }
    var activity: AgentActivity? { decodeNested("activity", as: AgentActivity.self) }

    /// The `ApprovalRequest` frame: `{"session_id": ..., "request": {id,
    /// prompt, options, risk_level, timestamp}}`.
    var approvalRequest: PendingApproval? { decodeNested("request", as: PendingApproval.self) }

    var sessionId: String? { payloadObject?["session_id"] as? String }
    var state: String? { payloadObject?["state"] as? String }
    var requestId: String? { payloadObject?["request_id"] as? String }
    var decision: String? { payloadObject?["decision"] as? String }
    var lastEventId: UInt64? { (payloadObject?["last_event_id"] as? NSNumber)?.uint64Value }
    var errorCode: String? { payloadObject?["code"] as? String }
    var errorMessage: String? { payloadObject?["message"] as? String }
    var terminalData: String? { payloadObject?["data"] as? String }
    var deviceId: String? { payloadObject?["device_id"] as? String }

    /// Session the frame belongs to, wherever it happens to live — top-level
    /// for most frames, nested for `Message`, `AgentEvent`, and
    /// `SessionUpdate`.
    var affectedSessionId: String? {
        sessionId
            ?? message?.sessionId
            ?? agentEvent?.sessionId
            ?? session?.id
            ?? approvalRequest?.sessionId
    }
}
