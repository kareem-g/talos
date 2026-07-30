import { useEffect } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { ThemeProvider } from './components/ThemeProvider'
import { CommandPalette } from './components/CommandPalette'
import { Header } from './components/Header'
import { Sidebar } from './components/Sidebar'
import { StatusBar } from './components/StatusBar'
import { SessionList } from './components/SessionList'
import { SessionDetail } from './components/SessionDetail'
import { Settings } from './components/Settings'
import { MCPManager } from './components/MCPManager'
import { useWebSocket } from './hooks/useWebSocket'
import { useTheme } from './hooks/useTheme'

function AppContent() {
  const { connected } = useWebSocket()
  const { theme } = useTheme()

  useEffect(() => {
    document.documentElement.className = theme
  }, [theme])

  return (
    <div className="h-screen w-screen flex flex-col bg-background text-text overflow-hidden">
      <Header />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 flex flex-col min-w-0">
          <Routes>
            <Route path="/" element={<SessionList />} />
            <Route path="/session/:id" element={<SessionDetail />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/mcp" element={<MCPManager />} />
          </Routes>
        </main>
      </div>
      <StatusBar connected={connected} />
      <CommandPalette />
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <AppContent />
      </ThemeProvider>
    </BrowserRouter>
  )
}
