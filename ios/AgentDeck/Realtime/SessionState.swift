import Foundation
import Observation

/// One row in the compact activity timeline.
struct ActivityItem: Identifiable, Equatable {
    /// Tool id / browser step id / event id — stable across start+finish.
    let id: String
    var kind: String
    var title: String
    var detail: String?
    var timestamp: Date?
    /// running | ok | failed
    var status: String

    var isRunning: Bool { status == "running" }
    var isFailed: Bool { status == "failed" }
}

/// Live, reducible state for one agent session.
///
/// Kept as a value type so the reduce logic is unit-testable without mocks;
/// `SessionModel` wraps it for SwiftUI observation.
struct SessionState: Equatable {
    var session: Session
    var messages: [AgentMessage] = []
    var activities: [ActivityItem] = []
    var approvals: [PendingApproval] = []
    var questions: [Question] = []
    var terminalLines: [String] = []
    /// Assistant text streamed via `assistant_text` deltas for the current
    /// turn. Cleared when the persisted assistant `Message` arrives.
    var streamingText: String = ""
    var thinkingText: String = ""
    var deleted = false
    var lastError: String?
    var hydrated = false

    /// Bumped whenever anything rendered changes, so views can scroll.
    var revision: Int {
        messages.count + approvals.count + questions.count + activities.count + streamingText.count
    }

    init(session: Session) {
        self.session = session
    }

    // MARK: Hydration

    /// Load the REST snapshot of a session, then replay persisted events to
    /// rebuild activity/approvals/questions.
    mutating func load(_ detail: SessionDetail) {
        session = detail.session
        messages = detail.messages
            .sorted { ($0.timestamp, $0.id) < ($1.timestamp, $1.id) }
        terminalLines = detail.terminalOutput
            .map { Self.stripANSI($0.data) }
            .suffix(300)
            .map { $0 }

        activities = []
        approvals = []
        questions = []
        streamingText = ""
        thinkingText = ""
        for event in detail.events.sorted(by: { $0.sequence < $1.sequence }) {
            applyEvent(event, replay: true)
        }
        // Server-persisted pending approvals/questions are authoritative.
        approvals = detail.approvals
        questions = detail.questions
        hydrated = true
    }

    // MARK: Frame reduction

    mutating func apply(_ frame: ServerFrame) {
        switch frame.type {
        case "SessionUpdate":
            if let session = frame.session {
                self.session = session
            }
        case "SessionDeleted":
            deleted = true
        case "Message":
            if let message = frame.message {
                upsertMessage(message)
            }
        case "AgentEvent":
            if let event = frame.agentEvent {
                applyEvent(event, replay: false)
            }
        case "ApprovalRequest":
            if var approval = frame.approvalRequest {
                approval.sessionId = approval.sessionId ?? frame.sessionId
                upsertApproval(approval)
            }
        case "ApprovalResolved":
            if let requestId = frame.requestId {
                removeApproval(requestId)
            }
        case "StateChange":
            if let state = frame.state {
                session.status = state
            }
        case "SessionError":
            if let message = frame.errorMessage ?? frame.errorCode {
                lastError = message
            }
        case "TerminalOutput":
            if let data = frame.terminalData {
                appendTerminal(data)
            }
        case "Activity":
            if let activity = frame.activity {
                activities.append(
                    ActivityItem(
                        id: activity.id,
                        kind: activity.kind,
                        title: activity.title,
                        detail: activity.detail,
                        timestamp: activity.timestamp,
                        status: "ok"
                    )
                )
            }
        default:
            break
        }
    }

    // MARK: Events

