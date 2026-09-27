import SwiftUI

/// The mobile counterpart of the desktop session's right rail: Activity,
/// Plan, Agents, Goal, Files, Git, Browser, Projects, Sub-sessions, Rooms,
/// Side, and Terminal in one bottom sheet, styled with the desktop's
/// eyebrow/pill language. Activity/Plan/Agents/Goal read the live socket
/// state; the rest fetch the same REST endpoints the dashboard uses (the
/// device token authorizes every `/api/*` route).
enum InspectorTab: String, CaseIterable, Identifiable {
    case activity, plan, agents, goal, files, git, browser, projects, subsessions, rooms, side, terminal

    var id: String { rawValue }

    var label: String {
        switch self {
        case .activity: return "Activity"
        case .plan: return "Plan"
        case .agents: return "Agents"
        case .goal: return "Goal"
        case .files: return "Files"
        case .git: return "Git"
        case .browser: return "Browser"
        case .projects: return "Projects"
        case .subsessions: return "Sessions"
        case .rooms: return "Rooms"
        case .side: return "Side"
        case .terminal: return "Terminal"
        }
    }

    var icon: String {
        switch self {
        case .activity: return "clock.arrow.circlepath"
        case .plan: return "list.clipboard"
        case .agents: return "person.2"
        case .goal: return "flag"
        case .files: return "folder"
        case .git: return "arrow.triangle.branch"
        case .browser: return "safari"
        case .projects: return "square.stack.3d.up"
        case .subsessions: return "rectangle.stack"
        case .rooms: return "person.3"
        case .side: return "bubble.left.and.text.bubble.right"
        case .terminal: return "terminal"
        }
    }
}

struct InspectorSheet: View {
    let sessionId: String
    /// Pushes another session onto the home stack (Projects / Sub-sessions
    /// jump targets). The sheet dismisses itself first.
    var onOpenSession: (String) -> Void = { _ in }

    @Environment(AppState.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var selection: InspectorTab = .activity

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                tabStrip
                Divider().overlay(Theme.line)
                content
            }
            .background(Theme.canvas)
            .navigationTitle(app.sessions[sessionId]?.state.session.name ?? "Task")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    if let session = app.sessions[sessionId]?.state.session {
                        StatusBadge(status: session.status)
                    }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    private var tabStrip: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(InspectorTab.allCases) { tab in
                    Button {
                        selection = tab
                    } label: {
                        Label(tab.label, systemImage: tab.icon)
                            .font(Theme.eyebrow(10))
                            .textCase(.uppercase)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 6)
                            .background(selection == tab ? Theme.accentTint : Theme.field, in: Capsule())
                            .overlay(Capsule().stroke(selection == tab ? Theme.accent : Theme.clear, lineWidth: 1))
                            .foregroundStyle(selection == tab ? Theme.accent : Theme.ink3)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(tab.label)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
        }
    }

    private func open(_ id: String) {
        dismiss()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
            onOpenSession(id)
        }
    }

    @ViewBuilder
    private var content: some View {
        if let model = app.sessions[sessionId] {
            switch selection {
            case .activity:
                ActivityTabView(activities: model.state.activities.reversed().map { $0 })
            case .plan:
                PlanTabView(entries: model.state.planEntries)
            case .agents:
                AgentsTabView(
                    session: model.state.session,
                    subagents: model.state.subagents,
                    activities: model.state.activities.reversed().map { $0 }
                )
            case .goal:
                GoalTabView(
                    session: model.state.session,
                    objective: model.state.messages.last(where: { $0.role == "user" })?.content,
                    entries: model.state.planEntries
                )
            case .files:
                FilesTabView(session: model.state.session)
            case .git:
                GitTabView(session: model.state.session)
            case .browser:
                BrowserTabView(sessionId: sessionId)
            case .projects:
                ProjectsTabView(onOpenSession: open)
            case .subsessions:
                SubSessionsTabView(session: model.state.session, onOpenSession: open)
            case .rooms:
                RoomsTabView(session: model.state.session)
            case .side:
                SideTabView(session: model.state.session)
            case .terminal:
                TerminalTabView(lines: model.state.terminalLines)
            }
        } else {
            ProgressView()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}

// MARK: - Shared bits

/// Small mono eyebrow header used at the top of each rail surface.
struct RailHeader: View {
    let title: String
    var trailing: String?

    var body: some View {
        HStack {
            Text(title)
                .font(Theme.eyebrow(10))
                .textCase(.uppercase)
                .foregroundStyle(Theme.ink3)
            Spacer()
            if let trailing {
                Text(trailing)
                    .font(Theme.eyebrow(10))
                    .foregroundStyle(Theme.ink3)
            }
        }
        .padding(.horizontal, 14)
        .padding(.top, 12)
        .padding(.bottom, 6)
    }
}

struct EmptyState: View {
    let icon: String
    let title: String
    let detail: String

    var body: some View {
        VStack(spacing: 6) {
            Image(systemName: icon)
                .font(.system(size: 26))
                .foregroundStyle(Theme.ink3)
            Text(title)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(Theme.ink2)
            Text(detail)
                .font(.footnote)
                .foregroundStyle(Theme.ink3)
                .multilineTextAlignment(.center)
        }
        .padding(.horizontal, 32)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 40)
    }
}

