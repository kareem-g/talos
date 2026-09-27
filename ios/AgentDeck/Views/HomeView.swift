import SwiftUI

/// Home: workspaces and tasks from `/api/mobile/snapshot`, live-patched by
/// socket frames.
struct HomeView: View {
    @Environment(AppState.self) private var app
    @State private var path = NavigationPath()
    @State private var showNewTask = false
    @State private var showSettings = false

    var body: some View {
        NavigationStack(path: $path) {
            content
                .navigationTitle("AgentDeck")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .primaryAction) {
                        Button {
                            showNewTask = true
                        } label: {
                            Image(systemName: "plus")
                        }
                        .accessibilityLabel("New task")
                    }
                    ToolbarItem(placement: .topBarTrailing) {
                        Button {
                            showSettings = true
                        } label: {
                            Image(systemName: "gearshape")
                        }
                        .accessibilityLabel("Settings")
                    }
                }
                .navigationDestination(for: String.self) { sessionId in
                    TaskView(sessionId: sessionId)
                }
        }
        .sheet(isPresented: $showNewTask) {
            NewTaskSheet { sessionId in
                showNewTask = false
                path.append(sessionId)
            }
        }
        .sheet(isPresented: $showSettings) {
            SettingsView()
        }
        .task {
            await app.refreshSnapshot()
        }
        .refreshable {
            await app.refreshSnapshot()
        }
    }

    @ViewBuilder
    private var content: some View {
        if app.loadingSnapshot && app.snapshot == nil {
            ProgressView("Connecting to your desktop…")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let error = app.snapshotError, app.snapshot == nil {
            VStack(spacing: 12) {
                Image(systemName: "wifi.exclamationmark")
                    .font(.system(size: 40))
                    .foregroundStyle(.secondary)
                    .accessibilityHidden(true)
                Text(error)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                Button("Retry") {
                    Task { await app.refreshSnapshot() }
                }
                .buttonStyle(.borderedProminent)
            }
            .padding(32)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let snapshot, !snapshot.workspaces.isEmpty {
            List {
                if app.connection != .connected {
                    Section {
                        ConnectionBanner(state: app.connection)
                            .listRowBackground(Color.clear)
                            .listRowInsets(EdgeInsets())
                    }
                }
                ForEach(snapshot.workspaces) { workspace in
                    Section(workspace.name) {
                        ForEach(workspace.tasks) { task in
                            NavigationLink(value: task.id) {
                                TaskRow(task: task)
                            }
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background(Theme.background)
        } else {
            VStack(spacing: 14) {
                Image(systemName: "square.grid.2x2")
                    .font(.system(size: 40))
                    .foregroundStyle(.secondary)
                    .accessibilityHidden(true)
                Text("No tasks yet")
                    .font(.headline)
                Text("Start an agent on your desktop, or create one from here.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                Button("New task") {
                    showNewTask = true
                }
                .buttonStyle(.borderedProminent)
            }
            .padding(32)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}

private struct ConnectionBanner: View {
    let state: ConnectionState

    private var tint: Color {
        switch state {
        case .connected: return .green
        case .offline: return .red
        case .unauthorized: return .red
        default: return .orange
        }
    }

    var body: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(tint)
                .frame(width: 8, height: 8)
            Text(state.label)
                .font(.footnote.weight(.medium))
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
        .background(tint.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
    }
}

private struct TaskRow: View {
    let task: MobileTask

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(task.name)
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(1)
                Spacer()
                StatusBadge(status: task.status)
            }
            HStack(spacing: 6) {
                if let project = Format.projectLabel(task.project) {
                    Label(project, systemImage: "folder")
                } else {
                    Label(task.agent, systemImage: "cpu")
                }
                if let cost = Format.cost(task.cost) {
                    Text("· \(cost)")
                }
                Spacer()
                Text(Format.relativeTime(task.updatedAt))
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        .padding(.vertical, 2)
    }
}

struct StatusBadge: View {
    let status: String

    var body: some View {
        Text(Theme.statusLabel(status))
            .font(.caption2.weight(.semibold))
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(Theme.statusColor(status).opacity(0.15), in: Capsule())
            .foregroundStyle(Theme.statusColor(status))
    }
}

// MARK: - New task

struct NewTaskSheet: View {
    var onCreated: (String) -> Void
    @Environment(AppState.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var agentId: String = ""
    @State private var name = ""
    @State private var prompt = ""
    @State private var project = ""
    @State private var creating = false
    @State private var error: String?

    private var availableAgents: [AgentInfo] {
        (app.snapshot?.agents ?? []).filter { $0.available != false }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Agent", selection: $agentId) {
                        ForEach(availableAgents) { agent in
                            Text(agent.name).tag(agent.id)
                        }
                    }
                    .disabled(availableAgents.isEmpty)
                    if availableAgents.isEmpty {
                        Text("No agents detected on the desktop.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                } header: {
                    Text("Agent")
                }

                Section {
                    TextField("Task name", text: $name)
                        .autocorrectionDisabled()
                    TextField("First prompt (optional)", text: $prompt, axis: .vertical)
                        .lineLimit(2...6)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                } header: {
                    Text("Task")
                }

                Section {
                    TextField("/home/you/project", text: $project)
                        .font(.caption.monospaced())
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                } header: {
                    Text("Project directory")
                    Text("Leave empty to use the desktop's default workspace.")
                }

                if let error {
                    Section {
                        Text(error)
                            .font(.footnote)
                            .foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("New task")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .disabled(creating)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(creating ? "Starting…" : "Start") {
                        create()
                    }
                    .disabled(creating || availableAgents.isEmpty)
                }
            }
            .interactiveDismissDisabled(creating)
            .onAppear {
                if agentId.isEmpty {
                    agentId = availableAgents.first?.id ?? ""
                }
            }
        }
    }

    private func create() {
        creating = true
        error = nil
        let agent = agentId
        let name = name.nilIfBlank ?? prompt.nilIfBlank?.components(separatedBy: .newlines).first
        Task {
            do {
                let sessionId = try await app.createSession(
                    agent: agent,
                    name: name ?? "New task",
                    prompt: prompt,
                    project: project
                )
                onCreated(sessionId)
            } catch {
                creating = false
                self.error = (error as? APIError)?.message ?? "Could not start the task."
            }
        }
    }
}
