# 🌳 Universal Agent Orchestration & Evaluation Harness
**Master Architectural Blueprint & Implementation Plan**

---

## 🎯 1. Executive Summary

We are building a **Universal Agent Orchestrator** (a "harness") that sits between our Web/Mobile Dashboard and any AI provider or local agent runtime (Anthropic API, OpenAI, Claude Code CLI, ACP, etc.).

Instead of building a new AI model or replacing the providers, this harness acts as a universal adapter and controller. It forces all disparate backends to behave in the exact same predictable way, enabling advanced features like deterministic replay, automated context assembly, and "muscle memory" (trajectory injection) that are completely invisible to the end-user interacting via our Web or Mobile UI.

**Key Differentiators:**
- Backend-agnostic orchestration via a unified trait interface
- Deterministic trajectory recording and replay for evaluation/debugging
- Automatic context assembly with dynamic skill loading from the dashboard
- "Muscle memory" via trajectory injection (few-shot learning from past successful runs)
- Cross-platform Web/Mobile dashboard with real-time agent interaction

---

## 🏗️ 2. The 3-Stage Master Plan

### Stage 1: Trajectory Telemetry (Record, Replay, Export)
**Goal:** Create a deterministic, backend-agnostic source of truth for agent behavior.

**What it does:**
- **Record:** A single subscriber on the `BroadcastHub` captures all `WsMessage` events for a session and writes them to a JSONL file in `~/.local/share/agentdeck/trajectories/`
- **Replay:** Reads the JSONL and re-broadcasts events with fresh sequence numbers, optionally retargeting to a different session ID
- **Export:** Streams `AgentEvents` from the database as NDJSON for dataset generation or fine-tuning

**Why it matters:**
- Provides forensic debugging capability (see exactly what the agent did)
- Enables A/B testing different models on identical inputs
- Creates training data for fine-tuning smaller models
- Backend-agnostic: works for API, ACP, Claude CLI, and Pi without modification

**Status:** ✅ **Completed**

---

### Stage 2: Unified Agent Loop (The `AgentTurn` Harness)
**Goal:** Unify the per-message and command dispatch logic across all backends using the "Strangler Fig" pattern.

**The Problem:**
The `websocket/handler.rs` file contains massive, duplicated `if/else` chains for routing messages to different backends (`pi`, `api`, `acp`, `claude`). Each branch has slightly different logic for prompt injection, interrupt handling, and state management.

**The Solution:**
Create an `AgentTurn` trait that defines the common lifecycle methods: `start_turn`, `interrupt`, `stop`, `respond_approval`, and `is_live`. Implement thin wrappers for each backend (`ApiTurn`, `PiTurn`, `AcpTurn`, `ClaudeTurn`) that delegate to the existing backend-specific functions.

**Key Insights:**
1. **We are NOT rewriting backend internals.** The complex logic in `claude_stream.rs`, `acp.rs`, etc. remains untouched. We're just unifying the entry point.
2. **Two lifecycle shapes:** On-demand backends (API, Pi) spawn a fresh process per turn. Resident-process backends (ACP, Claude) maintain persistent sessions.
3. **The harness handles cross-cutting concerns:** Broadcasting user messages, marking session state, and routing approvals.

**Critical Refinements Applied:**
- **TOCTOU Safety:** Liveness checks happen inside `start_turn`, not as a pre-check in the handler
- **DRY Principle:** Browser skill injection logic is extracted to a shared helper
- **Stage 3 Preparation:** `TurnContext` includes an `injected_context` field for future trajectory/skill injection

**Status:** 🔄 **In Progress (Refinements applied, pending handler refactor)**

---

### Stage 3: Context Assembly & Trajectory Injection
**Goal:** Build the automatic "muscle memory" pipeline that enriches prompts before they hit the backend.

