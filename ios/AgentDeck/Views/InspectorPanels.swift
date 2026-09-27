import SwiftUI
import UIKit

// The right-rail surfaces the first pass left out: the browser mirror with
// live takeover, workspace/session navigation, room channels, and the pinned
// side chat. Everything here talks to the same endpoints the dashboard uses;
// the paired device token authorizes them.

// MARK: - Shared wire shapes

struct DirEntryWire: Decodable, Identifiable {
    var name: String
    var path: String
    var dir: Bool

    var id: String { path }
}

struct DirListingWire: Decodable {
    var path: String
    var parent: String?
    var roots: [DirEntryWire]?
    var entries: [DirEntryWire]?
}

struct BrowserStateWire: Decodable {
    var ok: Bool?
    var tabs: [BrowserTabWire]?
    var viewport: ViewportWire?
}

struct BrowserTabWire: Decodable, Identifiable {
    var id: String
    var url: String?
    var title: String?
}

struct ViewportWire: Decodable {
    var width: Double
    var height: Double
}

struct RoomWorkerWire: Decodable, Identifiable {
    var name: String
    var sessionId: String?

    var id: String { sessionId ?? name }

    enum CodingKeys: String, CodingKey {
        case name
        case sessionId
    }
}

/// The dashboard-owned room record (`dashboard/src/lib/api.ts` RoomRecord).
/// Keys are camelCase because the dashboard writes this blob verbatim.
struct RoomWire: Decodable, Identifiable {
    var id: String
    var name: String
    var workers: [RoomWorkerWire]?
    var chief: String?
    var sessionId: String?
    var project: String?
}

private struct RoomsResponse: Decodable {
    var rooms: [RoomWire]
}

private struct BrowserToolBody: Encodable {
    var name: String
    var arguments: [String: JSONValue]
}

private struct SessionIdBody: Encodable {
    var sessionId: String

    enum CodingKeys: String, CodingKey {
        case sessionId = "session_id"
    }
}

// MARK: - Browser mirror

/// Live screenshot of the agent's CDP browser with click/scroll/type takeover.
/// Polls the daemon's screenshot proxy; taps map through the rendered image
/// rect into viewport coordinates and go back as `browser_cua_*` tool calls,
/// so manual actions land in the session timeline exactly like agent steps.
struct BrowserTabView: View {
    let sessionId: String
    @Environment(AppState.self) private var app

    @State private var state: BrowserStateWire?
    @State private var frame: UIImage?
    @State private var status: String?
    @State private var busy = false
    @State private var urlField = ""
    @State private var typeField = ""

    private var activeTab: BrowserTabWire? {
        state?.tabs?.first
    }

    private var viewport: (width: Double, height: Double) {
        (state?.viewport?.width ?? 1280, state?.viewport?.height ?? 800)
    }

    var body: some View {
        VStack(spacing: 0) {
            if let tab = activeTab, frame != nil {
                mirror(tab: tab)
            } else {
                empty
            }
            controls
        }
        .task { await poll() }
    }

    private var empty: some View {
        VStack {
            EmptyState(
                icon: "safari",
                title: "Browser not mirrored",
                detail: status ?? "Start the built-in browser to watch and drive the page the agent is on."
            )
            Spacer()
        }
        .frame(maxWidth: .infinity)
    }

