import type { ChatItem } from '../lib/chatItems'

export interface ResumeAssessment {
  /** Whether the session is in a state that can be resumed. */
  showResume: boolean
  /** The command to display (read-only). Computed client-side when the backend
   *  has not populated one. */
  resumeCommand: string | undefined
}

const RESUME_HINT = /Resume\s+this\s+session\s+with:\s*([\s\S]*?claude\s+--resume\s+([^\s\n]+)[^\n]*)/i

/**
 * Detects the Claude CLI's literal resume hint in raw terminal output.
 *
 * When a Claude session can be resumed, the CLI prints something like:
 *   Resume this session with:
 *   claude --resume <session-id>
 * This parses that block and returns the command + session id so the UI can
 * offer a Resume action even when the backend hasn't (yet) set `needs_resume`.
 */
export function detectResumeHint(rawOutput: string): { command: string; sessionId: string } | null {
  if (!rawOutput) return null
  const match = RESUME_HINT.exec(rawOutput)
  if (!match) return null
  return { command: match[1].trim(), sessionId: match[2].trim() }
}

/**
 * Determines whether to show a Resume action for a session and what command to
 * display.
 *
 * Prefers the authoritative `needs_resume` status the backend sets when it
 * detects a resumable claude session ending. As a fallback for sessions that
 * exited before that detection ran (or where the live event was missed), it
 * treats any exited/idle claude session with prior conversation history as
 * resumable — constructing the command client-side. This uses only structured
 * state (agent + history), never terminal-text parsing.
 */
export function assessResumable(
  status: string,
  agent: string | undefined,
  resumeCommand: string | undefined,
  history: ChatItem[],
  rawOutput?: string,
): ResumeAssessment {
  const agentId = (agent || 'agent').toLowerCase()
  const isClaude = agentId.includes('claude')

  if (status === 'needs_resume') {
    return { showResume: true, resumeCommand: resumeCommand || `claude --resume <session>` }
  }

  // The CLI explicitly tells us the session is resumable. Trust that hint so
  // the Resume action appears even if the backend status is still stale.
  const hint = detectResumeHint(rawOutput || '')
  if (hint) {
    return { showResume: true, resumeCommand: hint.command }
  }

  const isTerminal = status === 'exited' || status === 'idle' || status === 'stopped'
  if (isTerminal && isClaude && history.length > 0) {
    const command = resumeCommand || `claude --resume <session>`
    return { showResume: true, resumeCommand: command }
  }

  return { showResume: false, resumeCommand: undefined }
}
