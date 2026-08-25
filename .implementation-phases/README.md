# AgentDeck Feature Phases

> Ordered implementation prompts for transforming AgentDeck into a full agent command center.
> Each file is a self-contained prompt describing a feature — no code, just the idea and goals.

## How to Use

1. Copy the **Master Prompt** below into your AI coding assistant
2. The AI reads one phase at a time, implements it, then waits for your approval
3. Phases are ordered so each builds naturally on the previous
4. After each phase, review the work, give feedback, then say "next phase"

## Phase Overview

| # | Phase | What It Delivers |
|---|-------|-----------------|
| 01 | [Sidebar Infrastructure](./01-sidebar-infrastructure/PHASE.md) | Tabbed sidebar shell — the foundation for everything else |
| 02 | [Working Agents View](./02-working-agents/PHASE.md) | See all active agents across sessions in the sidebar |
| 03 | [Active Terminals](./03-active-terminals/PHASE.md) | View and interact with PTY terminals in the sidebar |
| 04 | [Browser View Tab](./04-browser-view/PHASE.md) | Built-in browser panel in the sidebar |
| 05 | [Agent Todos & Goals](./05-agent-todos-goals/PHASE.md) | Agent-generated todo lists and goals in sidebar |
| 06 | [Git Status & AI Commits](./06-git-status-ai-commits/PHASE.md) | Git panel — status, diff, AI commit message, push |
| 07 | [Automations](./07-automations/PHASE.md) | Schedule recurring tasks, queue background work |
| 08 | [Skills Page](./08-skills-page/PHASE.md) | Import, browse, and manage skills per workspace |
| 09 | [Bots](./09-bots/PHASE.md) | Persistent autonomous bot agents (GrokBot-style) |
| 10 | [Session Multitasking](./10-session-multitasking/PHASE.md) | Multiple concurrent tasks within a session |
| 11 | [Keep Awake](./11-keep-awake/PHASE.md) | Prevent computer sleep while agents are running |
| 12 | [Mobile Polish](./12-mobile-polish/PHASE.md) | Make everything responsive and touch-friendly |

---

## Master Prompt

Copy everything below the line into your AI coding assistant:

---

You are implementing features for **AgentDeck** — a Rust (Axum) + React (TypeScript/Zustand) AI agent control center for Linux.

## PROJECT CONTEXT

- **Backend**: Rust, Axum, SQLite, PTY management, WebSocket broadcast
- **Frontend**: React, TypeScript, Zustand store, Tailwind CSS
- **Sidebar**: `dashboard/src/components/home/HomeSidebar.tsx`
- **Store**: `dashboard/src/store/index.ts`
- **Backend routes**: `backend/src/api/routes.rs`
- **Session model**: `backend/src/sessions/mod.rs`

## WORKING PROTOCOL

1. Read the current phase's `PHASE.md` file for the feature description
2. Implement the feature completely — both backend and frontend as needed
3. Use your own judgment on technical implementation (file structure, naming, patterns)
4. Follow existing code patterns and style in the project
5. Verify it compiles before reporting done
6. Report what you built and any decisions you made
7. STOP — wait for the user to say "next phase" before proceeding

## IMPORTANT RULES

- All features are **ADDITIVE** — never break existing functionality
- Sidebar updates must not re-render main content (use the existing revision counter pattern)
- Mobile-compatible where specified
- Match the existing code style, naming conventions, and comment density
- Each phase should be fully functional on its own — no "TODO: wire this up later"

## START NOW

Read and implement: `.implementation-phases/01-sidebar-infrastructure/PHASE.md`