    private func mirror(tab: BrowserTabWire) -> some View {
        GeometryReader { geo in
            let image = frame
            let size = image?.size ?? CGSize(width: 1, height: 1)
            let scale = min(geo.size.width / max(size.width, 1), geo.size.height / max(size.height, 1))
            let drawn = CGSize(width: size.width * scale, height: size.height * scale)
            let origin = CGPoint(
                x: (geo.size.width - drawn.width) / 2,
                y: (geo.size.height - drawn.height) / 2
            )
            ZStack(alignment: .topLeading) {
                if let image {
                    Image(uiImage: image)
                        .resizable()
                        .interpolation(.medium)
                        .frame(width: drawn.width, height: drawn.height)
                        .offset(x: origin.x, y: origin.y)
                        .overlay(alignment: .topLeading) {
                            Rectangle()
                                .fill(.clear)
                                .frame(width: drawn.width, height: drawn.height)
                                .offset(x: origin.x, y: origin.y)
                                .contentShape(Rectangle())
                                .onTapGesture(coordinateSpace: .local) { point in
                                    let x = (point.x - origin.x) / max(drawn.width, 1)
                                    let y = (point.y - origin.y) / max(drawn.height, 1)
                                    guard (0...1).contains(x), (0...1).contains(y) else { return }
                                    Task {
                                        await tool("browser_cua_click", [
                                            "tab": .string(tab.id),
                                            "x": .number((x * viewport.width).rounded()),
                                            "y": .number((y * viewport.height).rounded()),
                                        ])
                                    }
                                }
                                .gesture(
                                    DragGesture(minimumDistance: 24)
                                        .onEnded { value in
                                            let delta = value.translation.height
                                            guard abs(delta) > 24 else { return }
                                            Task {
                                                await tool("browser_cua_scroll", [
                                                    "tab": .string(tab.id),
                                                    "x": .number(viewport.width / 2),
                                                    "y": .number(viewport.height / 2),
                                                    "scrollX": .number(0),
                                                    "scrollY": .number((delta * 2).rounded()),
                                                ])
                                            }
                                        }
                                )
                        }
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .background(Theme.termBg)
    }

    private var controls: some View {
        VStack(spacing: 8) {
            HStack(spacing: 6) {
                Button {
                    Task { await start() }
                } label: {
                    Label(activeTab == nil ? "Start" : "Restart", systemImage: "play.fill")
                }
                .disabled(busy)

                Button {
                    Task { await stop() }
                } label: {
                    Label("Stop", systemImage: "stop.fill")
                }
                .disabled(busy || activeTab == nil)

                Spacer()

                if let tab = activeTab {
                    Text(tab.url ?? "")
                        .font(.caption2.monospaced())
                        .foregroundStyle(Theme.ink3)
                        .lineLimit(1)
                        .truncationMode(.head)
                }
            }
            .font(.caption)
            .buttonStyle(.bordered)
            .controlSize(.small)

            HStack(spacing: 6) {
                TextField("https://…", text: $urlField)
                    .font(.caption.monospaced())
                    .textFieldStyle(.roundedBorder)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                    .onSubmit { go() }
                Button("Go") { go() }
                    .font(.caption)
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                    .disabled(urlField.trimmingCharacters(in: .whitespaces).isEmpty)
            }

            HStack(spacing: 6) {
                TextField("Type into the focused field…", text: $typeField)
                    .font(.caption)
                    .textFieldStyle(.roundedBorder)
                    .autocorrectionDisabled()
                    .onSubmit { typeText() }
                Button("Send") { typeText() }
                    .font(.caption)
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                    .disabled(typeField.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .padding(10)
        .background(Theme.card)
        .overlay(alignment: .top) { Divider().overlay(Theme.line) }
    }

    private func refreshState() async {
        do {
            let next: BrowserStateWire = try await app.get("/api/browser/\(sessionId)/state")
            state = next
            status = nil
        } catch {
            state = nil
            status = (error as? APIError)?.message
        }
    }

    private func refreshFrame() async {
        guard let tab = activeTab else {
            frame = nil
            return
        }
        do {
            let data = try await app.getData("/api/browser/\(sessionId)/screenshot/\(tab.id)")
            if let image = UIImage(data: data) {
                frame = image
            }
        } catch {
            // Transient — the poll loop retries.
        }
    }

    private func poll() async {
        await refreshState()
        if let tab = activeTab, urlField.isEmpty {
            urlField = tab.url ?? ""
        }
        while !Task.isCancelled {
            await refreshFrame()
            try? await Task.sleep(for: .seconds(1.5))
            if Task.isCancelled { break }
            await refreshState()
        }
    }

    private func start() async {
        busy = true
        defer { busy = false }
        do {
            try await app.postJSON("/api/browser/start", body: SessionIdBody(sessionId: sessionId))
            await refreshState()
            await refreshFrame()
        } catch {
            status = (error as? APIError)?.message ?? "Couldn't start the browser."
        }
    }

    private func stop() async {
        busy = true
        defer { busy = false }
        do {
            try await app.postJSON("/api/browser/stop", body: SessionIdBody(sessionId: sessionId))
            state = nil
            frame = nil
        } catch {
            status = (error as? APIError)?.message ?? "Couldn't stop the browser."
        }
    }

    private func go() {
        let target = urlField.trimmingCharacters(in: .whitespaces)
        guard !target.isEmpty, let tab = activeTab else { return }
        let url = target.contains("://") ? target : "https://\(target)"
        urlField = url
        Task { await tool("browser_goto", ["tab": .string(tab.id), "url": .string(url)]) }
    }

    private func typeText() {
        let text = typeField
        guard !text.isEmpty else { return }
        typeField = ""
        Task { await tool("browser_cursor_type", ["text": .string(text)]) }
    }

    private func tool(_ name: String, _ arguments: [String: JSONValue]) async {
        do {
            try await app.postJSON(
                "/api/browser/\(sessionId)/tool",
                body: BrowserToolBody(name: name, arguments: arguments)
            )
            try? await Task.sleep(for: .milliseconds(500))
            await refreshFrame()
        } catch {
            status = (error as? APIError)?.message
        }
    }
}

// MARK: - Projects

/// Every workspace on the desktop with its sessions — the mobile stand-in for
/// the desktop Projects rail, jumping straight into a session.
struct ProjectsTabView: View {
    @Environment(AppState.self) private var app
    let onOpenSession: (String) -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                ForEach(app.snapshot?.workspaces ?? [], id: \.id) { workspace in
                    VStack(alignment: .leading, spacing: 0) {
                        HStack(spacing: 6) {
                            Image(systemName: "square.stack.3d.up")
                                .font(.caption2)
                                .foregroundStyle(Theme.ink3)
                            Text(workspace.name)
                                .font(.footnote.weight(.semibold))
                                .foregroundStyle(Theme.ink)
                            Spacer()
                            Text("\(workspace.tasks.count)")
                                .font(Theme.eyebrow(9))
                                .foregroundStyle(Theme.ink3)
                        }
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)

                        ForEach(workspace.tasks) { task in
                            Button {
                                onOpenSession(task.id)
                            } label: {
                                HStack(spacing: 8) {
                                    Circle()
                                        .fill(Theme.statusColor(task.status))
                                        .frame(width: 6, height: 6)
                                    Text(task.name)
                                        .font(.caption)
                                        .foregroundStyle(Theme.ink2)
                                        .lineLimit(1)
                                    Spacer()
                                    Text(Theme.statusLabel(task.status).uppercased())
                                        .font(Theme.eyebrow(8))
                                        .foregroundStyle(Theme.statusColor(task.status))
                                }
                                .padding(.horizontal, 12)
                                .padding(.vertical, 7)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .background(Theme.card, in: RoundedRectangle(cornerRadius: Theme.cardRadius))
                    .overlay(
                        RoundedRectangle(cornerRadius: Theme.cardRadius).stroke(Theme.line, lineWidth: 1)
                    )
                    .padding(.horizontal, 14)
                }

                if (app.snapshot?.workspaces ?? []).isEmpty {
                    EmptyState(
                        icon: "square.stack.3d.up",
                        title: "No workspaces",
                        detail: "Start an agent on the desktop to see its workspace here."
                    )
                }
            }
            .padding(.vertical, 10)
        }
    }
}

// MARK: - Sub-sessions

/// Sessions sharing this session's workspace (plus any children it spawned).
struct SubSessionsTabView: View {
    let session: Session
    @Environment(AppState.self) private var app
    let onOpenSession: (String) -> Void

    private var here: [MobileTask] {
        guard let snapshot = app.snapshot else { return [] }
        let project = session.project
        return snapshot.allTasks.filter { task in
            task.id == session.id
                || (project != nil && task.project == project)
                || task.parentId == session.id
        }
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                ForEach(here) { task in
                    Button {
                        guard task.id != session.id else { return }
                        onOpenSession(task.id)
                    } label: {
                        HStack(spacing: 8) {
                            Text(activeDot(task.status))
                                .font(.caption2)
                                .foregroundStyle(Theme.statusColor(task.status))
                            VStack(alignment: .leading, spacing: 1) {
                                Text(task.name)
                                    .font(.footnote)
                                    .foregroundStyle(task.id == session.id ? Theme.ink : Theme.ink2)
                                    .lineLimit(1)
                                Text(meta(task))
                                    .font(Theme.eyebrow(8))
                                    .foregroundStyle(Theme.ink3)
                            }
                            Spacer()
                            if task.id == session.id {
                                Text("HERE")
                                    .font(Theme.eyebrow(8))
                                    .foregroundStyle(Theme.accent)
                            } else if task.parentId == session.id {
                                Text("CHILD")
                                    .font(Theme.eyebrow(8))
                                    .foregroundStyle(Theme.ink3)
                            }
                        }
                        .padding(.horizontal, 14)
                        .padding(.vertical, 9)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .disabled(task.id == session.id)
                    Divider().overlay(Theme.line.opacity(0.5))
                }
            }
            .background(Theme.card, in: RoundedRectangle(cornerRadius: Theme.cardRadius))
            .overlay(RoundedRectangle(cornerRadius: Theme.cardRadius).stroke(Theme.line, lineWidth: 1))
            .padding(14)
        }
    }

    private func activeDot(_ status: String) -> String {
        status == "running" || status == "starting" ? "◉" : "○"
    }

    private func meta(_ task: MobileTask) -> String {
        [task.agent, Theme.statusLabel(task.status)]
            .filter { !$0.isEmpty }
            .joined(separator: " · ")
            .uppercased()
    }
}

// MARK: - Rooms

/// Room rosters stored by the daemon, with the shared channel transcript.
struct RoomsTabView: View {
    let session: Session
    @Environment(AppState.self) private var app

    @State private var rooms: [RoomWire] = []
    @State private var openRoom: RoomWire?
    @State private var loaded = false
    @State private var error: String?

    var body: some View {
        Group {
            if let room = openRoom {
                RoomChannelView(room: room, fallbackAgent: session.agent) {
                    openRoom = nil
                }
            } else {
                list
            }
        }
        .task { await load() }
    }

    private var list: some View {
        Group {
            if let error {
                EmptyState(icon: "exclamationmark.triangle", title: "Rooms unavailable", detail: error)
            } else if rooms.isEmpty && loaded {
                EmptyState(
                    icon: "person.3",
                    title: "No rooms yet",
                    detail: "Rooms are created on the desktop. Once one exists, its channel shows here."
                )
            } else {
                ScrollView {
                    VStack(spacing: 0) {
                        ForEach(rooms) { room in
                            Button {
                                openRoom = room
                            } label: {
                                HStack(spacing: 10) {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(room.name)
                                            .font(.footnote.weight(.medium))
                                            .foregroundStyle(Theme.ink)
                                        Text(roster(room).uppercased())
                                            .font(Theme.eyebrow(8))
                                            .foregroundStyle(Theme.ink3)
                                            .lineLimit(1)
                                    }
                                    Spacer()
                                    Image(systemName: "chevron.right")
                                        .font(.caption2)
                                        .foregroundStyle(Theme.ink3)
                                }
                                .padding(.horizontal, 14)
                                .padding(.vertical, 10)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            Divider().overlay(Theme.line.opacity(0.5))
                        }
                    }
                    .background(Theme.card, in: RoundedRectangle(cornerRadius: Theme.cardRadius))
                    .overlay(RoundedRectangle(cornerRadius: Theme.cardRadius).stroke(Theme.line, lineWidth: 1))
                    .padding(14)
                }
            }
        }
    }

    private func roster(_ room: RoomWire) -> String {
        let workers = (room.workers ?? []).map(\.name).joined(separator: ", ")
        if let chief = room.chief, !chief.isEmpty {
            return "chief \(chief) · \(workers)"
        }
        return workers.isEmpty ? "no workers" : workers
    }

    private func load() async {
        do {
            let response: RoomsResponse = try await app.get("/api/rooms")
            rooms = response.rooms
        } catch {
            self.error = (error as? APIError)?.message ?? "Couldn't load rooms."
        }
        loaded = true
    }
}

/// One room's channel: worker chips, the shared transcript, and a composer.
/// `@worker` mentions and `/orchestrator` fan-out are just text on the wire —
/// the daemon's room dispatcher interprets them.
struct RoomChannelView: View {
    let room: RoomWire
    let fallbackAgent: String
    let onBack: () -> Void

    @Environment(AppState.self) private var app
    @State private var draft = ""

    /// The room's channel session — created lazily on the desktop side, so a
    /// room without one renders an explanatory empty state.
    private var channelSessionId: String? { room.sessionId }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Button {
                    onBack()
                } label: {
                    Image(systemName: "chevron.left").font(.caption)
                }
                .buttonStyle(.plain)
                Text(room.name)
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Theme.ink)
                Spacer()
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(room.workers ?? []) { worker in
                        Text("@\(worker.name)")
                            .font(Theme.eyebrow(9))
                            .foregroundStyle(Theme.accent)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(Theme.accentTint, in: Capsule())
                    }
                }
                .padding(.horizontal, 12)
            }
            .padding(.bottom, 6)

            Divider().overlay(Theme.line)

            if let channelSessionId, let model = app.sessions[channelSessionId] {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 8) {
                            ForEach(model.state.messages) { message in
                                ChannelMessageRow(message: message)
                            }
                            Color.clear.frame(height: 1).id("end")
                        }
                        .padding(12)
                    }
                    .onAppear { proxy.scrollTo("end", anchor: .bottom) }
                    .onChange(of: model.state.messages.count) { _, _ in
                        proxy.scrollTo("end", anchor: .bottom)
                    }
                }
            } else {
                EmptyState(
                    icon: "bubble.left.and.bubble.right",
                    title: "Channel not started",
                    detail: "Open this room on the desktop once to create its channel session, then it appears here."
                )
            }

            if let channelSessionId {
                MiniComposer(text: $draft) {
                    let text = draft
                    draft = ""
                    app.sendInput(sessionId: channelSessionId, text: text)
                }
            }
        }
        .task {
            if let channelSessionId {
                await app.hydrate(channelSessionId)
            }
        }
    }
}