**What it does:**
1. **Dynamic Environment Context:** Automatically fetches Git status, OS info, working directory, and injects them into the system prompt
2. **Dynamic Skill Loading:** Scans the project's `.agentdeck/skills/` directory (populated via the Web Dashboard) and injects available skills into the context
3. **Trajectory Injection:** Queries past successful sessions, finds similar trajectories based on the current prompt, and injects them as few-shot examples
4. **Base System Prompt:** Applies the standard agent rules (Markdown formatting, tool usage guidelines, safety constraints)

**Why it matters:**
- The agent automatically "learns" from past successful runs without manual intervention
- Users can install skills via the dashboard, and they're immediately available to the agent
- The system prompt is dynamically assembled, not hardcoded
- End users see an agent that "just gets it" without writing massive prompts

**Status:** 📝 **Planned (Depends on Stage 2 completion)**

---

## 🖥️ 3. Frontend & Web/Mobile Dashboard Integration

The backend harness is the "engine," but the Web/Mobile Dashboard is the "steering wheel." The end user never sees the CLI, JSONL files, or backend routing. They interact with a polished, real-time interface.

### A. The Skills Marketplace & Management Page

**Purpose:** Allow users to discover, install, and manage agent capabilities (skills) through a visual interface.

**Features:**
1. **Browse & Discover**
   - Fetch available skills from a remote registry or curated list via `GET /api/skills/available`
   - Display skill metadata: name, description, author, version, dependencies
   - Search and filter by category (e.g., "code-review", "browser-use", "testing")

2. **One-Click Install**
   - User clicks "Install" on a skill
   - Frontend calls `POST /api/skills/install` with the skill ID
   - Backend downloads the `SKILL.md` file and saves it to the project's `.agentdeck/skills/` directory
   - UI shows success state and the skill immediately appears in the "Installed" list

3. **Active Management**
   - View all installed skills with toggle switches to enable/disable them
   - Edit skill definitions via a web-based Markdown editor (with live preview)
   - Delete skills or revert to default versions
   - View skill dependencies and compatibility warnings

4. **The Magic Connection**
   - The moment a skill is installed or enabled via the UI, the backend's **Context Assembler (Stage 3)** automatically detects it
   - On the very next user prompt, the assembler reads the new skill and injects it into the LLM's system prompt
   - **No restart required.** The agent immediately has access to the new capability.

**UI Components:**
- Skills grid/list view with cards showing skill metadata
- Install button with loading states
- Toggle switches for enable/disable
- Markdown editor modal for editing skill definitions
- Search bar with category filters
- "Recently Updated" and "Trending" sections

---

### B. Real-Time Agent Interaction UI

**Purpose:** Provide a ChatGPT/Claude-like interface for interacting with the agent, with full visibility into tool execution and state.

**Features:**
1. **Streaming Markdown Rendering**
   - The dashboard consumes the `BroadcastHub` WebSocket stream
   - Renders the agent's text output as Github-flavored Markdown in real-time
   - Supports code blocks with syntax highlighting, tables, lists, and inline code
   - Handles partial messages (streaming tokens as they arrive)

2. **Interactive Tool Approvals**
   - When the agent requests a tool execution (e.g., `execute_bash`, `write_file`), the UI intercepts the `approval_request` event
   - Renders a modal or inline card showing:
     - Tool name and description
     - Input parameters (e.g., the bash command to run)
     - Risk level (if applicable)
   - User clicks "Allow" or "Deny"
   - UI sends an `approval_response` command back to the harness
   - Agent continues execution based on the decision

3. **Floating HUD (Heads-Up Display)**
   - Persistent UI overlay showing:
     - Current agent state (`running`, `idle`, `needs_resume`, `error`)
     - Token usage (input/output tokens, estimated cost)
     - Session duration
     - "Interrupt" button (triggers the unified `AgentTurn::interrupt()` method)
     - "Stop" button (kills the session entirely)
   - Collapsible to save screen space
   - Color-coded state indicators (green = idle, blue = running, yellow = needs_resume, red = error)

4. **Session Management**
   - List of all sessions with status indicators
   - Ability to resume interrupted sessions
   - Export session history as JSONL or Markdown
   - Delete sessions

