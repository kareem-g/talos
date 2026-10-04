/**
 * Remote view / control — the wire contract and the domain shapes.
 *
 * Mirrors `backend/src/remote/protocol.rs` and `types.rs` exactly. The envelope
 * is the same `{"type": "Variant", "payload": {...}}` the rest of the app uses,
 * but on its own socket (`/ws/remote`) so a video frame never competes with the
 * chat stream. Frames ride as base64 JPEG inside a `Frame` message; input,
 * clipboard and metadata are separate message types on the same socket — the
 * logical channels the desktop exposes.
 */

/** Operating system the daemon runs on. */
export type PlatformKind = 'linux' | 'macos'
/** Display server / compositor. On Linux the two need different capture paths. */
export type SessionKind = 'x11' | 'wayland' | 'macos'

/* ── Targets and discovery ───────────────────────────────────────────────── */

export type RemoteTarget =
  | { kind: 'desktop' }
  | { kind: 'display'; id: number }
  | { kind: 'window'; id: number }

export interface DisplayInfo {
  id: number
  name: string
  x: number
  y: number
  width: number
  height: number
  primary: boolean
}

export interface WindowInfo {
  id: number
  display_id: number
  title: string
  app_name: string
  app_id: string | null
  pid: number | null
  process: string | null
  /** Basename of the owning process's working directory, when known. */
  project: string | null
  x: number
  y: number
  width: number
  height: number
  minimized: boolean
  focused: boolean
}

export interface HostInfo {
  name: string
  platform: PlatformKind
  platform_label: string
  session_kind: SessionKind
  session_label: string
  version: string
}

export type PermissionStatus = 'not_required' | 'granted' | 'denied' | 'unknown'

export interface PermissionReport {
  screen_recording: PermissionStatus
  accessibility: PermissionStatus
  input_monitoring: PermissionStatus
  message?: string | null
  settings_hint?: string | null
}

export interface Capabilities {
  platform: PlatformKind
  session_kind: SessionKind
  full_desktop: boolean
  app_view: boolean
  multi_display: boolean
  input: boolean
  clipboard: boolean
  cursor: boolean
  codecs: string[]
  hardware_encode: boolean
  max_fps: number
  max_dimension: number
}

/** A live session as reported by the daemon (also drives the desktop banner). */
export interface RemoteSessionInfo {
  id: string
  device_id: string
  device_name: string
  target: RemoteTarget
  target_label: string
  viewers: number
  started_at: string
  width: number
  height: number
  fps: number
  kbps: number
}

export interface RemoteHostView {
  enabled: boolean
  host: HostInfo
  capabilities: Capabilities
  permissions: PermissionReport
  active_sessions: RemoteSessionInfo[]
}

export interface RemoteTargetsView {
  displays: DisplayInfo[]
  windows: WindowInfo[]
  permissions: PermissionReport
  host: HostInfo
  capabilities: Capabilities
}

/* ── Stream options ──────────────────────────────────────────────────────── */

export interface StreamOptions {
  max_width: number
  quality: number
  max_fps: number
  codec?: string | null
  binary_frames?: boolean
  max_height: number
}

export const DEFAULT_OPTIONS: StreamOptions = {
  max_width: 1600,
  quality: 70,
  max_fps: 24,
  codec: 'jpeg',
  binary_frames: false,
  max_height: 0,
}

/* ── Input ───────────────────────────────────────────────────────────────── */

export type MouseButton = 'left' | 'middle' | 'right'

export interface Modifiers {
  ctrl: boolean
  alt: boolean
  shift: boolean
  meta: boolean
}

export const NO_MODIFIERS: Modifiers = { ctrl: false, alt: false, shift: false, meta: false }

export type NamedKey =
  | 'escape'
  | 'tab'
  | 'enter'
  | 'backspace'
  | 'delete'
  | 'insert'
  | 'home'
  | 'end'
  | 'page_up'
  | 'page_down'
  | 'arrow_up'
  | 'arrow_down'
  | 'arrow_left'
  | 'arrow_right'
  | 'space'
  | 'f1' | 'f2' | 'f3' | 'f4' | 'f5' | 'f6'
  | 'f7' | 'f8' | 'f9' | 'f10' | 'f11' | 'f12'
  | 'super'

export type InputEvent =
  | { kind: 'pointer_move'; x: number; y: number }
  | { kind: 'pointer_move_relative'; dx: number; dy: number }
  | { kind: 'button_down'; button: MouseButton }
  | { kind: 'button_up'; button: MouseButton }
  | { kind: 'click'; button: MouseButton; count: number }
  | { kind: 'scroll'; dx: number; dy: number }
  | { kind: 'key_down'; key: NamedKey; modifiers: Modifiers }
  | { kind: 'key_up'; key: NamedKey }
  /** A single character with modifiers — how shortcuts (Ctrl+C, ⌘V) travel. */
  | { kind: 'chord'; key: string; modifiers: Modifiers }
  | { kind: 'text'; text: string }