    mutating func applyEvent(_ event: AgentEvent, replay: Bool) {
        let payload = event.payload
        switch event.kind {
        case "assistant_text":
            guard !replay else { break }
            let text = payload?["text"]?.stringValue ?? ""
            let delta = payload?["delta"]?.boolValue ?? false
            let redraw = payload?["redraw"]?.boolValue ?? false
            if delta, !redraw {
                streamingText += text
            } else {
                streamingText = text
            }

        case "thinking_started":
            if !replay { thinkingText = "" }
        case "thinking_delta":
            if !replay { thinkingText += payload?["text"]?.stringValue ?? "" }
        case "thinking_finished":
            if !replay { thinkingText = "" }

        case "tool_started":
            upsertActivity(
                id: payload?["tool_id"]?.stringValue ?? event.eventId,
                kind: "tool",
                title: payload?["tool_name"]?.stringValue ?? "Tool",
                detail: nil,
                timestamp: event.timestamp,
                status: "running"
            )
        case "tool_input":
            if let input = payload?["input"], let id = payload?["tool_id"]?.stringValue {
                updateActivityDetail(id: id, detail: Self.summarize(input))
            }
        case "tool_finished":
            let success = payload?["success"]?.boolValue ?? true
            finishActivity(
                id: payload?["tool_id"]?.stringValue ?? event.eventId,
                success: success,
                durationMs: event.durationMs
            )

        case "command_started":
            upsertActivity(
                id: payload?["tool_id"]?.stringValue ?? event.eventId,
                kind: "command",
                title: payload?["command"]?.stringValue ?? "Command",
                detail: nil,
                timestamp: event.timestamp,
                status: "running"
            )
        case "command_finished":
            finishActivity(
                id: payload?["tool_id"]?.stringValue ?? event.eventId,
                success: payload?["success"]?.boolValue ?? (payload?["exit_code"]?.intValue == 0),
                durationMs: event.durationMs
            )

        case "browser_step":
            let stepId = payload?["id"]?.stringValue ?? event.eventId
            let action = payload?["action"]?.stringValue ?? "browser"
            let target = payload?["target"]?.stringValue
            upsertActivity(
                id: stepId,
                kind: "browser",
                title: action,
                detail: target,
                timestamp: event.timestamp,
                status: payload?["status"]?.stringValue ?? "running"
            )

        case "permission_required":
            var options: [String] = []
            if let list = payload?["options"]?.arrayValue {
                options = list.compactMap(\.stringValue)
            }
            let approval = PendingApproval(
                id: payload?["id"]?.stringValue ?? event.eventId,
                sessionId: event.sessionId,
                prompt: payload?["prompt"]?.stringValue ?? "Permission requested",
                options: options,
                riskLevel: payload?["risk_level"]?.stringValue ?? "Medium",
                timestamp: event.timestamp
            )
            upsertApproval(approval)

        case "permission_resolved":
            if let requestId = payload?["request_id"]?.stringValue {
                removeApproval(requestId)
            }

        case "question_started":
            // The payload is the full persisted Question; decode through the
            // event's raw payload object to reuse the Codable path.
            if let question = decodeQuestion(from: event) {
                upsertQuestion(question)
            }

        case "question_answered":
            if let questionId = payload?["question_id"]?.stringValue {
                removeQuestion(questionId)
            }

        case "agent_error":
            let message = payload?["message"]?.stringValue ?? "Agent error"
            lastError = message
            activities.append(
                ActivityItem(
                    id: event.eventId,
                    kind: "error",
                    title: "Error",
                    detail: message,
                    timestamp: event.timestamp,
                    status: "failed"
                )
            )

        case "agent_completed":
            var detail: String?
            if let usage = payload {
                detail = Self.usageSummary(usage)
            }
            activities.append(
                ActivityItem(
                    id: event.eventId,
                    kind: "turn",
                    title: "Completed",
                    detail: detail,
                    timestamp: event.timestamp,
                    status: "ok"
                )
            )

        case "plan":
            let title = payload?["title"]?.stringValue ?? "Plan"
            activities.append(
                ActivityItem(
                    id: event.eventId,
                    kind: "plan",
                    title: title,
                    detail: Self.firstPlanEntry(payload),
                    timestamp: event.timestamp,
                    status: "ok"
                )
            )

        case "usage":
            if let cost = payload?["cost_usd"]?.doubleValue, cost >= 0 {
                session.cost = cost
            }
            if let tokens = payload?["output_tokens"]?.doubleValue, tokens >= 0 {
                session.tokensUsed = UInt64(tokens)
            }

        default:
            break
        }
    }

    private func decodeQuestion(from event: AgentEvent) -> Question? {
        guard case .object(let fields)? = event.payload,
              let data = try? JSONSerialization.data(withJSONObject: Self.jsonObject(from: fields))
        else { return nil }
        return try? DateCoding.decoder().decode(Question.self, from: data)
    }

    /// Converts a JSONValue object tree back into a JSONSerialization tree.
    private static func jsonObject(from fields: [String: JSONValue]) -> [String: Any] {
        func convert(_ value: JSONValue) -> Any {
            switch value {
            case .null: return NSNull()
            case .bool(let bool): return bool
            case .number(let number): return number
            case .string(let string): return string
            case .array(let list): return list.map(convert)
            case .object(let object): return jsonObject(from: object)
            }
        }
        var result: [String: Any] = [:]
        for (key, value) in fields {
            result[key] = convert(value)
        }
        return result
    }

    // MARK: Pieces

    mutating func upsertMessage(_ message: AgentMessage) {
        if message.role == "user" {
            streamingText = ""
            thinkingText = ""
        }
        if message.role == "assistant" {
            // The persisted turn supersedes the streamed one.
            streamingText = ""
        }
        if let index = messages.firstIndex(where: { $0.id == message.id }) {
            messages[index] = message
        } else {
            messages.append(message)
        }
    }

