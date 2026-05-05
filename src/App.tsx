import { useEffect, useState } from 'react'
import { ensureSeed } from './db/seed'
import { PosScreen } from './pos/PosScreen'
import { AdminScreen } from './admin/AdminScreen'
import { ZReportModal } from './zreport/ZReportModal'
import { db } from './db/database'
import { sha256Hex } from './lib/pin'
import { getStoredToken, hasApi } from './api/config'
import { logOut } from './api/auth'
import { resolveApiUrl } from './api/http'
import { DemoBanner } from './demo/DemoBanner'
import { OfflineIndicator } from './pwa/OfflineIndicator'
import { PwaUpdateProvider } from './pwa/PwaUpdateProvider'

function PinOverlay(props: {
  onSuccess: () => void
  onCancel: () => void
}) {
  const [pin, setPin] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    setBusy(true)
    setErr(null)
    const row = await db.settings.get('adminPinHash')
    const expected = row?.value
    const entered = await sha256Hex(pin)
    if (!expected || entered === expected) {
      props.onSuccess()
      setPin('')
    } else {
      setErr('PIN falsch.')
    }
    setBusy(false)
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 p-4 backdrop-blur-md">
      <div className="panel-glass w-full max-w-sm rounded-2xl p-8 text-center shadow-[0_0_50px_rgba(244,63,94,0.15)]">
        <h2 className="text-xl font-bold text-white">Admin‑PIN</h2>
        <p className="mt-2 text-sm text-slate-400">Standard bei Erststart: 1234</p>
        <input
          type="password"
          inputMode="numeric"
          autoFocus
          className="mt-6 w-full rounded-xl border border-rose-500/30 bg-black/40 px-4 py-4 text-center text-2xl tracking-widest text-white"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit()
          }}
        />
        {err && <p className="mt-3 text-sm text-rose-300">{err}</p>}
        <div className="mt-6 flex gap-2">
          <button
            type="button"
            className="flex-1 rounded-xl border border-white/15 py-3 text-slate-200"
            onClick={props.onCancel}
          >
            Abbrechen
          </button>
          <button
            type="button"
            disabled={busy || pin.length < 4}
            className="flex-1 rounded-xl bg-gradient-to-r from-rose-600 to-orange-500 py-3 font-bold text-white disabled:opacity-40"
            onClick={() => void submit()}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const [ready, setReady] = useState(false)
  const [route, setRoute] = useState<'pos' | 'admin'>('pos')
  const [adminOk, setAdminOk] = useState(false)
  const [zOpen, setZOpen] = useState(false)
  const [apiJwt, setApiJwt] = useState<string | null>(() => getStoredToken())
  const [preferredDataMode, setPreferredDataMode] = useState<'api' | 'offline'>('offline')
  const [apiReachable, setApiReachable] = useState(false)

  useEffect(() => {
    void ensureSeed().then(() => setReady(true))
  }, [])

  useEffect(() => {
    const sync = () => setApiJwt(getStoredToken())
    window.addEventListener('drk-kasse-auth', sync)
    return () => window.removeEventListener('drk-kasse-auth', sync)
  }, [])

  useEffect(() => {
    if (!ready) return
    let alive = true
    void (async () => {
      const row = await db.settings.get('preferredDataMode')
      const mode = row?.value === 'api' ? 'api' : 'offline'
      if (!alive) return
      setPreferredDataMode(mode)
      if (!row) await db.settings.put({ key: 'preferredDataMode', value: mode })
    })()
    return () => {
      alive = false
    }
  }, [ready])

  useEffect(() => {
    if (!ready || !hasApi()) return
    let alive = true
    const probe = async () => {
      try {
        const res = await fetch(resolveApiUrl('/health'), { method: 'GET' })
        if (!alive) return
        setApiReachable(res.status > 0)
      } catch {
        if (!alive) return
        setApiReachable(false)
      }
    }
    void probe()
    const t = window.setInterval(() => void probe(), 15000)
    const onOnline = () => void probe()
    window.addEventListener('online', onOnline)
    return () => {
      alive = false
      window.clearInterval(t)
      window.removeEventListener('online', onOnline)
    }
  }, [ready])

  const effectiveDataMode: 'api' | 'offline' =
    hasApi() && apiJwt && preferredDataMode === 'api' && apiReachable ? 'api' : 'offline'

  const switchPreferredMode = async (mode: 'api' | 'offline') => {
    setPreferredDataMode(mode)
    await db.settings.put({ key: 'preferredDataMode', value: mode })
  }

  return (
    <PwaUpdateProvider>
      {!ready ? (
        <div className="flex h-full flex-col items-center justify-center gap-2 text-slate-300">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" />
          <p>Datenbank wird vorbereitet …</p>
        </div>
      ) : (
        <div className="flex h-full min-h-0 flex-col">
          <DemoBanner />
          <div className="min-h-0 flex-1">
            {preferredDataMode === 'api' && effectiveDataMode === 'offline' && (
              <div className="border-b border-amber-500/40 bg-amber-950/30 px-3 py-2 text-xs font-semibold text-amber-100">
                Online-Modus gewünscht, aber Server aktuell nicht erreichbar. Es wird Offline/Lokal verwendet.
                <button
                  type="button"
                  className="ml-2 rounded border border-amber-500/50 px-2 py-0.5 text-[11px] font-black hover:bg-amber-900/40"
                  onClick={() => void switchPreferredMode('offline')}
                >
                  Offline-Modus verwenden
                </button>
              </div>
            )}
            {route === 'pos' && (
              <PosScreen
                apiJwt={hasApi() ? apiJwt : null}
                dataMode={effectiveDataMode}
                onActivateOnlineMode={() => void switchPreferredMode('api')}
                onActivateOfflineMode={() => void switchPreferredMode('offline')}
                onApiLogout={
                  hasApi()
                    ? () => {
                        logOut()
                        setApiJwt(null)
                      }
                    : undefined
                }
                onOpenAdmin={() => {
                  setAdminOk(false)
                  setRoute('admin')
                }}
                onOpenZReport={() => setZOpen(true)}
              />
            )}
            {route === 'admin' && !adminOk && (
              <PinOverlay
                onSuccess={() => setAdminOk(true)}
                onCancel={() => {
                  setRoute('pos')
                  setAdminOk(false)
                }}
              />
            )}
            {route === 'admin' && adminOk && (
              <AdminScreen
                onBack={() => {
                  setRoute('pos')
                  setAdminOk(false)
                }}
              />
            )}
            {zOpen && <ZReportModal onClose={() => setZOpen(false)} />}
          </div>
          <OfflineIndicator />
        </div>
      )}
    </PwaUpdateProvider>
  )
}
