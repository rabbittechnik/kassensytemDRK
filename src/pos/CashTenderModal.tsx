import { useState } from 'react'
import { formatMoney } from '../lib/format'
import { parseEurosToCents } from '../lib/euroParse'

export function CashTenderModal(props: {
  totalCents: number
  onCancel: () => void
  onConfirm: (amountTenderedCents: number) => void | Promise<void>
}) {
  const [raw, setRaw] = useState('')
  const [err, setErr] = useState<string | null>(null)

  function submit() {
    setErr(null)
    const given = parseEurosToCents(raw)
    if (given === null || given < props.totalCents) {
      setErr('Betrag zu niedrig oder ungültig.')
      return
    }

    void props.onConfirm(given)
  }

  const changePreview =
    (() => {
      const given = parseEurosToCents(raw)

      return given !== null && given >= props.totalCents ? given - props.totalCents : null
    })()

  return (
    <div
      className="fixed inset-0 z-[62] flex items-end justify-center bg-black/85 p-4 backdrop-blur-md sm:items-center"
      role="dialog"
      aria-modal
    >
      <div className="panel-dlrg max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-[#ff003c]/50 p-6 shadow-[0_0_60px_rgba(255,0,60,0.35)]">
        <h2 className="text-xl font-black text-[#FFD700]">Barzahlung</h2>

        <p className="mt-2 text-sm font-semibold text-neutral-400">
          Gegeben-Betrag (EUR) eingeben. Rückgeld wird angezeigt.
        </p>

        <div className="mt-5 rounded-2xl border-2 border-[#FFD700]/40 bg-black/60 px-4 py-4 text-center">
          <div className="text-xs font-bold uppercase text-neutral-500">Zu zahlen</div>
          <div className="mt-1 text-3xl font-black text-[#FFD700]">{formatMoney(props.totalCents)}</div>
        </div>

        <label className="mt-5 block text-sm font-semibold text-white">
          Vom Kunden erhalten

          <input
            autoFocus
            inputMode="decimal"

            placeholder="z. B. 20,00"
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            className="mt-2 w-full rounded-xl border-2 border-[#ff003c]/35 bg-neutral-950 px-4 py-4 text-center text-2xl font-black text-white outline-none focus:border-[#FFD700]/60"

            onKeyDown={(k) => {
              if (k.key === 'Enter') submit()

            }}

          />

        </label>

        {changePreview !== null ? (
          <div className="mt-5 rounded-xl border border-[#FFD700]/30 bg-yellow-950/20 px-4 py-4 text-center">
            <span className="text-xs font-bold uppercase text-neutral-400">Rückgeld</span>
            <div className="text-4xl font-black text-[#FFD700]">{formatMoney(changePreview)}</div>
          </div>
        ) : null}

        {err && (
          <p className="mt-3 rounded-lg bg-red-950/40 px-3 py-2 text-sm font-semibold text-red-300">
            {err}
          </p>
        )}

        <div className="mt-6 flex flex-wrap gap-2 sm:justify-end">
          <button
            type="button"
            onClick={props.onCancel}
            className="rounded-xl border border-neutral-600 bg-neutral-900 px-4 py-3 font-bold text-neutral-100"

          >
            Abbrechen
          </button>
          <button
            type="button"
            onClick={submit}

            className="rounded-xl border-2 border-[#ff003c] bg-red-950/50 px-4 py-3 font-black text-white shadow-[0_0_24px_rgba(255,0,60,0.25)] hover:bg-red-950/65"

          >
            Verbuchen / Druck
          </button>
        </div>
      </div>
    </div>
  )

}
