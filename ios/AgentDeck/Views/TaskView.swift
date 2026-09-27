import SwiftUI

/// The remote-control surface for one session: conversation, approvals,
/// questions, activity, terminal tail, and the composer.
struct TaskView: View {
    let sessionId: String
    /// Pushes another session (used by the inspector's Projects / Sessions
    /// tabs). Defaulted so previews and direct pushes stay simple.
    var onOpenSession: (String) -> Void = { _ in }

    @Environment(AppState.self) private var app
    @State private var draft = ""
    @State private var showInspector = false
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
            HStack(spacing: 10) {
                Button {
                    showInspector = true
                } label: {
                    Label("Panels", systemImage: "sidebar.right")
                        .font(.caption2.weight(.medium))
                        .foregroundStyle(Theme.accent)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 5)
                        .background(Theme.accentTint, in: Capsule())
                }
                .accessibilityLabel("Open inspector panels")
                Spacer()
                StatusBadge(status: model.state.session.status)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 6)
            .background(.ultraThinMaterial)
        }
        .sheet(isPresented: $showInspector) {
            InspectorSheet(sessionId: sessionId, onOpenSession: onOpenSession)
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
                .foregroundStyle(Theme.ink3)
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
                    .background(Theme.accent, in: BubbleShape(right: true))
                    .foregroundStyle(Theme.accentInk)
            }
        } else if message.role == "system" {
            Text(message.content)
                .font(.caption)
                .foregroundStyle(Theme.ink2)
                .frame(maxWidth: .infinity)
                .multilineTextAlignment(.center)
        } else {
            HStack {
                Text(message.content)
                    .font(.subheadline)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(Theme.card, in: BubbleShape(right: false))
                    .overlay(BubbleShape(right: false).stroke(Theme.line, lineWidth: 1))
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
                .overlay(BubbleShape(right: false).stroke(Theme.line, lineWidth: 1))
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
                .tint(Theme.accent)
            if !thinking.isEmpty {
                Text(thinking)
                    .font(.caption)
                    .foregroundStyle(Theme.ink3)
                    .lineLimit(1)
            } else {
                Text("Working…")
                    .font(.caption)
                    .foregroundStyle(Theme.ink3)
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
            .foregroundStyle(Theme.red)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 6)
            .background(Theme.red.opacity(0.1))
    }
}

private struct ErrorBanner: View {
    let text: String

    var body: some View {
        Label(text, systemImage: "exclamationmark.triangle")
            .font(.footnote)
            .foregroundStyle(Theme.red)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 6)
            .background(Theme.red.opacity(0.1))
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
                .background(Theme.field, in: RoundedRectangle(cornerRadius: 18))
                .overlay(RoundedRectangle(cornerRadius: 18).stroke(Theme.line, lineWidth: 1))
                .focused($focused)
                .onSubmit { send() }

            Button(action: send) {
                Image(systemName: "arrow.up.circle.fill")
                    .font(.system(size: 30))
                    .foregroundStyle(
                        text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                            ? Theme.ink3.opacity(0.4)
                            : Theme.accent
                    )
            }
            .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            .accessibilityLabel("Send")
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(Theme.canvas)
    }

    private func send() {
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        onSend()
        focused = true
    }
}
