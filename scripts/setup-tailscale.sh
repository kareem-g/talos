#!/bin/bash
set -e

echo "🔐 Setting up Tailscale for AgentDeck..."

if ! command -v tailscale &> /dev/null; then
    echo "Installing Tailscale..."
    curl -fsSL https://tailscale.com/install.sh | sh
fi

if ! tailscale status &> /dev/null; then
    echo "Starting Tailscale..."
    sudo tailscale up
fi

IP=$(ip -4 addr show tailscale0 2>/dev/null | grep -oP '(?<=inet\s)\d+(\.\d+){3}' || echo "")

if [ -z "$IP" ]; then
    echo "❌ Could not determine Tailscale IP"
    echo "   Make sure 'sudo tailscale up' completed successfully"
    exit 1
fi

echo "✅ Tailscale IP: $IP"
echo ""
echo "Update your config (~/.config/agentdeck/config.toml):"
echo ""
echo "[server]"
echo "bind_interface = "tailscale0""
echo ""
echo "[tunnel.tailscale]"
echo "enabled = true"
echo "hostname = "agentdeck""
echo ""
echo "Dashboard will be available at: http://$IP:9120"
