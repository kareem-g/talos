import { useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom'
import { WorkspaceView } from './components/workspace/WorkspaceView'
import { ThemeProvider } from './components/ThemeProvider'
import { DesktopApp } from './components/home/DesktopApp'
import { MobileRoot } from './components/home/MobileRoot'
import { useMediaQuery } from './hooks/useMediaQuery'
import { useTheme } from './hooks/useTheme'

/**
 * `/mobile/task/<id>` → `/?task=<id>` · `/mobile/pair?offer=…` → `/?offer=…`
 * `/mobile` → `/`. Pairing params ride along in the search string so the
 * mobile shell at the root can complete the pairing flow inline.
 */
function MobileRedirect() {
  const location = useLocation()
  if (location.pathname.startsWith('/mobile/task/')) {
    const id = location.pathname.slice('/mobile/task/'.length)
    return <Navigate to={`/?task=${encodeURIComponent(id)}${location.search}`} replace />
  }
  return <Navigate to={`/${location.search}`} replace />
}

/** Old session/task links keep working — they land on the same session in `/`. */
function SessionRedirect() {
  const { id } = useParams<{ id: string }>()
  return <Navigate to={`/?session=${encodeURIComponent(id || '')}`} replace />
}

function TaskRedirect() {
  const { id } = useParams<{ id: string }>()
  return <Navigate to={`/?task=${encodeURIComponent(id || '')}`} replace />
}

/**
 * One responsive application at `/`.
 *
 *   /  └─ MainApplication
 *         ├─ DesktopApp     (lg+ viewports: chat, sidebar, CLI, work/diff)
 *         ├─ MobileRoot     (<lg viewports: pairing, then remote control)
 *         └─ Mobile pairing (inline at / on mobile; at /pair on desktop)
 *
 * Mounting is decided by the CSS media query (viewport width), not by
 * user-agent sniffing, so the same URL serves both layouts and only the
 * visible shell opens WebSocket connections.
 */
function AppShell() {
  const isDesktop = useMediaQuery('(min-width: 1024px)')
  const { theme } = useTheme()

  // Apply the theme class on the <html> element for whichever shell is active
  // (previously only the desktop shell did this).
  useEffect(() => {
    document.documentElement.className = theme
  }, [theme])

  return (
    <>
      {isDesktop && <DesktopApp />}
      {!isDesktop && <MobileRoot />}
    </>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <Routes>
          <Route path="/mobile/*" element={<MobileRedirect />} />
          <Route path="/session/:id" element={<SessionRedirect />} />
          <Route path="/task/:id" element={<TaskRedirect />} />
          <Route path="/workspace/:project" element={<WorkspaceView />} />
          <Route path="*" element={<AppShell />} />
        </Routes>
      </ThemeProvider>
    </BrowserRouter>
  )
}