// MARK: - Side chat

/// The `/side` thread: one parallel chat pinned per project. Created from here
/// when it doesn't exist yet.
struct SideTabView: View {
    let session: Session
    @Environment(AppState.self) private var app

    @State private var sideId: String?
    @State private var draft = ""
    @State private var creating = false
    @State private var error: String?

    private var storageKey: String {
        "agentdeck-side-session-\(session.project ?? "default")"
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Text("Side chat")
                    .font(Theme.eyebrow(10))
                    .textCase(.uppercase)
                    .foregroundStyle(Theme.ink3)
                Spacer()
                if sideId != nil {
                    Button("New") {
                        Task { await create() }
                    }
                    .font(.caption)
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                    .disabled(creating)
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 8)

            Divider().overlay(Theme.line)

            if let error {
                EmptyState(icon: "exclamationmark.triangle", title: "Side chat unavailable", detail: error)
                Spacer()
            } else if sideId == nil {
                VStack {
                    EmptyState(
                        icon: "bubble.left.and.text.bubble.right",
                        title: "No side chat yet",
                        detail: "A side chat is a second thread in this project — ask a quick question without derailing the main session."
                    )
                    Button {
                        Task { await create() }
                    } label: {
                        Text(creating ? "Starting…" : "Start side chat")
                            .font(.subheadline.weight(.medium))
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(creating)
                    Spacer()
                }
                .frame(maxWidth: .infinity)
            } else if let sideId, let model = app.sessions[sideId] {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 8) {
                            ForEach(model.state.messages) { message in
                                ChannelMessageRow(message: message)
                            }
                            if !model.state.streamingText.isEmpty {
                                ChannelMessageRow(
                                    message: AgentMessage(
                                        id: "streaming",
                                        sessionId: sideId,
                                        role: "assistant",
                                        content: model.state.streamingText,
                                        timestamp: Date()
                                    )
                                )
                            }
                            Color.clear.frame(height: 1).id("end")
                        }
                        .padding(12)
                    }
                    .onAppear { proxy.scrollTo("end", anchor: .bottom) }
                    .onChange(of: model.state.messages.count) { _, _ in
                        proxy.scrollTo("end", anchor: .bottom)
                    }
                }
                MiniComposer(text: $draft) {
                    let text = draft
                    draft = ""
                    app.sendInput(sessionId: sideId, text: text)
                }
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .onAppear { restore() }
    }

    private func restore() {
        if let stored = UserDefaults.standard.string(forKey: storageKey) {
            sideId = stored
        }
    }

    private func create() async {
        creating = true
        error = nil
        defer { creating = false }
        do {
            let id = try await app.createSession(
                agent: session.agent,
                name: "Side · \(Format.projectLabel(session.project) ?? "workspace")",
                prompt: nil,
                project: session.project
            )
            UserDefaults.standard.set(id, forKey: storageKey)
            sideId = id
            await app.hydrate(id)
        } catch {
            if let stored = UserDefaults.standard.string(forKey: storageKey) {
                sideId = stored
            } else {
                self.error = (error as? APIError)?.message ?? "Couldn't start a side chat."
            }
        }
    }
}

