import Foundation

// Wire models for the AgentDeck mobile API.
//
// Every model declares explicit coding keys: the backend mixes snake_case
// fields with camelCase capability flags, so a global key strategy would get
// one of the two wrong. Dates are RFC 3339 with optional fractional seconds
// (see `DateCoding`).

// MARK: - Sessions

struct Session: Codable, Identifiable, Equatable, Hashable {
    var id: String
    var name: String
    var agent: String
    var project: String?
    var branch: String?
    /// One of: starting, running, waiting_for_input, waiting_for_approval,
    /// idle, needs_resume, error, archived, exited.
    var status: String
    var worktreePath: String?
    var createdAt: Date
    var updatedAt: Date
    var cost: Double?
    var tokensUsed: UInt64?
    var resumeCommand: String?
    var externalId: String?
    var source: String
    var parentId: String?
    var hidden: Bool

    enum CodingKeys: String, CodingKey {
        case id
        case name
        case agent
        case project
        case branch
        case status
        case worktreePath = "worktree_path"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
        case cost
        case tokensUsed = "tokens_used"
        case resumeCommand = "resume_command"
        case externalId = "external_id"
        case source
        case parentId = "parent_id"
        case hidden
    }

    /// Backend-written engine-switch notices are chrome, not conversation
    /// turns — mirrors `is_lifecycle_marker` on the backend.
    var isRunning: Bool {
        status == "starting" || status == "running" || status == "waiting_for_approval"
    }
}

struct AgentMessage: Codable, Identifiable, Equatable {
    var id: String
    var sessionId: String
    /// user | assistant | system
    var role: String
    var content: String
    var timestamp: Date

    enum CodingKeys: String, CodingKey {
        case id
        case sessionId = "session_id"
        case role
        case content
        case timestamp
    }

    var isLifecycleMarker: Bool {
        let trimmed = content.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.hasPrefix("Engine switched from ")
            && trimmed.contains("continuing the same session.")
    }
}

struct AgentEvent: Codable, Identifiable, Equatable {
    var eventId: String
    var sessionId: String
    var sequence: UInt64
    var timestamp: Date
    var kind: String
    var payload: JSONValue?
    var durationMs: UInt64?

    var id: String { eventId }

    enum CodingKeys: String, CodingKey {
        case eventId = "event_id"
        case sessionId = "session_id"
        case sequence
        case timestamp
        case kind
        case payload
        case durationMs = "duration_ms"
    }
}

// MARK: - Approvals and questions

/// A pending approval. Two wire variants exist: the `ApprovalRequest` socket
/// frame (`id`, `prompt`, `options`, `risk_level`, `timestamp`) and the mobile
/// session payload (which adds `session_id`). `session_id` is optional so both
/// decode through this one type.
struct PendingApproval: Codable, Identifiable, Equatable {
    var id: String
    var sessionId: String?
    var prompt: String
    var options: [String]
    /// Low | Medium | High | Critical
    var riskLevel: String
    var timestamp: Date?

    enum CodingKeys: String, CodingKey {
        case id
        case sessionId = "session_id"
        case prompt
        case options
        case riskLevel = "risk_level"
        case timestamp
    }
}

struct QuestionOption: Codable, Identifiable, Equatable {
    var id: String
    var label: String
    var description: String?
    var allowsCustomText: Bool

    enum CodingKeys: String, CodingKey {
        case id
        case label
        case description
        case allowsCustomText = "allows_custom_text"
    }
}

struct Question: Codable, Identifiable, Equatable {
    var questionId: String
    var sessionId: String
    var title: String
    var question: String
    var options: [QuestionOption]
    /// single | multiple
    var selectionMode: String
    /// pending | answered | cancelled | expired | failed
    var status: String
    var createdAt: Date
    var answeredAt: Date?
    var selectedOptions: [String]
    var customText: String?

    var id: String { questionId }

    enum CodingKeys: String, CodingKey {
        case questionId = "question_id"
        case sessionId = "session_id"
        case title
        case question
        case options
        case selectionMode = "selection_mode"
        case status
        case createdAt = "created_at"
        case answeredAt = "answered_at"
        case selectedOptions = "selected_options"
        case customText = "custom_text"
    }
}

struct AgentActivity: Codable, Identifiable, Equatable {
    var id: String
    var kind: String
    var title: String
    var detail: String?
    var timestamp: Date
}

struct TerminalLine: Codable, Equatable {
    var sequence: UInt64
    var data: String
    var timestamp: Date
}

// MARK: - Snapshot / home screen

struct DeviceInfo: Codable, Equatable {
    var id: String
    var name: String
}

