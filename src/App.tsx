import { useEffect, useState } from 'react'
import { ensureSeed } from './db/seed'
import { PosScreen } from './pos/PosScreen'
import { AdminScreen } from './admin/AdminScreen'
import { ZReportModal } from './zreport/ZReportModal'
import { db } from './db/database'
import { sha256Hex } from './lib/pin'
import { getStoredToken, hasApi } from './api/config'
import { logOut } from './api/auth'
import { checkServerReachability } from './api/http'
import { DemoBanner } from './demo/DemoBanner'
import { OfflineIndicator } from './pwa/OfflineIndicator'
import { PwaUpdateProvider } from './pwa/PwaUpdateProvider'

const DB_INIT_TIMEOUT_MS = 10000

type InitPhase = 'idle' | 'seeding' | 'done' | 'failed' | 'timeout'

type InitDebug = {
  phase: InitPhase
  indexedDbAvailable: boolean
  browser: string
  appVersion: string
  swActive: boolean
  lastError: string | null
}

function detectBrowserLabel(): string {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  const isIpad =
    /iPad/i.test(ua) ||
    (/Macintosh/i.test(ua) && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1)
  const isSafari = /Safari/i.test(ua) && !/Chrome|CriOS|Edg|OPR|FxiOS/i.test(ua)
  if (isIpad && isSafari) return 'Safari/iPadOS'
  if (isIpad) return 'iPadOS'
  if (isSafari) return 'Safari'
  return 'Unbekannt'
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = window.setTimeout(() => reject(new Error('DB_INIT_TIMEOUT')), ms)
    promise.then(
      (value) => {
        window.clearTimeout(id)
        resolve(value)
      },
      (error) => {
        window.clearTimeout(id)
        reject(error)
      },
    )
  })
}

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
  const [dbInitFailed, setDbInitFailed] = useState(false)
  const [dbInitDebug, setDbInitDebug] = useState<InitDebug>({
    phase: 'idle',
    indexedDbAvailable: typeof indexedDB !== 'undefined',
    browser: detectBrowserLabel(),
    appVersion: String(import.meta.env.VITE_APP_VERSION ?? 'dev'),
    swActive: false,
    lastError: null,
  })
  const [route, setRoute] = useState<'pos' | 'admin'>('pos')
  const [adminOk, setAdminOk] = useState(false)
  const [zOpen, setZOpen] = useState(false)
  const [apiJwt, setApiJwt] = useState<string | null>(() => getStoredToken())
  const [preferredDataMode, setPreferredDataMode] = useState<'api' | 'offline'>('offline')
  const [apiReachable, setApiReachable] = useState(false)

  useEffect(() => {
    let alive = true
    const init = async () => {
      const swActive =
        typeof navigator !== 'undefined' &&
        'serviceWorker' in navigator &&
        (await navigator.serviceWorker.getRegistration()) != null
      if (!alive) return
      setDbInitDebug((prev) => ({ ...prev, swActive, phase: 'seeding' }))
      try {
        await withTimeout(ensureSeed(), DB_INIT_TIMEOUT_MS)
        if (!alive) return
        setDbInitDebug((prev) => ({ ...prev, phase: 'done', lastError: null }))
        setReady(true)
      } catch (e) {
        if (!alive) return
        const msg = String((e as Error)?.message ?? e)
        const timeout = msg.includes('DB_INIT_TIMEOUT')
        setDbInitDebug((prev) => ({
          ...prev,
          phase: timeout ? 'timeout' : 'failed',
          lastError: msg,
        }))
        setDbInitFailed(true)
      }
    }
    void init()
    return () => {
      alive = false
    }
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
      let mode: 'api' | 'offline' = row?.value === 'api' ? 'api' : 'offline'
      if (!alive) return
      setPreferredDataMode(mode)
      if (!row) await db.settings.put({ key: 'preferredDataMode', value: mode })

      // PWA (Standalone): wenn API nicht erreichbar und kein Token, nicht im „API warten“-Zustand hängen bleiben
      try {
        const standalone = window.matchMedia('(display-mode: standalone)').matches
        if (standalone && hasApi() && mode === 'api' && !getStoredToken()) {
          const result = await checkServerReachability('/health')
          if (!alive) return
          const ok = result.reachable || result.requiresAuth
          if (!ok) {
            mode = 'offline'
            setPreferredDataMode('offline')
            await db.settings.put({ key: 'preferredDataMode', value: 'offline' })
          }
        }
      } catch {
        /* ignore */
      }
    })()
    return () => {
      alive = false
    }
  }, [ready])

  useEffect(() => {
    if (!hasApi()) return
    let alive = true
    const probe = async () => {
      const result = await checkServerReachability('/health')
      if (!alive) return
      // Treat "auth required" (401/403) as reachable — server is up, just needs login
      setApiReachable(result.reachable || result.requiresAuth)
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
    try {
      await db.settings.put({ key: 'preferredDataMode', value: mode })
    } catch {
      /* IndexedDB nicht verfügbar — nur UI-Zustand */
    }
  }

  const resetDatabaseAndReload = async () => {
    try {
      await db.delete()
    } catch {
      // ignored
    }
    window.location.reload()
  }

  return (
    <PwaUpdateProvider>
      {!ready ? (
        dbInitFailed ? (
          <div className="mx-auto flex h-full w-full max-w-2xl flex-col items-center justify-center gap-4 px-4 text-slate-200">
            <h2 className="text-lg font-semibold">Lokale Datenbank konnte nicht vorbereitet werden.</h2>
            <p className="text-center text-sm text-slate-400">
              Die App hat beim Start Probleme mit IndexedDB oder einer Migration erkannt.
            </p>
            <div className="grid w-full gap-2 rounded-xl border border-white/10 bg-black/30 p-3 text-xs">
              <p>Schritt: {dbInitDebug.phase}</p>
              <p>IndexedDB verfügbar: {dbInitDebug.indexedDbAvailable ? 'ja' : 'nein'}</p>
              <p>Letzter Fehler: {dbInitDebug.lastError ?? 'kein Fehlertext'}</p>
              <p>Browser: {dbInitDebug.browser}</p>
              <p>Service Worker aktiv: {dbInitDebug.swActive ? 'ja' : 'nein'}</p>
              <p>App-Version: {dbInitDebug.appVersion}</p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              <button
                type="button"
                className="rounded-lg border border-white/20 px-3 py-2 text-sm font-semibold hover:bg-white/10"
                onClick={() => void resetDatabaseAndReload()}
              >
                Datenbank zurücksetzen
              </button>
              <button
                type="button"
                className="rounded-lg border border-white/20 px-3 py-2 text-sm font-semibold hover:bg-white/10"
                onClick={() => window.location.reload()}
              >
                App neu laden
              </button>
              <button
                type="button"
                className="rounded-lg border border-cyan-400/60 px-3 py-2 text-sm font-semibold text-cyan-200 hover:bg-cyan-900/30"
                onClick={() => void switchPreferredMode('api')}
              >
                Servermodus verwenden
              </button>
            </div>
            <p className="max-w-md text-center text-xs text-slate-500">
              Bevorzugter Modus wird auf API gesetzt; Anmeldung unter Admin. API erreichbar:{' '}
              {apiReachable ? 'ja' : 'nein'}.
            </p>
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-slate-300">
            <div className="h-10 w-10 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" />
            <p>Datenbank wird vorbereitet …</p>
            <p className="text-xs text-slate-500">Schritt: {dbInitDebug.phase}</p>
          </div>
        )
      ) : (
        <div className="flex h-full min-h-0 flex-col">
          <DemoBanner />
          <div className="min-h-0 flex-1">
            {preferredDataMode === 'api' && !apiReachable && (
              <div className="border-b border-amber-500/40 bg-amber-950/30 px-3 py-2 text-xs font-semibold text-amber-100">
                Server nicht erreichbar. Es wird Offline/Lokal verwendet.
                <button
                  type="button"
                  className="ml-2 rounded border border-amber-500/50 px-2 py-0.5 text-[11px] font-black hover:bg-amber-900/40"
                  onClick={() => void switchPreferredMode('offline')}
                >
                  Offline-Modus verwenden
                </button>
              </div>
            )}
            {preferredDataMode === 'api' && apiReachable && !apiJwt && (
              <div className="border-b border-sky-500/40 bg-sky-950/30 px-3 py-2 text-xs font-semibold text-sky-100">
                Server erreichbar – Anmeldung erforderlich.
                <button
                  type="button"
                  className="ml-2 rounded border border-sky-500/50 px-2 py-0.5 text-[11px] font-black hover:bg-sky-900/40"
                  onClick={() => {
                    setAdminOk(false)
                    setRoute('admin')
                  }}
                >
                  Jetzt anmelden
                </button>
              </div>
            )}
            {route === 'pos' && (
              <PosScreen
                apiJwt={hasApi() ? apiJwt : null}
                apiReachable={apiReachable}
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
                onApiLogout={
                  hasApi()
                    ? () => {
                        logOut()
                        setApiJwt(null)
                      }
                    : undefined
                }
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
