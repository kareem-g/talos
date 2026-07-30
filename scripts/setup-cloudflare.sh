#!/bin/bash
set -e

echo "☁️  Setting up Cloudflare Tunnel for AgentDeck..."

if ! command -v cloudflared &> /dev/null; then
    echo "Installing cloudflared..."

    # Detect architecture
    ARCH=$(uname -m)
    case $ARCH in
        x86_64) CF_ARCH="amd64" ;;
        aarch64) CF_ARCH="arm64" ;;
        armv7l) CF_ARCH="arm" ;;
        *) echo "Unsupported architecture: $ARCH"; exit 1 ;;
    esac

    # Download latest
    curl -L --output cloudflared.deb         "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${CF_ARCH}.deb"
    sudo dpkg -i cloudflared.deb || sudo apt-get install -f -y
    rm -f cloudflared.deb
fi

echo ""
echo "Choose setup method:"
echo "1) Quick tunnel (temporary, no account needed)"
echo "2) Named tunnel (persistent, requires Cloudflare account)"
read -p "Select [1/2]: " choice

if [ "$choice" = "1" ]; then
    echo ""
    echo "Starting quick tunnel..."
    echo "Dashboard will be available at a random *.trycloudflare.com URL"
    echo ""
    echo "Run: cloudflared tunnel --url http://localhost:9120"
    echo ""
    echo "Or start AgentDeck with: agentdeck daemon start --cloudflare"

elif [ "$choice" = "2" ]; then
    echo ""
    echo "Setting up named tunnel..."
    echo ""
    echo "1. Login to Cloudflare:"
    echo "   cloudflared tunnel login"
    echo ""
    echo "2. Create a tunnel:"
    echo "   cloudflared tunnel create agentdeck"
    echo ""
    echo "3. Get your tunnel token and add to config:"
    echo "   ~/.config/agentdeck/config.toml"
    echo ""
    echo "   [tunnel.cloudflare]"
    echo "   enabled = true"
    echo "   token = "your-tunnel-token""
    echo "   hostname = "agentdeck.yourdomain.com""
    echo ""
    echo "4. Start AgentDeck:"
    echo "   agentdeck daemon start --cloudflare"
fi
