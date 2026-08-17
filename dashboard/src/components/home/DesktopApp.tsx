import { useEffect } from 'react'
import { Routes, Route } from 'react-router-dom'
import { Header } from '../Header'
import { Sidebar } from '../Sidebar'
import { StatusBar } from '../StatusBar'
import { Settings } from '../Settings'
import { MCPManager } from '../MCPManager'
import { PairingPage } from '../PairingPage'
import { CommandPalette } from '../CommandPalette'
import { useWebSocketConnected } from '../../hooks/useWebSocket'
import { useTheme } from '../../hooks/useTheme'
import { Home } from './Home'

/**
 * Desktop application shell at `/`.
 *
 * Rendered only on `lg+` viewports (the mobile shell renders below that, both
 * from the same tree). The pairing component lives at `/pair` here; on mobile
 * viewports the equivalent pairing experience is rendered inline at `/`.
 */
export function DesktopApp() {
  const connected = useWebSocketConnected()
  const { theme } = useTheme()

  useEffect(() => {
    document.documentElement.className = theme
  }, [theme])

  return (
    <div className="hidden h-screen w-screen flex-col overflow-hidden bg-background text-text lg:flex">
      <Header />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex min-w-0 flex-1 flex-col">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/mcp" element={<MCPManager />} />
            <Route path="/pair" element={<PairingPage />} />
            {/* Legacy alias so old pairing links keep working. */}
            <Route path="/pairing" element={<PairingPage />} />
          </Routes>
        </main>
      </div>
      <StatusBar connected={connected} />
      <CommandPalette />
    </div>
  )
}
