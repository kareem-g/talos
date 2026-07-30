#!/bin/bash
set -e

echo "🔨 Building AgentDeck Linux..."

# Backend
echo "Building backend..."
cd backend
cargo build --release
cd ..

# CLI
echo "Building CLI..."
cd cli
cargo build --release
cd ..

# Dashboard
echo "Building dashboard..."
cd dashboard
pnpm install
pnpm build
cd ..

echo ""
echo "✅ Build complete!"
echo ""
echo "Binaries:"
echo "  target/release/agentdeck-backend"
echo "  target/release/agentdeck"
echo "Dashboard:"
echo "  dashboard/dist/"
