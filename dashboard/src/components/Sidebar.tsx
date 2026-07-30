import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { 
  Terminal,
  GitBranch,
  Puzzle,
  Settings,
  ChevronLeft,
  ChevronRight,
  Activity
} from 'lucide-react'

const navItems = [
  { icon: Terminal, label: 'Sessions', path: '/' },
  { icon: GitBranch, label: 'Worktrees', path: '/worktrees' },
  { icon: Puzzle, label: 'MCP', path: '/mcp' },
  { icon: Activity, label: 'Activity', path: '/activity' },
  { icon: Settings, label: 'Settings', path: '/settings' },
]

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()

  return (
    <aside 
      className={`shrink-0 border-r border-border bg-surface flex flex-col transition-all duration-200 ${
        collapsed ? 'w-12' : 'w-56'
      }`}
    >
      <div className="flex-1 py-2">
        {navItems.map((item) => {
          const isActive = location.pathname === item.path
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={`w-full flex items-center gap-3 px-3 py-2 mx-1 rounded-md text-sm transition-colors ${
                isActive 
                  ? 'bg-accent/10 text-accent' 
                  : 'text-text-muted hover:text-text hover:bg-surface-hover'
              }`}
              title={collapsed ? item.label : undefined}
            >
              <item.icon className="w-4 h-4 shrink-0" />
              {!collapsed && <span>{item.label}</span>}
            </button>
          )
        })}
      </div>

      <div className="border-t border-border p-2">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="w-full flex items-center justify-center p-1.5 rounded-md hover:bg-surface-hover text-text-muted transition-colors"
        >
          {collapsed ? (
            <ChevronRight className="w-4 h-4" />
          ) : (
            <ChevronLeft className="w-4 h-4" />
          )}
        </button>
      </div>
    </aside>
  )
}
