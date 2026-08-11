import { useState, useEffect, useCallback } from 'react'
import { X, Shield, Copy, Check, Clock, RefreshCw, Wifi } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { api } from '../lib/api'

interface PairingOffer {
  offer_id: string
  qr_data: string
  fingerprint: string
  expires_at: string
  status?: string
}

interface PairedDevice {
  id: string
  name: string
  paired_at: string
}

interface PairingModalProps {
  isOpen: boolean
  onClose: () => void
}

export function PairingModal({ isOpen, onClose }: PairingModalProps) {
  const [offer, setOffer] = useState<PairingOffer | null>(null)
  const [timeLeft, setTimeLeft] = useState(0)
  const [copied, setCopied] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pairedDevice, setPairedDevice] = useState<PairedDevice | null>(null)
  const [knownDeviceIds, setKnownDeviceIds] = useState<string[]>([])

  const generateOffer = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const existing = await api.devices.list() as { devices?: PairedDevice[] }
      setKnownDeviceIds((existing.devices || []).map((device) => device.id))
      const data = await api.pair.initiate() as PairingOffer
      setOffer(data)
      setPairedDevice(null)
      setTimeLeft(Math.max(0, Math.floor((new Date(data.expires_at).getTime() - Date.now()) / 1000)))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
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
    const interval = setInterval(() => setTimeLeft(Math.max(0, Math.floor((new Date(offer.expires_at).getTime() - Date.now()) / 1000))), 1000)
    return () => clearInterval(interval)
  }, [isOpen, offer])

  useEffect(() => {
    if (!isOpen || !offer || timeLeft === 0 || pairedDevice) return
    const interval = setInterval(async () => {
      try {
        const result = await api.devices.list() as { devices?: PairedDevice[] }
        const latest = result.devices?.find((device) => !knownDeviceIds.includes(device.id))
        if (latest) setPairedDevice(latest)
      } catch {
        // The QR remains usable when device polling is temporarily unavailable.
      }
    }, 2000)
    return () => clearInterval(interval)
  }, [isOpen, offer, pairedDevice, timeLeft, knownDeviceIds])

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
                  <QRCodeSVG value={offer.qr_data} size={192} level="M" includeMargin bgColor="#ffffff" fgColor="#09090b" />
                </div>
                <p className="text-xs text-text-muted mt-3">Scan with your phone camera</p>
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

              {pairedDevice && (
                <div className="flex items-center gap-3 rounded-lg border border-success/20 bg-success/10 p-3">
                  <Wifi className="h-4 w-4 text-success" />
                  <div><p className="text-sm font-medium text-text">{pairedDevice.name} connected</p><p className="text-[10px] text-text-muted">The mobile device is now trusted.</p></div>
                </div>
              )}

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