5. **File & Code References**
   - When the agent references files (e.g., `src/main.rs:42`), the UI renders them as clickable links
   - Clicking opens the file in an integrated code viewer or external editor
   - Inline code comments (using the `::code-comment{...}` directive) are rendered as annotations on the code

6. **Attachment Support**
   - Users can paste images or upload files
   - Images are previewed in the chat input before sending
   - Files are attached to the prompt and sent to the agent

7. **Message Queue & Steering**
   - Users can queue multiple messages while the agent is running
   - "Steer" functionality allows users to redirect the agent mid-execution
   - Edit and resend previous messages

---

### C. Trajectory Management UI (Advanced)

**Purpose:** Allow power users to view, replay, and inject trajectories for debugging and optimization.

**Features:**
1. **Trajectory Viewer**
   - Visual timeline of agent actions (tool calls, text outputs, state changes)
   - Expandable cards for each step showing inputs and outputs
   - Filter by event type (e.g., only show tool calls)

2. **Replay Mode**
   - Step through a trajectory one action at a time
   - Compare two trajectories side-by-side (e.g., "Why did this run fail but that one succeed?")
   - Export trajectories as JSONL or shareable links

3. **Injection Controls**
   - Manually select a trajectory to inject as few-shot context
   - Set injection preferences (e.g., "Always inject similar trajectories" or "Never inject")
   - View which trajectories were injected for a given session

---

### D. Settings & Configuration

**Purpose:** Global and per-project configuration for the agent harness.

**Features:**
1. **Backend Configuration**
   - Select default agent backend (API, ACP, Claude CLI, etc.)
   - Configure API keys and authentication
   - Set model preferences (e.g., "Use Claude 3.5 Sonnet for API backend")

2. **Context Assembly Settings**
   - Toggle automatic trajectory injection on/off
   - Configure similarity threshold for trajectory matching
   - Enable/disable environment context (Git status, OS info)
   - Set base system prompt template

3. **Permission Modes**
   - Configure tool execution permissions (e.g., "Always ask for bash commands", "Auto-allow file reads")
   - Set destructive action policies (e.g., "Block `rm -rf` without confirmation")

4. **Dashboard Preferences**
   - Theme (light/dark)
   - Notification preferences
   - Keyboard shortcuts

---

## 🧠 4. Core Architectural Insights

### 1. The "Strangler Fig" Refactor Pattern

Instead of a "big bang" rewrite, we are wrapping existing, battle-tested backend logic in a unified trait.

**Below the line:** The messy, provider-specific adapters (`claude_stream.rs`, `acp.rs`, `api.rs`). Their *only* job is to talk to the provider and emit standard events.

**Above the line:** Clean, unified application logic. It doesn't care if it's talking to Anthropic or a local model. It just calls `start_turn(ctx)` and handles the result.

**Why this works:**
- Minimal risk: we're not rewriting complex, working code
- Incremental migration: we can refactor one backend at a time
- Preserves optimizations: each backend's unique optimizations remain intact

---

### 2. The Split Reality of Context Assembly

**Stateless Backends (Raw APIs like `api.rs`):**
- The harness owns context assembly
- Must query the database for full conversation history every turn
- Must fetch system prompt, tool definitions, and format them for the specific provider's schema
- Sends the full payload over HTTP every turn

**Stateful Backends (ACP, Claude CLI):**
- The backend owns context assembly
- Maintains its own internal memory and conversation state
- The harness only sends the *delta* (the new user message)
- Trusts the server to remember the rest

**The Solution:**
`TurnContext` carries both the full logical state (for stateless backends) and the specific delta (for stateful backends). Each implementation uses only what it needs.

---

### 3. ACP vs. Direct API

**Using the Agent Client Protocol (ACP) to talk to installed CLIs is the industry standard** (the "LSP for AI agents").

**Direct API:**
- You must build the tool registry
- Parse tool calls and execute them
- Manage authentication and rate limits
- Handle context window management

