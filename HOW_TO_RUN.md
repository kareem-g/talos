# AgentDeck Linux - How to Run

> **Download:** [agentdeck-linux.zip](https://github.com/yourusername/agentdeck-linux/releases/latest/download/agentdeck-linux.zip) | [View on GitHub](https://github.com/yourusername/agentdeck-linux)

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start-build--run)
- [Development Mode](#development-mode-hot-reload)
- [Auto-Start on Boot](#auto-start-on-boot)
  - [Systemd User Service](#systemd-user-service-recommended)
  - [Systemd System Service](#systemd-system-service)
  - [Desktop Entry](#desktop-entry-gui-login)
  - [Cron](#cron-reboot)
- [Remote Access](#remote-access)
  - [Tailscale](#tailscale-private-network)
  - [Cloudflare Tunnel](#cloudflare-public-access)
- [Common Commands](#common-commands)
- [Troubleshooting](#troubleshooting)
- [Config Locations](#config-locations)
- [Links](#links)

---

## Prerequisites

```bash
# Rust (if not installed)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env

# Node.js 20+ (if not installed)
# See: https://nodejs.org/

# pnpm
npm install -g pnpm

# Install AI agent CLIs
npm install -g @anthropic-ai/claude-code
npm install -g @openai/codex
npm install -g opencode
```

---

## Quick Start (Build & Run)

```bash
cd agentdeck-linux

# Build everything (backend + CLI + dashboard)
make build

# Start the daemon
agentdeck daemon start

# Open dashboard
agentdeck dashboard open
```

---

## Development Mode (Hot Reload)

```bash
# Terminal 1: Backend
cd backend
cargo run

# Terminal 2: Dashboard
cd dashboard
pnpm install
pnpm dev          # Vite dev server on :3000
```

The dashboard proxies API calls to `localhost:9120` automatically.

---

## Auto-Start on Boot

### Systemd User Service (Recommended)

Runs as your user on login — no root required.

```bash
# Create and enable user service
mkdir -p ~/.config/systemd/user
cp config/systemd/agentdeck.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable agentdeck
systemctl --user start agentdeck

# Check status
systemctl --user status agentdeck
journalctl --user -u agentdeck -f
```

**Commands:**
```bash
systemctl --user start agentdeck      # Start now
systemctl --user stop agentdeck       # Stop
systemctl --user restart agentdeck    # Restart
systemctl --user disable agentdeck    # Disable auto-start
```

---

### Systemd System Service

```bash
# Install binary system-wide
sudo cp target/release/agentdeck-backend /usr/local/bin/

# Enable for your user
sudo cp config/systemd/agentdeck.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable agentdeck@$(whoami)
sudo systemctl start agentdeck@$(whoami)
```

---

### Desktop Entry (GUI Login)

```bash
mkdir -p ~/.config/autostart
cat > ~/.config/autostart/agentdeck.desktop << 'EOF'
[Desktop Entry]
Type=Application
Name=AgentDeck
Exec=agentdeck daemon start
Hidden=false
X-GNOME-Autostart-enabled=true
EOF
```

---

### Cron @reboot

```bash
crontab -e
# Add:
@reagentdeck daemon start >> ~/.local/share/agentdeck/daemon.log 2>&1
```

---

## Remote Access

### Tailscale (Private Network)

```bash
# Install and start Tailscale
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up

# Configure AgentDeck to bind to Tailscale interface
# Edit ~/.config/agentdeck/config.toml:
#   [server]
#   bind_interface = "tailscale0"
#   
#   [tunnel.tailscale]
#   enabled = true

# Start with Tailscale
agentdeck daemon start --tailscale

# Access from any device on your Tailnet:
# http://$(tailscale ip -4):9120
```

For full Tailscale setup (MagicDNS, ACLs, auto-connect), see [docs/REMOTE_ACCESS.md](https://github.com/yourusername/agentdeck-linux/blob/main/docs/REMOTE_ACCESS.md).

---

### Cloudflare (Public Access)

```bash
# Quick tunnel (temporary, no account)
agentdeck daemon start --cloudflare

# Named tunnel (persistent)
# 1. Install cloudflared
# 2. cloudflared tunnel login
# 3. cloudflared tunnel create agentdeck
# 4. Add token to ~/.config/agentdeck/config.toml
# 5. agentdeck daemon start --cloudflare
```

For full Cloudflare setup (DNS, systemd auto-start), see [docs/REMOTE_ACCESS.md](https://github.com/yourusername/agentdeck-linux/blob/main/docs/REMOTE_ACCESS.md).

---

## Common Commands

### Sessions
```bash
agentdeck list                          # List all sessions
agentdeck create --agent claude         # New Claude session
agentdeck attach <id>                   # Attach to session
agentdeck kill <id>                     # Kill session
```

### Agents
```bash
agentdeck claude ~/my-project           # Launch Claude Code
agentdeck codex ~/my-project            # Launch Codex CLI
agentdeck opencode ~/my-project         # Launch OpenCode
```

### Tunnels
```bash
agentdeck tunnel status                 # Check tunnel status
agentdeck tunnel tailscale --up         # Enable Tailscale
agentdeck tunnel cloudflare --up        # Enable Cloudflare
```

### MCP
```bash
agentdeck mcp list                      # List MCP servers
agentdeck mcp add filesystem "npx -y @modelcontextprotocol/server-filesystem /path"
```

### Pairing
```bash
agentdeck pair                          # Show QR for mobile pairing
agentdeck revoke <device-id>            # Revoke device
```

### Config
```bash
agentdeck config edit                   # Edit config in $EDITOR
```

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Port 9120 in use | `agentdeck daemon start --port 9121` or kill existing process |
| Dashboard 404 | Run `make build` to build dashboard into `dashboard/dist/` |
| Tailscale not detected | Run `sudo tailscale up` first |
| Cloudflare not working | Install `cloudflared` via script: `./scripts/setup-cloudflare.sh` |
| Permission denied | Ensure `~/.config/agentdeck/` and `~/.local/share/agentdeck/` are writable |
| Service fails to start | Check `journalctl --user -u agentdeck` for errors |

---

## Config Locations

```bash
~/.config/agentdeck/config.toml       # Main config
~/.local/share/agentdeck/agentdeck.db  # SQLite database
~/.local/share/agentdeck/worktrees/    # Git worktrees
~/.config/systemd/user/agentdeck.service  # User systemd service
```

---

## Links

- [GitHub Repository](https://github.com/yourusername/agentdeck-linux)
- [Latest Release](https://github.com/yourusername/agentdeck-linux/releases/latest)
- [Remote Access Guide](https://github.com/yourusername/agentdeck-linux/blob/main/docs/REMOTE_ACCESS.md)
- [Documentation](https://github.com/yourusername/agentdeck-linux/tree/main/docs)
- [Report an Issue](https://github.com/yourusername/agentdeck-linux/issues)
- [Discussions](https://github.com/yourusername/agentdeck-linux/discussions)
