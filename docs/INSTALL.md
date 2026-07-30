# Installation Guide

## Requirements

- Linux (glibc 2.31+, kernel 5.4+)
- Rust 1.80+
- Node.js 20+
- pnpm 9+

## Quick Install

```bash
curl -fsSL https://raw.githubusercontent.com/yourusername/agentdeck-linux/main/scripts/install.sh | bash
```

## Manual Install

```bash
git clone https://github.com/yourusername/agentdeck-linux.git
cd agentdeck-linux
make install
```

## Post-Install

```bash
# Start daemon
agentdeck daemon start

# Open dashboard
agentdeck dashboard open

# Launch Claude Code
agentdeck claude ~/my-project
```

## Systemd Service

```bash
# Enable auto-start
sudo systemctl enable --now agentdeck@$(whoami)

# Check status
systemctl status agentdeck@$(whoami)
```
