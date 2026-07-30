#!/bin/bash
set -e

REPO_URL="https://github.com/yourusername/agentdeck-linux"
INSTALL_DIR="/usr/local/bin"
CONFIG_DIR="$HOME/.config/agentdeck"
DATA_DIR="$HOME/.local/share/agentdeck"

echo "🚀 Installing AgentDeck Linux..."

# Check dependencies
check_dep() {
    if ! command -v "$1" &> /dev/null; then
        echo "❌ $1 is required but not installed."
        return 1
    fi
    echo "✅ $1 found"
}

echo "Checking dependencies..."
check_dep curl
check_dep git

if ! check_dep rustc; then
    echo "Installing Rust..."
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    source "$HOME/.cargo/env"
fi

if ! check_dep node; then
    echo "Please install Node.js 20+ from https://nodejs.org/"
    exit 1
fi

if ! check_dep pnpm; then
    echo "Installing pnpm..."
    npm install -g pnpm
fi

# Build backend
echo "🔨 Building backend..."
cd backend
cargo build --release
cd ..

# Build CLI
echo "🔨 Building CLI..."
cd cli
cargo build --release
cd ..

# Build dashboard
echo "🔨 Building dashboard..."
cd dashboard
pnpm install
pnpm build
cd ..

# Install binaries
echo "📦 Installing binaries..."
sudo mkdir -p "$INSTALL_DIR"
sudo cp target/release/agentdeck-backend "$INSTALL_DIR/"
sudo cp target/release/agentdeck "$INSTALL_DIR/"
sudo chmod +x "$INSTALL_DIR/agentdeck-backend"
sudo chmod +x "$INSTALL_DIR/agentdeck"

# Create directories
mkdir -p "$CONFIG_DIR"
mkdir -p "$DATA_DIR"
mkdir -p "$DATA_DIR/worktrees"

# Install default config
if [ ! -f "$CONFIG_DIR/config.toml" ]; then
    cp config/default.toml "$CONFIG_DIR/config.toml"
    echo "✅ Default config installed to $CONFIG_DIR/config.toml"
fi

# Install systemd service (optional)
if command -v systemctl &> /dev/null; then
    echo "🔧 Installing systemd service..."
    sudo mkdir -p /etc/systemd/system

    # Create user service
    mkdir -p "$HOME/.config/systemd/user"
    cp config/systemd/agentdeck.service "$HOME/.config/systemd/user/"
    systemctl --user daemon-reload
    echo "   Run: systemctl --user enable --now agentdeck"
fi

# Install shell completions
echo "🐚 Installing shell completions..."
mkdir -p "$HOME/.local/share/bash-completion/completions"
mkdir -p "$HOME/.config/fish/completions"
mkdir -p "$HOME/.zsh/completions"

# Generate completions (best effort)
agentdeck --generate bash > "$HOME/.local/share/bash-completion/completions/agentdeck" 2>/dev/null || true
agentdeck --generate fish > "$HOME/.config/fish/completions/agentdeck.fish" 2>/dev/null || true
agentdeck --generate zsh > "$HOME/.zsh/completions/_agentdeck" 2>/dev/null || true

echo ""
echo "✅ AgentDeck Linux installed successfully!"
echo ""
echo "Quick start:"
echo "  agentdeck daemon start          # Start the daemon"
echo "  agentdeck dashboard open        # Open the dashboard"
echo "  agentdeck claude                # Launch Claude Code"
echo ""
echo "For remote access:"
echo "  agentdeck daemon start --tailscale     # With Tailscale"
echo "  agentdeck daemon start --cloudflare    # With Cloudflare Tunnel"
echo ""
echo "To enable auto-start on boot:"
echo "  systemctl --user enable agentdeck"
