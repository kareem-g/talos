/**
 * DirPicker — pick a project directory by browsing, not by typing a path.
 *
 * Typing absolute paths from memory is where sessions die: one wrong segment
 * and the agent starts somewhere useless. The picker lists real subdirectories
 * from the daemon (`GET /api/workspace/dirs`), supports up-navigation, and
 * offers common roots (~/Documents, ~/projects…) as shortcuts.
 */

import { useCallback, useEffect, useState } from 'react'
import { Button, Chip, Dots, Layer, Row } from './ui'
import { workspaceApi, type DirListing } from '@/lib/api'

function FolderGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  )
}

export function DirPicker({
  open,
  onClose,
  onPick,
}: {
  open: boolean
  onClose: () => void
  /** Called with the chosen absolute path. */
  onPick: (path: string) => void
}) {
  const [listing, setListing] = useState<DirListing>()
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(false)

  const load = useCallback((path?: string) => {
    setLoading(true)
    setError(undefined)
    workspaceApi
      .dirs(path)
      .then(setListing)
      .catch((cause) =>
        setError(cause instanceof Error ? cause.message : 'Could not list directories'),
      )
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (open) load()
  }, [open, load])

  const current = listing?.path ?? ''

  return (
    <Layer
      open={open}
      onClose={onClose}
      title="Choose project directory"
      size="md"
      footer={
        <div className="flex items-center justify-between gap-2">
          <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink-3">
            {current || '—'}
          </code>
          <Button
            variant="primary"
            disabled={!current || !listing?.exists}
            onClick={() => {
              onPick(current)
              onClose()
            }}
          >
            Use this folder
          </Button>
        </div>
      }
    >
      {current ? (
        <div className="scroll-thin flex items-center gap-1 overflow-x-auto px-2.5 pb-1.5 pt-1 font-mono text-[11px] text-ink-3">
          <span>/</span>
          {current
            .split('/')
            .filter(Boolean)
            .map((segment, index) => (
              <span key={index} className="shrink-0">
                {segment}
                <span aria-hidden className="mx-1 text-ink-3/50">/</span>
              </span>
            ))}
        </div>
      ) : null}

      {listing && listing.parent ? (
        <Row
          primary=".."
          secondary="Parent directory"
          onSelect={() => load(listing.parent ?? undefined)}
          mono
        />
      ) : null}

      {listing && listing.roots.length > 0 ? (
        <>
          <div className="px-2.5 pb-1 pt-2 text-[10.5px] font-medium uppercase tracking-[0.06em] text-ink-3">
            Common
          </div>
          {listing.roots.map((root) => (
            <Row
              key={root.path}
              primary={<span><Chip mono>{root.name}</Chip></span>}
              secondary={root.path}
              onSelect={() => load(root.path)}
              mono
            />
          ))}
        </>
      ) : null}

      <div className="px-2.5 pb-1 pt-2 text-[10.5px] font-medium uppercase tracking-[0.06em] text-ink-3">
        Folders here
      </div>

      {loading ? (
        <div className="px-2.5 py-3">
          <Dots label="Listing…" />
        </div>
      ) : error ? (
        <p className="px-2.5 py-2 text-[11.5px] text-red">{error}</p>
      ) : listing && listing.entries.length === 0 ? (
        <p className="px-2.5 py-2 text-[11.5px] text-ink-3">
          No subdirectories — you can use this folder as-is.
        </p>
      ) : (
        (listing?.entries ?? []).map((entry) => (
          <Row
            key={entry.path}
            primary={
              <span className="flex items-center gap-2">
                <span className="text-accent-ink"><FolderGlyph /></span>
                {entry.name}
              </span>
            }
            onSelect={() => load(entry.path)}
          />
        ))
      )}
    </Layer>
  )
}
