/**
 * Remote helpers — pure functions over normalized remote model.
 *
 * No React, no I/O. Keeps derivation testable and keeps components thin.
 */

import type { Conversation } from '@/types/conversation'
import type { ConnectionState } from '@/types/protocol'
import type { Provider } from '@/types/provider'
import type { Session } from '@/types/session'
import { agentStateDisplay, deriveAgentState, type AgentState } from '@/types/remote'

/** Derive + display in one call for the top bar. */
export function agentDisplayFor(
  session: Session,
  conversation: Conversation | undefined,
  connection: ConnectionState,
): { state: AgentState; label: string; detail?: string; tone: 'green' | 'orange' | 'red' | 'dim'; pulse: boolean } {
  const state = deriveAgentState(session, conversation?.activity, connection)
  const detail = conversation?.activity?.detail ?? undefined
  const display = agentStateDisplay(state, detail)
  // Prefer live activity detail when available; otherwise use state label only.
  // For working/editing/running, the detail is the file/command.
  return { state, ...display }
}

/** Short provider label with fallback — no hardcoding. */
export function providerLabel(provider: Provider | undefined, fallbackAgent: string): string {
  return provider?.name ?? fallbackAgent
}

/** Model label for top bar chip — opaque id never split. */
export function modelChipLabel(
  provider: Provider | undefined,
  currentValue?: string,
): string | undefined {
  if (currentValue && currentValue.trim().length > 0) {
    // Prefer choice display name if known
    const choiceName = provider?.configOptions
      .flatMap((o) => o.choices)
      .find((c) => c.value === currentValue)?.name
    return choiceName ?? truncateModelId(currentValue)
  }
  // Fallback to provider model displayName for common case
  const modelOption = provider?.configOptions.find((o) => o.id === 'model' || o.category === 'model')
  if (modelOption?.currentValue) {
    const choiceName = modelOption.choices.find((c) => c.value === modelOption.currentValue)?.name
    return choiceName ?? truncateModelId(modelOption.currentValue)
  }
  if (provider?.models.length === 1) return provider.models[0].displayName
  return undefined
}

function truncateModelId(id: string): string {
  // Show last segment after slash for readability, but keep full id on hover via title attr
  const slash = id.lastIndexOf('/')
  if (slash !== -1 && slash < id.length - 1) return id.slice(slash + 1)
  if (id.length > 28) return `${id.slice(0, 26)}…`
  return id
}

/** Project breadcrumb: `projectBasename / sessionName` */
export function sessionBreadcrumb(session: Session): { project: string; session: string } {
  const project = session.project ? session.project.split('/').pop() ?? session.project : 'No project'
  return { project, session: session.name }
}

/** Connection pill label helper matching App.tsx but reusable. */
export function connectionLabel(state: ConnectionState): string {
  switch (state) {
    case 'idle':
      return 'Offline'
    case 'connecting':
      return 'Connecting'
    case 'connected':
      return 'Connected'
    case 'reconnecting':
      return 'Reconnecting'
    case 'disconnected':
      return 'Disconnected'
    case 'offline':
      return 'Offline'
    case 'unauthorized':
      return 'Not paired'
    case 'error':
      return 'Connection error'
  }
}