// MARK: - Activity

private struct ActivityTabView: View {
    let activities: [ActivityItem]

    var body: some View {
        Group {
            if activities.isEmpty {
                EmptyState(
                    icon: "clock.arrow.circlepath",
                    title: "No activity yet",
                    detail: "Tool calls, commands, and browser steps stream here in real time."
                )
            } else {
                ScrollView {
                    LazyVStack(spacing: 10) {
                        ForEach(activities) { item in
                            ActivityRowView(item: item)
                        }
                    }
                    .padding(14)
                }
            }
        }
    }
}

struct ActivityRowView: View {
    let item: ActivityItem

    private var icon: (String, Color) {
        switch item.kind {
        case "command": return ("terminal", Theme.ink2)
        case "browser": return ("safari", Theme.accent)
        case "plan": return ("list.clipboard", Theme.accent)
        case "error": return ("xmark.octagon", Theme.red)
        case "turn": return ("checkmark.circle", Theme.green)
        default: return ("wrench.and.screwdriver", Theme.ink2)
        }
    }

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            if item.isRunning {
                ProgressView()
                    .controlSize(.mini)
                    .frame(width: 16)
            } else {
                Image(systemName: item.isFailed ? "xmark.circle" : icon.0)
                    .font(.caption)
                    .foregroundStyle(item.isFailed ? Theme.red : icon.1)
                    .frame(width: 16)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(item.title)
                    .font(.caption.weight(.medium))
                    .foregroundStyle(Theme.ink)
                    .lineLimit(1)
                if let detail = item.detail, !detail.isEmpty {
                    Text(detail)
                        .font(.caption2)
                        .foregroundStyle(Theme.ink2)
                        .lineLimit(2)
                }
            }
            Spacer(minLength: 0)
            if let timestamp = item.timestamp {
                Text(Format.relativeTime(timestamp))
                    .font(Theme.eyebrow(9))
                    .foregroundStyle(Theme.ink3)
            }
        }
    }
}

// MARK: - Plan

private struct PlanTabView: View {
    let entries: [PlanEntry]

    var body: some View {
        Group {
            if entries.isEmpty {
                EmptyState(
                    icon: "list.clipboard",
                    title: "No plan yet",
                    detail: "The agent's plan checklist appears here as soon as it writes one."
                )
            } else {
                ScrollView {
                    VStack(spacing: 0) {
                        PlanProgressRow(entries: entries)
                            .padding(.bottom, 10)
                        ForEach(entries) { entry in
                            HStack(alignment: .top, spacing: 10) {
                                planIcon(entry)
                                Text(entry.content)
                                    .font(.footnote)
                                    .foregroundStyle(entry.isDone ? Theme.ink3 : Theme.ink)
                                    .strikethrough(entry.isDone, color: Theme.ink3)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                            .padding(.vertical, 7)
                            .padding(.horizontal, 14)
                            Divider().overlay(Theme.line.opacity(0.5))
                        }
                    }
                    .background(Theme.card, in: RoundedRectangle(cornerRadius: Theme.cardRadius))
                    .overlay(
                        RoundedRectangle(cornerRadius: Theme.cardRadius).stroke(Theme.line, lineWidth: 1)
                    )
                    .padding(14)
                }
            }
        }
    }

    @ViewBuilder
    private func planIcon(_ entry: PlanEntry) -> some View {
        switch entry.status {
        case "completed":
            Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.green)
        case "in_progress":
            ProgressView().controlSize(.mini)
        case "failed":
            Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.red)
        case "blocked":
            Image(systemName: "exclamationmark.octagon.fill").foregroundStyle(Theme.orange)
        default:
            Image(systemName: "circle").foregroundStyle(Theme.ink3)
        }
    }
}

