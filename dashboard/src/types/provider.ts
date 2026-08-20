/**
 * Provider contracts — mirrors `backend/src/providers/types.rs`.
 *
 * Three rules carried over from the backend, because breaking them here would
 * undo them everywhere:
 *
 * 1. **Model ids are opaque.** Never parse, split, lowercase, or rebuild one.
 *    Real ids from a user's config include
 *    `localllm/downloaded:Jackrong/MLX-Qwen3.5-4B-…-6bit` — three segments and a
 *    colon. `modelProvider` exists precisely so nothing needs to split `id`.
 * 2. **`undefined` is not `false`.** Capability fields are optional. A missing
 *    value means the provider didn't say, and the UI must not render that as
 *    unsupported.
 * 3. **Config dimensions are data.** There is no model field plus mode field
 *    plus effort field — there is `ConfigOption[]`. A provider that grows a new
 *    dimension appears in the UI with no code change here. (This is not
 *    hypothetical: opencode reports `effort` alongside `model` and `mode`, and
 *    nothing in this codebase knows what effort means.)
 */

/** How the backend drives this provider's process. */
export type Transport = 'acp' | 'stream_json' | 'jsonl' | 'pty'

/** Whether a provider is usable, and if not, what to do about it. */
export type ProviderState =
  | 'ready'
  | 'not_installed'
  | 'auth_required'
  | 'config_required'
  | 'error'

/**
 * Where a piece of discovered information came from. Lets the UI be honest
 * about authority: `agent_handshake` is ground truth, `catalog` is a guess.
 */
export type DiscoverySource =
  | 'agent_handshake'
  | 'cli_command'
  | 'provider_api'
  | 'cli_help'
  | 'user_config'
  | 'catalog'

/** Per-model capabilities. Every field optional — see rule 2. */
export interface ModelCapabilities {
  reasoning?: boolean
  toolCalling?: boolean
  attachments?: boolean
  vision?: boolean
  contextWindow?: number
  maxOutputTokens?: number
  inputTypes?: string[]
  outputTypes?: string[]
}

/** One selectable model. `id` round-trips to the provider byte-for-byte. */
export interface Model {
  id: string
  displayName: string
  /**
   * The *model* provider (ollama, openrouter, a self-hosted endpoint) — not the
   * agent CLI. Present only when the backend could express it. Used for grouping
   * in the picker; never for reconstructing `id`.
   */
  modelProvider?: string
  tag?: string
  source: DiscoverySource
  capabilities?: ModelCapabilities
  metadata?: Record<string, unknown>
}

export type ConfigOptionType = 'select' | 'text' | 'boolean' | 'number'

/** When a dimension can be changed. */
export type ConfigMutability = 'live' | 'next_run' | 'start_only'

export interface ConfigChoice {
  /** Sent back to the provider verbatim. */
  value: string
  name: string
  description?: string
}

/**
 * One dimension of session configuration: model, mode, effort, sandbox, or
 * anything a provider invents. Rendered generically from `optionType`.
 */
export interface ConfigOption {
  /** Provider-native id, passed back on update. */
  id: string
  name: string
  /** Grouping hint ("model", "mode", …). Unfamiliar values must still render. */
  category?: string
  optionType: ConfigOptionType
  currentValue?: string
  choices: ConfigChoice[]
  /**
   * Whether a value outside `choices` is accepted. True for CLIs whose model
   * flag takes any string, which is what keeps an undiscovered model selectable.
   */
  allowsCustomValue: boolean
  mutability: ConfigMutability
}

/** Session-level provider capabilities. Optional for the same reason as models. */
export interface ProviderCapabilities {
  streaming?: boolean
  reasoning?: boolean
  permissions?: boolean
  fileChanges?: boolean
  plans?: boolean
  attachments?: boolean
  terminal?: boolean
  resume?: boolean
  interrupt?: boolean
}

/**
 * A discovered provider. The backend flattens `ProviderState` onto this object,
 * so `state` sits alongside `remedy`/`message` rather than nesting.
 */
export interface Provider {
  id: string
  name: string
  state: ProviderState
  /** Present on every non-ready state: what the user can do about it. */
  remedy?: string
  /** Present on `error`: what went wrong, in the agent's own words. */
  message?: string
  transport: Transport
  executable?: string
  version?: string
  capabilities: ProviderCapabilities
  /** May be empty for providers that only reveal models at session creation. */
  models: Model[]
  modelsSource?: DiscoverySource
  /** Dimensions known before a session exists; the live session is authoritative. */
  configOptions: ConfigOption[]
  userDefined: boolean
  probedAt: string
}

/** `GET /api/providers` */
export interface ProvidersResponse {
  providers: Provider[]
  ready: number
  total: number
}

/**
 * Outcome of a config change. The three cases are distinct on purpose: a picker
 * must never show a change that did not happen.
 */
export type ConfigApplied =
  | { applied: 'immediate' }
  | { applied: 'next_run'; reason: string }
  | { applied: 'unsupported'; reason: string }

/** `GET/PATCH /api/sessions/{id}/config` */
export interface SessionConfig {
  sessionId: string
  agent: string
  transport: Transport
  options: ConfigOption[]
  /**
   * True when these came from a live agent. False means "what the provider
   * offers", which the UI should not present as the agent's current state.
   */
  live: boolean
  /**
   * Whether this session has a pseudo-terminal accepting keystrokes.
   *
   * A session property, not a provider one: the same CLI can run under a PTY or
   * over ACP depending on how it was spawned. Terminal *output* is recorded for
   * every session regardless, so this gates input, not the view.
   */
  interactiveTerminal: boolean
}

export interface ConfigUpdateResponse {
  applied: ConfigApplied
  config: SessionConfig
}

/** Whether a provider can start a session right now. */
export function isUsable(provider: Provider): boolean {
  return provider.state === 'ready'
}

/**
 * The single explanation to show for a non-ready provider. `remedy` is preferred
 * because it names an action; `message` is the fallback for bare errors.
 */
export function providerExplanation(provider: Provider): string | undefined {
  return provider.remedy ?? provider.message
}

/** Find a dimension by id, falling back to category so provider-specific naming still resolves. */
export function findOption(
  options: ConfigOption[],
  idOrCategory: string,
): ConfigOption | undefined {
  return (
    options.find((option) => option.id === idOrCategory) ??
    options.find((option) => option.category === idOrCategory)
  )
}

/**
 * Group models for display. Models without a `modelProvider` land under a single
 * unnamed group so nothing is ever hidden for lacking metadata.
 */
export function groupModels(models: Model[]): Array<{ provider?: string; models: Model[] }> {
  const groups = new Map<string, Model[]>()
  const UNGROUPED = '\u0000'
  for (const model of models) {
    const key = model.modelProvider ?? UNGROUPED
    const existing = groups.get(key)
    if (existing) existing.push(model)
    else groups.set(key, [model])
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([provider, models]) => ({
      provider: provider === UNGROUPED ? undefined : provider,
      models,
    }))
}
