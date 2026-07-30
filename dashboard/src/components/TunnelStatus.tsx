import { useState } from 'react'
import { Globe, Shield, Copy, Check } from 'lucide-react'

interface TunnelStatusProps {
  tailscale?: { enabled: boolean; ip?: string }
  cloudflare?: { enabled: boolean; url?: string }
}

export function TunnelStatus({ tailscale, cloudflare }: TunnelStatusProps) {
  const [copied, setCopied] = useState<string | null>(null)

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text)
    setCopied(id)
    setTimeout(() => setCopied(null), 2000)
  }

  return (
    <div className="space-y-2">
      {tailscale?.enabled && tailscale.ip && (
        <div className="flex items-center gap-2 p-2 rounded-md bg-success/5 border border-success/20">
          <Shield className="w-3.5 h-3.5 text-success shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-[11px] text-text-muted">Tailscale</div>
            <div className="text-xs text-success font-mono">{tailscale.ip}:9120</div>
          </div>
          <button
            onClick={() => copyToClipboard(`http://${tailscale.ip}:9120`, 'ts')}
            className="p-1 rounded hover:bg-success/10 text-text-muted hover:text-success transition-colors"
          >
            {copied === 'ts' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
          </button>
        </div>
      )}

      {cloudflare?.enabled && cloudflare.url && (
        <div className="flex items-center gap-2 p-2 rounded-md bg-accent/5 border border-accent/20">
          <Globe className="w-3.5 h-3.5 text-accent shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-[11px] text-text-muted">Cloudflare</div>
            <div className="text-xs text-accent font-mono truncate">{cloudflare.url}</div>
          </div>
          <button
            onClick={() => copyToClipboard(cloudflare.url!, 'cf')}
            className="p-1 rounded hover:bg-accent/10 text-text-muted hover:text-accent transition-colors"
          >
            {copied === 'cf' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
          </button>
        </div>
      )}
    </div>
  )
}
