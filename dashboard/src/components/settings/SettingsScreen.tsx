/**
 * SettingsScreen — the small print: how the station works, what it can do,
 * and where the levers live. Deliberately short; configuration that matters
 * day-to-day (models, modes) lives in the session workspace instead.
 */

import { useEffect, useState } from 'react'
import { Chip, Dots, SectionLabel } from '../ui'

interface SettingsInfo {
  config_path?: string
}

function useSettings(): SettingsInfo | undefined {
  const [info, setInfo] = useState<SettingsInfo>()
  useEffect(() => {
    let cancelled = false
    fetch('/api/settings')
      .then((response) => response.json())
      .then((body: { settings?: unknown; config_path?: string }) => {
        if (!cancelled) setInfo({ config_path: body.config_path })
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])
  return info
}

const SHORTCUTS: Array<[string, string]> = [
  ['⌘/Ctrl + N', 'New session'],
  ['⌘/Ctrl + K', 'Focus search'],
  ['Esc', 'Close panel / back'],
]

export function SettingsScreen() {
  const info = useSettings()

  return (
    <div className="scroll-thin min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 pb-24 pt-5 sm:px-6 lg:pb-6">
        <div>
          <h1 className="text-[16px] font-semibold tracking-[-0.01em] text-ink">Settings</h1>
          <p className="mt-0.5 text-[12px] leading-[1.6] text-ink-3">
            AgentDeck runs coding agents on this machine and lets you drive them from anywhere.
          </p>
        </div>

        <SectionLabel>How it works</SectionLabel>
        <section className="rounded-card border border-line bg-surface p-3.5 shadow-card">
          <ol className="flex flex-col gap-2 text-[12px] leading-[1.6] text-ink-2">
            <li className="flex gap-2">
              <span className="font-mono text-[11px] text-accent-ink">01</span>
              Install an agent CLI (Claude Code, Codex, OpenCode, Grok Build…) — AgentDeck detects
              it automatically.
            </li>
            <li className="flex gap-2">
              <span className="font-mono text-[11px] text-accent-ink">02</span>
              Start sessions here at the desk; watch tool calls, diffs, and approvals stream live.
            </li>
            <li className="flex gap-2">
              <span className="font-mono text-[11px] text-accent-ink">03</span>
              Scan the pairing QR from Remote — your phone becomes a remote control over Tailnet,
              Cloudflare, or LAN. Leave the machine running.
            </li>
          </ol>
        </section>

        <SectionLabel>Keyboard</SectionLabel>
        <section className="flex flex-col rounded-card border border-line bg-surface shadow-card">
          {SHORTCUTS.map(([keys, action]) => (
            <div key={keys} className="flex items-center justify-between border-b border-line px-3.5 py-2 last:border-b-0">
              <span className="text-[12px] text-ink-2">{action}</span>
              <Chip mono>{keys}</Chip>
            </div>
          ))}
        </section>

        <SectionLabel>Machine</SectionLabel>
        <section className="rounded-card border border-line bg-surface p-3.5 shadow-card">
          {info === undefined ? (
            <Dots />
          ) : (
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12px] text-ink-2">Config file</span>
              <code className="min-w-0 truncate font-mono text-[11px] text-ink-3">
                {info.config_path ?? '~/.config/agentdeck/config.toml'}
              </code>
            </div>
          )}
          <p className="mt-2 text-[11px] leading-[1.6] text-ink-3">
            Tunnels, MCP servers, worktrees, and notification channels are configured in the TOML
            file — see docs/TUNNELS.md and docs/MCP.md in the repository.
          </p>
        </section>
      </div>
    </div>
  )
}