private struct PlanProgressRow: View {
    let entries: [PlanEntry]

    private var done: Int { entries.filter(\.isDone).count }

    var body: some View {
        VStack(spacing: 5) {
            HStack {
                Text("Progress")
                    .font(Theme.eyebrow(9))
                    .textCase(.uppercase)
                    .foregroundStyle(Theme.ink3)
                Spacer()
                Text("\(done)/\(entries.count)")
                    .font(Theme.eyebrow(9))
                    .foregroundStyle(Theme.ink3)
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Theme.field)
                    Capsule()
                        .fill(Theme.accent)
                        .frame(width: entries.isEmpty ? 0 : geo.size.width * CGFloat(done) / CGFloat(entries.count))
                }
            }
            .frame(height: 4)
        }
    }
}

// MARK: - Agents

private struct AgentsTabView: View {
    let session: Session
    let subagents: [SubagentInfo]
    let activities: [ActivityItem]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                VStack(spacing: 0) {
                    agentRow(
                        name: session.agent.isEmpty ? "Primary" : session.agent,
                        kind: "primary",
                        status: Theme.statusColor(session.status),
                        statusLabel: Theme.statusLabel(session.status),
                        highlight: true
                    )
                    ForEach(subagents) { subagent in
                        agentRow(
                            name: subagent.name,
                            kind: "subagent",
                            status: statusColor(subagent.status),
                            statusLabel: statusLabel(subagent.status),
                            highlight: false
                        )
                    }
                }
                .background(Theme.card, in: RoundedRectangle(cornerRadius: Theme.cardRadius))
                .overlay(RoundedRectangle(cornerRadius: Theme.cardRadius).stroke(Theme.line, lineWidth: 1))

                if session.branch != nil || session.project != nil {
                    VStack(alignment: .leading, spacing: 4) {
                        if let project = Format.projectLabel(session.project) {
                            Label(project, systemImage: "folder")
                        }
                        if let branch = session.branch {
                            Label(branch, systemImage: "arrow.triangle.branch")
                        }
                    }
                    .font(.caption)
                    .foregroundStyle(Theme.ink2)
                    .padding(.horizontal, 4)
                }

                RailHeader(
                    title: "Live timeline",
                    trailing: subagents.isEmpty ? nil : "\(subagents.count) subagent\(subagents.count == 1 ? "" : "s")"
                )
                if activities.isEmpty {
                    Text("No activity yet — agent events stream here in real time.")
                        .font(.footnote)
                        .foregroundStyle(Theme.ink3)
                        .padding(.horizontal, 14)
                } else {
                    VStack(spacing: 10) {
                        ForEach(activities.prefix(24)) { item in
                            ActivityRowView(item: item)
                        }
                    }
                    .padding(.horizontal, 14)
                }
            }
            .padding(.vertical, 4)
        }
    }

    private func agentRow(
        name: String,
        kind: String,
        status: Color,
        statusLabel: String,
        highlight: Bool
    ) -> some View {
        HStack(spacing: 8) {
            Circle()
                .fill(status)
                .frame(width: 6, height: 6)
            VStack(alignment: .leading, spacing: 1) {
                Text(name)
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(Theme.ink)
                    .lineLimit(1)
                Text(kind.uppercased())
                    .font(Theme.eyebrow(8))
                    .foregroundStyle(Theme.ink3)
            }
            Spacer()
            Text(statusLabel.uppercased())
                .font(Theme.eyebrow(9))
                .foregroundStyle(status)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 9)
        .background(highlight ? Theme.accentTint : .clear)
    }

    private func statusColor(_ status: String) -> Color {
        switch status {
        case "working", "thinking": return Theme.green
        case "completed": return Theme.green
        case "failed": return Theme.red
        default: return Theme.ink3
        }
    }

    private func statusLabel(_ status: String) -> String {
        switch status {
        case "working": return "Working"
        case "completed": return "Completed"
        case "failed": return "Failed"
        default: return status.capitalized
        }
    }
}

