import XCTest
@testable import AgentDeck

final class FramesTests: XCTestCase {
    private func json(_ text: String) throws -> [String: Any] {
        let object = try JSONSerialization.jsonObject(with: Data(text.utf8))
        return try XCTUnwrap(object as? [String: Any])
    }

    // MARK: Client frames

    func testInputEncoding() {
        let frame = ClientFrame.input(sessionId: "s1", data: "hello")
        let encoded = try? json(frame.encoded())
        XCTAssertEqual(encoded?["type"] as? String, "Input")
        let payload = try? XCTUnwrap(encoded?["payload"] as? [String: Any])
        XCTAssertEqual(payload?["session_id"] as? String, "s1")
        XCTAssertEqual(payload?["data"] as? String, "hello")
    }

    func testAuthenticateEncoding() throws {
        let frame = ClientFrame.authenticate(token: "tok", afterEventId: 41)
        let encoded = try json(frame.encoded())
        XCTAssertEqual(encoded["type"] as? String, "Authenticate")
        let payload = try XCTUnwrap(encoded["payload"] as? [String: Any])
        XCTAssertEqual(payload["token"] as? String, "tok")
        XCTAssertEqual(payload["after_event_id"] as? Int, 41)

        let noCursor = ClientFrame.authenticate(token: "tok", afterEventId: nil)
        let encodedNoCursor = try json(noCursor.encoded())
        let payloadNoCursor = try XCTUnwrap(encodedNoCursor["payload"] as? [String: Any])
        XCTAssertNil(payloadNoCursor["after_event_id"])
    }

    func testPingHasNoPayload() throws {
        let encoded = try json(ClientFrame.ping.encoded())
        XCTAssertEqual(encoded["type"] as? String, "Ping")
        XCTAssertNil(encoded["payload"])
    }

    func testApprovalResponseEncoding() throws {
        let frame = ClientFrame.approvalResponse(
            sessionId: "s1",
            requestId: "r1",
            decision: "1. Yes",
            always: true,
            customText: nil,
            allow: nil
        )
        let encoded = try json(frame.encoded())
        XCTAssertEqual(encoded["type"] as? String, "Command")
        let payload = try XCTUnwrap(encoded["payload"] as? [String: Any])
        XCTAssertEqual(payload["action"] as? String, "approval_response")
        let params = try XCTUnwrap(payload["params"] as? [String: Any])
        XCTAssertEqual(params["session_id"] as? String, "s1")
        XCTAssertEqual(params["request_id"] as? String, "r1")
        XCTAssertEqual(params["decision"] as? String, "1. Yes")
        XCTAssertEqual(params["always"] as? Bool, true)
        XCTAssertNil(params["custom_text"])
    }

    func testQuestionAnswerEncoding() throws {
        let frame = ClientFrame.questionAnswer(
            questionId: "q1",
            sessionId: "s1",
            selectedOptions: ["opt-a"],
            customText: "because"
        )
        let encoded = try json(frame.encoded())
        XCTAssertEqual(encoded["type"] as? String, "QuestionAnswer")
        let payload = try XCTUnwrap(encoded["payload"] as? [String: Any])
        XCTAssertEqual(payload["question_id"] as? String, "q1")
        XCTAssertEqual(payload["selected_options"] as? [String], ["opt-a"])
        XCTAssertEqual(payload["custom_text"] as? String, "because")
    }

    // MARK: Server frames

