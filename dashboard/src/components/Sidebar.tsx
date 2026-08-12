import { useLayoutEffect, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  Terminal,
  Puzzle,
  Settings,
  ChevronLeft,
  ChevronRight,
  Smartphone
} from 'lucide-react'

const NAV_SECTIONS: { label: string; items: { path: string; label: string; icon: typeof Terminal }[] }[] = [
  {
    label: 'Workspace',
    items: [
      { path: '/', label: 'Sessions', icon: Terminal },
    ],
  },
  {
    label: 'System',
    items: [
      { path: '/mcp', label: 'MCP', icon: Puzzle },
      { path: '/settings', label: 'Settings', icon: Settings },
      { path: '/pairing', label: 'Mobile pairing', icon: Smartphone },
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
      <aside className="hidden w-12 shrink-0 flex-col border-r border-line bg-canvas lg:flex">
        <div className="flex-1 py-2">
          {ALL_PATHS.map((path) => {
            const item = NAV_SECTIONS.flatMap((section) => section.items).find((i) => i.path === path)!
            const isActive = activePath === path
            return (
              <button
                key={path}
                onClick={() => navigate(path)}
                title={item.label}
                className={`mx-1.5 flex w-[calc(100%-12px)] items-center justify-center rounded-control p-2 transition-colors ${
                  isActive ? 'bg-accent-tint text-accent' : 'text-ink-3 hover:bg-hover-2 hover:text-ink'
                }`}
              >
                <item.icon className="h-4 w-4 shrink-0" />
              </button>
            )
          })}
        </div>
        <div className="border-t border-line p-2">
          <button
            onClick={() => setCollapsed(false)}
            className="flex w-full items-center justify-center rounded-control p-1.5 text-ink-3 transition-colors hover:bg-hover-2 hover:text-ink"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </aside>
    )
  }

  return (
    <aside className="hidden w-52 shrink-0 flex-col border-r border-line bg-canvas lg:flex">
      <div className="flex-1 overflow-y-auto p-2">
        <div
          ref={navRef}
          className="relative flex flex-col gap-2"
        >
          {/* Sliding active indicator — Beautiful UI SidebarNav pattern */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 rounded-control bg-accent-tint"
            style={{
              top: box?.top ?? 0,
              height: box?.height ?? 0,
              opacity: box ? 1 : 0,
              transition: 'top 220ms cubic-bezier(0.23,1,0.32,1), height 220ms cubic-bezier(0.23,1,0.32,1), opacity 150ms ease',
            }}
          />
          {NAV_SECTIONS.map((section) => (
            <div key={section.label}>
              <div className="px-2 pb-1 pt-1 text-[10.5px] font-medium uppercase tracking-[0.08em] text-ink-3">
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
                      className={`group relative z-10 flex w-full items-center gap-2.5 rounded-control px-2 py-1.5 text-left transition-colors ${
                        isActive ? 'text-ink' : 'text-ink-2 hover:text-ink'
                      }`}
                    >
                      <span className={isActive ? 'text-accent' : 'text-ink-3'}>
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

      <div className="border-t border-line p-2">
        <button
          onClick={() => setCollapsed(true)}
          className="flex w-full items-center justify-center rounded-control p-1.5 text-ink-3 transition-colors hover:bg-hover-2 hover:text-ink"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      </div>
    </aside>
  )
}
