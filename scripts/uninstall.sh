#!/bin/bash
set -e

INSTALL_DIR="/usr/local/bin"
CONFIG_DIR="$HOME/.config/agentdeck"
DATA_DIR="$HOME/.local/share/agentdeck"

echo "🗑️  Uninstalling AgentDeck Linux..."

# Stop daemon
if command -v systemctl &> /dev/null; then
    sudo systemctl stop agentdeck@$(whoami) 2>/dev/null || true
    sudo systemctl disable agentdeck@$(whoami) 2>/dev/null || true
    sudo rm -f /etc/systemd/system/agentdeck.service
    sudo systemctl daemon-reload
fi

# Kill running processes
pkill -f agentdeck-backend 2>/dev/null || true

# Remove binaries
sudo rm -f "$INSTALL_DIR/agentdeck-backend"
sudo rm -f "$INSTALL_DIR/agentdeck"

# Ask about config
read -p "Remove configuration and data? [y/N] " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    rm -rf "$CONFIG_DIR"
    rm -rf "$DATA_DIR"
    echo "✅ Configuration and data removed"
fi

echo "✅ AgentDeck Linux uninstalled"
