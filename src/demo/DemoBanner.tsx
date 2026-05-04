import { exitDemoMode, useDemoMode } from './demoStore'
import { logDemoModeAudit } from './demoAudit'

/**
 * Globaler Banner, der den aktiven Demo-Modus in der gesamten App
 * unmissverstaendlich kennzeichnet.
 */
export function DemoBanner() {
  const active = useDemoMode()
  if (!active) return null
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-yellow-400/80 bg-gradient-to-r from-rose-700 via-amber-500 to-rose-700 px-3 py-2 text-center text-[12px] font-black uppercase tracking-wide text-black shadow-[0_0_24px_rgba(255,200,0,0.45)]"
    >
      <span className="flex-1 text-shadow">
        ⚠ DEMO-MODUS AKTIV — Verkäufe, Rechnungen und Tagesabschlüsse werden
        NICHT echt gespeichert.
      </span>
      <button
        type="button"
        onClick={() => {
          void logDemoModeAudit('leave')
          exitDemoMode()
        }}
        className="rounded-md border-2 border-black bg-black/85 px-3 py-1 text-[11px] font-black uppercase tracking-wide text-yellow-300 hover:bg-black"
      >
        Demo-Modus verlassen
      </button>
    </div>
  )
}