**ACP:**
- The CLI handles context, tools, and auth natively
- Your harness just orchestrates, records, and steers
- You get all the CLI's built-in capabilities for free
- Updates to the CLI automatically benefit your harness

**When to use which:**
- Use ACP for agents that support it (Claude Code, Copilot CLI, Codex)
- Use direct API for custom integrations or when you need full control over tool execution

---

### 4. The Context Assembly Pipeline

The pipeline runs *before* `start_turn` is called. It takes the raw user prompt and dynamically builds the enriched context.

**Pipeline Stages:**
1. **Base System Rules:** Load the standard agent prompt (Markdown formatting, tool guidelines, safety rules)
2. **Environment Context:** Fetch Git status, OS info, working directory, recent file changes
3. **Dynamic Skills:** Scan `.agentdeck/skills/` directory and format available skills for the LLM
4. **Trajectory Injection:** Query past successful sessions, find similar trajectories, format as few-shot examples
5. **Final Assembly:** Combine all layers into the final `TurnContext`

**Key Insight:** The backend doesn't know the context was enriched. It just receives a `TurnContext` with a `prompt` and `injected_context`. The magic happens in the assembler.

---

## 📝 5. Data Flow & API Contracts

### Backend API Endpoints

**Skills Management:**
- `GET /api/skills/available` → Returns list of skills from remote registry
- `GET /api/skills/installed` → Returns list of locally installed skills
- `POST /api/skills/install` → Downloads and saves a SKILL.md to disk
- `DELETE /api/skills/{id}` → Removes a skill from disk
- `PUT /api/skills/{id}/toggle` → Enables/disables a skill for the current session
- `PUT /api/skills/{id}` → Updates a skill's SKILL.md content

**Session Management:**
- `GET /api/sessions` → List all sessions
- `POST /api/sessions` → Create a new session
- `DELETE /api/sessions/{id}` → Delete a session
- `POST /api/sessions/{id}/interrupt` → Interrupt the current turn
- `POST /api/sessions/{id}/stop` → Stop and kill the session

**Trajectory Management:**
- `POST /api/trajectories/record` → Start recording a session
- `POST /api/trajectories/stop` → Stop recording and flush
- `POST /api/trajectories/replay` → Replay a trajectory file
- `GET /api/sessions/{id}/trajectory` → Export session events as JSONL
- `POST /api/trajectories/inject` → Inject a trajectory into a session

**WebSocket Events:**
- Client sends: `message`, `command` (interrupt, stop, approval_response)
- Server sends: `message` (agent text), `agent_event` (tool calls, state changes), `state_change` (session status), `approval_request` (tool approval needed)

---

## 🥊 6. Comparison to Open-Source Ecosystem

| Feature | Our Harness Plan | LangGraph / LangChain | OpenHands (OpenDevin) | Aider / Cline |
| :--- | :--- | :--- | :--- | :--- |
| **Backend Agnosticism** | **Excellent.** `AgentTurn` wraps existing backends without rewriting internals. | **Poor.** Forces proprietary `StateGraph` rewrites. | **Medium.** Tightly coupled to its Docker sandbox. | **Poor.** Monolithic and hard to extend. |
| **Frontend / UI** | **Excellent.** Custom Web/Mobile dashboard with real-time streaming, skill management, and tool approvals. | **Poor.** Mostly backend-only; requires building your own UI from scratch. | **Medium.** Web UI exists, but tightly coupled to their specific agent loop. | **Poor.** Cline is bound to VS Code; Aider is CLI only. |
| **Trajectory & Replay** | **Excellent.** Raw, provider-agnostic JSONL. Perfect for evals/fine-tuning. | **Medium.** LangSmith is SaaS; local JSONL export is hard. | **Good.** Complex, nested internal state JSON. | **Poor.** Chat history only, not tool-aware. |
| **Context Assembly** | **Excellent.** Dynamic pipeline (Git + Dashboard Skills + Auto-injected Trajectories). | **Medium.** Verbose and manual memory/RAG setup. | **Medium.** Agent wastes tokens reading its own environment. | **Good.** Hardcoded git diffs, not pluggable. |
| **Protocol Support** | **Excellent.** Raw HTTP APIs + ACP (Agent Client Protocol). | **Poor.** Almost exclusively raw HTTP APIs. | **Poor.** Custom internal RPC. | **Medium.** Adopting ACP as a client only. |
| **Skill Ecosystem** | **Excellent.** Dashboard-driven skill marketplace with one-click install. | **Poor.** No skill marketplace; tools are hardcoded. | **Medium.** Limited skill/plugin system. | **Poor.** No skill marketplace. |

