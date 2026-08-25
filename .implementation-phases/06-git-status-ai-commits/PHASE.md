# Phase 06: Git Status & AI Commits

> **Goal**: A full git operations panel in the sidebar — see what changed, review diffs, write commit messages with AI, and push. All without leaving AgentDeck.

---

## What to Build

A Git tab that gives you a complete view of your repository's state and the ability to act on it.

### The View

#### Top: Branch Info Bar

- Current branch name
- Ahead/behind counts relative to upstream (e.g., "↑2 ↓1")
- Repository name (project folder name)
- Last refresh time + a refresh button

#### Middle: File Changes List

Three sub-sections (collapsible):

**Staged** — files ready to commit
**Modified** — tracked files with changes
**Untracked** — new files not yet tracked

Each file shows:
- File path (truncated from the left if long)
- Status icon (M=modified green, A=added blue, D=deleted red, ?=untracked gray)
- For modified files: "+X -Y" change count
- Hover: action buttons appear (Stage/Unstage, Discard, View diff)

#### Bottom: Commit Controls

- Commit message textarea (auto-resizes, max 5 lines)
- "Generate with AI" button next to it — sends the diff to the agent and gets a conventional commit message back
- Commit button (disabled if nothing staged)
- Commit & Push button (commits then pushes)
- Amend checkbox

### The Diff Viewer

Clicking "View diff" on a file opens an inline diff panel:

- Syntax-highlighted side-by-side or unified diff
- File path header
- Scroll through the changes
- Close button to collapse back

### AI Commit Message

When "Generate with AI" is clicked:
1. Collect the staged diff
2. Send it to the configured agent with a prompt: "Write a concise conventional commit message for these changes"
3. Populate the textarea with the result
4. The user can edit before committing

### Backend Support Needed

- Git operations: status, diff, stage, unstage, commit, push, discard
- Use a git library (git2 crate) or shell out to git
- AI commit message endpoint — accepts diff, returns message
- Cache git state per workspace (don't re-scan on every tab switch)
- WebSocket event when git state changes (e.g., after a commit)

### Safety

- Push requires confirmation (a small dialog: "Push 3 commits to origin/main?")
- Discard changes requires confirmation
- If push fails (conflict, auth), show the error inline

### Empty State

"Working tree clean — nothing to commit. Your repository is up to date."

---

## Acceptance Criteria

- [ ] Branch info with ahead/behind counts
- [ ] File changes list grouped by staged/modified/untracked
- [ ] Click to view inline diff
- [ ] Stage/unstage files from the UI
- [ ] Commit message textarea with AI generate button
- [ ] AI generates commit message from staged diff
- [ ] Commit and Commit & Push buttons work
- [ ] Confirmation dialogs for destructive actions
- [ ] Errors shown inline (push failure, etc.)
- [ ] Empty state when clean
- [ ] Git state refreshes automatically after changes