// MARK: - Goal

private struct GoalTabView: View {
    let session: Session
    let objective: String?
    let entries: [PlanEntry]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text(session.name)
                    .font(.headline)
                    .foregroundStyle(Theme.ink)

                if let objective, !objective.isEmpty {
                    HStack(alignment: .top, spacing: 8) {
                        Image(systemName: "flag.fill")
                            .font(.caption)
                            .foregroundStyle(Theme.ink3)
                            .padding(.top, 2)
                        Text(objective)
                            .font(.footnote)
                            .foregroundStyle(Theme.ink2)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .padding(12)
                    .background(Theme.inset, in: RoundedRectangle(cornerRadius: 12))
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.line, lineWidth: 1))
                } else {
                    Text("No objective recorded yet — send the agent a message to set one.")
                        .font(.footnote)
                        .foregroundStyle(Theme.ink3)
                }

                if !entries.isEmpty {
                    PlanProgressRow(entries: entries)
                }
            }
            .padding(14)
        }
    }
}

// MARK: - Terminal

private struct TerminalTabView: View {
    let lines: [String]

    var body: some View {
        Group {
            if lines.isEmpty {
                EmptyState(
                    icon: "terminal",
                    title: "No terminal output",
                    detail: "PTY output from the agent's machine streams here."
                )
            } else {
                ScrollViewReader { proxy in
                    ScrollView {
                        Text(lines.joined(separator: "\n"))
                            .font(.caption2.monospaced())
                            .foregroundStyle(Theme.termFg)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .textSelection(.enabled)
                            .padding(12)
                            .id("tail")
                    }
                    .background(Theme.termBg)
                    .onAppear { proxy.scrollTo("tail", anchor: .bottom) }
                    .onChange(of: lines.count) { _, _ in
                        proxy.scrollTo("tail", anchor: .bottom)
                    }
                }
            }
        }
    }
}

// MARK: - Files

/// Wire shapes for the desktop workspace/git endpoints (snake_case, same
/// payloads the dashboard's `api.ts` decodes).
struct ChangedFileWire: Decodable, Identifiable {
    var path: String
    var status: String?

    var id: String { path }
}

struct WorkspaceOverviewWire: Decodable {
    var changedFiles: [ChangedFileWire]?

    enum CodingKeys: String, CodingKey {
        case changedFiles = "changed_files"
    }
}

struct FileContentsWire: Decodable {
    var path: String
    var contents: String?
    var error: String?
}

struct FileDiffWire: Decodable {
    var path: String
    var diff: String?
}

private struct FilesTabView: View {
    let session: Session
    @Environment(AppState.self) private var app

    @State private var changed: [ChangedFileWire] = []
    @State private var listing: DirListingWire?
    @State private var browsePath: String?
    @State private var loaded = false
    @State private var loadError: String?
    @State private var showChangedOnly = true

    private var project: String? {
        session.worktreePath ?? session.project
    }