---

## 🌿 7. Naming Suggestions (Inspired by the Strangler Fig)

The Strangler Fig grows *around* a host tree, weaving its roots together, eventually becoming the primary structure. Since we have a cross-platform (Web/Mobile) dashboard, the name needs to sound elegant, structural, and encompassing.

**Top Recommendations:**

1. **Canopy**
   - The overarching layer of a forest that covers and connects everything
   - Perfect for a harness that sits *above* messy backends and provides a unified interface to Web/Mobile
   - Vibe: Modern, clean, expansive

2. **Trellis**
   - An architectural framework specifically designed to support and guide climbing plants
   - The literal definition of a "harness" in botany
   - Vibe: Structural, supportive, elegant

3. **Banyan**
   - A fig tree that drops roots from its branches to create new trunks, becoming a massive, interconnected forest
   - Represents the multi-backend, multi-platform architecture
   - Vibe: Robust, deeply rooted, enterprise-grade

4. **Ficus**
   - The botanical genus of the Fig tree (including the Strangler Fig)
   - A subtle, insider nod to the architectural pattern without using the aggressive word "Strangler"
   - Vibe: Scientific, precise, minimalist

5. **Lattice**
   - Represents the woven, interconnected roots of the Strangler Fig
   - Also represents the grid/dashboard nature of the web/mobile UI
   - Vibe: Technical, interconnected, structured

**Recommendation:** Go with **Canopy** if you want it to sound like a modern SaaS/Platform, or **Trellis** if you want to emphasize the "harness/framework" aspect.

---

## 🚦 8. Implementation Roadmap & Action Items

### Phase 1: Backend Foundation (Current)
- [x] Stage 1: Trajectory telemetry (Record, Replay, Export)
- [ ] Stage 2: Unified agent loop
  - [ ] Fix DRY violation: Extract `browser_skill_prompt_injection_for` to a shared helper in `harness.rs`
  - [ ] Enforce TOCTOU safety: Ensure `start_turn` handles its own liveness validation internally
  - [ ] Refactor `websocket/handler.rs` to use `resolve_turn` and remove the `if/else` chains
  - [ ] Add unit tests for `classify` and `resolve_turn`
  - [ ] Verify all existing tests still pass

### Phase 2: Context Assembly (Stage 3)
- [ ] Create `backend/src/context_assembler.rs`
- [ ] Implement `fetch_environment_context` (Git status, OS info, CWD)
- [ ] Implement `load_available_skills` (scan `.agentdeck/skills/` directory)
- [ ] Implement `find_and_format_similar_trajectory` (query DB for similar sessions)
- [ ] Wire the assembler into the websocket handler (before calling `start_turn`)
- [ ] Add configuration options for enabling/disabling each assembly stage

### Phase 3: Skills API & Dashboard Integration
- [ ] Implement Skills API endpoints:
  - `GET /api/skills/available`
  - `GET /api/skills/installed`
  - `POST /api/skills/install`
  - `DELETE /api/skills/{id}`
  - `PUT /api/skills/{id}/toggle`
- [ ] Create skill registry service (fetch from remote, cache locally)
- [ ] Add skill installation logic (download SKILL.md, save to disk)
- [ ] Add tests for all Skills API endpoints

