# Remote Access & Auto-Start Guide

> Configure AgentDeck Linux to run automatically on boot and access it remotely via Tailscale or Cloudflare Tunnel.

---

## Table of Contents

- [Auto-Start on Boot](#auto-start-on-boot)
  - [Systemd User Service (Recommended)](#systemd-user-service-recommended)
  - [Systemd System Service](#systemd-system-service)
  - [Desktop Entry (GUI)](#desktop-entry-gui)
  - [Cron @reboot](#cron-reboot)
- [Tailscale Remote Access](#tailscale-remote-access)
  - [Setup](#tailscale-setup)
  - [Auto-Connect](#tailscale-auto-connect)
  - [MagicDNS](#tailscale-magicdns)
- [Cloudflare Tunnel Remote Access](#cloudflare-tunnel-remote-access)
  - [Quick Tunnel](#quick-tunnel)
  - [Named Tunnel (Persistent)](#named-tunnel-persistent)
  - [Auto-Start with Systemd](#cloudflare-auto-start)
- [Combined Setup (Tailscale + Cloudflare)](#combined-setup)
- [Security Checklist](#security-checklist)
- [Troubleshooting](#troubleshooting)

---

## Auto-Start on Boot

### Systemd User Service (Recommended)

Runs AgentDeck as your user on login — no root required.

```bash
# 1. Create user service directory
mkdir -p ~/.config/systemd/user

# 2. Create the service file
cat > ~/.config/systemd/user/agentdeck.service << 'EOF'
[Unit]
Description=AgentDeck Linux Daemon
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=%h/.cargo/bin/agentdeck-backend
Restart=always
RestartSec=5
Environment="RUST_LOG=info"
Environment="AGENTDECK_CONFIG=%h/.config/agentdeck/config.toml"

[Install]
WantedBy=default.target
EOF

# 3. Reload systemd user daemon
systemctl --user daemon-reload

# 4. Enable auto-start on login
systemctl --user enable agentdeck.service

# 5. Start now
systemctl --user start agentdeck.service

# 6. Check status
systemctl --user status agentdeck.service
```

**Commands:**
```bash
systemctl --user start agentdeck      # Start now
systemctl --user stop agentdeck       # Stop
systemctl --user restart agentdeck    # Restart
systemctl --user disable agentdeck    # Disable auto-start
journalctl --user -u agentdeck -f     # View logs
```

---

### Systemd System Service

Runs as a system service (requires root, shared across all users).

```bash
# 1. Install binary system-wide
sudo cp target/release/agentdeck-backend /usr/local/bin/
sudo chmod +x /usr/local/bin/agentdeck-backend

# 2. Create system service
sudo tee /etc/systemd/system/agentdeck.service > /dev/null << 'EOF'
[Unit]
Description=AgentDeck Linux Daemon
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=%I
ExecStart=/usr/local/bin/agentdeck-backend
Restart=always
RestartSec=5
Environment="RUST_LOG=info"
Environment="AGENTDECK_CONFIG=/home/%I/.config/agentdeck/config.toml"

[Install]
WantedBy=multi-user.target
EOF

# 3. Enable for your user
sudo systemctl daemon-reload
sudo systemctl enable agentdeck@$(whoami)
sudo systemctl start agentdeck@$(whoami)

# 4. Check status
sudo systemctl status agentdeck@$(whoami)
```

---

### Desktop Entry (GUI Login)

For desktop environments (GNOME, KDE, XFCE).

```bash
# Create autostart entry
mkdir -p ~/.config/autostart

cat > ~/.config/autostart/agentdeck.desktop << 'EOF'
[Desktop Entry]
Type=Application
Name=AgentDeck
Exec=/bin/sh -c "agentdeck daemon start"
Hidden=false
NoDisplay=false
X-GNOME-Autostart-enabled=true
EOF

# Make executable
chmod +x ~/.config/autostart/agentdeck.desktop
```

---

### Cron @reboot

Simple fallback method.

```bash
# Edit crontab
crontab -e

# Add this line:
@reboot /usr/bin/env bash -c "sleep 10 && export PATH=$HOME/.cargo/bin:$PATH && agentdeck daemon start >> $HOME/.local/share/agentdeck/daemon.log 2>&1 &"
```

---

## Tailscale Remote Access

### Tailscale Setup

```bash
# 1. Install Tailscale
curl -fsSL https://tailscale.com/install.sh | sh

# 2. Start and authenticate
sudo tailscale up

# 3. Verify connection
tailscale status

# 4. Get your Tailscale IP
tailscale ip -4
# Example output: 100.64.0.1
```

### Configure AgentDeck for Tailscale

Edit `~/.config/agentdeck/config.toml`:

```toml
[server]
host = "0.0.0.0"
port = 9120
bind_interface = "tailscale0"  # Bind only to Tailscale interface

[tunnel.tailscale]
enabled = true
hostname = "agentdeck"
```

Start with Tailscale:
```bash
agentdeck daemon start --tailscale
```

Access from any device on your Tailnet:
```
http://100.64.0.1:9120
```

---

### Tailscale Auto-Connect

Ensure Tailscale connects automatically on boot:

```bash
# Enable Tailscale service
sudo systemctl enable tailscaled
sudo systemctl start tailscaled

# Accept routes (if using subnet routers)
sudo tailscale up --accept-routes

# Enable MagicDNS
tailscale status --json | grep -q '"MagicDNSEnabled": true'
```

---

### Tailscale MagicDNS

Access AgentDeck by hostname instead of IP:

```bash
# In Tailscale admin console (https://login.tailscale.com/admin/dns)
# Enable MagicDNS

# Then access via:
http://agentdeck.your-tailnet.ts.net:9120
```

---

## Cloudflare Tunnel Remote Access

### Quick Tunnel (Temporary)

No Cloudflare account needed. URL changes on each restart.

```bash
# 1. Install cloudflared
# See: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/

# 2. Start quick tunnel
cloudflared tunnel --url http://localhost:9120

# 3. Copy the *.trycloudflare.com URL from output
```

---

### Named Tunnel (Persistent)

Requires free Cloudflare account. Permanent URL.

```bash
# 1. Authenticate cloudflared
cloudflared tunnel login
# This opens browser to authorize

# 2. Create a tunnel
cloudflared tunnel create agentdeck
# Saves credentials file, note the tunnel ID

# 3. Configure tunnel
cat > ~/.cloudflared/config.yml << EOF
tunnel: <YOUR-TUNNEL-ID>
credentials-file: /home/$(whoami)/.cloudflared/<YOUR-TUNNEL-ID>.json

ingress:
  - hostname: agentdeck.yourdomain.com
    service: http://localhost:9120
  - service: http_status:404
EOF

# 4. Add DNS record in Cloudflare dashboard
# CNAME agentdeck → <YOUR-TUNNEL-ID>.cfargotunnel.com

# 5. Run tunnel
cloudflared tunnel run agentdeck
```

---

### Cloudflare Auto-Start with Systemd

```bash
# Install cloudflared as a service
sudo cloudflared service install

# Or create user service
mkdir -p ~/.config/systemd/user

cat > ~/.config/systemd/user/cloudflared-agentdeck.service << 'EOF'
[Unit]
Description=Cloudflare Tunnel for AgentDeck
After=network-online.target

[Service]
Type=simple
ExecStart=/usr/bin/cloudflared tunnel run agentdeck
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable cloudflared-agentdeck
systemctl --user start cloudflared-agentdeck
```

---

## Combined Setup

Run AgentDeck with both Tailscale (private) and Cloudflare (public):

```bash
# Terminal 1: AgentDeck with Tailscale
agentdeck daemon start --tailscale

# Terminal 2: Cloudflare tunnel
cloudflared tunnel run agentdeck
```

Or via systemd with dependencies:

```bash
cat > ~/.config/systemd/user/agentdeck-combined.service << 'EOF'
[Unit]
Description=AgentDeck with Cloudflare Tunnel
After=network-online.target

[Service]
Type=simple
ExecStartPre=/bin/sh -c "until tailscale status; do sleep 2; done"
ExecStart=/bin/sh -c "agentdeck daemon start --tailscale & cloudflared tunnel run agentdeck"
Restart=always
RestartSec=10

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable agentdeck-combined
systemctl --user start agentdeck-combined
```

---

## Security Checklist

| Check | Status |
|-------|--------|
| ☐ Pairing required for all new devices | Enforced by default |
| ☐ Auth token set in config | `security.auth_token = "..."` |
| ☐ TLS enabled | `security.tls_enabled = true` |
| ☐ Tailscale ACL restricts access | Configure at [tailscale.com/admin/acls](https://login.tailscale.com/admin/acls) |
| ☐ Cloudflare Access (optional) | Add identity provider |
| ☐ Firewall blocks port 9120 on public interfaces | `sudo ufw deny 9120` or `sudo iptables -A INPUT -p tcp --dport 9120 -j DROP` |
| ☐ No secrets in logs | Automatic redaction enabled |

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `Failed to bind to tailscale0` | Run `sudo tailscale up` first |
| `cloudflared: command not found` | Install from [Cloudflare docs](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) |
| `systemctl --user start` fails | Check `journalctl --user -u agentdeck` for errors |
| Tailscale IP not accessible | Check `tailscale status` — ensure both devices are logged in |
| Cloudflare tunnel not routing | Verify DNS CNAME points to `<tunnel-id>.cfargotunnel.com` |
| Port 9120 already in use | `lsof -i :9120` then `kill <PID>` or change port in config |
| Service starts but dashboard 404 | Run `make build` to compile dashboard to `dashboard/dist/` |
| Permission denied on systemd | Ensure binary path is correct and executable |

---

## Quick Reference

```bash
# One-shot: start everything
agentdeck daemon start --tailscale &
cloudflared tunnel run agentdeck &

# Auto-start: enable systemd
systemctl --user enable agentdeck
systemctl --user enable cloudflared-agentdeck

# Access URLs
# Local:     http://localhost:9120
# Tailscale: http://$(tailscale ip -4):9120
# Cloudflare: https://agentdeck.yourdomain.com
```