// MARK: - Shared chat pieces

struct ChannelMessageRow: View {
    let message: AgentMessage

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(message.role.uppercased())
                .font(Theme.eyebrow(8))
                .foregroundStyle(message.role == "user" ? Theme.accent : Theme.ink3)
            Text(message.content)
                .font(.footnote)
                .foregroundStyle(Theme.ink)
                .frame(maxWidth: .infinity, alignment: .leading)
                .textSelection(.enabled)
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            message.role == "user" ? Theme.accentTint : Theme.inset,
            in: RoundedRectangle(cornerRadius: 12)
        )
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.line, lineWidth: 1))
    }
}

struct MiniComposer: View {
    @Binding var text: String
    let onSend: () -> Void

    var body: some View {
        HStack(alignment: .bottom, spacing: 8) {
            TextField("Message…", text: $text, axis: .vertical)
                .lineLimit(1...4)
                .font(.footnote)
                .padding(.horizontal, 10)
                .padding(.vertical, 7)
                .background(Theme.field, in: RoundedRectangle(cornerRadius: 14))
                .overlay(RoundedRectangle(cornerRadius: 14).stroke(Theme.line, lineWidth: 1))
                .onSubmit(send)
            Button(action: send) {
                Image(systemName: "arrow.up.circle.fill")
                    .font(.system(size: 26))
                    .foregroundStyle(
                        text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                            ? Theme.ink3.opacity(0.4)
                            : Theme.accent
                    )
            }
            .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            .accessibilityLabel("Send")
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(Theme.canvas)
        .overlay(alignment: .top) { Divider().overlay(Theme.line) }
    }

    private func send() {
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        onSend()
    }
}
