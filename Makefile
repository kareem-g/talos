.PHONY: all install build test clean dev release backend dashboard cli

CARGO_TARGET := target/release
INSTALL_DIR := /usr/local/bin

all: build

install: build
	@echo "Installing AgentDeck Linux..."
	@sudo mkdir -p $(INSTALL_DIR)
	@sudo cp $(CARGO_TARGET)/agentdeck-backend $(INSTALL_DIR)/
	@sudo cp $(CARGO_TARGET)/agentdeck $(INSTALL_DIR)/
	@sudo chmod +x $(INSTALL_DIR)/agentdeck-backend
	@sudo chmod +x $(INSTALL_DIR)/agentdeck
	@echo "✅ Installed to $(INSTALL_DIR)"
	@echo ""
	@echo "Next steps:"
	@echo "  agentdeck daemon start          # Start the daemon"
	@echo "  agentdeck dashboard open        # Open the dashboard"

build: backend dashboard

backend:
	cd backend && cargo build --release

dashboard:
	cd dashboard && pnpm install && pnpm build

cli:
	cd cli && cargo build --release

test:
	cd backend && cargo test
	cd cli && cargo test
	cd shared && cargo test
	cd dashboard && pnpm test

clean:
	cd backend && cargo clean
	cd cli && cargo clean
	cd shared && cargo clean
	cd dashboard && rm -rf node_modules dist

dev:
	@echo "Starting development servers..."
	@make -j2 dev-backend dev-dashboard

dev-backend:
	cd backend && cargo run

dev-dashboard:
	cd dashboard && pnpm dev

release:
	@echo "Building release artifacts..."
	@./scripts/build.sh

package:
	@./scripts/package.sh

eval: cli
	./target/debug/agentdeck eval -s eval/suite.json --agents claude
