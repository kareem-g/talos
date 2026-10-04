# AgentDeck Linux

> Visual agent terminal companion for Claude Code, Codex, Grok, Kimi, and OpenCode — now on Linux.

A lightweight, native Linux control surface for AI coding agents. Built with Rust (backend) and React (dashboard), featuring Tailscale and Cloudflare tunnel integration for secure remote access.

## Features

- **Multi-Agent Support**: Claude Code, Codex CLI, OpenCode, **Grok Build**, Gemini, Copilot, Kimi, and any Agent Client Protocol (ACP) agent
- **Control-Station Dashboard**: Browser UI with streaming transcripts, plan/usage/turn-summary cards, diff viewers, and approval cards
- **Remote Control — Browser and iOS Shell**: Scan a QR with any phone; the paired browser becomes the remote control (installable PWA, offline shell, system attention alerts). The same React bundle ships as a Capacitor iOS shell, built as an unsigned IPA in CI (`.github/workflows/ios-capacitor.yml`) and re-signed with Sideloadly/AltStore
- **Remote View & Control**: From the QAI phone app, view and control the computer's real desktop, one monitor, or a single application window (App View) — native capture and input on Linux (X11 and Wayland via the desktop portal) and macOS (CoreGraphics), over the paired device token. Adaptive low-latency streaming, a virtual keyboard with sticky modifiers, and a "● Remote Control Active" indicator with one-tap terminate. See [docs/REMOTE_VIEW.md](docs/REMOTE_VIEW.md)
- **Secure Remote Access**: Built-in Tailscale and Cloudflare tunnel support with one-tap device pairing and revocation
- **Session Management**: Create, fork, archive, resume, and monitor agent sessions across devices
- **Git Worktrees**: Isolated branches per session with auto-merge
- **MCP Server Pooling**: Shared MCP processes across sessions via Unix sockets
- **Notifications**: Web Push that pages you when an agent finishes, needs approval, or errors — even with the app closed — plus Telegram, Slack, and Discord integrations
- **Lightweight Backend**: Pure Rust, <20MB binary, zero runtime dependencies
- **Pairing Security**: Short-lived single-use offers, hashed device tokens, per-device revocation

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Dashboard (React)                       │
│  Claude Code-style UI · WebSocket · Theme-aware              │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTPS / WSS
┌──────────────────────────▼──────────────────────────────────┐
│                    Rust Backend (Axum)                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │  WebSocket   │  │  REST API   │  │  Static File Serve  │  │
│  │  Broadcast   │  │  Routes     │  │  (Dashboard SPA)    │  │
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

## Quick Start

### Prerequisites

- Linux (Ubuntu 22.04+, Fedora 38+, Arch)
- Rust 1.80+ (`curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`)
- Node.js 20+ (for dashboard build)
- pnpm 9+ (`npm install -g pnpm`)
- Claude Code CLI: `npm install -g @anthropic-ai/claude-code`

### Install

```bash
# Option 1: One-liner install
curl -fsSL https://raw.githubusercontent.com/yourusername/agentdeck-linux/main/scripts/install.sh | bash

# Option 2: From source
git clone https://github.com/yourusername/agentdeck-linux.git
cd agentdeck-linux
make install
```

### Run

```bash
# Start the daemon (backend + dashboard)
agentdeck daemon start

# Or start with specific tunnel
agentdeck daemon start --tailscale
agentdeck daemon start --cloudflare

# Launch a Claude Code session
agentdeck claude

# Open dashboard
agentdeck dashboard open
```

### Remote Access Setup

#### Tailscale (Recommended for private networks)

```bash
# Install Tailscale
sudo tailscale up

# AgentDeck auto-detects Tailscale and binds to tailscale0
agentdeck daemon start --tailscale
# Dashboard available at: http://<tailscale-ip>:9120
```

#### Cloudflare Tunnel (For public access)

