import SwiftUI

/// The remote-control surface for one session: conversation, approvals,
/// questions, activity, terminal tail, and the composer.
struct TaskView: View {
    let sessionId: String
    @Environment(AppState.self) private var app
    @State private var draft = ""
    @State private var showTerminal = false
    @State private var showActivity = false
    @State private var confirmKill = false

    private struct Anchor: Equatable {
        var messages: Int
        var streaming: Int
        var approvals: Int
        var questions: Int
        var activities: Int
    }

    var body: some View {
        Group {
            if let model = app.sessions[sessionId] {
                conversation(model)
            } else {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .navigationTitle(app.sessions[sessionId]?.state.session.name ?? "Task")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button(role: .destructive) {
                        app.stop(sessionId: sessionId)
                        app.toast = "Stop requested"
                    } label: {
                        Label("Stop", systemImage: "stop.fill")
                    }
                    Button {
                        app.interrupt(sessionId: sessionId)
                        app.toast = "Interrupt sent"
                    } label: {
                        Label("Interrupt (^C)", systemImage: "hand.raised")
                    }
                    Divider()
                    Button {
                        Task { await app.archive(sessionId: sessionId) }
                    } label: {
                        Label("Archive", systemImage: "archivebox")
                    }
                    Button(role: .destructive) {
                        confirmKill = true
                    } label: {
                        Label("Kill task…", systemImage: "xmark.octagon")
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
                .accessibilityLabel("Task controls")
            }
        }
        .confirmationDialog(
            "Kill this task?",
            isPresented: $confirmKill,
            titleVisibility: .visible
        ) {
            Button("Kill task", role: .destructive) {
                Task { await app.kill(sessionId: sessionId) }
            }
        } message: {
            Text("The agent process is terminated immediately. Unfinished work may be lost.")
        }
        .task {
            await app.hydrate(sessionId)
        }
        .refreshable {
            if let model = app.sessions[sessionId] {
                model.state.hydrated = false
            }
            await app.hydrate(sessionId)
        }
    }

    private func anchor(_ model: SessionModel) -> Anchor {
        Anchor(
            messages: model.state.messages.count,
            streaming: model.state.streamingText.count,
            approvals: model.state.approvals.count,
            questions: model.state.questions.count,
            activities: model.state.activities.count
        )
    }

    @ViewBuilder
    private func conversation(_ model: SessionModel) -> some View {
        let current = anchor(model)
        VStack(spacing: 0) {
            if model.state.deleted {
                DeletedBanner()
            } else if let error = model.state.lastError {
                ErrorBanner(text: error)
            }

            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 10) {
                        ForEach(model.state.messages) { message in
                            MessageBubble(message: message)
                                .id(message.id)
                        }
                        if !model.state.streamingText.isEmpty {
                            StreamingBubble(text: model.state.streamingText)
                                .id("streaming")
                        }
                        if model.state.activities.contains(where: \.isRunning) {
                            WorkingIndicator(thinking: model.state.thinkingText)
                                .id("working")
                        }
                        if !model.state.approvals.isEmpty {
                            ForEach(model.state.approvals) { approval in
                                ApprovalCard(approval: approval) { decision in
                                    app.respondToApproval(
                                        sessionId: sessionId,
                                        requestId: approval.id,
                                        decision: decision
                                    )
                                }
                                .id("approval-\(approval.id)")
                            }
                        }
                        ForEach(model.state.questions) { question in
                            QuestionCard(question: question) { selected, custom in
                                app.answerQuestion(
                                    question,
                                    selectedOptions: selected,
                                    customText: custom
                                )
                            }
                            .id("question-\(question.questionId)")
                        }
                        if showActivity, !model.state.activities.isEmpty {
                            ActivitySection(activities: model.state.activities.reversed())
                        }
                        if showTerminal, !model.state.terminalLines.isEmpty {
                            TerminalSection(lines: model.state.terminalLines.suffix(60))
                        }
                        Color.clear
                            .frame(height: 1)
                            .id("end")
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                }
                .defaultScrollAnchor(.bottom)
                .onChange(of: current) { _, _ in
                    withAnimation {
                        proxy.scrollTo("end", anchor: .bottom)
                    }
                }
                .onAppear {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
                        proxy.scrollTo("end", anchor: .bottom)
                    }
                }
            }

            Divider()
            Composer(text: $draft) {
                send(model)
            }
        }
        .background(Theme.background)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            HStack(spacing: 14) {
                ToggleButton(
                    isOn: $showActivity,
                    icon: "clock.arrow.circlepath",
                    label: "Activity"
                )
                ToggleButton(
                    isOn: $showTerminal,
                    icon: "terminal",
                    label: "Terminal"
                )
                Spacer()
                StatusBadge(status: model.state.session.status)
            }
            .font(.caption2)
            .padding(.horizontal, 14)
            .padding(.vertical, 6)
            .background(.ultraThinMaterial)
        }
    }

    private func send(_ model: SessionModel) {
        let text = draft
        draft = ""
        app.sendInput(sessionId: sessionId, text: text)
    }
}

// MARK: - Bubbles

