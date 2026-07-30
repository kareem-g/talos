import { useState, useEffect } from 'react'
import { 
  Settings as SettingsIcon, 
  Save, 
  RotateCcw, 
  Server, 
  Shield, 
  Globe, 
  Bot, 
  GitBranch, 
  Puzzle, 
  Bell, 
  Palette,
  Check,
  AlertCircle,
  Eye,
  EyeOff
} from 'lucide-react'

interface SettingSection {
  id: string
  title: string
  description: string
  icon: React.ElementType
}

const sections: SettingSection[] = [
  { id: 'server', title: 'Server', description: 'Host, port, and network', icon: Server },
  { id: 'security', title: 'Security', description: 'Auth, pairing, and TLS', icon: Shield },
  { id: 'agents', title: 'Agents', description: 'Binary paths and detection', icon: Bot },
  { id: 'tunnel', title: 'Tunnels', description: 'Tailscale and Cloudflare', icon: Globe },
  { id: 'worktree', title: 'Worktrees', description: 'Git worktree settings', icon: GitBranch },
  { id: 'mcp', title: 'MCP', description: 'Model Context Protocol servers', icon: Puzzle },
  { id: 'notifications', title: 'Notifications', description: 'Telegram, Slack, Discord, Email', icon: Bell },
  { id: 'theme', title: 'Theme', description: 'Colors and appearance', icon: Palette },
]

