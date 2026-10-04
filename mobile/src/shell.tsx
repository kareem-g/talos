/**
 * shell — the chrome above the navigator: the new-task wizard host and the
 * helpers screens use to route from anywhere.
 */

import * as React from 'react'
import { navigationRef } from '@/lib/navigationRef'
import { NewTask } from './newtask'

export type Page = 'home' | 'agents' | 'history' | 'usage' | 'portal' | 'config'

type ShellValue = {
  openNewTask: (project?: string) => void
  navigate: (page: Page) => void
  openSession: (sessionId: string) => void
}

const Ctx = React.createContext<ShellValue | null>(null)

export function useShell(): ShellValue {
  const value = React.useContext(Ctx)
  if (!value) throw new Error('useShell outside the shell provider')
  return value
}

const TAB_ROUTES: Partial<Record<Page, keyof import('./navigation').TabList>> = {
  home: 'Home',
  history: 'History',
  agents: 'Agents',
  usage: 'Usage',
  portal: 'Remote',
  config: 'Config',
}

export function ShellProvider({ children }: { children: React.ReactNode }) {
  const [task, setTask] = React.useState<{ open: boolean; project?: string }>({ open: false })

  const value = React.useMemo<ShellValue>(
    () => ({
      openNewTask: (project?: string) => setTask({ open: true, project }),
      navigate: (page: Page) => {
        if (!navigationRef.isReady()) return
        const tab = TAB_ROUTES[page]
        if (tab) navigationRef.navigate('Tabs', { screen: tab })
      },
      openSession: (sessionId: string) => {
        if (navigationRef.isReady()) navigationRef.navigate('Session', { sessionId })
      },
    }),
    [],
  )

  return (
    <Ctx.Provider value={value}>
      {children}
      <NewTask open={task.open} project={task.project} onClose={() => setTask({ open: false })} />
    </Ctx.Provider>
  )
}