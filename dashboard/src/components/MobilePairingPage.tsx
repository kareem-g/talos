import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, Check, KeyRound, Loader2, Smartphone } from 'lucide-react'
import { api, ApiError } from '../lib/api'
import { clearDeviceCredential, getDeviceCredential, setDeviceCredential } from '../lib/auth'

type PairingPhase = 'checking' | 'pairing' | 'success' | 'expired' | 'missing' | 'error'

function createDeviceKey() {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function deviceName() {
  const platform = navigator.userAgent.match(/iPhone|iPad|Android|Macintosh|Windows|Linux/)?.[0]
  return platform ? `${platform} browser` : 'Mobile browser'
}

export function MobilePairingPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [phase, setPhase] = useState<PairingPhase>('checking')
  const [message, setMessage] = useState('Checking this device...')
  const [pairingUrl, setPairingUrl] = useState('')
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true

    const offerId = searchParams.get('offer')
    const secret = searchParams.get('secret')
    const credential = getDeviceCredential()

    if (!offerId || !secret) {
      if (!credential) {
        setPhase('missing')
        setMessage('Open a pairing link from your AgentDeck desktop.')
        return
      }

      api.mobile.me()
        .then(() => navigate('/mobile', { replace: true }))
        .catch(() => {
          clearDeviceCredential()
          setPhase('missing')
          setMessage('This device needs to be paired again from your desktop.')
        })
      return
    }

    setPhase('pairing')
    setMessage('Establishing a secure device identity...')
    api.pair.verify({
      offer_id: offerId,
      secret,
      device_key: createDeviceKey(),
      device_name: deviceName(),
    })
      .then((data) => {
        const result = data as {
          verified?: boolean
          token?: string
          device_id?: string
          device_name?: string
          paired_at?: string
          error?: string
        }
        if (!result.verified || !result.token || !result.device_id) {
          throw new Error(result.error || 'This pairing code is invalid or expired.')
        }
        setDeviceCredential({
          token: result.token,
          deviceId: result.device_id,
          deviceName: result.device_name || deviceName(),
          pairedAt: result.paired_at,
        })
        setPhase('success')
        setMessage('Device paired. Loading your workspaces...')
        setTimeout(() => navigate('/mobile', { replace: true }), 500)
      })
      .catch((error: unknown) => {
        setPhase(error instanceof ApiError && error.status >= 400 ? 'expired' : 'error')
        setMessage(error instanceof Error ? error.message : 'Pairing failed. Return to your desktop and try again.')
      })
  }, [navigate, searchParams])

  const submitPairingUrl = () => {
    try {
      const url = new URL(pairingUrl)
      const offer = url.searchParams.get('offer')
      const secret = url.searchParams.get('secret')
      if (offer && secret) {
        navigate(`/mobile/pair?offer=${encodeURIComponent(offer)}&secret=${encodeURIComponent(secret)}`, { replace: true })
        window.location.reload()
      } else {
        setPhase('error')
        setMessage('That does not look like an AgentDeck pairing link.')
      }
    } catch {
      setPhase('error')
      setMessage('Paste the full pairing link from your desktop.')
    }
  }

  return (
    <main className="mobile-app min-h-[100dvh] flex items-center justify-center px-5 py-8 text-text">
      <section className="w-full max-w-sm">
        <button
          onClick={() => navigate('/')}
          className="mb-8 inline-flex items-center gap-2 text-sm text-text-muted hover:text-text"
        >
          <ArrowLeft className="h-4 w-4" />
          Desktop dashboard
        </button>

        <div className="mb-8 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-border bg-surface">
            <Smartphone className="h-5 w-5 text-accent" />
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-[0.24em] text-text-dim">AgentDeck</p>
            <h1 className="text-xl font-semibold tracking-tight">Connect mobile control</h1>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-surface p-5 shadow-[0_24px_80px_rgba(0,0,0,0.24)]">
          <div className="mb-5 flex items-start gap-3">
            <div className={`mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${phase === 'error' || phase === 'expired' ? 'bg-error/10 text-error' : phase === 'success' ? 'bg-success/10 text-success' : 'bg-accent/10 text-accent'}`}>
              {phase === 'error' || phase === 'expired' ? <AlertTriangle className="h-4 w-4" /> : phase === 'success' ? <Check className="h-4 w-4" /> : <Loader2 className="h-4 w-4 animate-spin" />}
            </div>
            <div>
              <h2 className="font-medium">{phase === 'expired' ? 'Pairing code expired' : phase === 'missing' ? 'Pair this device' : phase === 'success' ? 'Connected' : 'Connecting to desktop'}</h2>
              <p className="mt-1 text-sm leading-6 text-text-muted">{message}</p>
            </div>
          </div>

          {phase === 'missing' && (
            <div className="space-y-4">
              <div className="rounded-xl border border-border bg-background/60 p-4 text-sm leading-6 text-text-muted">
                On the desktop dashboard, open <span className="text-text">Connect mobile</span>, then scan the QR code with this phone.
              </div>
              <div className="border-t border-border pt-4">
                <label className="mb-2 block text-xs font-medium text-text-muted">Or paste the pairing URL</label>
                <textarea
                  value={pairingUrl}
                  onChange={(event) => setPairingUrl(event.target.value)}
                  rows={3}
                  placeholder="https://desktop.example/mobile/pair?..."
                  className="w-full resize-none rounded-xl border border-border bg-background px-3 py-2.5 text-xs text-text outline-none placeholder:text-text-dim focus:border-accent"
                />
                <button onClick={submitPairingUrl} className="mt-2 w-full rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-hover">
                  Continue pairing
                </button>
              </div>
            </div>
          )}

          {(phase === 'expired' || phase === 'error') && (
            <button onClick={() => navigate('/mobile/pair', { replace: true })} className="mt-2 w-full rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-text hover:bg-surface-hover">
              Return to pairing
            </button>
          )}

          {phase === 'checking' && <div className="mt-4 h-1 overflow-hidden rounded-full bg-background"><div className="h-full w-1/2 animate-pulse rounded-full bg-accent" /></div>}
          {phase === 'pairing' && <div className="mt-4 flex items-center gap-2 text-xs text-text-dim"><KeyRound className="h-3.5 w-3.5" /> The code is single-use and expires shortly.</div>}
        </div>
      </section>
    </main>
  )
}
