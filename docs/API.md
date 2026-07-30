# API Reference

## REST Endpoints

### Health
```
GET /health
```
Returns daemon health status.

### Sessions
```
GET    /api/sessions          # List all sessions
POST   /api/sessions          # Create new session
GET    /api/sessions/:id      # Get session details
POST   /api/sessions/:id/attach  # Attach to session
POST   /api/sessions/:id/kill    # Kill session
```

### Agents
```
GET /api/agents            # List available agents
```

### MCP
```
GET    /api/mcp             # List MCP servers
POST   /api/mcp             # Add MCP server
DELETE /api/mcp/:id        # Remove MCP server
POST   /api/mcp/:id/start  # Start MCP server
POST   /api/mcp/:id/stop   # Stop MCP server
```

### Tunnel
```
GET /api/tunnel/status     # Get tunnel status
```

### Pairing
```
POST /api/pair             # Initiate pairing (returns QR data)
POST /api/pair/verify      # Verify pairing with device key
```

## WebSocket Protocol

### Connection
```
ws://localhost:9120/ws
```

### Message Types

#### Client → Server
```json
{
  "type": "Subscribe",
  "payload": {
    "channels": ["sessions", "transcripts"]
  }
}
```

```json
{
  "type": "Input",
  "payload": {
    "session_id": "uuid",
    "data": "yes\n"
  }
}
```

```json
{
  "type": "Command",
  "payload": {
    "action": "approve",
    "params": {
      "request_id": "uuid",
      "approved": true,
      "always": false
    }
  }
}
```

#### Server → Client
```json
{
  "type": "SessionUpdate",
  "payload": {
    "session": {
      "id": "uuid",
      "name": "My Session",
      "agent": "claude",
      "status": "running"
    }
  }
}
```

```json
{
  "type": "TranscriptChunk",
  "payload": {
    "session_id": "uuid",
    "chunk": "I'll help you with that...",
    "kind": "Stdout"
  }
}
```

```json
{
  "type": "ApprovalRequest",
  "payload": {
    "session_id": "uuid",
    "request": {
      "id": "uuid",
      "prompt": "Do you want me to edit src/main.rs?",
      "options": ["Yes", "No", "Always"],
      "risk_level": "Medium"
    }
  }
}
```

```json
{
  "type": "TunnelUpdate",
  "payload": {
    "status": "connected",
    "details": {
      "tailscale": { "ip": "100.x.x.x" },
      "cloudflare": { "url": "https://xxx.trycloudflare.com" }
    }
  }
}
```
