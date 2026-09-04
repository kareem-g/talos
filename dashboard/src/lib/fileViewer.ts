/**
 * fileViewer — which workspace file the right pane is showing.
 *
 * The right rail's tab strip is id-only (`openTab(id)` carries no payload),
 * so the open file lives here instead: the sidebar tree (or a timeline file
 * chip, later) publishes `{ project, path }` and the File tab subscribes.
 * One file at a time, like an editor preview tab — opening another replaces
 * it. The `nonce` re-triggers the fetch even when re-opening the same path.
 */

import { useSyncExternalStore } from 'react'

export interface OpenFile {
  project: string
  /** Absolute path, as returned by the dirs listing. */
  path: string
  name: string
  nonce: number
}

let current: OpenFile | null = null
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

export function openFile(project: string, path: string): void {
  const name = path.split('/').pop() ?? path
  current = { project, path, name, nonce: (current?.nonce ?? 0) + 1 }
  emit()
}

export function closeFile(): void {
  current = null
  emit()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function snapshot(): OpenFile | null {
  return current
}

export function useOpenFile(): OpenFile | null {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}
