import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/database'
import { formatMoney } from '../lib/format'

export function CardPaymentModal(props: {
  totalCents: number
  onCancel: () => void
  onConfirmSuccess: () => void | Promise<void>
}) {
  const note = useLiveQuery(
    () => db.settings.where('key').equals('sumupNote').first(),
    [],
  )

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal
      aria-labelledby="card-title"
    >
      <div className="panel-glass max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl p-6 shadow-[0_0_60px_rgba(34,211,238,0.15)]">
        <h2 id="card-title" className="text-xl font-bold text-white">
          Kartenzahlung (SumUp / App)
        </h2>
        <p className="mt-2 text-sm text-slate-400">
          Eine direkte Schnittstellen-Anbindung ist im Browser meist nicht
          verfügbar. Bitte Betrag in SumUp (oder vergleichbare App) eingeben und
          Zahlung am Kartenterminal durchführen.
        </p>
        <div className="mt-6 rounded-2xl border border-violet-500/30 bg-violet-500/10 px-4 py-5 text-center">
          <div className="text-sm uppercase tracking-wider text-violet-200/80">
            Zu zahlen
          </div>
          <div className="mt-1 text-4xl font-bold text-white">
            {formatMoney(props.totalCents)}
          </div>
        </div>
        {note?.value != null && note.value !== '' && (
          <p className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3 text-sm text-slate-300">
            {note.value}
          </p>
        )}
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            className="rounded-xl border border-white/15 bg-white/5 px-4 py-3 font-semibold text-slate-100 hover:bg-white/10"
            onClick={props.onCancel}
          >
            Abbrechen
          </button>
          <button
            type="button"
            className="rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 px-4 py-3 font-bold text-white shadow-[0_0_28px_rgba(139,92,246,0.35)] hover:brightness-110"
            onClick={() => void props.onConfirmSuccess()}
          >
            Kartenzahlung erfolgreich
          </button>
        </div>
      </div>
    </div>
  )
}
