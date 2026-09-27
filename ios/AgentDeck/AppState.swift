import Foundation
import Observation
import UIKit

/// Central app store: owns the pairing, the API client, the socket, and the
/// live session models. Views read it through the SwiftUI environment.
@Observable
final class AppState {
    enum Phase: Equatable {
        case unpaired
        case ready
        case revoked
    }

    private(set) var phase: Phase = .unpaired
    private(set) var connection: ConnectionState = .idle
    private(set) var snapshot: Snapshot?
    private(set) var loadingSnapshot = false
    private(set) var pairing: Pairing?
    private(set) var desktop: DesktopInfo?

    var toast: String?
    var snapshotError: String?

    /// Live models for sessions the user has opened (or that received events).
    private(set) var sessions: [String: SessionModel] = [:]

    let socket = SocketClient()
    private var api: APIClient?
    private var activated = false

    init() {
        socket.onStateChange = { [weak self] state in
            guard let self else { return }
            self.connection = state
            if state == .unauthorized {
                self.phase = .revoked
            }
        }
        socket.onFrame = { [weak self] frame in
            self?.handleFrame(frame)
        }
    }

    // MARK: Lifecycle

    /// Runs once per launch: restores the pairing, connects, loads the
    /// snapshot.
    func activate() {
        guard !activated else { return }
        activated = true
        guard let stored = KeychainStore.load(), let url = URL(string: stored.baseURL) else {
            phase = .unpaired
            return
        }
        install(pairing: stored, url: url)
    }

    private func install(pairing: Pairing, url: URL) {
        self.pairing = pairing
        api = APIClient(baseURL: url, token: pairing.token)
        phase = .ready
        socket.configure(with: pairing)
        socket.connect()
        Task { await refreshSnapshot() }
    }

    /// Pairing flow completion — called by the pairing UI after a successful
    /// `/api/pair/verify`.
    func completePairing(
        response: PairVerifyResponse,
        baseURL: URL,
        deviceName: String
    ) {
        guard let token = response.token, let deviceId = response.deviceId else { return }
        var base = baseURL.absoluteString
        while base.hasSuffix("/") {
            base.removeLast()
        }
        guard let url = URL(string: base) else { return }
        let pairing = Pairing(
            baseURL: base,
            token: token,
            deviceId: deviceId,
            deviceName: response.deviceName ?? deviceName,
            fingerprint: response.fingerprint,
            pairedAt: response.pairedAt
        )
        KeychainStore.save(pairing)
        activated = true
        install(pairing: pairing, url: url)
    }

    func unpair() {
        socket.reset()
        KeychainStore.delete()
        pairing = nil
        api = nil
        snapshot = nil
        desktop = nil
        sessions = [:]
        snapshotError = nil
        toast = nil
        phase = .unpaired
    }

    func wake() {
        socket.wake()
        if phase == .ready, snapshot == nil, pairing != nil {
            Task { await refreshSnapshot() }
        }
    }

    // MARK: Snapshot / home data

    @MainActor
    func refreshSnapshot() async {
        guard let api else { return }
        loadingSnapshot = true
        snapshotError = nil
        defer { loadingSnapshot = false }
        do {
            let result: Snapshot = try await api.get("/api/mobile/snapshot")
            snapshot = result
            desktop = result.desktop
        } catch {
            snapshotError = Self.message(for: error)
            if Self.isRevoked(error) {
                phase = .revoked
            }
        }
    }

    @MainActor
    func hydrate(_ sessionId: String) async {
        guard let api else { return }
        let model = sessionModel(for: sessionId)
        guard !model.state.hydrated else { return }
        do {
            let detail: SessionDetail = try await api.get("/api/mobile/sessions/\(sessionId)")
            model.load(detail)
        } catch {
            if Self.isRevoked(error) {
                phase = .revoked
            } else {
                model.state.lastError = Self.message(for: error)
            }
        }
    }

    /// Get-or-create the live model for a session. Creates a placeholder from
    /// snapshot data so navigation is instant; `hydrate` fills in the rest.
    func sessionModel(for sessionId: String) -> SessionModel {
        if let existing = sessions[sessionId] {
            return existing
        }
        let session = session(fromSnapshot: sessionId) ?? Session.placeholder(id: sessionId)
        let model = SessionModel(session: session)
        sessions[sessionId] = model
        return model
    }

    private func session(fromSnapshot sessionId: String) -> Session? {
        guard let task = snapshot?.allTasks.first(where: { $0.id == sessionId }) else {
            return nil
        }
        return Session(
            id: task.id,
            name: task.name,
            agent: task.agent,
            project: task.project,
            branch: task.branch,
            status: task.status,
            worktreePath: nil,
            createdAt: task.createdAt ?? Date(timeIntervalSince1970: 0),
            updatedAt: task.updatedAt ?? Date(timeIntervalSince1970: 0),
            cost: task.cost,
            tokensUsed: task.tokensUsed,
            resumeCommand: nil,
            externalId: nil,
            source: "agentdeck",
            parentId: nil,
            hidden: false
        )
    }

    @MainActor
    func createSession(agent: String, name: String, prompt: String?, project: String?) async throws -> String {
        guard let api else { throw APIError(message: "Not paired", status: nil) }
        let body = CreateSessionRequest(
            agent: agent,
            project: project?.nilIfBlank,
            prompt: prompt?.nilIfBlank,
            name: name.nilIfBlank
        )
        let response: CreateSessionResponse = try await api.post("/api/mobile/sessions", body: body)
        await refreshSnapshot()
        return response.session.id
    }