struct DesktopInfo: Codable, Equatable {
    var name: String
    var version: String
    var connected: Bool?
}

struct AgentCapabilities: Codable, Equatable {
    var supportsStreaming: Bool?
    var supportsApproval: Bool?
    var supportsPlan: Bool?
    var supportsModelSwitch: Bool?
    var supportsFileChanges: Bool?
    var supportsReasoning: Bool?
    var supportsStructuredQuestions: Bool?
    var supportsTerminal: Bool?
}

struct AgentInfo: Codable, Identifiable, Equatable {
    var id: String
    var name: String
    var available: Bool?
    var path: String?
    var version: String?
    var features: [String]?
    /// acp | pty
    var proto: String?
    var capabilities: AgentCapabilities?

    enum CodingKeys: String, CodingKey {
        case id
        case name
        case available
        case path
        case version
        case features
        case proto = "protocol"
        case capabilities
    }
}

struct MobileTask: Codable, Identifiable, Equatable {
    var id: String
    var title: String?
    var name: String
    var agent: String
    var status: String
    var project: String?
    var branch: String?
    var createdAt: Date?
    var updatedAt: Date?
    var cost: Double?
    var tokensUsed: UInt64?
    var parentId: String?
    var worktreePath: String?
    var capabilities: AgentCapabilities?

    enum CodingKeys: String, CodingKey {
        case id
        case title
        case name
        case agent
        case status
        case project
        case branch
        case createdAt = "created_at"
        case updatedAt = "updated_at"
        case cost
        case tokensUsed = "tokens_used"
        case parentId = "parent_id"
        case worktreePath = "worktree_path"
        case capabilities
    }

    /// Only non-error states count as "needs you" — mirrors the desktop's
    /// pinned attention group.
    var needsYou: Bool {
        switch status {
        case "waiting_for_approval", "waiting_for_input", "error", "needs_resume":
            return true
        default:
            return false
        }
    }
}

struct Workspace: Codable, Identifiable, Equatable {
    var id: String
    var name: String
    var path: String?
    var local: Bool?
    var updatedAt: Date?
    var taskCount: Int
    var tasks: [MobileTask]

    enum CodingKeys: String, CodingKey {
        case id
        case name
        case path
        case local
        case updatedAt = "updated_at"
        case taskCount = "task_count"
        case tasks
    }
}

struct Snapshot: Codable, Equatable {
    var device: DeviceInfo?
    var desktop: DesktopInfo?
    var workspaces: [Workspace]
    var agents: [AgentInfo]
    var syncedAt: Date?

    enum CodingKeys: String, CodingKey {
        case device
        case desktop
        case workspaces
        case agents
        case syncedAt = "synced_at"
    }

    var allTasks: [MobileTask] {
        workspaces.flatMap(\.tasks)
    }
}

// MARK: - Session detail

struct SessionDetail: Codable, Equatable {
    var session: Session
    /// Legacy transcript rows — not rendered, only swallowed.
    var transcripts: [JSONValue]?
    var messages: [AgentMessage]
    var events: [AgentEvent]
    var terminalOutput: [TerminalLine]
    var approvals: [PendingApproval]
    var questions: [Question]

    enum CodingKeys: String, CodingKey {
        case session
        case transcripts
        case messages
        case events
        case terminalOutput = "terminal_output"
        case approvals
        case questions
    }
}

// MARK: - Requests

struct CreateSessionRequest: Encodable {
    var agent: String
    var project: String?
    var prompt: String?
    var name: String?

    enum CodingKeys: String, CodingKey {
        case agent
        case project
        case prompt
        case name
    }
}

struct CreateSessionResponse: Decodable {
    var session: Session
}

struct PairVerifyRequest: Encodable {
    var offerId: String
    var secret: String
    /// Opaque per-device value: 32 random bytes, base64. The backend stores it
    /// on the device record but never uses it to sign anything.
    var deviceKey: String
    var deviceName: String

    enum CodingKeys: String, CodingKey {
        case offerId = "offer_id"
        case secret
        case deviceKey = "device_key"
        case deviceName = "device_name"
    }
}

struct PairVerifyResponse: Decodable {
    var verified: Bool
    var token: String?
    var deviceId: String?
    var deviceName: String?
    var fingerprint: String?
    var pairedAt: Date?
    var error: String?

    enum CodingKeys: String, CodingKey {
        case verified
        case token
        case deviceId = "device_id"
        case deviceName = "device_name"
        case fingerprint
        case pairedAt = "paired_at"
        case error
    }
}

struct MobileMeResponse: Decodable {
    var device: DeviceInfo
    var desktop: DesktopInfo
}
