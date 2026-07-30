# MCP (Model Context Protocol)

## Overview

AgentDeck Linux supports MCP servers via Unix domain sockets for efficient inter-process communication.

## Configuration

Add to `~/.config/agentdeck/config.toml`:

```toml
[[mcp.servers]]
name = "filesystem"
command = "npx"
args = ["-y", "@modelcontextprotocol/server-filesystem", "/home/user/docs"]

[[mcp.servers]]
name = "github"
command = "npx"
args = ["-y", "@modelcontextprotocol/server-github"]
env = { GITHUB_PERSONAL_ACCESS_TOKEN = "your-token" }
```

## Management

```bash
# List servers
agentdeck mcp list

# Add server
agentdeck mcp add filesystem "npx -y @modelcontextprotocol/server-filesystem /home/user/docs"

# Start/stop
agentdeck mcp start filesystem
agentdeck mcp stop filesystem
```

## Socket Pool

MCP servers are shared across sessions via Unix domain sockets at `/tmp/agentdeck-mcp-*.sock`.

## Claude Code Integration

AgentDeck automatically configures Claude Code to use the MCP socket pool via environment variables.
