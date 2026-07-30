import { useState, useEffect } from 'react'

interface TunnelState {
  tailscale: { enabled: boolean; ip?: string } | null
  cloudflare: { enabled: boolean; url?: string } | null
}

export function useTunnel() {
  const [status, setStatus] = useState<TunnelState>({ tailscale: null, cloudflare: null })

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await fetch('/api/tunnel/status')
        const data = await res.json()
        setStatus({
          tailscale: data.tailscale,
          cloudflare: data.cloudflare,
        })
      } catch {
        // Demo data
        setStatus({
          tailscale: { enabled: true, ip: '100.64.0.1' },
          cloudflare: { enabled: false },
        })
      }
    }

    fetchStatus()
    const interval = setInterval(fetchStatus, 10000)
    return () => clearInterval(interval)
  }, [])

  return status
}
