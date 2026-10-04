/**
 * pathBrowser — walking the desktop's filesystem from the phone.
 *
 * A project folder is picked, not typed: the person choosing it knows the name
 * of the directory, not its absolute path. The daemon already exposes
 * `/api/workspace/dirs`, which answers with `$HOME`'s subdirectories, the
 * shortcuts worth offering (`~/Documents`, `~/Projects`, …), the parent to walk
 * up to, and a `roots` list when no path was asked for.
 *
 * This module is the thin state machine over that endpoint: one directory at a
 * time, with a history so "up" and "back" both work, and an explicit failure
 * the sheet can show instead of an empty list.
 */

import * as React from 'react'

import { workspaceApi, type DirEntry, type DirRoot } from './api'

export interface BrowserState {
  /** The directory being shown right now, as the daemon canonicalised it. */
  path: string
  entries: DirEntry[]
  roots: DirRoot[]
  /** Where "up" goes — absent at the filesystem root. */
  parent?: string
  loading: boolean
  /** Set when the daemon refused or the request failed. */
  error?: string
}

export interface PathBrowser extends BrowserState {
  open: boolean
  /** Show a directory (or `$HOME` when called with nothing) and remember where we were. */
  go: (path?: string) => void
  /** Walk up one level. */
  up: () => void
  /** Return to the previous directory visited. */
  back: () => void
  canGoBack: boolean
  /** Start over: clear history and reload `$HOME`. */
  reset: () => void
}

/**
 * The browser's state. It keeps its own history rather than leaning on the
 * navigation stack: a folder walk is a detail *inside* one sheet step, and
 * pushing screens for it would put the phone's back gesture in charge of it.
 */
export function usePathBrowser(): PathBrowser {
  const [open, setOpen] = React.useState(false)
  const [state, setState] = React.useState<BrowserState>({
    path: '',
    entries: [],
    roots: [],
    loading: false,
  })
  const [history, setHistory] = React.useState<string[]>([])
  // Guards against a slow listing for a folder the user already walked away
  // from landing after a newer one.
  const requestId = React.useRef(0)

  const load = React.useCallback(async (path?: string) => {
    const id = ++requestId.current
    setState((current) => ({ ...current, loading: true, error: undefined }))
    try {
      const listing = await workspaceApi.dirs(path)
      if (id !== requestId.current) return
      setState({
        path: listing.path,
        entries: listing.entries ?? [],
        roots: listing.roots ?? [],
        parent: listing.parent,
        loading: false,
        error: listing.exists === false ? 'That folder is not on the desktop.' : undefined,
      })
    } catch (cause) {
      if (id !== requestId.current) return
      setState((current) => ({
        ...current,
        loading: false,
        entries: [],
        error: cause instanceof Error ? cause.message : 'Could not read that folder.',
      }))
    }
  }, [])

  const go = React.useCallback(
    (path?: string) => {
      setOpen(true)
      setHistory((current) => (state.path ? [...current, state.path] : current))
      void load(path)
    },
    [load, state.path],
  )

  const up = React.useCallback(() => {
    if (!state.parent) return
    setHistory((current) => [...current, state.path])
    void load(state.parent)
  }, [load, state.parent, state.path])

  const back = React.useCallback(() => {
    setHistory((current) => {
      if (current.length === 0) return current
      const previous = current[current.length - 1]
      void load(previous)
      return current.slice(0, -1)
    })
  }, [load])

  const reset = React.useCallback(() => {
    setOpen(false)
    setHistory([])
    setState({ path: '', entries: [], roots: [], loading: false })
  }, [])

  return { ...state, open, go, up, back, canGoBack: history.length > 0, reset }
}