    @MainActor
    func kill(sessionId: String) async {
        guard let api else { return }
        do {
            try await api.post("/api/mobile/sessions/\(sessionId)/kill")
            toast = "Task stopped"
        } catch {
            toast = Self.message(for: error)
        }
    }

    @MainActor
    func archive(sessionId: String) async {
        guard let api else { return }
        do {
            try await api.post("/api/mobile/sessions/\(sessionId)/archive")
            toast = "Task archived"
            await refreshSnapshot()
        } catch {
            toast = Self.message(for: error)
        }
    }

    // MARK: Live controls (WebSocket)

    func sendInput(sessionId: String, text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        let model = sessionModel(for: sessionId)
        // Optimistic echo; the server's Message frame reconciles by id.
        let optimistic = AgentMessage(
            id: UUID().uuidString,
            sessionId: sessionId,
            role: "user",
            content: trimmed,
            timestamp: Date()
        )
        model.state.upsertMessage(optimistic)
        socket.send(.input(sessionId: sessionId, data: trimmed))
    }

    func stop(sessionId: String) {
        socket.send(.commandStop(sessionId: sessionId))
        socket.send(.terminalInput(sessionId: sessionId, data: "\u{03}"))
    }

    func interrupt(sessionId: String) {
        socket.send(.commandInterrupt(sessionId: sessionId))
        socket.send(.terminalInput(sessionId: sessionId, data: "\u{03}"))
    }

    func respondToApproval(sessionId: String, requestId: String, decision: String) {
        socket.send(
            .approvalResponse(
                sessionId: sessionId,
                requestId: requestId,
                decision: decision,
                always: decision.lowercased().contains("always") ? true : nil,
                customText: nil,
                allow: nil
            )
        )
        if let model = sessions[sessionId] {
            model.state.removeApproval(requestId)
        }
    }

    func answerQuestion(_ question: Question, selectedOptions: [String], customText: String?) {
        socket.send(
            .questionAnswer(
                questionId: question.questionId,
                sessionId: question.sessionId,
                selectedOptions: selectedOptions,
                customText: customText?.nilIfBlank
            )
        )
        if let model = sessions[question.sessionId] {
            model.state.removeQuestion(question.questionId)
        }
    }

    // MARK: Frame routing

    private func handleFrame(_ frame: ServerFrame) {
        switch frame.type {
        case "DeviceRevoked":
            phase = .revoked
            socket.disconnect()
            return
        case "SessionUpdate":
            if let session = frame.session {
                patchSnapshot(with: session)
                sessions[session.id]?.state.session = session
            }
        case "SessionDeleted":
            removeSession(fromSnapshot: frame.sessionId)
            if let id = frame.sessionId {
                sessions[id]?.state.deleted = true
            }
        default:
            break
        }

        // The broadcast is global — like the dashboard, filter by session and
        // only reduce into models the user has actually opened.
        if let sessionId = frame.affectedSessionId, let model = sessions[sessionId] {
            model.apply(frame)
        }
    }

    private func patchSnapshot(with session: Session) {
        guard var current = snapshot else { return }
        var updated = false
        for workspaceIndex in current.workspaces.indices {
            let workspace = current.workspaces[workspaceIndex]
            guard let taskIndex = workspace.tasks.firstIndex(where: { $0.id == session.id }) else {
                continue
            }
            current.workspaces[workspaceIndex].tasks[taskIndex].status = session.status
            current.workspaces[workspaceIndex].tasks[taskIndex].name = session.name
            current.workspaces[workspaceIndex].tasks[taskIndex].updatedAt = session.updatedAt
            current.workspaces[workspaceIndex].tasks[taskIndex].cost = session.cost
            current.workspaces[workspaceIndex].tasks[taskIndex].tokensUsed = session.tokensUsed
            updated = true
            break
        }
        if updated {
            snapshot = current
        }
    }

    private func removeSession(fromSnapshot sessionId: String?) {
        guard let sessionId, var current = snapshot else { return }
        for workspaceIndex in current.workspaces.indices {
            current.workspaces[workspaceIndex]
                .tasks.removeAll { $0.id == sessionId }
        }
        current.workspaces.removeAll { $0.tasks.isEmpty }
        snapshot = current
    }

    // MARK: Errors

    private static func isRevoked(_ error: Error) -> Bool {
        if let apiError = error as? APIError {
            return apiError.isRevoked
        }
        return false
    }

    private static func message(for error: Error) -> String {
        if let apiError = error as? APIError {
            return apiError.message
        }
        return "Connection failed. Check that AgentDeck is running and reachable."
    }
}

extension Session {
    /// Minimal placeholder until the real session data loads.
    static func placeholder(id: String) -> Session {
        Session(
            id: id,
            name: "Task",
            agent: "",
            project: nil,
            branch: nil,
            status: "idle",
            worktreePath: nil,
            createdAt: Date(timeIntervalSince1970: 0),
            updatedAt: Date(timeIntervalSince1970: 0),
            cost: nil,
            tokensUsed: nil,
            resumeCommand: nil,
            externalId: nil,
            source: "agentdeck",
            parentId: nil,
            hidden: false
        )
    }
}

extension String {
    var nilIfBlank: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : self
    }
}
