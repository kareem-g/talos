/**
 * NewTaskHost — the one new-task sheet, mounted at the app root.
 *
 * Sibling of the toast host: rendered above the navigator so the sheet
 * presents over any tab, pushed screen, or other sheet state without being
 * owned by any of them. Requests arrive through the `lib/newTask` emitter;
 * a created session is opened through the navigation ref, which is why this
 * component needs no navigator context of its own.
 */

import * as React from 'react'

import { navigationRef } from '@app/navigation'
import { setNewTaskListener } from '@app/lib/newTask'
import { NewTaskSheet } from './NewTaskSheet'

interface HostState {
  open: boolean
  agentId?: string
  project?: string
}

export function NewTaskHost() {
  const [state, setState] = React.useState<HostState>({ open: false })

  React.useEffect(() => {
    setNewTaskListener((request) => setState({ open: true, ...request }))
    return () => setNewTaskListener(null)
  }, [])

  return (
    <NewTaskSheet
      open={state.open}
      initialAgent={state.agentId}
      initialProject={state.project}
      onClose={() => setState((current) => ({ ...current, open: false }))}
      onCreated={(session) => {
        setState((current) => ({ ...current, open: false }))
        if (navigationRef.isReady()) {
          navigationRef.navigate('Session', { sessionId: session.id })
        }
      }}
    />
  )
}
