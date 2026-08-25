# Phase 11: Keep Computer Awake

> **Goal**: Prevent the computer from sleeping while AgentDeck has active agents running — no more waking up to find your agents stalled because the laptop went to sleep.

---

## What to Build

A system-level "keep awake" feature that inhibits sleep/suspend while agents are actively working. Simple, reliable, and automatic.

### The Concept

When any session is in a "working" or "running" state, AgentDeck tells the operating system: "Don't sleep, I'm busy." When all sessions are idle for a while, it releases the lock and lets the computer sleep normally.

### Behavior

#### Auto-Enable Conditions
- Any session status is `running`, `starting`, or `resuming`
- Any automation is currently executing
- Any bot is currently running

#### Auto-Disable Conditions
- All sessions have been idle for 5 minutes (configurable)
- No automations or bots running
- User manually disables it

#### Manual Override
- A toggle in Settings: "Keep computer awake while agents are running"
- When ON: the auto behavior above applies
- When OFF: never inhibit sleep (agents may stall if computer sleeps)
- A manual "Keep awake now" button for one-shot use (inhibits for 1 hour)

### Platform Implementation

Each OS has a different mechanism:

- **Linux**: Use systemd's Inhibit interface (logind D-Bus call) or the `systemd-inhibit` command. This covers sleep, suspend, hibernate, and idle.
- **macOS**: Use the `caffeinate` command or IOKit's `IOPMAssertionCreateWithName`.
- **Windows**: Use `SetThreadExecutionState` from the Windows API.

The implementation should be behind a trait/interface so each platform provides its own version. Use conditional compilation (`#[cfg(target_os = "linux")]`, etc.).

### UI Indicators

- A small coffee cup icon in the status bar when awake lock is active
- Tooltip: "Keeping computer awake — 3 sessions active"
- Clicking the icon shows details: what's keeping it awake, time remaining (if manual)
- When the lock releases, a brief notification: "Sleep lock released — all agents idle"

### Settings

In the Settings page, a new "Power" section:
- Toggle: "Keep awake while agents are running" (default: ON)
- Slider: "Idle timeout before releasing" (1-30 minutes, default: 5)
- Checkbox: "Show indicator in status bar" (default: ON)

### Edge Cases

- If AgentDeck crashes, the lock should be released (use a guard pattern — lock is held while the guard object exists, released on drop)
- If the user closes the lid on a laptop, respect that (don't fight the user)
- On desktops with no sleep capability, the feature is a no-op (no error)

---

## Acceptance Criteria

- [ ] Computer stays awake while any agent is running
- [ ] Lock auto-releases after all agents idle for the configured timeout
- [ ] Manual toggle in Settings enables/disables the feature
- [ ] Status bar indicator shows when lock is active
- [ ] Works on Linux (systemd-inhibit or D-Bus)
- [ ] Works on macOS (caffeinate or IOKit)
- [ ] Works on Windows (SetThreadExecutionState)
- [ ] Lock releases cleanly on app exit/crash
- [ ] No-op on systems without sleep capability
