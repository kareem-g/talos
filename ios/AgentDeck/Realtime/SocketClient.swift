import Foundation
import Network

enum ConnectionState: Equatable {
    case idle
    case connecting
    case connected
    case reconnecting
    case offline
    case unauthorized

    var label: String {
        switch self {
        case .idle: return "Idle"
        case .connecting: return "Connecting…"
        case .connected: return "Connected"
        case .reconnecting: return "Reconnecting…"
        case .offline: return "Offline"
        case .unauthorized: return "Revoked"
        }
    }
}

/// Authenticated WebSocket client for `/ws/mobile`.
///
/// Mirrors the dashboard socket's semantics:
/// - `Authenticate` is the first frame after connect, carrying the replay
///   cursor (`after_event_id`).
/// - State becomes `connected` only on `Authenticated`, not on socket open.
/// - The server's event counter resets when the daemon restarts, so a cursor
///   ahead of the server's `last_event_id` is dropped to avoid silently
///   skipping the whole replay.
/// - Frames sent while disconnected are queued (bounded) and flushed on
///   reconnect.
/// - `Error{code:"device_revoked"}` is terminal: no reconnect.
final class SocketClient {
    var onFrame: ((ServerFrame) -> Void)?
    var onStateChange: ((ConnectionState) -> Void)?

    private(set) var state: ConnectionState = .idle {
        didSet {
            if oldValue != state {
                onStateChange?(state)
            }
        }
    }

    private let urlSession: URLSession
    private var task: URLSessionWebSocketTask?
    private var pairing: Pairing?
    private var cursor: UInt64?
    private var outbox: [ClientFrame] = []
    private var closedByUs = false
    private var everConnected = false
    private var attempt = 0
    private var reconnectItem: DispatchWorkItem?
    private var pingTimer: Timer?
    private var networkUnsatisfied = false
    private let pathMonitor = NWPathMonitor()

    /// Backoff schedule in seconds, capped like the dashboard's.
    private static let backoff: [TimeInterval] = [0.5, 1, 2, 4, 8, 15]
    private static let outboxLimit = 50
    private static let pingInterval: TimeInterval = 25

    init(urlSession: URLSession = .shared) {
        self.urlSession = urlSession
        pathMonitor.pathUpdateHandler = { [weak self] path in
            DispatchQueue.main.async {
                self?.networkPathChanged(path.status == .satisfied)
            }
        }
        pathMonitor.start(queue: DispatchQueue(label: "socket.path-monitor"))
    }

    deinit {
        pathMonitor.cancel()
    }

    func configure(with pairing: Pairing) {
        self.pairing = pairing
    }

    // MARK: Connection lifecycle

    func connect() {
        guard state != .unauthorized, state != .connected, state != .connecting else { return }
        guard let pairing, let url = Self.webSocketURL(for: pairing) else {
            state = .idle
            return
        }
        clearReconnectTimer()

        state = everConnected ? .reconnecting : .connecting
        closedByUs = false

        let task = urlSession.webSocketTask(with: url)
        self.task = task
        task.resume()

        // URLSession buffers sends until the handshake completes, so the
        // authenticate frame can go out immediately after resume.
        sendNow(.authenticate(token: pairing.token, afterEventId: cursor))
        receiveLoop(on: task)
        startPingTimer()
    }

    func disconnect() {
        closedByUs = true
        clearReconnectTimer()
        stopPingTimer()
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
        state = .idle
    }

    /// Full reset — used when the device is unpaired.
    func reset() {
        disconnect()
        cursor = nil
        outbox.removeAll()
        everConnected = false
        attempt = 0
        networkUnsatisfied = false
        pairing = nil
    }

    /// Nudge the socket awake when the app returns to the foreground.
    func wake() {
        guard state != .unauthorized else { return }
        if task == nil, pairing != nil {
            connect()
        }
    }

    private static func webSocketURL(for pairing: Pairing) -> URL? {
        guard let base = pairing.url,
              var components = URLComponents(url: base, resolvingAgainstBaseURL: false)
        else { return nil }
        components.scheme = components.scheme == "https" ? "wss" : "ws"
        components.path = components.path + "/ws/mobile"
        return components.url
    }

