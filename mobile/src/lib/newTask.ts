/**
 * The new-task emitter — a module-level channel, not a React context.
 *
 * WHY THIS EXISTS
 * ---------------
 * The new-task sheet used to be mounted inside the tab navigator and opened
 * through a context callback. On iOS that presentation path is fragile: the
 * sheet's `Modal` is owned by a screen of the tab stack, and a tab-screen
 * modal can fail to present (or present behind the navigator) depending on
 * what else is mounted. The centre FAB is the app's primary verb — it must
 * work from every tab, every screen, every state.
 *
 * So the *intent* ("open new task, optionally pre-seeded") is a plain
 * function call, and the sheet itself is mounted once at the app root by
 * `NewTaskHost`, above the navigator, beside the toast host. Nothing in
 * between can swallow it.
 */

export interface NewTaskRequest {
  agentId?: string
  project?: string
}

type Listener = (request: NewTaskRequest) => void

let listener: Listener | null = null

/** Open the new-task sheet from anywhere — a tab bar, a menu, a row action. */
export function openNewTask(agentId?: string, project?: string): void {
  listener?.({ agentId, project })
}

/** Owned by `NewTaskHost`; nothing else should call this. */
export function setNewTaskListener(next: Listener | null): void {
  listener = next
}
