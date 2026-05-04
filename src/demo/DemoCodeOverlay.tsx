import { useState } from 'react'
import { enterDemoMode } from './demoStore'
import { logDemoModeAudit } from './demoAudit'

/**
 * Code-Eingabe zum Aktivieren des Demo-Modus.
 * Aktivierung NUR mit korrektem Demo-Code (2005). Falscher Code zeigt
 * "Falscher Demo-Code" und verweigert Zugriff. Der Code ist NICHT
 * identisch mit dem Admin-PIN.
 */
export function DemoCodeOverlay(props: { onClose: () => void }) {
  const { onClose } = props
  const [code, setCode] = useState('')
  const [err, setErr] = useState<string | null>(null)

  function submit() {
    setErr(null)
    const ok = enterDemoMode(code)
    if (!ok) {
      setErr('Falscher Demo-Code')
      return
    }
    void logDemoModeAudit('enter')
    setCode('')
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/85 p-4 backdrop-blur-md">
      <div
        className="w-full max-w-sm rounded-2xl border-2 border-yellow-400/50 p-7 text-center shadow-[0_0_60px_rgba(255,215,0,0.25)]"
        style={{
          background:
            'linear-gradient(160deg, rgba(20,8,20,0.98) 0%, rgba(8,8,15,0.98) 100%)',
        }}
      >
        <h2 className="text-xl font-black uppercase tracking-wider text-yellow-300">
          Demo-Modus
        </h2>
        <p className="mt-2 text-sm font-semibold text-yellow-200/80">
          Nur für Vorführungen. Es werden KEINE echten Verkäufe oder Buchungen
          gespeichert.
        </p>
        <p className="mt-2 text-xs text-neutral-400">
          Demo-Code eingeben:
        </p>
        <input
          type="password"
          inputMode="numeric"
          autoFocus
          className="mt-4 w-full rounded-xl border-2 border-yellow-500/40 bg-black/60 px-4 py-4 text-center text-2xl tracking-widest text-yellow-100"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
        />
        {err && (
          <p className="mt-3 rounded-lg border border-red-500/40 bg-red-950/40 px-3 py-2 text-sm font-semibold text-red-200">
            {err}
          </p>
        )}
        <div className="mt-6 flex gap-2">
          <button
            type="button"
            className="flex-1 rounded-xl border border-white/15 py-3 font-bold text-slate-200"
            onClick={() => {
              setCode('')
              setErr(null)
              onClose()
            }}
          >
            Abbrechen
          </button>
          <button
            type="button"
            disabled={code.length === 0}
            className="flex-1 rounded-xl bg-gradient-to-r from-rose-600 via-amber-500 to-rose-600 py-3 font-black uppercase text-black disabled:opacity-40"
            onClick={submit}
          >
            Demo starten
          </button>
        </div>
      </div>
    </div>
  )
}
