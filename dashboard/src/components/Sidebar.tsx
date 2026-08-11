import { useLayoutEffect, useRef, useState } from 'react'
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

const NAV_SECTIONS: { label: string; items: { path: string; label: string; icon: typeof Terminal }[] }[] = [
  {
    label: 'Workspace',
    items: [
      { path: '/', label: 'Sessions', icon: Terminal },
      { path: '/worktrees', label: 'Worktrees', icon: GitBranch },
      { path: '/activity', label: 'Activity', icon: Activity },
    ],
  },
  {
    label: 'System',
    items: [
      { path: '/mcp', label: 'MCP', icon: Puzzle },
      { path: '/settings', label: 'Settings', icon: Settings },
    ],
  },
]

/** All flat nav items for active-path matching. */
const ALL_PATHS = NAV_SECTIONS.flatMap((section) => section.items.map((item) => item.path))

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const navRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<Record<string, HTMLButtonElement | null>>({})

  const activePath = ALL_PATHS.find((path) =>
    path === '/' ? location.pathname === '/' : location.pathname.startsWith(path)
  ) || '/'

  const [box, setBox] = useState<{ top: number; height: number } | null>(null)

  useLayoutEffect(() => {
    const container = navRef.current
    const target = itemRefs.current[activePath]
    if (!container || !target || collapsed) {
      setBox(null)
      return
    }
    const containerRect = container.getBoundingClientRect()
    const targetRect = target.getBoundingClientRect()
    setBox({
      top: targetRect.top - containerRect.top,
      height: targetRect.height,
    })
  }, [activePath, collapsed])

  if (collapsed) {
    return (
      <aside className="flex w-12 shrink-0 flex-col border-r border-border bg-surface">
        <div className="flex-1 py-2">
          {ALL_PATHS.map((path) => {
            const item = NAV_SECTIONS.flatMap((section) => section.items).find((i) => i.path === path)!
            const isActive = activePath === path
            return (
              <button
                key={path}
                onClick={() => navigate(path)}
                title={item.label}
                className={`mx-1.5 flex w-[calc(100%-12px)] items-center justify-center rounded-md p-2 transition-colors ${
                  isActive ? 'bg-accent/10 text-accent' : 'text-text-muted hover:bg-surface-hover hover:text-text'
                }`}
              >
                <item.icon className="h-4 w-4 shrink-0" />
              </button>
            )
          })}
        </div>
        <div className="border-t border-border p-2">
          <button
            onClick={() => setCollapsed(false)}
            className="flex w-full items-center justify-center rounded-md p-1.5 text-text-muted transition-colors hover:bg-surface-hover"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </aside>
    )
  }

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-surface">
      <div className="flex-1 overflow-y-auto p-2">
        <div
          ref={navRef}
          className="relative flex flex-col gap-2"
        >
          {/* Sliding active indicator — Beautiful UI SidebarNav pattern */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 rounded-md bg-accent/10"
            style={{
              top: box?.top ?? 0,
              height: box?.height ?? 0,
              opacity: box ? 1 : 0,
              transition: 'top 220ms cubic-bezier(0.23,1,0.32,1), height 220ms cubic-bezier(0.23,1,0.32,1), opacity 150ms ease',
            }}
          />
          {NAV_SECTIONS.map((section) => (
            <div key={section.label}>
              <div className="px-2 pb-1 pt-1 text-[10.5px] font-medium uppercase tracking-[0.08em] text-text-dim">
                {section.label}
              </div>
              <div className="flex flex-col gap-px">
                {section.items.map((item) => {
                  const isActive = activePath === item.path
                  return (
                    <button
                      key={item.path}
                      ref={(el) => { itemRefs.current[item.path] = el }}
                      onClick={() => navigate(item.path)}
                      aria-current={isActive ? 'page' : undefined}
                      className={`group relative z-10 flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors ${
                        isActive ? 'text-text' : 'text-text-muted hover:text-text'
                      }`}
                    >
                      <span className={isActive ? 'text-accent' : 'text-text-dim'}>
                        <item.icon className="h-4 w-4" />
                      </span>
                      <span className={`min-w-0 flex-1 truncate text-[13px] ${isActive ? 'font-medium' : ''}`}>
                        {item.label}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="border-t border-border p-2">
        <button
          onClick={() => setCollapsed(true)}
          className="flex w-full items-center justify-center rounded-md p-1.5 text-text-muted transition-colors hover:bg-surface-hover"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      </div>
    </aside>
  )
}