    func testAuthenticatedFrame() throws {
        let frame = try XCTUnwrap(ServerFrame(text: #"{"type":"Authenticated","payload":{"device_id":"dev-1","last_event_id":42}}"#))
        XCTAssertEqual(frame.type, "Authenticated")
        XCTAssertEqual(frame.lastEventId, 42)
        XCTAssertEqual(frame.deviceId, "dev-1")
        XCTAssertNil(frame.eventID)
    }

    func testMessageFrameNestingAndEventID() throws {
        let text = #"{"type":"Message","payload":{"message":{"id":"m1","session_id":"s1","role":"user","content":"hi","timestamp":"2026-09-27T10:00:00Z"}},"event_id":7,"timestamp":"2026-09-27T10:00:01Z"}"#
        let frame = try XCTUnwrap(ServerFrame(text: text))
        XCTAssertEqual(frame.type, "Message")
        XCTAssertEqual(frame.eventID, 7)
        let message = try XCTUnwrap(frame.message)
        XCTAssertEqual(message.id, "m1")
        XCTAssertEqual(message.sessionId, "s1")
        XCTAssertEqual(message.content, "hi")
        XCTAssertEqual(frame.affectedSessionId, "s1")
    }

    func testSessionUpdateFrame() throws {
        let text = #"{"type":"SessionUpdate","payload":{"session":{"id":"s1","name":"Task","agent":"claude","project":null,"branch":null,"status":"running","worktree_path":null,"created_at":"2026-09-27T09:00:00Z","updated_at":"2026-09-27T09:05:00Z","cost":null,"tokens_used":null,"resume_command":null,"external_id":null,"source":"agentdeck","parent_id":null,"hidden":false}},"event_id":8}"#
        let frame = try XCTUnwrap(ServerFrame(text: text))
        let session = try XCTUnwrap(frame.session)
        XCTAssertEqual(session.id, "s1")
        XCTAssertEqual(session.status, "running")
        XCTAssertEqual(session.agent, "claude")
    }

    func testAgentEventFrame() throws {
        let text = #"{"type":"AgentEvent","payload":{"event":{"event_id":"e1","session_id":"s1","sequence":3,"timestamp":"2026-09-27T10:00:00.123456Z","kind":"assistant_text","payload":{"text":"Hello","delta":true,"redraw":false},"duration_ms":null}},"event_id":9}"#
        let frame = try XCTUnwrap(ServerFrame(text: text))
        let event = try XCTUnwrap(frame.agentEvent)
        XCTAssertEqual(event.eventId, "e1")
        XCTAssertEqual(event.kind, "assistant_text")
        XCTAssertEqual(event.payload?["text"]?.stringValue, "Hello")
        XCTAssertEqual(event.payload?["delta"]?.boolValue, true)
    }

    func testApprovalRequestFrame() throws {
        let text = #"{"type":"ApprovalRequest","payload":{"session_id":"s1","request":{"id":"r1","prompt":"Run rm -rf?","options":["1. Yes","2. No"],"risk_level":"High","timestamp":"2026-09-27T10:00:00Z"}},"event_id":10}"#
        let frame = try XCTUnwrap(ServerFrame(text: text))
        XCTAssertEqual(frame.sessionId, "s1")
        let approval = try XCTUnwrap(frame.approvalRequest)
        XCTAssertEqual(approval.id, "r1")
        XCTAssertEqual(approval.prompt, "Run rm -rf?")
        XCTAssertEqual(approval.options, ["1. Yes", "2. No"])
        XCTAssertEqual(approval.riskLevel, "High")
    }

    func testErrorFrame() throws {
        let frame = try XCTUnwrap(ServerFrame(text: #"{"type":"Error","payload":{"code":"device_revoked","message":"revoked"}}"#))
        XCTAssertEqual(frame.errorCode, "device_revoked")
        XCTAssertEqual(frame.errorMessage, "revoked")
    }

    func testUnknownFrameTypeIsTolerated() {
        // Unknown frames must parse structurally and expose no typed data —
        // new backend event kinds must not crash older clients.
        let frame = ServerFrame(text: #"{"type":"SomethingNew","payload":{"whatever":1},"event_id":11}"#)
        XCTAssertNotNil(frame)
        XCTAssertEqual(frame?.eventID, 11)
        XCTAssertNil(frame?.message)
        XCTAssertNil(frame?.session)
    }

    // MARK: Pairing URL parsing

    func testPairingOfferParsing() throws {
        let offer = try XCTUnwrap(
            PairingOfferParser.parse("http://192.168.1.5:9120/mobile/pair?offer=abc&secret=xyz")
        )
        XCTAssertEqual(offer.baseURL.absoluteString, "http://192.168.1.5:9120")
        XCTAssertEqual(offer.offerId, "abc")
        XCTAssertEqual(offer.secret, "xyz")
        XCTAssertEqual(offer.host, "192.168.1.5")
    }

    func testPairingOfferParsingKeepsPathPrefix() throws {
        let offer = try XCTUnwrap(
            PairingOfferParser.parse("https://tunnel.example.com/proxy/mobile/pair?offer=a&secret=b")
        )
        XCTAssertEqual(offer.baseURL.absoluteString, "https://tunnel.example.com/proxy")
    }

    func testPairingOfferParsingRejectsNonPairingURLs() {
        XCTAssertNil(PairingOfferParser.parse("https://example.com/other?offer=a&secret=b"))
        XCTAssertNil(PairingOfferParser.parse("not a url"))
        XCTAssertNil(PairingOfferParser.parse("http://host:9120/mobile/pair?offer="))
    }
}