    var body: some View {
        Group {
            if let error = loadError {
                EmptyState(icon: "exclamationmark.triangle", title: "Couldn't load files", detail: error)
            } else {
                List {
                    if !changed.isEmpty {
                        Section {
                            ForEach(changed) { file in
                                NavigationLink {
                                    FilePreviewView(session: session, project: project, path: file.path)
                                } label: {
                                    row(
                                        name: file.path,
                                        icon: "doc.badge.ellipsis",
                                        trailing: file.status?.uppercased(),
                                        tint: statusColor(file.status)
                                    )
                                }
                            }
                        } header: {
                            eyebrow("Changed · \(changed.count)")
                        }
                    }

                    if !showChangedOnly, let listing {
                        Section {
                            ForEach(listing.entries ?? []) { entry in
                                if entry.dir {
                                    Button {
                                        Task { await load(path: entry.path) }
                                    } label: {
                                        row(name: entry.name, icon: "folder", trailing: nil, tint: Theme.ink3)
                                    }
                                    .buttonStyle(.plain)
                                } else {
                                    NavigationLink {
                                        FilePreviewView(session: session, project: project, path: entry.path)
                                    } label: {
                                        row(name: entry.name, icon: "doc.text", trailing: nil, tint: Theme.ink3)
                                    }
                                }
                            }
                        } header: {
                            HStack {
                                eyebrow(shortPath(listing.path))
                                Spacer()
                                Text("\(listing.entries?.count ?? 0) entries")
                                    .font(Theme.eyebrow(9))
                                    .foregroundStyle(Theme.ink3)
                            }
                        }
                    }

                    if changed.isEmpty && (listing?.entries ?? []).isEmpty && loaded {
                        Text("No files here.")
                            .font(.footnote)
                            .foregroundStyle(Theme.ink3)
                            .listRowBackground(Theme.canvas)
                    }
                }
                .listStyle(.insetGrouped)
                .scrollContentBackground(.hidden)
                .background(Theme.canvas)
            }
        }
        .overlay {
            if !loaded && loadError == nil {
                ProgressView().controlSize(.small)
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            HStack(spacing: 10) {
                Button {
                    showChangedOnly.toggle()
                } label: {
                    Label(showChangedOnly ? "Browse tree" : "Changed only", systemImage: "folder")
                        .font(.caption2.weight(.medium))
                        .foregroundStyle(Theme.accent)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 5)
                        .background(Theme.accentTint, in: Capsule())
                }
                if !showChangedOnly, let parent = listing?.parent, parent != listing?.path {
                    Button {
                        Task { await load(path: parent) }
                    } label: {
                        Label("Up", systemImage: "arrow.up")
                            .font(.caption2.weight(.medium))
                            .foregroundStyle(Theme.ink2)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 5)
                            .background(Theme.field, in: Capsule())
                    }
                }
                Spacer()
                if let roots = listing?.roots, !roots.isEmpty, !showChangedOnly {
                    Menu {
                        ForEach(roots) { root in
                            Button(root.name) {
                                Task { await load(path: root.path) }
                            }
                        }
                        if let project {
                            Button("Project root") {
                                Task { await load(path: project) }
                            }
                        }
                    } label: {
                        Image(systemName: "bookmark")
                            .font(.caption)
                            .foregroundStyle(Theme.ink2)
                    }
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 6)
            .background(Theme.canvas)
            .overlay(alignment: .top) { Divider().overlay(Theme.line) }
        }
        .task(id: session.id) { await loadAll() }
    }

    private func eyebrow(_ text: String) -> some View {
        Text(text)
            .font(Theme.eyebrow(9))
            .textCase(.uppercase)
            .foregroundStyle(Theme.ink3)
    }

    private func row(name: String, icon: String, trailing: String?, tint: Color) -> some View {
        HStack(spacing: 8) {
            Image(systemName: icon)
                .font(.caption)
                .foregroundStyle(tint)
            Text(name)
                .font(.caption.monospaced())
                .foregroundStyle(Theme.ink)
                .lineLimit(1)
                .truncationMode(.middle)
            Spacer()
            if let trailing {
                Text(trailing)
                    .font(Theme.eyebrow(8))
                    .foregroundStyle(tint)
            }
        }
    }

    private func shortPath(_ path: String) -> String {
        let home = NSHomeDirectory()
        if path.hasPrefix(home) {
            return "~" + path.dropFirst(home.count)
        }
        return path
    }

    private func loadAll() async {
        await loadChanged()
        await load(path: browsePath ?? project)
        loaded = true
    }

    private func loadChanged() async {
        do {
            let overview: WorkspaceOverviewWire = try await app.get(
                "/api/workspace/overview",
                query: [URLQueryItem(name: "session", value: session.id)]
            )
            changed = overview.changedFiles ?? []
            loadError = nil
        } catch {
            loadError = (error as? APIError)?.message ?? "Couldn't reach the workspace overview."
        }
    }

    private func load(path: String?) async {
        guard let path, !path.isEmpty else { return }
        browsePath = path
        do {
            let listing: DirListingWire = try await app.get(
                "/api/workspace/dirs",
                query: [
                    URLQueryItem(name: "path", value: path),
                    URLQueryItem(name: "files", value: "1"),
                ]
            )
            self.listing = listing
            loadError = nil
        } catch {
            loadError = (error as? APIError)?.message ?? "Couldn't read that directory."
        }
    }

    private func statusColor(_ status: String?) -> Color {
        switch status?.lowercased() {
        case "added", "untracked": return Theme.green
        case "deleted": return Theme.red
        case .none: return Theme.ink3
        default: return Theme.orange
        }
    }
}

