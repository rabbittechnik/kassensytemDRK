import { useEffect, useState } from 'react'
import { ensureSeed } from './db/seed'
import { PosScreen } from './pos/PosScreen'
import { AdminScreen } from './admin/AdminScreen'
import { ZReportModal } from './zreport/ZReportModal'
import { db } from './db/database'
import { sha256Hex } from './lib/pin'
import { getStoredToken, hasApi } from './api/config'
import { login, logOut } from './api/auth'

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

function ApiLoginScreen(props: { onSuccess: () => void }) {
  const [username, setUsername] = useState('kasse')
  const [pin, setPin] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    setBusy(true)
    setErr(null)
    try {
      await login(username.trim(), pin)
      props.onSuccess()
      setPin('')
    } catch {
      setErr('Anmeldung fehlgeschlagen (Benutzer/PIN).')
    }
    setBusy(false)
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 bg-black p-6 text-white">
      <div className="panel-glass w-full max-w-md rounded-2xl p-8">
        <h1 className="text-center text-2xl font-black text-[#FFD700]">DLRG Kasse · API</h1>
        <p className="mt-2 text-center text-sm text-neutral-400">
          Server‑Modus: Benutzer <code className="text-cyan-300">kasse</code> oder{' '}
          <code className="text-cyan-300">admin</code> (Standard‑PIN 1234)
        </p>
        <label className="mt-6 block text-xs font-bold uppercase text-neutral-500">
          Benutzer
          <input
            className="mt-1 w-full rounded-xl border border-white/15 bg-black px-4 py-3 text-white"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
          />
        </label>
        <label className="mt-4 block text-xs font-bold uppercase text-neutral-500">
          PIN
          <input
            type="password"
            inputMode="numeric"
            className="mt-1 w-full rounded-xl border border-white/15 bg-black px-4 py-3 text-white"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit()
            }}
            autoComplete="current-password"
          />
        </label>
        {err && <p className="mt-3 text-sm text-red-400">{err}</p>}
        <button
          type="button"
          disabled={busy || pin.length < 4}
          onClick={() => void submit()}
          className="mt-6 w-full rounded-xl bg-gradient-to-r from-rose-600 to-orange-500 py-4 font-black text-white disabled:opacity-40"
        >
          Anmelden
        </button>
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

  useEffect(() => {
    void ensureSeed().then(() => setReady(true))
  }, [])

  if (!ready) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-slate-300">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" />
        <p>Datenbank wird vorbereitet …</p>
      </div>
    )
  }

  if (hasApi() && !apiJwt) {
    return (
      <ApiLoginScreen
        onSuccess={() => {
          setApiJwt(getStoredToken())
        }}
      />
    )
  }

  return (
    <div className="h-full min-h-0">
      {route === 'pos' && (
        <PosScreen
          apiJwt={hasApi() ? apiJwt : null}
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
  )
}
