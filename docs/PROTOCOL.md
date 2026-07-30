# Protocol Specification

## Frame Format

All messages are JSON-encoded WebSocket frames with the following structure:

```
{
  "type": "<message_type>",
  "payload": { ... },
  "timestamp": "2026-01-01T00:00:00Z",
  "nonce": "<uuid>"
}
```

## Authentication

1. **Pairing**: Server generates QR code with ephemeral public key
2. **Verification**: Client scans QR, performs X25519 key exchange
3. **Session**: Client receives bearer token for subsequent requests
4. **WebSocket**: Token passed as query parameter `?token=...`

## Security Invariants

- No privileged daemon, no root
- No public exposure by default
- No secrets in logs or notifications
- No unrestricted auto-approval
- Every integration is explicit and reversible