    mutating func upsertApproval(_ approval: PendingApproval) {
        if let index = approvals.firstIndex(where: { $0.id == approval.id }) {
            approvals[index] = approval
        } else {
            approvals.append(approval)
        }
    }

    mutating func removeApproval(_ requestId: String) {
        approvals.removeAll { $0.id == requestId }
    }

    mutating func upsertQuestion(_ question: Question) {
        if let index = questions.firstIndex(where: { $0.questionId == question.questionId }) {
            questions[index] = question
        } else {
            questions.append(question)
        }
    }

    mutating func removeQuestion(_ questionId: String) {
        questions.removeAll { $0.questionId == questionId }
    }

    mutating func upsertActivity(
        id: String,
        kind: String,
        title: String,
        detail: String?,
        timestamp: Date?,
        status: String
    ) {
        let item = ActivityItem(
            id: id,
            kind: kind,
            title: title,
            detail: detail,
            timestamp: timestamp,
            status: status
        )
        if let index = activities.firstIndex(where: { $0.id == id }) {
            activities[index] = item
        } else {
            activities.append(item)
            if activities.count > 300 {
                activities.removeFirst(activities.count - 300)
            }
        }
    }

    mutating func finishActivity(id: String, success: Bool, durationMs: UInt64?) {
        guard let index = activities.firstIndex(where: { $0.id == id }) else { return }
        activities[index].status = success ? "ok" : "failed"
        if let durationMs {
            let seconds = Double(durationMs) / 1000
            let existing = activities[index].detail
            let timing = seconds >= 1
                ? String(format: "%.1fs", seconds)
                : String(format: "%.0fms", seconds * 1000)
            activities[index].detail = existing.map { "\($0) · \(timing)" } ?? timing
        }
    }

    mutating func updateActivityDetail(id: String, detail: String?) {
        guard let index = activities.firstIndex(where: { $0.id == id }) else { return }
        activities[index].detail = detail
    }

    mutating func appendTerminal(_ data: String) {
        let line = Self.stripANSI(data)
        terminalLines.append(line)
        if terminalLines.count > 300 {
            terminalLines.removeFirst(terminalLines.count - 300)
        }
    }

    // MARK: Formatting helpers

    private static func usageSummary(_ payload: JSONValue) -> String? {
        var parts: [String] = []
        if let inputTokens = payload["input_tokens"]?.doubleValue {
            parts.append("\(Int(inputTokens)) in")
        }
        if let outputTokens = payload["output_tokens"]?.doubleValue {
            parts.append("\(Int(outputTokens)) out")
        }
        if let cost = payload["cost_usd"]?.doubleValue {
            parts.append(String(format: "$%.2f", cost))
        }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    private static func firstPlanEntry(_ payload: JSONValue?) -> String? {
        guard let payload else { return nil }
        if let entries = payload["entries"]?.arrayValue, let first = entries.first {
            if let content = first["content"]?.stringValue {
                return content
            }
            return first.displayString
        }
        if let steps = payload["steps"]?.arrayValue, let first = steps.first {
            return first.displayString
        }
        return payload["text"]?.stringValue
    }

    private static func summarize(_ input: JSONValue) -> String? {
        switch input {
        case .string(let string):
            let prefix = String(string.prefix(140))
            return prefix == string ? string : prefix + "…"
        case .object(let fields):
            let keys = fields.keys.sorted()
            return keys.isEmpty ? nil : keys.joined(separator: ", ")
        default:
            return input.displayString
        }
    }

    /// Strips ANSI CSI/OSC escape sequences from raw PTY output.
    static func stripANSI(_ text: String) -> String {
        var result = ""
        result.reserveCapacity(text.count)
        var iterator = text.unicodeScalars.makeIterator()
        while let scalar = iterator.next() {
            if scalar != "\u{1B}" {
                result.unicodeScalars.append(scalar)
                continue
            }
            guard let next = iterator.next() else { break }
            if next == "[" {
                // CSI sequence: parameters then a final byte.
                while let body = iterator.next() {
                    if body.isASCII, body >= "a" && body <= "z" || body >= "A" && body <= "Z" {
                        break
                    }
                }
            } else if next == "]" {
                // OSC sequence: terminated by BEL.
                var terminated = false
                while let body = iterator.next() {
                    if body == "\u{07}" {
                        terminated = true
                        break
                    }
                }
                if !terminated { break }
            }
            // Other escape sequences (two bytes) are dropped with `next`.
        }
        return result
    }
}

/// Observable wrapper so SwiftUI views can watch one session's live state.
@Observable
final class SessionModel {
    var state: SessionState

    init(session: Session) {
        state = SessionState(session: session)
    }

    var id: String { state.session.id }

    func apply(_ frame: ServerFrame) {
        state.apply(frame)
    }

    func load(_ detail: SessionDetail) {
        state.load(detail)
    }
}