### Phase 4: Frontend Development
- [ ] **Skills Marketplace Page**
  - Design UI mockups for skills grid, install flow, and management
  - Implement skills list view with search and filters
  - Build install button with loading states
  - Create toggle switches for enable/disable
  - Build Markdown editor modal for editing skill definitions
  - Add "Recently Updated" and "Trending" sections

- [ ] **Real-Time Agent UI**
  - Implement WebSocket client for streaming messages
  - Build Markdown renderer with syntax highlighting
  - Create tool approval modal/card component
  - Build Floating HUD with state indicators and interrupt/stop buttons
  - Implement file/code reference rendering (clickable links)
  - Add attachment support (image paste, file upload)
  - Build message queue and steer functionality

- [ ] **Session Management**
  - Create session list view with status indicators
  - Build session creation flow
  - Implement resume interrupted session functionality
  - Add export session history feature

- [ ] **Trajectory Management (Advanced)**
  - Build trajectory viewer with visual timeline
  - Create replay mode with step-through controls
  - Implement side-by-side trajectory comparison
  - Add injection controls for manual trajectory selection

- [ ] **Settings & Configuration**
  - Build backend configuration UI (agent selection, API keys, model preferences)
  - Create context assembly settings (toggle injection, configure similarity threshold)
  - Implement permission modes UI
  - Add dashboard preferences (theme, notifications, shortcuts)

### Phase 5: Mobile App
- [ ] Port key features to mobile (React Native or native)
- [ ] Optimize for touch interactions and smaller screens
- [ ] Implement push notifications for agent state changes
- [ ] Add offline support for viewing past sessions

### Phase 6: Polish & Optimization
- [ ] Performance optimization (reduce latency, optimize database queries)
- [ ] Error handling and user-friendly error messages
- [ ] Accessibility improvements (keyboard navigation, screen reader support)
- [ ] Documentation (user guides, API docs, skill authoring guide)
- [ ] Analytics and monitoring (track usage patterns, identify bottlenecks)

---

## 📚 9. Key Design Decisions & Rationale

### Why JSONL for Trajectories?
- **Human-readable:** Can be inspected with `cat` or `jq`
- **Streamable:** Can be written incrementally without loading entire file into memory
- **Append-friendly:** New events can be added without rewriting the file
- **Standard format:** Compatible with fine-tuning APIs (OpenAI, Anthropic) and data processing tools

### Why a Unified Trait Instead of Rewriting Backends?
- **Risk mitigation:** Existing backends are complex and battle-tested; rewriting them introduces bugs
- **Incremental migration:** Can refactor one backend at a time
- **Preserves optimizations:** Each backend's unique optimizations remain intact
- **Easier testing:** Can test the harness independently of backend internals

### Why ACP for Installed CLIs?
- **Industry standard:** Adopted by Zed, JetBrains, GitHub Copilot CLI
- **Leverages existing capabilities:** CLIs already handle context, tools, and auth
- **Future-proof:** Updates to CLIs automatically benefit the harness
- **Reduces maintenance:** No need to reimplement tool execution or context management

### Why Dynamic Skill Loading from Dashboard?
- **User-friendly:** No need to manually edit config files or restart the agent
- **Discoverable:** Users can browse and install skills from a marketplace
- **Flexible:** Skills can be enabled/disabled per session or globally
- **Extensible:** Users can create custom skills and share them

### Why Automatic Trajectory Injection?
- **Silent learning:** Agent improves without user intervention
- **Contextual relevance:** Injects only trajectories similar to the current task
- **Token efficiency:** Uses few-shot examples instead of massive system prompts
- **Competitive advantage:** Most agents don't have this capability

---

## 🎓 10. Lessons Learned & Best Practices

### Architecture
1. **Start with the data model:** JSONL trajectories are the source of truth; everything else builds on top
2. **Unify at the boundaries:** The `AgentTurn` trait unifies backends at the entry point, not the internals
3. **Separate concerns:** Context assembly, execution, and recording are distinct phases
4. **Design for extensibility:** The harness should make it easy to add new backends, skills, and features

