# Remote Access (Tunnels)

## Tailscale (Recommended)

Tailscale provides secure, private networking between your devices.

### Setup
```bash
# Install Tailscale
curl -fsSL https://tailscale.com/install.sh | sh

# Authenticate
sudo tailscale up

# Configure AgentDeck
agentdeck tunnel tailscale --up
agentdeck daemon start --tailscale
```

### Access
- Dashboard: `http://<tailscale-ip>:9120`
- Only devices on your Tailscale network can access

## Cloudflare Tunnel

For public access without opening ports.

### Quick Tunnel (Temporary)
```bash
agentdeck daemon start --cloudflare
# URL will be printed to console
```

### Named Tunnel (Persistent)
```bash
# 1. Install cloudflared
# 2. Login: cloudflared tunnel login
# 3. Create tunnel: cloudflared tunnel create agentdeck
# 4. Add token to config
# 5. Start: agentdeck daemon start --cloudflare
```

## Security Notes

- Tailscale IP alone is NOT authentication - pairing still required
- Cloudflare hostname alone is NOT authentication - pairing still required
- Always use HTTPS when accessing over public networks
- Consider setting `auth_token` in config for additional protection
