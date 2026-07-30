# Security

## Threat Model

| Threat | Vector | Mitigation |
|--------|--------|------------|
| Stolen paired device | Physical access | Per-device keys; revocation kills credentials |
| Compromised account | Malware | Approval engine scopes actions; audit trail |
| MITM | Untrusted network | TLS + pinning; signed frames |
| Replay attacks | Reused frames | Per-frame nonce + replay cache |
| QR interception | Attacker scans first | Fingerprint + verification phrase |
| Malicious repository | Poisoned project files | Project allowlist; path checks |
| Command injection | Crafted paths | No shell interpolation; safe filenames |
| Path traversal | Crafted paths | Canonical path checks |

## Secrets Handling

- Private keys stored in `~/.config/agentdeck/keys/` (0700)
- Database at `~/.local/share/agentdeck/agentdeck.db` (0600)
- Tokens auto-generated, never logged
- Clipboard sync is opt-in and per-session