### Implementation
1. **Refactor incrementally:** Use the Strangler Fig pattern to avoid big-bang rewrites
2. **Test at every stage:** Unit tests for classification, integration tests for end-to-end flows
3. **Document decisions:** Explain *why* you made a choice, not just *what* you chose
4. **Keep it simple:** Don't over-engineer; solve the actual problem, not a theoretical one

### Frontend
1. **Real-time is critical:** Users expect instant feedback; optimize WebSocket streaming
2. **Progressive disclosure:** Show basic features first; advanced features (trajectory management) can be hidden
3. **Error handling:** Show clear, actionable error messages; don't just log to console
4. **Accessibility:** Ensure the UI is usable with keyboard navigation and screen readers

---

## 🔮 11. Future Enhancements

### Short-Term (3-6 months)
- **Multi-agent orchestration:** Run multiple agents in parallel and coordinate their outputs
- **Agent handoff:** Seamlessly transfer context from one agent to another (e.g., Claude → GPT-4)
- **Custom tool registry:** Allow users to define custom tools via the dashboard
- **Trajectory scoring:** Automatically rate trajectories based on success criteria

### Medium-Term (6-12 months)
- **Fine-tuning pipeline:** Export trajectories and fine-tune smaller models to mimic agent behavior
- **Collaborative sessions:** Multiple users can interact with the same agent session
- **Agent marketplace:** Share and install pre-configured agent setups (skills + system prompts + trajectories)
- **Advanced analytics:** Visualize agent performance over time, identify common failure modes

### Long-Term (12+ months)
- **Autonomous agent improvement:** Agent automatically identifies weaknesses and requests specific training data
- **Cross-platform agent sync:** Seamless handoff between web, mobile, and desktop clients
- **Enterprise features:** Role-based access control, audit logs, compliance reporting
- **Agent-to-agent communication:** Agents can collaborate and delegate tasks to each other

---

## 📖 12. Glossary

- **Harness:** The orchestration layer that sits between the UI and AI backends
- **Trajectory:** A time-ordered sequence of states, actions, and observations an agent experiences
- **AgentTurn:** The unified trait that defines the common lifecycle for all backends
- **Context Assembly:** The pipeline that dynamically builds the system prompt and injects context
- **Skill:** A markdown file that defines a capability the agent can use (e.g., "code-review", "browser-use")
- **BroadcastHub:** The internal event bus that streams agent events to subscribers (UI, trajectory recorder)
- **ACP (Agent Client Protocol):** Industry-standard protocol for communication between clients and AI agents
- **TOCTOU (Time-of-Check to Time-of-Use):** A race condition where state changes between checking and using it
- **Strangler Fig Pattern:** A refactoring approach that gradually replaces a system by wrapping it in a new layer
- **Few-Shot Learning:** Providing the LLM with examples of desired behavior in the prompt

---

## 🤝 13. Contributing & Collaboration

### For Developers
- Follow the 3-stage plan; don't skip stages
- Write tests for all new functionality
- Document architectural decisions in this file
- Use the Strangler Fig pattern for refactoring

### For Designers
- Prioritize real-time feedback in the UI
- Design for both power users (trajectory management) and casual users (simple chat)
- Ensure accessibility compliance (WCAG 2.1 AA)

### For Product Managers
- Focus on the end-user experience; the harness is invisible to them
- Prioritize features that differentiate us from open-source alternatives
- Gather user feedback on the Skills Marketplace and trajectory injection

---

## 📞 14. Support & Resources

- **Architecture Questions:** Refer to this document first
- **Implementation Issues:** Check the action items in Section 8
- **Design Decisions:** See Section 9 (Key Design Decisions & Rationale)
- **Future Ideas:** See Section 11 (Future Enhancements)

---

**Last Updated:** August 30, 2026  
**Version:** 1.0  
**Status:** Active Development (Stage 2 in progress)