```bash
# Install cloudflared
sudo cloudflared service install <your-token>

# Or let AgentDeck manage it
agentdeck tunnel cloudflare --setup
agentdeck daemon start --cloudflare
# Dashboard available at: https://your-subdomain.trycloudflare.com
```

## Dashboard

The dashboard is a single-page React application served by the Rust backend. Access it at:

- **Local**: `http://localhost:9120`
- **Tailscale**: `http://<tailscale-ip>:9120`
- **Cloudflare**: `https://your-subdomain.trycloudflare.com`

### Features

- **Streaming Transcript**: Real-time color-coded output from agents
- **Session Sidebar**: All sessions with status indicators (running/waiting/idle/errored)
- **Diff Viewer**: Inline syntax-highlighted diffs with approve/reject
- **Approval Cards**: One-click YES/NO/ALWAYS for agent prompts
- **Worktree Panel**: Visual git branch and worktree management
- **Command Palette**: `Ctrl+K` quick actions
- **Theme Support**: Tokyo Night, Nord, Catppuccin, Solarized, and custom

## CLI Commands

```bash
agentdeck --help

# Session management
agentdeck list                    # List all sessions
agentdeck create --agent claude   # Create new Claude session
agentdeck attach <id>             # Attach to session
agentdeck fork <id>               # Fork a session
agentdeck archive <id>            # Archive session

# Agent launching
agentdeck claude [project]        # Launch Claude Code
agentdeck codex [project]         # Launch Codex CLI
agentdeck opencode [project]      # Launch OpenCode

# Dashboard
agentdeck dashboard open          # Open browser dashboard
agentdeck dashboard --port 3000   # Custom port

# Tunnels
agentdeck tunnel status           # Show tunnel status
agentdeck tunnel tailscale --up   # Start Tailscale tunnel
agentdeck tunnel cloudflare --up  # Start Cloudflare tunnel

# MCP
agentdeck mcp list                # List MCP servers
agentdeck mcp add <name> <cmd>    # Add MCP server

# Pairing
agentdeck pair                    # Show QR code for mobile pairing
agentdeck revoke <device-id>      # Revoke paired device

# Config
agentdeck config edit             # Edit configuration
agentdeck config reset            # Reset to defaults
```

## Configuration

Config file: `~/.config/agentdeck/config.toml`

```toml
[server]
host = "0.0.0.0"
port = 9120
# Bind to specific interface for Tailscale
# bind_interface = "tailscale0"

[security]
# Auto-generate pairing keys
auto_pair = true
# Token for LAN clients (auto-generated if empty)
# auth_token = "your-secure-token"

[tunnel]
# Tailscale settings
tailscale.enabled = false
tailscale.hostname = "agentdeck"

# Cloudflare settings
cloudflare.enabled = false
# cloudflare.token = "your-token"
# cloudflare.hostname = "agentdeck"

[agents]
claude.path = "claude"
codex.path = "codex"
opencode.path = "opencode"

[worktree]
enabled = true
base_dir = "~/.agentdeck/worktrees"
auto_merge = false

[mcp]
# Global MCP servers
servers = []

[notifications]
telegram.bot_token = ""
telegram.chat_id = ""
slack.webhook_url = ""

[theme]
# Dashboard theme
default = "tokyo-night"
```

## Security

- **No root required**: Runs as your user, never privileged
- **Curve25519 pairing**: Per-device keys with ephemeral key agreement
- **Signed frames**: All WebSocket messages signed with Ed25519
- **TLS by default**: Auto-generated certificates for local HTTPS
- **Project allowlist**: Agents can only access authorized directories
- **No secrets in logs**: Automatic redaction of tokens and keys
- **Path traversal protection**: Canonical path checks on all file operations

## Development

```bash
# Backend
cd backend
cargo run

# Dashboard
cd dashboard
pnpm install
pnpm dev          # Vite dev server
pnpm build        # Production build

# CLI
cd cli
cargo run -- --help

# Run tests
make test

# Build everything
make release
```

## License

MIT License — see [LICENSE](LICENSE)