    // MARK: Sending

    func send(_ frame: ClientFrame) {
        guard state != .unauthorized else { return }
        if state == .connected, task != nil {
            sendNow(frame)
        } else {
            if outbox.count < Self.outboxLimit {
                outbox.append(frame)
            }
            connect()
        }
    }

    private func sendNow(_ frame: ClientFrame) {
        task?.send(.string(frame.encoded())) { [weak self] error in
            DispatchQueue.main.async {
                if error != nil, case .connected = self?.state ?? .idle {
                    // The socket died mid-send; requeue and let the reconnect
                    // path flush it.
                    if self?.outbox.count ?? 0 < Self.outboxLimit {
                        self?.outbox.append(frame)
                    }
                    self?.handleDisconnect()
                }
            }
        }
    }

    private func flushOutbox() {
        let queued = outbox
        outbox.removeAll()
        for frame in queued {
            sendNow(frame)
        }
    }

    // MARK: Receiving

    private func receiveLoop(on task: URLSessionWebSocketTask) {
        task.receive { [weak self] result in
            DispatchQueue.main.async {
                guard let self, self.task === task else { return }
                switch result {
                case .success(let message):
                    if case .string(let text) = message {
                        if let frame = ServerFrame(text: text) {
                            self.handleFrame(frame)
                        }
                    }
                    self.receiveLoop(on: task)
                case .failure:
                    self.handleDisconnect()
                }
            }
        }
    }

    private func handleFrame(_ frame: ServerFrame) {
        if frame.type == "Authenticated" {
            attempt = 0
            everConnected = true
            if let serverLast = frame.lastEventId, let cursor, serverLast < cursor {
                // The daemon restarted and its counter reset; a stale cursor
                // would skip the entire replay.
                self.cursor = nil
            }
            state = .connected
            flushOutbox()
            return
        }
        if frame.type == "Error", frame.errorCode == "device_revoked" {
            closedByUs = true
            stopPingTimer()
            task?.cancel(with: .goingAway, reason: nil)
            task = nil
            state = .unauthorized
            return
        }
        if let eventID = frame.eventID {
            cursor = max(cursor ?? 0, eventID)
        }
        onFrame?(frame)
    }

    private func handleDisconnect() {
        stopPingTimer()
        task = nil
        guard !closedByUs else {
            state = .idle
            return
        }
        scheduleReconnect()
    }

    private func scheduleReconnect() {
        guard reconnectItem == nil else { return }
        if networkUnsatisfied {
            state = .offline
        } else {
            state = .reconnecting
        }
        let delay = Self.backoff[min(attempt, Self.backoff.count - 1)]
        attempt += 1
        let item = DispatchWorkItem { [weak self] in
            self?.reconnectItem = nil
            self?.connect()
        }
        reconnectItem = item
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: item)
    }

    private func clearReconnectTimer() {
        reconnectItem?.cancel()
        reconnectItem = nil
    }

    private func networkPathChanged(_ satisfied: Bool) {
        networkUnsatisfied = !satisfied
        if satisfied {
            // Back online: reconnect promptly if we're down.
            if state == .offline || state == .reconnecting || state == .idle {
                if task == nil, pairing != nil {
                    attempt = 0
                    connect()
                }
            }
        } else if state == .connected || state == .connecting || state == .reconnecting {
            state = .offline
            task?.cancel(with: .goingAway, reason: nil)
            task = nil
            stopPingTimer()
            scheduleReconnect()
        }
    }

    // MARK: Keepalive

    private func startPingTimer() {
        stopPingTimer()
        let timer = Timer(timeInterval: Self.pingInterval, repeats: true) { [weak self] _ in
            self?.task?.sendPing { _ in }
        }
        RunLoop.main.add(timer, forMode: .common)
        pingTimer = timer
    }

    private func stopPingTimer() {
        pingTimer?.invalidate()
        pingTimer = nil
    }
}
