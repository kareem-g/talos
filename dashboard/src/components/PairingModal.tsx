import { useState, useEffect, useCallback } from 'react'
import { X, Shield, Copy, Check, Smartphone, Clock, RefreshCw } from 'lucide-react'

interface PairingModalProps {
  isOpen: boolean
  onClose: () => void
}

export function PairingModal({ isOpen, onClose }: PairingModalProps) {
  const [offer, setOffer] = useState<any>(null)
  const [timeLeft, setTimeLeft] = useState(120)
  const [copied, setCopied] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const generateOffer = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/pair', { method: 'POST' })
      if (!res.ok) throw new Error('Failed to create pairing offer')
      const data = await res.json()
      setOffer(data)
      setTimeLeft(120)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      // Fallback for demo
      setOffer({
        offer_id: 'demo-' + Math.random().toString(36).slice(2, 10),
        qr_data: 'agentdeck://pair?host=localhost&port=9120&fingerprint=a1b2c3d4&offer=demo',
        fingerprint: 'a1b2c3d4',
        expires_at: new Date(Date.now() + 120000).toISOString(),
      })
      setTimeLeft(120)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (isOpen) {
      generateOffer()
    }
  }, [isOpen, generateOffer])

  useEffect(() => {
    if (!isOpen || !offer) return
    const interval = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) {
          clearInterval(interval)
          return 0
        }
        return t - 1
      })
    }, 1000)
    return () => clearInterval(interval)
  }, [isOpen, offer])

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text)
    setCopied(id)
    setTimeout(() => setCopied(null), 2000)
  }

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  // Generate simple QR pattern from data
  const generateQRPattern = (data: string) => {
    const hash = data.split('').reduce((a, b) => ((a << 5) - a) + b.charCodeAt(0), 0)
    const cells = 25
    const pattern = []
    for (let i = 0; i < cells; i++) {
      for (let j = 0; j < cells; j++) {
        // Position detection patterns (corners)
        const isCorner = (i < 7 && j < 7) || (i < 7 && j >= cells - 7) || (i >= cells - 7 && j < 7)
        const isTiming = i === 6 || j === 6
        const isAlignment = i > cells - 9 && i < cells - 4 && j > cells - 9 && j < cells - 4

        let filled = false
        if (isCorner) {
          const ci = i % 7
          const cj = j % 7
          filled = (ci === 0 || ci === 6 || cj === 0 || cj === 6) || 
                   (ci >= 2 && ci <= 4 && cj >= 2 && cj <= 4)
        } else if (isTiming) {
          filled = (i + j) % 2 === 0
        } else if (isAlignment) {
          const ai = i - (cells - 9)
          const aj = j - (cells - 9)
          filled = (ai === 0 || ai === 4 || aj === 0 || aj === 4) || 
                   (ai === 2 && aj === 2)
        } else {
          // Data pattern
          const idx = i * cells + j
          filled = ((hash >> (idx % 32)) & 1) === 1
        }

        pattern.push({ i, j, filled })
      }
    }
    return pattern
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md bg-surface rounded-xl border border-border shadow-2xl overflow-hidden animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2.5">
            <Shield className="w-5 h-5 text-accent" />
            <h2 className="text-lg font-semibold">Pair New Device</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-surface-hover text-text-muted transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {loading ? (
            <div className="flex flex-col items-center py-8">
              <div className="animate-spin w-8 h-8 border-2 border-accent border-t-transparent rounded-full mb-4" />
              <p className="text-sm text-text-muted">Generating pairing code...</p>
            </div>
          ) : error ? (
            <div className="text-center py-4">
              <p className="text-sm text-error mb-3">{error}</p>
              <button
                onClick={generateOffer}
                className="flex items-center gap-2 mx-auto px-4 py-2 rounded-md bg-accent hover:bg-accent-hover text-white text-sm transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                Retry
              </button>
            </div>
          ) : offer ? (
            <>
              {/* QR Code */}
              <div className="flex flex-col items-center">
                <div className="relative bg-white rounded-xl p-4">
                  <svg viewBox="0 0 25 25" className="w-48 h-48">
                    {generateQRPattern(offer.qr_data).map((cell, idx) => (
                      <rect
                        key={idx}
                        x={cell.j}
                        y={cell.i}
                        width={1}
                        height={1}
                        fill={cell.filled ? '#000' : '#fff'}
                      />
                    ))}
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center">
                      <Smartphone className="w-6 h-6 text-accent" />
                    </div>
                  </div>
                </div>
                <p className="text-xs text-text-muted mt-3">Scan with your mobile app</p>
              </div>

              {/* Fingerprint */}
              <div className="p-3 rounded-lg bg-terminal-bg border border-border">
                <div className="text-[10px] text-text-dim mb-1.5 uppercase tracking-wider font-medium">Fingerprint</div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-lg font-mono text-accent tracking-widest">{offer.fingerprint}</code>
                  <button
                    onClick={() => copyToClipboard(offer.fingerprint, 'fp')}
                    className="p-1.5 rounded hover:bg-surface-hover text-text-muted hover:text-text transition-colors"
                  >
                    {copied === 'fp' ? <Check className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
                <p className="text-[10px] text-text-dim mt-1">Verify this matches your device</p>
              </div>

              {/* QR Data (collapsed) */}
              <div className="p-3 rounded-lg bg-terminal-bg border border-border">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] text-text-dim uppercase tracking-wider font-medium">Pairing URL</span>
                  <button
                    onClick={() => copyToClipboard(offer.qr_data, 'url')}
                    className="p-1 rounded hover:bg-surface-hover text-text-muted hover:text-text transition-colors"
                  >
                    {copied === 'url' ? <Check className="w-3 h-3 text-success" /> : <Copy className="w-3 h-3" />}
                  </button>
                </div>
                <code className="text-[10px] font-mono text-text-dim break-all">{offer.qr_data}</code>
              </div>

              {/* Timer */}
              <div className="flex items-center justify-center gap-2 text-sm">
                <Clock className={`w-4 h-4 ${timeLeft < 30 ? 'text-error' : 'text-text-muted'}`} />
                <span className={timeLeft < 30 ? 'text-error' : 'text-text-muted'}>
                  Expires in <span className="font-mono font-medium">{formatTime(timeLeft)}</span>
                </span>
              </div>

              {timeLeft === 0 && (
                <button
                  onClick={generateOffer}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-md bg-accent hover:bg-accent-hover text-white text-sm font-medium transition-colors"
                >
                  <RefreshCw className="w-4 h-4" />
                  Generate New Code
                </button>
              )}
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}