private struct FilePreviewView: View {
    let session: Session
    let project: String?
    let path: String

    @Environment(AppState.self) private var app
    @State private var contents: String?
    @State private var diff: String?
    @State private var showDiff = false
    @State private var loadError: String?

    var body: some View {
        Group {
            if let error = loadError {
                EmptyState(icon: "exclamationmark.triangle", title: "Couldn't open file", detail: error)
            } else if showDiff, let diff {
                DiffTextView(diff: diff)
            } else if let contents {
                ScrollView([.horizontal, .vertical]) {
                    Text(contents)
                        .font(.caption.monospaced())
                        .foregroundStyle(Theme.ink)
                        .textSelection(.enabled)
                        .padding(12)
                }
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(Theme.canvas)
        .navigationTitle(path.components(separatedBy: "/").last ?? path)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button(showDiff ? "Source" : "Diff") { showDiff.toggle() }
                    .font(Theme.eyebrow(10))
            }
        }
        .task { await load() }
    }

    private func load() async {
        guard let project else {
            loadError = "This session has no project path to read from."
            return
        }
        loadError = nil
        do {
            async let fileTask: FileContentsWire = app.get(
                "/api/workspace/file",
                query: [
                    URLQueryItem(name: "project", value: project),
                    URLQueryItem(name: "path", value: path),
                ]
            )
            async let diffTask: FileDiffWire = app.get(
                "/api/git/diff",
                query: [
                    URLQueryItem(name: "project", value: project),
                    URLQueryItem(name: "path", value: path),
                    URLQueryItem(name: "session", value: session.id),
                ]
            )
            let (file, diffResult) = try await (fileTask, diffTask)
            if let error = file.error {
                loadError = error
            }
            contents = file.contents
            diff = diffResult.diff
        } catch {
            loadError = (error as? APIError)?.message ?? "Couldn't load the file."
        }
    }
}

// MARK: - Git

struct GitBranchWire: Decodable, Identifiable {
    var name: String
    var current: Bool?

    var id: String { name }
}

struct GitStateWire: Decodable {
    var branches: [GitBranchWire]
    var current: String?
    var changedCount: Int?
    var added: Int?
    var removed: Int?

    enum CodingKeys: String, CodingKey {
        case branches
        case current
        case changedCount = "changed_count"
        case added
        case removed
    }
}

struct GitCommitWire: Decodable, Identifiable {
    var hash: String
    var short: String?
    var author: String?
    var date: String?
    var message: String

    var id: String { hash }
}

struct GitCommitBody: Encodable {
    var project: String
    var message: String
    var push: Bool
}

struct GitCommitResultWire: Decodable {
    var ok: Bool?
    var head: String?
    var output: String?
    var pushed: Bool?
    var pushError: String?
    var error: String?

    enum CodingKeys: String, CodingKey {
        case ok
        case head
        case output
        case pushed
        case pushError = "push_error"
        case error
    }
}

private struct GitTabView: View {
    let session: Session
    @Environment(AppState.self) private var app

    @State private var state: GitStateWire?
    @State private var commits: [GitCommitWire] = []
    @State private var loadError: String?
    @State private var pendingCheckout: String?
    @State private var actionMessage: String?
    @State private var commitMessage = ""
    @State private var pushAfterCommit = false
    @State private var committing = false

    private var project: String? {
        session.worktreePath ?? session.project
    }

