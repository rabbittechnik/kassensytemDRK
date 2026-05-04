import { useEffect } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/database'
import { formatMoney } from '../lib/format'
import { useDemoMode } from '../demo/demoStore'

export function CardPaymentModal(props: {
  totalCents: number
  onCancel: () => void
  onConfirmSuccess: () => void | Promise<void>
}) {
  const { totalCents, onCancel, onConfirmSuccess } = props
  const demoMode = useDemoMode()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const note = useLiveQuery(
    () => db.settings.where('key').equals('sumupNote').first(),
    [],
  )

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 p-4 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal
      aria-labelledby="card-title"
    >
      <div className="panel-dlrg max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-[#ff003c]/40 p-6 shadow-[0_0_60px_rgba(255,0,60,0.2)]">
        <h2 id="card-title" className="text-xl font-black text-[#FFD700]">
          {demoMode ? 'Kartenzahlung (DEMO – simuliert)' : 'Kartenzahlung (SumUp / App)'}
        </h2>
        {demoMode ? (
          <p className="mt-2 rounded-lg border border-yellow-500/40 bg-yellow-950/20 px-3 py-2 text-sm font-bold text-yellow-200">
            DEMO-Modus: Es wird KEIN echtes SumUp/Terminal angesprochen.
            Kartenzahlung wird nur simuliert.
          </p>
        ) : (
          <p className="mt-2 text-sm font-semibold text-neutral-400">
            Eine direkte Schnittstellen-Anbindung ist im Browser meist nicht
            verfügbar. Bitte Betrag in SumUp (oder vergleichbare App) eingeben und
            Zahlung am Kartenterminal durchführen. Esc oder „Zurück“ schließt ohne
            Verbuchen.
          </p>
        )}
        <div className="mt-6 rounded-2xl border-2 border-[#FFD700]/50 bg-black/60 px-4 py-5 text-center shadow-[0_0_24px_rgba(255,215,0,0.12)]">
          <div className="text-sm font-bold uppercase tracking-wider text-neutral-400">
            Zu zahlen
          </div>
          <div className="mt-1 text-4xl font-black text-[#FFD700]">
            {formatMoney(totalCents)}
          </div>
        </div>
        {note?.value != null && note.value !== '' && (
          <p className="mt-4 rounded-xl border border-white/10 bg-black/40 p-3 text-sm text-neutral-300">
            {note.value}
          </p>
        )}
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            className="rounded-xl border border-neutral-600 bg-neutral-900 px-4 py-3 font-bold text-neutral-200 hover:border-[#FFD700]/40"
            onClick={onCancel}
          >
            ← Zurück zur Kasse
          </button>
          <button
            type="button"
            className="rounded-xl border-2 border-[#ff003c] bg-red-950/40 px-4 py-3 font-black text-white shadow-[0_0_24px_rgba(255,0,60,0.25)] hover:bg-red-950/60"
            onClick={() => void onConfirmSuccess()}
          >
            {demoMode ? 'Kartenzahlung simulieren' : 'Kartenzahlung erfolgreich'}
          </button>
        </div>
      </div>
    </div>
  )
}