/* ── Server → client ─────────────────────────────────────────────────────── */

export interface RemoteFrame {
  seq: number
  width: number
  height: number
  target: RemoteTarget
  codec: string
  keyframe: boolean
  bytes: number
  /** base64 JPEG, renderable as `data:image/jpeg;base64,<data>`. */
  data: string
}

export interface RemoteStreamStats {
  fps: number
  kbps: number
  width: number
  height: number
  quality: number
  frames_dropped: number
}

export type RemoteServerMessage =
  | {
      type: 'Ready'
      payload: {
        session_id: string
        device_id: string
        device_name: string
        host: HostInfo
        capabilities: Capabilities
        permissions: PermissionReport
        target: RemoteTarget
        options: StreamOptions
      }
    }
  | { type: 'TargetChanged'; payload: { target: RemoteTarget; width: number; height: number } }
  | { type: 'Frame'; payload: RemoteFrame }
  | { type: 'StreamStats'; payload: RemoteStreamStats }
  | { type: 'Cursor'; payload: { x: number; y: number; visible: boolean } }
  | {
      type: 'Metadata'
      payload: { host: HostInfo; displays: DisplayInfo[]; windows: WindowInfo[] }
    }
  | { type: 'Snapshot'; payload: { target: RemoteTarget; width: number; height: number; data: string } }
  | { type: 'Clipboard'; payload: { text: string } }
  | { type: 'State'; payload: { state: string; detail?: string | null } }
  | { type: 'PermissionRequired'; payload: { permissions: PermissionReport; message: string } }
  | { type: 'Error'; payload: { code: string; message: string; fatal: boolean } }
  | { type: 'Pong'; payload?: undefined }

export type RemoteClientMessage =
  | { type: 'Authenticate'; payload: { token: string; session_id?: string | null } }
  | { type: 'Start'; payload: { target: RemoteTarget; options: StreamOptions } }
  | { type: 'SwitchTarget'; payload: { target: RemoteTarget } }
  | { type: 'SetQuality'; payload: { options: StreamOptions } }
  | { type: 'Input'; payload: { event: InputEvent } }
  | { type: 'ClipboardGet' }
  | { type: 'ClipboardSet'; payload: { text: string } }
  | { type: 'RequestMetadata' }
  | { type: 'Snapshot'; payload: { target: RemoteTarget; quality: number; max_width: number } }
  | { type: 'Stop' }
  | { type: 'Ping' }

/** Structural guard — unknown-but-well-formed frames pass through untouched. */
export function isRemoteFrame(value: unknown): value is RemoteServerMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { type?: unknown }).type === 'string'
  )
}

/* ── Connection state ────────────────────────────────────────────────────── */

/**
 * The viewer's connection lifecycle. `permission_required` and `unsupported`
 * are distinct states because each gets its own actionable screen — never a
 * spinner that never resolves.
 */
export type RemoteState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'permission_required'
  | 'unauthorized'
  | 'unsupported'
  | 'error'

export const REMOTE_STATE_LABEL: Record<RemoteState, string> = {
  idle: 'Not connected',
  connecting: 'Connecting…',
  connected: 'Connected',
  reconnecting: 'Reconnecting…',
  disconnected: 'Disconnected',
  permission_required: 'Permission required',
  unauthorized: 'Unauthorized',
  unsupported: 'Unsupported platform',
  error: 'Error',
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */

/** Stable key for a target, matching the daemon's `RemoteTarget::key()`. */
export function targetKey(target: RemoteTarget): string {
  switch (target.kind) {
    case 'desktop':
      return 'desktop'
    case 'display':
      return `display:${target.id}`
    case 'window':
      return `window:${target.id}`
  }
}

export function parseTargetKey(key: string): RemoteTarget {
  if (key.startsWith('display:')) return { kind: 'display', id: Number(key.slice('display:'.length)) }
  if (key.startsWith('window:')) return { kind: 'window', id: Number(key.slice('window:'.length)) }
  return { kind: 'desktop' }
}

export function targetLabel(target: RemoteTarget, windows: WindowInfo[] = []): string {
  switch (target.kind) {
    case 'desktop':
      return 'Desktop'
    case 'display':
      return `Display ${target.id + 1}`
    case 'window':
      return windows.find((window) => window.id === target.id)?.app_name ?? `Window ${target.id}`
  }
}