    var body: some View {
        Group {
            if let error = loadError {
                EmptyState(icon: "exclamationmark.triangle", title: "Git unavailable", detail: error)
            } else if let state {
                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
                        summaryCard(state)
                        commitCard(state)
                        branchList(state)
                        commitsSection
                    }
                    .padding(14)
                }
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .confirmationDialog(
            "Checkout \(pendingCheckout ?? "branch")?",
            isPresented: Binding(get: { pendingCheckout != nil }, set: { if !$0 { pendingCheckout = nil } }),
            titleVisibility: .visible
        ) {
            Button("Checkout", role: .destructive) {
                if let branch = pendingCheckout {
                    Task { await checkout(branch) }
                }
                pendingCheckout = nil
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Switches the workspace to that branch. Uncommitted changes must not conflict.")
        }
        .task(id: session.id) { await load() }
        .refreshable { await load() }
    }

    private func summaryCard(_ state: GitStateWire) -> some View {
        HStack(spacing: 14) {
            VStack(alignment: .leading, spacing: 3) {
                Text("Branch")
                    .font(Theme.eyebrow(9))
                    .textCase(.uppercase)
                    .foregroundStyle(Theme.ink3)
                Text(state.current ?? "—")
                    .font(.footnote.weight(.semibold).monospaced())
                    .foregroundStyle(Theme.accent)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 3) {
                Text("Working tree")
                    .font(Theme.eyebrow(9))
                    .textCase(.uppercase)
                    .foregroundStyle(Theme.ink3)
                HStack(spacing: 6) {
                    Text("+\(state.added ?? 0)")
                        .foregroundStyle(Theme.green)
                    Text("−\(state.removed ?? 0)")
                        .foregroundStyle(Theme.red)
                    Text("\(state.changedCount ?? 0) files")
                        .foregroundStyle(Theme.ink2)
                }
                .font(Theme.eyebrow(10))
            }
        }
        .padding(12)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: Theme.cardRadius))
        .overlay(RoundedRectangle(cornerRadius: Theme.cardRadius).stroke(Theme.line, lineWidth: 1))
        .overlay(alignment: .bottom) {
            if let message = actionMessage {
                Text(message)
                    .font(.caption)
                    .foregroundStyle(Theme.ink2)
                    .padding(.bottom, 2)
            }
        }
    }

    /// Stage everything, commit, optionally push — the desktop's git panel
    /// workflow, minus the per-file staging UI.
    private func commitCard(_ state: GitStateWire) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Commit all changes")
                .font(Theme.eyebrow(10))
                .textCase(.uppercase)
                .foregroundStyle(Theme.ink3)

            TextField("Commit message", text: $commitMessage, axis: .vertical)
                .font(.footnote)
                .lineLimit(1...4)
                .padding(.horizontal, 10)
                .padding(.vertical, 8)
                .background(Theme.field, in: RoundedRectangle(cornerRadius: Theme.controlRadius))
                .overlay(
                    RoundedRectangle(cornerRadius: Theme.controlRadius).stroke(Theme.line, lineWidth: 1)
                )
                .autocorrectionDisabled()

            Toggle("Push after commit", isOn: $pushAfterCommit)
                .font(.footnote)
                .tint(Theme.accent)

            HStack(spacing: 8) {
                Button {
                    Task { await commit() }
                } label: {
                    Text(committing ? "Committing…" : "Commit")
                        .font(.footnote.weight(.medium))
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .disabled(
                    committing
                        || commitMessage.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                        || (state.changedCount ?? 0) == 0
                )
            }

            if (state.changedCount ?? 0) == 0 {
                Text("Working tree is clean.")
                    .font(.caption2)
                    .foregroundStyle(Theme.ink3)
            }
        }
        .padding(12)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: Theme.cardRadius))
        .overlay(RoundedRectangle(cornerRadius: Theme.cardRadius).stroke(Theme.line, lineWidth: 1))
    }

    private func branchList(_ state: GitStateWire) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Branches")
                .font(Theme.eyebrow(10))
                .textCase(.uppercase)
                .foregroundStyle(Theme.ink3)
                .padding(.bottom, 6)
            ForEach(state.branches) { branch in
                Button {
                    if branch.current != true {
                        pendingCheckout = branch.name
                    }
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: branch.current == true ? "checkmark.circle.fill" : "arrow.triangle.branch")
                            .font(.caption)
                            .foregroundStyle(branch.current == true ? Theme.green : Theme.ink3)
                        Text(branch.name)
                            .font(.footnote.monospaced())
                            .foregroundStyle(branch.current == true ? Theme.ink : Theme.ink2)
                            .lineLimit(1)
                        Spacer()
                    }
                    .padding(.vertical, 8)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                Divider().overlay(Theme.line.opacity(0.5))
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: Theme.cardRadius))
        .overlay(RoundedRectangle(cornerRadius: Theme.cardRadius).stroke(Theme.line, lineWidth: 1))
    }

    @ViewBuilder
    private var commitsSection: some View {
        if !commits.isEmpty {
            VStack(alignment: .leading, spacing: 0) {
                Text("Recent commits")
                    .font(Theme.eyebrow(10))
                    .textCase(.uppercase)
                    .foregroundStyle(Theme.ink3)
                    .padding(.bottom, 6)
                ForEach(commits) { commit in
                    HStack(alignment: .top, spacing: 8) {
                        Text(commit.short ?? String(commit.hash.prefix(7)))
                            .font(Theme.eyebrow(10))
                            .foregroundStyle(Theme.accent)
                            .padding(.top, 1)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(commit.message)
                                .font(.caption)
                                .foregroundStyle(Theme.ink)
                                .lineLimit(2)
                            if let author = commit.author {
                                Text(author)
                                    .font(Theme.eyebrow(9))
                                    .foregroundStyle(Theme.ink3)
                            }
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(.vertical, 7)
                    Divider().overlay(Theme.line.opacity(0.5))
                }
            }
            .padding(12)
            .background(Theme.card, in: RoundedRectangle(cornerRadius: Theme.cardRadius))
            .overlay(RoundedRectangle(cornerRadius: Theme.cardRadius).stroke(Theme.line, lineWidth: 1))
        }
    }

    private func load() async {
        guard let project else {
            loadError = "This session has no project directory."
            return
        }
        loadError = nil
        do {
            async let branchesTask: GitStateWire = app.get(
                "/api/git/branches",
                query: [URLQueryItem(name: "project", value: project)]
            )
            async let logTask: LogResponse = app.get(
                "/api/git/log",
                query: [
                    URLQueryItem(name: "project", value: project),
                    URLQueryItem(name: "limit", value: "12"),
                ]
            )
            let (gitState, log) = try await (branchesTask, logTask)
            state = gitState
            commits = log.commits
        } catch {
            loadError = (error as? APIError)?.message ?? "Couldn't read git state."
        }
    }

    private struct LogResponse: Decodable {
        var commits: [GitCommitWire]
    }

    private func checkout(_ branch: String) async {
        guard let project else { return }
        do {
            try await app.postEmpty(
                "/api/git/checkout",
                query: [
                    URLQueryItem(name: "project", value: project),
                    URLQueryItem(name: "branch", value: branch),
                ]
            )
            actionMessage = "Checked out \(branch)"
            await load()
        } catch {
            actionMessage = (error as? APIError)?.message ?? "Checkout failed."
        }
    }

    private func commit() async {
        guard let project else { return }
        let message = commitMessage.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !message.isEmpty else { return }
        committing = true
        defer { committing = false }
        do {
            let result: GitCommitResultWire = try await app.postJSONResult(
                "/api/git/commit",
                query: [URLQueryItem(name: "project", value: project)],
                body: GitCommitBody(project: project, message: message, push: pushAfterCommit)
            )
            if result.ok == false {
                actionMessage = result.error ?? "Commit failed."
            } else {
                var summary = "Committed \(result.head?.prefix(7) ?? "")"
                if pushAfterCommit {
                    summary += result.pushed == true ? " · pushed" : " · push failed"
                    if let pushError = result.pushError, !pushError.isEmpty {
                        actionMessage = pushError
                    }
                }
                actionMessage = summary.trimmingCharacters(in: .whitespaces)
                commitMessage = ""
            }
            await load()
        } catch {
            actionMessage = (error as? APIError)?.message ?? "Commit failed."
        }
    }
}

// MARK: - Diff rendering

struct DiffTextView: View {
    let diff: String

    var body: some View {
        ScrollView([.horizontal, .vertical]) {
            VStack(alignment: .leading, spacing: 1) {
                ForEach(Array(diff.split(separator: "\n", omittingEmptySubsequences: false).enumerated()), id: \.offset) { _, line in
                    Text(String(line))
                        .font(.caption2.monospaced())
                        .foregroundStyle(color(for: String(line)))
                        .fixedSize(horizontal: true, vertical: false)
                }
            }
            .padding(12)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
        .background(Theme.termBg)
    }

    private func color(for line: String) -> Color {
        if line.hasPrefix("+++") || line.hasPrefix("---") { return Theme.ink3 }
        if line.hasPrefix("+") { return Theme.green }
        if line.hasPrefix("-") { return Theme.red }
        if line.hasPrefix("@@") { return Theme.accent }
        return Theme.termFg
    }
}
