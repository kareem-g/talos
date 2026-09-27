import XCTest
@testable import AgentDeck

final class SessionStateTests: XCTestCase {
    private func makeState() -> SessionState {
        SessionState(session: Session.placeholder(id: "s1"))
    }

    private func frame(_ text: String) throws -> ServerFrame {
        try XCTUnwrap(ServerFrame(text: text))
    }

    private func eventFrame(
        kind: String,
        payload: String,
        eventId: String = "e1",
        sequence: UInt64 = 1
    ) throws -> ServerFrame {
        try frame(
            #"{"type":"AgentEvent","payload":{"event":{"event_id":"\#(eventId)","session_id":"s1","sequence":\#(sequence),"timestamp":"2026-09-27T10:00:00Z","kind":"\#(kind)","payload":\#(payload),"duration_ms":null}},"event_id":\#(sequence)}"#
        )
    }

    // MARK: Conversation

    func testAssistantTextDeltasAccumulate() throws {
        var state = makeState()
        state.apply(try eventFrame(kind: "assistant_text", payload: #"{"text":"Hel","delta":true,"redraw":false}"#, eventId: "e1", sequence: 1))
        state.apply(try eventFrame(kind: "assistant_text", payload: #"{"text":"lo","delta":true,"redraw":false}"#, eventId: "e2", sequence: 2))
        XCTAssertEqual(state.streamingText, "Hello")

        // A redraw replaces instead of appending.
        state.apply(try eventFrame(kind: "assistant_text", payload: #"{"text":"Hi!","delta":false,"redraw":true}"#, eventId: "e3", sequence: 3))
        XCTAssertEqual(state.streamingText, "Hi!")
    }

    func testPersistedAssistantMessageClearsStreamingText() throws {
        var state = makeState()
        state.apply(try eventFrame(kind: "assistant_text", payload: #"{"text":"Hel","delta":true}"#))
        XCTAssertEqual(state.streamingText, "Hel")

        let text = #"{"type":"Message","payload":{"message":{"id":"m1","session_id":"s1","role":"assistant","content":"Hello","timestamp":"2026-09-27T10:00:02Z"}},"event_id":5}"#
        state.apply(try frame(text))
        XCTAssertEqual(state.streamingText, "")
        XCTAssertEqual(state.messages.count, 1)
        XCTAssertEqual(state.messages.first?.content, "Hello")
    }

    func testOptimisticUserMessageIsReconciledById() throws {
        var state = makeState()
        let optimistic = AgentMessage(
            id: "m1", sessionId: "s1", role: "user",
            content: "hello", timestamp: Date(timeIntervalSince1970: 0)
        )
        state.upsertMessage(optimistic)
        XCTAssertEqual(state.messages.count, 1)

        let echo = #"{"type":"Message","payload":{"message":{"id":"m1","session_id":"s1","role":"user","content":"hello","timestamp":"2026-09-27T10:00:00Z"}},"event_id":1}"#
        state.apply(try frame(echo))
        XCTAssertEqual(state.messages.count, 1, "echo must replace, not duplicate")
    }

    // MARK: Approvals

    func testApprovalRequestAddAndResolve() throws {
        var state = makeState()
        let request = #"{"type":"ApprovalRequest","payload":{"session_id":"s1","request":{"id":"r1","prompt":"Install deps?","options":["1. Yes","2. No"],"risk_level":"Low","timestamp":"2026-09-27T10:00:00Z"}},"event_id":2}"#
        state.apply(try frame(request))
        XCTAssertEqual(state.approvals.count, 1)
        XCTAssertEqual(state.approvals.first?.id, "r1")

        let resolved = #"{"type":"ApprovalResolved","payload":{"session_id":"s1","request_id":"r1","decision":"1. Yes"},"event_id":3}"#
        state.apply(try frame(resolved))
        XCTAssertTrue(state.approvals.isEmpty)
    }

    func testPermissionRequiredEventCreatesApproval() throws {
        var state = makeState()
        state.apply(
            try eventFrame(
                kind: "permission_required",
                payload: #"{"id":"p1","prompt":"Run command?","options":["1. Yes","2. No"],"risk_level":"Medium"}"#
            )
        )
        XCTAssertEqual(state.approvals.count, 1)
        XCTAssertEqual(state.approvals.first?.prompt, "Run command?")

        state.apply(
            try eventFrame(kind: "permission_resolved", payload: #"{"request_id":"p1","decision":"deny"}"#, eventId: "e2", sequence: 2)
        )
        XCTAssertTrue(state.approvals.isEmpty)
    }

    // MARK: Questions

    func testQuestionStartedAndAnswered() throws {
        var state = makeState()
        let questionJSON = #"{"question_id":"q1","session_id":"s1","title":"Pick","question":"Which?","options":[{"id":"a","label":"A","description":null,"allows_custom_text":false},{"id":"b","label":"B","description":null,"allows_custom_text":true}],"selection_mode":"single","status":"pending","created_at":"2026-09-27T10:00:00Z","answered_at":null,"selected_options":[],"custom_text":null}"#
        state.apply(try eventFrame(kind: "question_started", payload: questionJSON))
        XCTAssertEqual(state.questions.count, 1)
        XCTAssertEqual(state.questions.first?.options.count, 2)
        XCTAssertEqual(state.questions.first?.options[1].allowsCustomText, true)

        state.apply(
            try eventFrame(
                kind: "question_answered",
                payload: #"{"question_id":"q1","session_id":"s1","selected_options":["a"],"custom_text":null}"#,
                eventId: "e2",
                sequence: 2
            )
        )
        XCTAssertTrue(state.questions.isEmpty)
    }

    // MARK: Activity

    func testToolStartedAndFinished() throws {
        var state = makeState()
        state.apply(
            try eventFrame(kind: "tool_started", payload: #"{"tool_name":"Bash","tool_id":"t1","input":{},"kind":"execute"}"#)
        )
        XCTAssertEqual(state.activities.count, 1)
        XCTAssertEqual(state.activities.first?.title, "Bash")
        XCTAssertEqual(state.activities.first?.status, "running")

        let finished = #"{"type":"AgentEvent","payload":{"event":{"event_id":"e2","session_id":"s1","sequence":2,"timestamp":"2026-09-27T10:00:02Z","kind":"tool_finished","payload":{"tool_name":"Bash","tool_id":"t1","success":true},"duration_ms":1500}},"event_id":2}"#
        state.apply(try frame(finished))
        XCTAssertEqual(state.activities.first?.status, "ok")
        XCTAssertTrue(state.activities.first?.detail?.contains("1.5s") ?? false)
    }

    func testStateChangeUpdatesStatus() throws {
        var state = makeState()
        state.apply(try frame(#"{"type":"StateChange","payload":{"session_id":"s1","state":"waiting_for_input"},"event_id":4}"#))
        XCTAssertEqual(state.session.status, "waiting_for_input")
    }

    // MARK: Hydration

    func testLoadDetailReplaysEventsButNotStreamedText() throws {
        var state = makeState()
        let detailJSON = """
        {
          "session": {"id":"s1","name":"Task","agent":"claude","project":null,"branch":null,"status":"idle","worktree_path":null,"created_at":"2026-09-27T09:00:00Z","updated_at":"2026-09-27T09:05:00Z","cost":null,"tokens_used":null,"resume_command":null,"external_id":null,"source":"agentdeck","parent_id":null,"hidden":false},
          "messages": [
            {"id":"m2","session_id":"s1","role":"assistant","content":"second","timestamp":"2026-09-27T10:00:02Z"},
            {"id":"m1","session_id":"s1","role":"user","content":"first","timestamp":"2026-09-27T10:00:01Z"}
          ],
          "events": [
            {"event_id":"e1","session_id":"s1","sequence":1,"timestamp":"2026-09-27T10:00:01Z","kind":"assistant_text","payload":{"text":"delta","delta":true},"duration_ms":null},
            {"event_id":"e2","session_id":"s1","sequence":2,"timestamp":"2026-09-27T10:00:02Z","kind":"tool_started","payload":{"tool_name":"Bash","tool_id":"t1"},"duration_ms":null}
          ],
          "terminal_output": [],
          "approvals": [],
          "questions": []
        }
        """
        let detail = try DateCoding.decoder().decode(SessionDetail.self, from: Data(detailJSON.utf8))
        state.load(detail)
        XCTAssertTrue(state.hydrated)
        XCTAssertEqual(state.messages.map(\.id), ["m1", "m2"], "messages sort by timestamp")
        XCTAssertEqual(state.streamingText, "", "replay must not resurrect streamed text")
        XCTAssertEqual(state.activities.count, 1, "tool events replay into activity")
    }

    // MARK: Terminal

    func testTerminalOutputStripsANSI() throws {
        var state = makeState()
        state.apply(try frame(#"{"type":"TerminalOutput","payload":{"session_id":"s1","data":"\u{1b}[32mOK\u{1b}[0m done"},"event_id":1}"#))
        XCTAssertEqual(state.terminalLines, ["OK done"])
    }

    func testStripANSIHandlesOSCAndCSI() {
        XCTAssertEqual(SessionState.stripANSI("\u{1b}[2J\u{1b}[Hclear"), "clear")
        XCTAssertEqual(SessionState.stripANSI("a\u{1b}]0;title\u{07}b"), "ab")
        XCTAssertEqual(SessionState.stripANSI("plain"), "plain")
    }
}

final class VersionComparisonTests: XCTestCase {
    func testVersionComparison() {
        XCTAssertTrue(UpdateChecker.isVersion("1.0.0", olderThan: "1.0.1"))
        XCTAssertTrue(UpdateChecker.isVersion("1.9", olderThan: "1.10"))
        XCTAssertFalse(UpdateChecker.isVersion("1.2.0", olderThan: "1.2.0"))
        XCTAssertFalse(UpdateChecker.isVersion("2.0.0", olderThan: "1.9.9"))
        XCTAssertTrue(UpdateChecker.isVersion("1.0", olderThan: "1.0.1"))
    }
}