private struct MessageBubble: View {
    let message: AgentMessage

    var body: some View {
        if message.isLifecycleMarker {
            Text(message.content)
                .font(.caption2)
                .foregroundStyle(.tertiary)
                .frame(maxWidth: .infinity)
                .multilineTextAlignment(.center)
                .padding(.vertical, 2)
        } else if message.role == "user" {
            HStack {
                Spacer(minLength: 48)
                Text(message.content)
                    .font(.subheadline)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(Color.accentColor.opacity(0.9), in: BubbleShape(right: true))
                    .foregroundStyle(.white)
            }
        } else if message.role == "system" {
            Text(message.content)
                .font(.caption)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity)
                .multilineTextAlignment(.center)
        } else {
            HStack {
                Text(message.content)
                    .font(.subheadline)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(Theme.card, in: BubbleShape(right: false))
                Spacer(minLength: 48)
            }
        }
    }
}

private struct StreamingBubble: View {
    let text: String

    var body: some View {
        HStack {
            Text(text)
                .font(.subheadline)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(Theme.card, in: BubbleShape(right: false))
                .opacity(0.75)
            Spacer(minLength: 48)
        }
    }
}

private struct WorkingIndicator: View {
    let thinking: String

    var body: some View {
        HStack(spacing: 8) {
            ProgressView()
                .controlSize(.small)
            if !thinking.isEmpty {
                Text(thinking)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            } else {
                Text("Working…")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 4)
    }
}

private struct BubbleShape: Shape {
    var right: Bool

    func path(in rect: CGRect) -> Path {
        let path = UIBezierPath(
            roundedRect: rect,
            byRoundingCorners: right
                ? [.topLeft, .bottomLeft, .bottomRight]
                : [.topRight, .bottomLeft, .bottomRight],
            cornerRadii: CGSize(width: 16, height: 16)
        )
        return Path(path.cgPath)
    }
}

// MARK: - Banners

private struct DeletedBanner: View {
    var body: some View {
        Label("This task was deleted", systemImage: "trash")
            .font(.footnote)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 6)
            .background(Color.red.opacity(0.1))
    }
}

private struct ErrorBanner: View {
    let text: String

    var body: some View {
        Label(text, systemImage: "exclamationmark.triangle")
            .font(.footnote)
            .foregroundStyle(.red)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 6)
            .background(Color.red.opacity(0.1))
    }
}

// MARK: - Activity & terminal

private struct ActivitySection: View {
    let activities: [ActivityItem]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Activity", systemImage: "clock.arrow.circlepath")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            ForEach(activities) { item in
                ActivityRow(item: item)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: 12))
    }
}

private struct ActivityRow: View {
    let item: ActivityItem

    private var icon: (String, Color) {
        switch item.kind {
        case "command": return ("terminal", .secondary)
        case "browser": return ("safari", .blue)
        case "plan": return ("list.clipboard", .purple)
        case "error": return ("xmark.octagon", .red)
        case "turn": return ("checkmark.circle", .green)
        default: return ("wrench.and.screwdriver", .secondary)
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
                    .foregroundStyle(item.isFailed ? .red : icon.1)
                    .frame(width: 16)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(item.title)
                    .font(.caption.weight(.medium))
                    .lineLimit(1)
                if let detail = item.detail, !detail.isEmpty {
                    Text(detail)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
            }
            Spacer(minLength: 0)
            if let timestamp = item.timestamp {
                Text(Format.relativeTime(timestamp))
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
        }
    }
}

private struct TerminalSection: View {
    let lines: [String]

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Label("Terminal", systemImage: "terminal")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
                .padding(.bottom, 6)
            Text(lines.joined(separator: "\n"))
                .font(.caption2.monospaced())
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .textSelection(.enabled)
        }
        .padding(12)
        .background(Color.black.opacity(0.75), in: RoundedRectangle(cornerRadius: 12))
    }
}

private struct ToggleButton: View {
    @Binding var isOn: Bool
    let icon: String
    let label: String

    var body: some View {
        Button {
            isOn.toggle()
        } label: {
            Label(label, systemImage: icon)
                .foregroundStyle(isOn ? Color.accentColor : Color.secondary)
        }
        .buttonStyle(.bordered)
        .controlSize(.mini)
    }
}

// MARK: - Composer

struct Composer: View {
    @Binding var text: String
    let onSend: () -> Void
    @FocusState private var focused: Bool

    var body: some View {
        HStack(alignment: .bottom, spacing: 10) {
            TextField("Message your agent…", text: $text, axis: .vertical)
                .lineLimit(1...5)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(Theme.card, in: RoundedRectangle(cornerRadius: 18))
                .focused($focused)
                .onSubmit { send() }

            Button(action: send) {
                Image(systemName: "arrow.up.circle.fill")
                    .font(.system(size: 30))
                    .foregroundStyle(
                        text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                            ? Color.secondary.opacity(0.4)
                            : Color.accentColor
                    )
            }
            .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            .accessibilityLabel("Send")
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(.bar)
    }

    private func send() {
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        onSend()
        focused = true
    }
}
