import Foundation

/// Client → server WebSocket frames.
///
/// Wire form is `{"type": "VariantName", "payload": {...}}` with snake_case
/// payload fields (serde `tag`/`content` on the backend).
enum ClientFrame {
    /// Must be the first frame on `/ws/mobile`, within 10 seconds.
    case authenticate(token: String, afterEventId: UInt64?)
    case input(sessionId: String, data: String)
    case terminalInput(sessionId: String, data: String)
    case commandStop(sessionId: String)
    case commandInterrupt(sessionId: String)
    case approvalResponse(
        sessionId: String,
        requestId: String,
        decision: String,
        always: Bool? = nil,
        customText: String? = nil,
        allow: Bool? = nil
    )
    case questionAnswer(
        questionId: String,
        sessionId: String? = nil,
        selectedOptions: [String],
        customText: String? = nil
    )
    case ping

    func jsonObject() -> [String: Any] {
        func payload(_ fields: [String: Any?]) -> [String: Any] {
            fields.compactMapValues { $0 }
        }

        let type: String
        let body: [String: Any]
        switch self {
        case let .authenticate(token, afterEventId):
            type = "Authenticate"
            body = payload([
                "token": token,
                "after_event_id": afterEventId.map(NSNumber.init(value:)),
            ])
        case let .input(sessionId, data):
            type = "Input"
            body = payload(["session_id": sessionId, "data": data])
        case let .terminalInput(sessionId, data):
            type = "TerminalInput"
            body = payload(["session_id": sessionId, "data": data])
        case let .commandStop(sessionId):
            type = "Command"
            body = payload(["action": "stop", "params": payload(["session_id": sessionId])])
        case let .commandInterrupt(sessionId):
            type = "Command"
            body = payload(["action": "interrupt", "params": payload(["session_id": sessionId])])
        case let .approvalResponse(sessionId, requestId, decision, always, customText, allow):
            type = "Command"
            var params: [String: Any] = payload([
                "session_id": sessionId,
                "request_id": requestId,
                "decision": decision,
                "custom_text": customText,
            ])
            if let always { params["always"] = always }
            if let allow { params["allow"] = allow }
            body = payload(["action": "approval_response", "params": params])
        case let .questionAnswer(questionId, sessionId, selectedOptions, customText):
            type = "QuestionAnswer"
            body = payload([
                "question_id": questionId,
                "session_id": sessionId,
                "selected_options": selectedOptions,
                "custom_text": customText,
            ])
        case .ping:
            type = "Ping"
            body = [:]
        }
        var frame: [String: Any] = ["type": type]
        // serde's adjacent tag/content encoding omits the content key for
        // unit variants, so `Ping` goes out as a bare `{"type": "Ping"}`.
        if !body.isEmpty {
            frame["payload"] = body
        }
        return frame
    }

    func encoded() -> String {
        guard let data = try? JSONSerialization.data(
            withJSONObject: jsonObject(),
            options: [.sortedKeys]
        ) else {
            return "{}"
        }
        return String(decoding: data, as: UTF8.self)
    }
}
