import { useEffect, useState } from 'react'
import { Wifi, WifiOff, HardDrive, Cpu, Clock } from 'lucide-react'

interface StatusBarProps {
  connected: boolean
}

export function StatusBar({ connected }: StatusBarProps) {
  const [uptime, setUptime] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => {
      setUptime(u => u + 1)
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  const formatUptime = (seconds: number) => {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = seconds % 60
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }

  return (
    <footer className="h-7 border-t border-border bg-surface flex items-center px-3 gap-4 text-[11px] text-text-dim shrink-0">
      <div className="flex items-center gap-1.5">
        {connected ? (
          <Wifi className="w-3 h-3 text-success" />
        ) : (
          <WifiOff className="w-3 h-3 text-error" />
        )}
        <span>{connected ? 'Connected' : 'Disconnected'}</span>
      </div>

      <div className="h-3 w-px bg-border" />

      <div className="flex items-center gap-1.5">
        <Cpu className="w-3 h-3" />
        <span>0 sessions</span>
      </div>

      <div className="h-3 w-px bg-border" />

      <div className="flex items-center gap-1.5">
        <HardDrive className="w-3 h-3" />
        <span>v0.1.0</span>
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-1.5">
        <Clock className="w-3 h-3" />
        <span>{formatUptime(uptime)}</span>
      </div>
    </footer>
  )
}
