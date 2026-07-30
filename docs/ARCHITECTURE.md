# Architecture

## Overview

AgentDeck Linux is a lightweight, native Linux control surface for AI coding agents. It consists of three main components:

1. **Backend** (Rust) - HTTP/WebSocket server, PTY management, session orchestration
2. **Dashboard** (React) - Claude Code-style web UI
3. **CLI** (Rust) - Terminal interface and command launcher

## Component Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                        User Layer                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │   Browser    │  │   Terminal   │  │   Mobile App     │  │
│  │  (Dashboard)  │  │    (CLI)     │  │  (Paired)        │  │
│  └──────┬───────┘  └──────┬───────┘  └────────┬─────────┘  │
└─────────┼─────────────────┼───────────────────┼────────────┘
          │                 │                   │
          │ HTTPS/WSS       │ HTTP              │ WSS (paired)
          │                 │                   │
┌─────────▼─────────────────▼───────────────────▼────────────┐
│                    Rust Backend (Axum)                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │  WebSocket   │  │  REST API   │  │  Static File Serve│  │
│  │  Broadcast   │  │  Routes     │  │  (Dashboard SPA)   │  │
│  └──────┬───────┘  └─────────────┘  └─────────────────────┘  │
│         │                                                    │
│  ┌──────▼──────────────────────────────────────────────┐   │
│  │              Session Manager (SQLite)                  │   │
│  │  ┌────────┐ ┌────────┐ ┌────────┐ ┌──────────────┐  │   │
│  │  │ Claude │ │ Codex  │ │OpenCode│ │   Grok/Kimi  │  │   │
│  │  │  PTY   │ │  PTY   │ │PTY+SSE │ │   Adapter    │  │   │
│  │  └────┬───┘ └────┬───┘ └────┬───┘ └──────┬───────┘  │   │
│  │       └──────────┴──────────┴────────────┘           │   │
│  │                      │                                │   │
│  │  ┌───────────────────▼────────────────────────────┐  │   │
│  │  │         MCP Socket Pool (Unix Domain)          │  │   │
│  │  └────────────────────────────────────────────────┘  │   │
│  └──────────────────────────────────────────────────────┘   │
│                           │                                  │
│  ┌────────────────────────▼─────────────────────────────┐     │
│  │              Tunnel Manager                         │     │
│  │  ┌──────────────┐      ┌──────────────────────┐  │     │
│  │  │  Tailscale   │      │  Cloudflare Tunnel   │  │     │
│  │  │  (tsnet)     │      │  (cloudflared)       │  │     │
│  │  └──────────────┘      └──────────────────────┘  │     │
│  └───────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────┘
```

## Backend Architecture

### Core Modules

| Module | Purpose | Key Types |
|--------|---------|-----------|
| `daemon` | Main event loop, mDNS, HTTP server | `Daemon`, `DaemonState` |
| `websocket` | Real-time bidirectional comms | `WsMessage`, `BroadcastHub` |
| `pty` | PTY spawning and I/O | `PtyManager`, `PtySession` |
| `agents` | Agent adapters | `AgentAdapter` trait |
| `sessions` | Session lifecycle | `SessionManager`, `Session` |
| `worktree` | Git worktree ops | `WorktreeManager` |
| `mcp` | MCP server pool | `McpManager`, `SocketPool` |
| `tunnel` | Remote access | `TunnelProvider` trait |
| `auth` | Device pairing | `PairingManager` |
| `notifications` | External alerts | `NotificationProvider` trait |

### Data Flow

1. **Agent Launch**: CLI → API → SessionManager → PtyManager → AgentAdapter → PTY
2. **Output Stream**: PTY → Parser → BroadcastHub → WebSocket → Dashboard
3. **Approval**: Agent → Parser → ApprovalRequest → WebSocket → Dashboard → Response → PTY
4. **Tunnel**: Config → TunnelProvider → External Access → Axum Router

## Security Model

- **No root required**: All processes run as the logged-in user
- **Curve25519 pairing**: Per-device keys with ephemeral key agreement
- **Signed frames**: Ed25519 signatures on all WebSocket messages
- **TLS by default**: Auto-generated certificates for HTTPS/WSS
- **Project allowlist**: Agents restricted to authorized directories
- **Path traversal protection**: Canonical path resolution
- **No secrets in logs**: Automatic redaction

## Database Schema

SQLite database at `~/.local/share/agentdeck/agentdeck.db`:

- **sessions**: Session metadata and state
- **devices**: Paired device public keys
- **mcp_servers**: MCP server configurations
- **transcripts**: Session output history
- **approvals**: Approval request log
