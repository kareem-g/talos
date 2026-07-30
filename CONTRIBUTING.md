# Contributing to AgentDeck Linux

> **Welcome!** This is an open-source project and we love contributions. Whether you are fixing a bug, adding a feature, or improving documentation — thank you!

---

## Quick Links

| Resource | Link |
|----------|------|
| **Repository** | [github.com/yourusername/agentdeck-linux](https://github.com/yourusername/agentdeck-linux) |
| **Issues** | [github.com/yourusername/agentdeck-linux/issues](https://github.com/yourusername/agentdeck-linux/issues) |
| **Discussions** | [github.com/yourusername/agentdeck-linux/discussions](https://github.com/yourusername/agentdeck-linux/discussions) |
| **Latest Release** | [github.com/yourusername/agentdeck-linux/releases/latest](https://github.com/yourusername/agentdeck-linux/releases/latest) |
| **Download ZIP** | [agentdeck-linux.zip](https://github.com/yourusername/agentdeck-linux/releases/latest/download/agentdeck-linux.zip) |
| **Remote Access Guide** | [docs/REMOTE_ACCESS.md](https://github.com/yourusername/agentdeck-linux/blob/main/docs/REMOTE_ACCESS.md) |

---

## Table of Contents

- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [How to Contribute](#how-to-contribute)
- [Code Guidelines](#code-guidelines)
- [Architecture Decisions](#architecture-decisions)
- [Security](#security)
- [License](#license)

---

## Development Setup

### 1. Fork & Clone

```bash
# Fork the repo on GitHub, then clone your fork
git clone https://github.com/YOUR_USERNAME/agentdeck-linux.git
cd agentdeck-linux
```

### 2. Install Dependencies

```bash
# Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env

# Node.js + pnpm
npm install -g pnpm

# AI agent CLIs (for testing)
npm install -g @anthropic-ai/claude-code
npm install -g @openai/codex
```

### 3. Build Everything

```bash
make build
```

### 4. Run in Development Mode

```bash
# Terminal 1 — Backend
cd backend
cargo run

# Terminal 2 — Dashboard
cd dashboard
pnpm install
pnpm dev
```

Dashboard will be at `http://localhost:3000` with API proxy to `http://localhost:9120`.

---

## Project Structure

```
agentdeck-linux/
├── backend/          # Rust Axum server (PTY, WebSocket, sessions, tunnels)
│   ├── src/
│   │   ├── daemon/       # mDNS, HTTP server
│   │   ├── websocket/    # Real-time broadcast
│   │   ├── pty/          # PTY spawning & I/O
│   │   ├── agents/       # Claude, Codex, OpenCode adapters
│   │   ├── tunnel/       # Tailscale & Cloudflare providers
│   │   ├── auth/         # Curve25519 pairing
│   │   ├── sessions/     # SQLite session manager
│   │   ├── worktree/     # Git worktree ops
│   │   ├── mcp/          # MCP server socket pool
│   │   └── ...
│   └── migrations/       # SQLite schema
├── cli/              # Rust CLI tool (clap)
├── shared/           # Shared protocol types
├── dashboard/        # React 19 + TypeScript + Tailwind SPA
│   ├── src/
│   │   ├── components/   # UI components (Terminal, SessionList, etc.)
│   │   ├── hooks/        # React hooks (useWebSocket, useSessions, etc.)
│   │   ├── types/        # TypeScript definitions
│   │   └── lib/          # API client, WebSocket client, crypto
│   └── public/
├── scripts/          # Install, build, tunnel setup
├── config/           # Default config + systemd services
│   └── systemd/
│       ├── agentdeck.service      # System service template
│       └── agentdeck.socket       # Socket activation
├── docs/             # Documentation
│   ├── ARCHITECTURE.md
│   ├── API.md
│   ├── SECURITY.md
│   ├── REMOTE_ACCESS.md    # Remote access & auto-start guide
│   ├── INSTALL.md
│   ├── TUNNELS.md
│   └── MCP.md
└── tests/            # Integration, WebSocket, auth tests
```

---

## How to Contribute

### Reporting Bugs

1. Check [existing issues](https://github.com/yourusername/agentdeck-linux/issues) first
2. Open a new issue with:
   - Clear title and description
   - Steps to reproduce
   - Expected vs actual behavior
   - System info (OS, Rust version, Node version)
   - Relevant logs

### Suggesting Features

1. Open a [Discussion](https://github.com/yourusername/agentdeck-linux/discussions) or [Issue](https://github.com/yourusername/agentdeck-linux/issues)
2. Describe the use case and proposed solution
3. Wait for feedback before starting implementation

### Pull Requests

1. **Fork** the repo and create a branch:
   ```bash
   git checkout -b feature/my-feature
   ```

2. **Make your changes** with clear, focused commits

3. **Test your changes:**
   ```bash
   make test          # Run all tests
   cd backend && cargo test
   cd dashboard && pnpm test
   ```

4. **Lint and format:**
   ```bash
   cd backend && cargo fmt && cargo clippy
   cd dashboard && pnpm lint
   ```

5. **Update documentation** if needed

6. **Open a PR** with:
   - Clear description of changes
   - Link to related issue(s)
   - Screenshots (for UI changes)
   - Test results

---

## Code Guidelines

### Rust
- Follow `rustfmt` and `clippy` rules
- Use `thiserror` for error types
- Document public APIs with `///`
- Add tests for new functionality

### TypeScript / React
- Use TypeScript strictly (no `any`)
- Follow existing component patterns
- Use Tailwind utility classes
- Prefer functional components + hooks

### Commits
- Use conventional commits: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`
- Keep commits focused and atomic

---

## Architecture Decisions

See [docs/ARCHITECTURE.md](https://github.com/yourusername/agentdeck-linux/blob/main/docs/ARCHITECTURE.md) for full details.

Key principles:
- **No root required** — runs as user, never privileged
- **Lightweight** — pure Rust backend, <20MB binary
- **Secure by default** — Curve25519 pairing, signed frames, TLS
- **Modular** — trait-based adapters for agents, tunnels, notifications

---

## Security

See [docs/SECURITY.md](https://github.com/yourusername/agentdeck-linux/blob/main/docs/SECURITY.md).

- Report security vulnerabilities privately via GitHub Security Advisories
- Do NOT open public issues for security bugs

---

## License

MIT License — see [LICENSE](https://github.com/yourusername/agentdeck-linux/blob/main/LICENSE)

---

## Community

- 💬 [Discussions](https://github.com/yourusername/agentdeck-linux/discussions)
- 🐛 [Issues](https://github.com/yourusername/agentdeck-linux/issues)
- 🏷️ [Releases](https://github.com/yourusername/agentdeck-linux/releases)
- 📖 [Wiki](https://github.com/yourusername/agentdeck-linux/wiki)
- 🌐 [Remote Access Guide](https://github.com/yourusername/agentdeck-linux/blob/main/docs/REMOTE_ACCESS.md)
