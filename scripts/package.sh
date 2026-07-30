#!/bin/bash
set -e

VERSION=$(grep '^version' Cargo.toml | head -1 | cut -d'"' -f2)
ARCH=$(uname -m)
PKG_NAME="agentdeck-linux-${VERSION}-${ARCH}"

echo "📦 Packaging AgentDeck Linux v${VERSION}..."

# Create package directory
rm -rf "dist/$PKG_NAME"
mkdir -p "dist/$PKG_NAME"

# Copy binaries
cp target/release/agentdeck-backend "dist/$PKG_NAME/"
cp target/release/agentdeck "dist/$PKG_NAME/"

# Copy dashboard
cp -r dashboard/dist "dist/$PKG_NAME/dashboard"

# Copy scripts
cp scripts/install.sh "dist/$PKG_NAME/"
cp scripts/setup-tailscale.sh "dist/$PKG_NAME/"
cp scripts/setup-cloudflare.sh "dist/$PKG_NAME/"
cp config/default.toml "dist/$PKG_NAME/"
cp config/systemd/agentdeck.service "dist/$PKG_NAME/"

# Copy docs
cp README.md "dist/$PKG_NAME/"
cp LICENSE "dist/$PKG_NAME/"

# Create tarball
cd dist
tar czf "${PKG_NAME}.tar.gz" "$PKG_NAME"
cd ..

echo "✅ Package created: dist/${PKG_NAME}.tar.gz"

# Create checksums
cd dist
sha256sum "${PKG_NAME}.tar.gz" > "${PKG_NAME}.tar.gz.sha256"
cd ..

echo "✅ Checksum: dist/${PKG_NAME}.tar.gz.sha256"
