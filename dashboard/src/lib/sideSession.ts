/**
 * Side sessions — one parallel chat per project, opened with `/side <prompt>`
 * and pinged with `/btw <note>` from any session in that project.
 *
 * The per-project id is pinned in localStorage so `/side` from any session in
 * the same workspace (main chat, room channel, another side) keeps routing to
 * the same thread. This module is shared by the desktop workspace (which opens
 * the side thread in the right rail) and mobile (which navigates to it).
 */

const SIDE_KEY = (project?: string | null) => `agentdeck-side-session-${project ?? 'default'}`

export function getSideSessionId(project?: string | null): string | null {
  try {
    return localStorage.getItem(SIDE_KEY(project))
  } catch {
    return null
  }
}

export function setSideSessionId(project: string | null | undefined, id: string): void {
  try {
    localStorage.setItem(SIDE_KEY(project), id)
  } catch {
    /* storage may be unavailable */
  }
}