export function Settings() {
  const [activeSection, setActiveSection] = useState('server')
  const [settings, setSettings] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [showToken, setShowToken] = useState(false)

  useEffect(() => {
    fetchSettings()
  }, [])

  const fetchSettings = async () => {
    try {
      const res = await fetch('/api/settings')
      const data = await res.json()
      setSettings(data.settings)
    } catch {
      // Fallback defaults
      setSettings({
        server: { host: '0.0.0.0', port: 9120, bind_interface: null },
        security: { auto_pair: true, auth_token: '', tls_enabled: true },
        agents: { claude: { path: 'claude' }, codex: { path: 'codex' }, opencode: { path: 'opencode' }, auto_detect: true },
        tunnel: { tailscale: { enabled: false, hostname: 'agentdeck' }, cloudflare: { enabled: false } },
        worktree: { enabled: true, base_dir: '~/.agentdeck/worktrees', auto_merge: false },
        mcp: { servers: [], socket_pool_enabled: true },
        notifications: { telegram: { enabled: false }, slack: { enabled: false }, discord: { enabled: false }, email: { enabled: false } },
        theme: { default: 'tokyo-night' },
      })
    } finally {
      setLoading(false)
    }
  }

  const updateSetting = (section: string, key: string, value: any) => {
    setSettings((prev: any) => ({
      ...prev,
      [section]: {
        ...prev[section],
        [key]: value,
      },
    }))
    setSaveStatus('idle')
  }

  const updateNestedSetting = (section: string, nested: string, key: string, value: any) => {
    setSettings((prev: any) => ({
      ...prev,
      [section]: {
        ...prev[section],
        [nested]: {
          ...prev[section][nested],
          [key]: value,
        },
      },
    }))
    setSaveStatus('idle')
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })
      if (res.ok) {
        setSaveStatus('success')
        setTimeout(() => setSaveStatus('idle'), 3000)
      } else {
        setSaveStatus('error')
      }
    } catch {
      setSaveStatus('error')
    } finally {
      setSaving(false)
    }
  }

  const handleReset = () => {
    if (confirm('Reset all settings to defaults?')) {
      fetchSettings()
      setSaveStatus('idle')
    }
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="animate-spin w-6 h-6 border-2 border-accent border-t-transparent rounded-full" />
      </div>
    )
  }

  const SectionIcon = sections.find(s => s.id === activeSection)?.icon || Server

  return (
    <div className="flex-1 flex min-w-0">
      {/* Settings Sidebar */}
      <div className="w-60 border-r border-border bg-surface shrink-0">
        <div className="p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <SettingsIcon className="w-4 h-4 text-accent" />
            <h2 className="text-sm font-semibold">Settings</h2>
          </div>
        </div>
        <div className="p-2 space-y-0.5">
          {sections.map((section) => (
            <button
              key={section.id}
              onClick={() => setActiveSection(section.id)}
              className={`w-full text-left px-3 py-2.5 rounded-md text-sm transition-colors ${
                activeSection === section.id
                  ? 'bg-accent/10 text-accent'
                  : 'text-text-muted hover:text-text hover:bg-surface-hover'
              }`}
            >
              <div className="flex items-center gap-2">
                <section.icon className="w-4 h-4 shrink-0" />
                <div>
                  <div className="font-medium">{section.title}</div>
                  <div className="text-[11px] text-text-dim mt-0.5">{section.description}</div>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Settings Content */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="h-12 border-b border-border flex items-center px-4 justify-between shrink-0">
          <div className="flex items-center gap-2">
            <SectionIcon className="w-4 h-4 text-accent" />
            <h3 className="text-sm font-medium capitalize">{activeSection}</h3>
          </div>
          <div className="flex items-center gap-2">
            {saveStatus === 'success' && (
              <span className="flex items-center gap-1 text-xs text-success">
                <Check className="w-3 h-3" /> Saved
              </span>
            )}
            {saveStatus === 'error' && (
              <span className="flex items-center gap-1 text-xs text-error">
                <AlertCircle className="w-3 h-3" /> Failed
              </span>
            )}
            <button
              onClick={handleReset}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-surface-hover hover:bg-surface-active text-text-muted text-xs transition-colors"
            >
              <RotateCcw className="w-3 h-3" />
              Reset
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent hover:bg-accent-hover disabled:opacity-50 text-white text-xs font-medium transition-colors"
            >
              <Save className="w-3 h-3" />
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-6">
          <div className="max-w-2xl space-y-6">
            {/* SERVER */}
            {activeSection === 'server' && (
              <>
                <SettingGroup title="Network">
                  <SettingInput
                    label="Host"
                    value={settings?.server?.host || '0.0.0.0'}
                    onChange={(v) => updateSetting('server', 'host', v)}
                    description="Bind address (0.0.0.0 for all interfaces)"
                  />
                  <SettingInput
                    label="Port"
                    type="number"
                    value={String(settings?.server?.port || 9120)}
                    onChange={(v) => updateSetting('server', 'port', parseInt(v))}
                    description="Dashboard and API port"
                  />
                  <SettingInput
                    label="Bind Interface"
                    value={settings?.server?.bind_interface || ''}
                    onChange={(v) => updateSetting('server', 'bind_interface', v || null)}
                    placeholder="e.g. tailscale0"
                    description="Optional: bind to specific network interface"
                  />
                </SettingGroup>
              </>
            )}

            {/* SECURITY */}
            {activeSection === 'security' && (
              <>
                <SettingGroup title="Authentication">
                  <SettingToggle
                    label="Auto Pairing"
                    enabled={settings?.security?.auto_pair}
                    onChange={(v) => updateSetting('security', 'auto_pair', v)}
                    description="Allow new devices to pair automatically"
                  />
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-text-muted">Auth Token</label>
                    <div className="flex gap-2">
                      <input
                        type={showToken ? 'text' : 'password'}
                        value={settings?.security?.auth_token || ''}
                        onChange={(e) => updateSetting('security', 'auth_token', e.target.value || null)}
                        placeholder="Leave empty for auto-generated"
                        className="flex-1 px-3 py-2 rounded-md bg-terminal-bg border border-border text-sm text-text outline-none focus:border-accent"
                      />
                      <button
                        onClick={() => setShowToken(!showToken)}
                        className="p-2 rounded-md bg-surface-hover text-text-muted hover:text-text"
                      >
                        {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    <p className="text-[11px] text-text-dim">Token for LAN client authentication</p>
                  </div>
                </SettingGroup>
                <SettingGroup title="TLS">
                  <SettingToggle
                    label="Enable TLS"
                    enabled={settings?.security?.tls_enabled}
                    onChange={(v) => updateSetting('security', 'tls_enabled', v)}
                    description="Use HTTPS/WSS with auto-generated certificates"
                  />
                </SettingGroup>
              </>
            )}

            {/* AGENTS */}
            {activeSection === 'agents' && (
              <>
                <SettingGroup title="Agent Binaries">
                  <SettingToggle
                    label="Auto Detect"
                    enabled={settings?.agents?.auto_detect}
                    onChange={(v) => updateSetting('agents', 'auto_detect', v)}
                    description="Automatically detect installed agent CLIs"
                  />
                  <SettingInput
                    label="Claude Code Path"
                    value={settings?.agents?.claude?.path || 'claude'}
                    onChange={(v) => updateNestedSetting('agents', 'claude', 'path', v)}
                  />
                  <SettingInput
                    label="Codex CLI Path"
                    value={settings?.agents?.codex?.path || 'codex'}
                    onChange={(v) => updateNestedSetting('agents', 'codex', 'path', v)}
                  />
                  <SettingInput
                    label="OpenCode Path"
                    value={settings?.agents?.opencode?.path || 'opencode'}
                    onChange={(v) => updateNestedSetting('agents', 'opencode', 'path', v)}
                  />
                </SettingGroup>
              </>
            )}

            {/* TUNNEL */}
            {activeSection === 'tunnel' && (
              <>
                <SettingGroup title="Tailscale">
                  <SettingToggle
                    label="Enable Tailscale"
                    enabled={settings?.tunnel?.tailscale?.enabled}
                    onChange={(v) => updateNestedSetting('tunnel', 'tailscale', 'enabled', v)}
                    description="Bind to Tailscale network interface"
                  />
                  <SettingInput
                    label="Hostname"
                    value={settings?.tunnel?.tailscale?.hostname || 'agentdeck'}
                    onChange={(v) => updateNestedSetting('tunnel', 'tailscale', 'hostname', v)}
                  />
                  <SettingToggle
                    label="Auto Connect"
                    enabled={settings?.tunnel?.tailscale?.auto_connect}
                    onChange={(v) => updateNestedSetting('tunnel', 'tailscale', 'auto_connect', v)}
                    description="Automatically connect Tailscale on startup"
                  />
                </SettingGroup>
                <SettingGroup title="Cloudflare">
                  <SettingToggle
                    label="Enable Cloudflare"
                    enabled={settings?.tunnel?.cloudflare?.enabled}
                    onChange={(v) => updateNestedSetting('tunnel', 'cloudflare', 'enabled', v)}
                    description="Use Cloudflare Tunnel for public access"
                  />
                  <SettingInput
                    label="Token"
                    type="password"
                    value={settings?.tunnel?.cloudflare?.token || ''}
                    onChange={(v) => updateNestedSetting('tunnel', 'cloudflare', 'token', v || null)}
                    placeholder="Cloudflare tunnel token"
                  />
                  <SettingInput
                    label="Hostname"
                    value={settings?.tunnel?.cloudflare?.hostname || ''}
                    onChange={(v) => updateNestedSetting('tunnel', 'cloudflare', 'hostname', v || null)}
                    placeholder="agentdeck.yourdomain.com"
                  />
                </SettingGroup>
              </>
            )}

            {/* WORKTREE */}
            {activeSection === 'worktree' && (
              <>
                <SettingGroup title="Git Worktrees">
                  <SettingToggle
                    label="Enable Worktrees"
                    enabled={settings?.worktree?.enabled}
                    onChange={(v) => updateSetting('worktree', 'enabled', v)}
                    description="Create isolated git worktrees per session"
                  />
                  <SettingInput
                    label="Base Directory"
                    value={settings?.worktree?.base_dir || '~/.agentdeck/worktrees'}
                    onChange={(v) => updateSetting('worktree', 'base_dir', v)}
                  />
                  <SettingToggle
                    label="Auto Create"
                    enabled={settings?.worktree?.auto_create_on_session}
                    onChange={(v) => updateSetting('worktree', 'auto_create_on_session', v)}
                    description="Automatically create worktree on new session"
                  />
                  <SettingToggle
                    label="Auto Merge"
                    enabled={settings?.worktree?.auto_merge}
                    onChange={(v) => updateSetting('worktree', 'auto_merge', v)}
                    description="Auto-merge worktree when session completes"
                  />
                </SettingGroup>
              </>
            )}

            {/* MCP */}
            {activeSection === 'mcp' && (
              <>
                <SettingGroup title="MCP Servers">
                  <SettingToggle
                    label="Socket Pool"
                    enabled={settings?.mcp?.socket_pool_enabled}
                    onChange={(v) => updateSetting('mcp', 'socket_pool_enabled', v)}
                    description="Share MCP servers across sessions via Unix sockets"
                  />
                  <SettingToggle
                    label="Auto Start"
                    enabled={settings?.mcp?.auto_start}
                    onChange={(v) => updateSetting('mcp', 'auto_start', v)}
                    description="Start MCP servers automatically on daemon start"
                  />
                </SettingGroup>
              </>
            )}

            {/* NOTIFICATIONS */}
            {activeSection === 'notifications' && (
              <>
                <SettingGroup title="Telegram">
                  <SettingToggle
                    label="Enable Telegram"
                    enabled={settings?.notifications?.telegram?.enabled}
                    onChange={(v) => updateNestedSetting('notifications', 'telegram', 'enabled', v)}
                  />
                  <SettingInput
                    label="Bot Token"
                    type="password"
                    value={settings?.notifications?.telegram?.bot_token || ''}
                    onChange={(v) => updateNestedSetting('notifications', 'telegram', 'bot_token', v || null)}
                  />
                  <SettingInput
                    label="Chat ID"
                    value={settings?.notifications?.telegram?.chat_id || ''}
                    onChange={(v) => updateNestedSetting('notifications', 'telegram', 'chat_id', v || null)}
                  />
                </SettingGroup>
                <SettingGroup title="Slack">
                  <SettingToggle
                    label="Enable Slack"
                    enabled={settings?.notifications?.slack?.enabled}
                    onChange={(v) => updateNestedSetting('notifications', 'slack', 'enabled', v)}
                  />
                  <SettingInput
                    label="Webhook URL"
                    type="password"
                    value={settings?.notifications?.slack?.webhook_url || ''}
                    onChange={(v) => updateNestedSetting('notifications', 'slack', 'webhook_url', v || null)}
                  />
                  <SettingInput
                    label="Channel"
                    value={settings?.notifications?.slack?.channel || ''}
                    onChange={(v) => updateNestedSetting('notifications', 'slack', 'channel', v || null)}
                    placeholder="#agentdeck"
                  />
                </SettingGroup>
                <SettingGroup title="Discord">
                  <SettingToggle
                    label="Enable Discord"
                    enabled={settings?.notifications?.discord?.enabled}
                    onChange={(v) => updateNestedSetting('notifications', 'discord', 'enabled', v)}
                  />
                  <SettingInput
                    label="Webhook URL"
                    type="password"
                    value={settings?.notifications?.discord?.webhook_url || ''}
                    onChange={(v) => updateNestedSetting('notifications', 'discord', 'webhook_url', v || null)}
                  />
                </SettingGroup>
                <SettingGroup title="Email">
                  <SettingToggle
                    label="Enable Email"
                    enabled={settings?.notifications?.email?.enabled}
                    onChange={(v) => updateNestedSetting('notifications', 'email', 'enabled', v)}
                  />
                  <SettingInput
                    label="SMTP Host"
                    value={settings?.notifications?.email?.smtp_host || ''}
                    onChange={(v) => updateNestedSetting('notifications', 'email', 'smtp_host', v || null)}
                    placeholder="smtp.gmail.com"
                  />
                  <SettingInput
                    label="SMTP Port"
                    type="number"
                    value={String(settings?.notifications?.email?.smtp_port || 587)}
                    onChange={(v) => updateNestedSetting('notifications', 'email', 'smtp_port', parseInt(v))}
                  />
                  <SettingInput
                    label="SMTP User"
                    value={settings?.notifications?.email?.smtp_user || ''}
                    onChange={(v) => updateNestedSetting('notifications', 'email', 'smtp_user', v || null)}
                  />
                  <SettingInput
                    label="SMTP Password"
                    type="password"
                    value={settings?.notifications?.email?.smtp_pass || ''}
                    onChange={(v) => updateNestedSetting('notifications', 'email', 'smtp_pass', v || null)}
                  />
                </SettingGroup>
              </>
            )}

            {/* THEME */}
            {activeSection === 'theme' && (
              <>
                <SettingGroup title="Appearance">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-text-muted">Default Theme</label>
                    <select
                      value={settings?.theme?.default || 'tokyo-night'}
                      onChange={(e) => updateNestedSetting('theme', 'theme', 'default', e.target.value)}
                      className="w-full px-3 py-2 rounded-md bg-terminal-bg border border-border text-sm text-text outline-none focus:border-accent"
                    >
                      <option value="tokyo-night">Tokyo Night</option>
                      <option value="nord">Nord</option>
                      <option value="catppuccin">Catppuccin</option>
                      <option value="solarized-dark">Solarized Dark</option>
                      <option value="solarized-light">Solarized Light</option>
                      <option value="dracula">Dracula</option>
                      <option value="one-dark">One Dark</option>
                    </select>
                  </div>
                </SettingGroup>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// --- Sub-components ---

function SettingGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider">{title}</h4>
      <div className="space-y-3 p-4 rounded-lg border border-border bg-surface">
        {children}
      </div>
    </div>
  )
}

function SettingInput({ 
  label, 
  value, 
  onChange, 
  type = 'text',
  placeholder,
  description 
}: { 
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  placeholder?: string
  description?: string
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-text-muted">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 rounded-md bg-terminal-bg border border-border text-sm text-text outline-none focus:border-accent transition-colors"
      />
      {description && <p className="text-[11px] text-text-dim">{description}</p>}
    </div>
  )
}

function SettingToggle({ 
  label, 
  enabled, 
  onChange, 
  description 
}: { 
  label: string
  enabled: boolean
  onChange: (v: boolean) => void
  description?: string
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="space-y-0.5">
        <label className="text-sm font-medium text-text">{label}</label>
        {description && <p className="text-[11px] text-text-dim">{description}</p>}
      </div>
      <button
        onClick={() => onChange(!enabled)}
        className={`relative w-10 h-5 rounded-full transition-colors ${
          enabled ? 'bg-accent' : 'bg-surface-hover'
        }`}
      >
        <div
          className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
            enabled ? 'left-5' : 'left-0.5'
          }`}
        />
      </button>
    </div>
  )
}
