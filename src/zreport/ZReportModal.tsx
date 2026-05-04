import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo } from 'react'
import { db } from '../db/database'
import { todayKey, formatMoney } from '../lib/format'
import { exportDayReportPdf, exportSalesCsv } from '../export/exportSales'

export function ZReportModal(props: { onClose: () => void }) {
  const dayKey = useMemo(() => todayKey(), [])

  const salesToday = useLiveQuery(
    () => db.sales.where('dayKey').equals(dayKey).toArray(),
    [dayKey],
  )

  const linesToday = useLiveQuery(async () => {
    const sales = await db.sales.where('dayKey').equals(dayKey).toArray()
    const ids = new Set(sales.map((s) => s.id))
    const all = await db.saleLines.toArray()
    return all.filter((l) => ids.has(l.saleId))
  }, [dayKey])

  const categories = useLiveQuery(() => db.categories.toArray(), [])

  const categoryNames = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of categories ?? []) m.set(c.id, c.name)
    return m
  }, [categories])

  const byCategory = useMemo(() => {
    const m = new Map<string, number>()
    for (const l of linesToday ?? []) {
      const key = l.categoryId
      m.set(key, (m.get(key) ?? 0) + l.lineTotalCents)
    }
    return m
  }, [linesToday])

  const cashTotal =
    salesToday?.filter((s) => s.paymentMethod === 'cash').reduce((a, s) => a + s.totalCents, 0) ??
    0
  const cardTotal =
    salesToday?.filter((s) => s.paymentMethod === 'card').reduce((a, s) => a + s.totalCents, 0) ??
    0

  const grand =
    (salesToday ?? []).reduce((a, s) => a + s.totalCents, 0) ?? 0

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 p-4 backdrop-blur-md sm:items-center"
      role="dialog"
      aria-modal
    >
      <div className="panel-glass max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl p-6 shadow-[0_0_60px_rgba(59,130,246,0.2)]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold text-white">Tages­abschluss</h2>
            <p className="text-slate-400">Kalendertag {dayKey}</p>
          </div>
          <button
            type="button"
            onClick={props.onClose}
            className="rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-slate-200 hover:bg-white/10"
          >
            Schließen
          </button>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <div className="rounded-2xl border border-cyan-500/25 bg-cyan-500/5 p-4">
            <div className="text-xs uppercase text-cyan-200/80">Verkäufe</div>
            <div className="mt-1 text-3xl font-bold text-white">
              {salesToday?.length ?? '…'}
            </div>
          </div>
          <div className="rounded-2xl border border-blue-500/25 bg-blue-500/5 p-4">
            <div className="text-xs uppercase text-blue-200/80">Bar</div>
            <div className="mt-1 text-2xl font-bold text-white">
              {formatMoney(cashTotal)}
            </div>
          </div>
          <div className="rounded-2xl border border-violet-500/25 bg-violet-500/5 p-4">
            <div className="text-xs uppercase text-violet-200/80">Karte</div>
            <div className="mt-1 text-2xl font-bold text-white">
              {formatMoney(cardTotal)}
            </div>
          </div>
        </div>

        <div className="mt-6 rounded-2xl border border-white/10 bg-black/20 p-4">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
            Nach Kategorie
          </h3>
          <ul className="mt-3 space-y-2">
            {[...byCategory.entries()].length === 0 && (
              <li className="text-slate-500">Noch keine Umsätze heute.</li>
            )}
            {[...byCategory.entries()].map(([catId, cents]) => (
              <li
                key={catId}
                className="flex justify-between rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2"
              >
                <span className="text-slate-200">
                  {categoryNames.get(catId) ?? catId}
                </span>
                <span className="font-semibold text-cyan-100 tabular-nums">
                  {formatMoney(cents)}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex items-baseline justify-between border-t border-white/10 pt-4">
            <span className="text-lg font-semibold text-slate-200">Summe</span>
            <span className="text-2xl font-bold text-white">
              {formatMoney(grand)}
            </span>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-xl border border-white/15 bg-white/5 px-4 py-3 font-medium text-slate-100 hover:bg-white/10"
            onClick={() => void exportSalesCsv(dayKey)}
          >
            CSV (Tag)
          </button>
          <button
            type="button"
            className="rounded-xl bg-gradient-to-r from-blue-600 to-cyan-500 px-4 py-3 font-semibold text-white shadow-[0_0_24px_rgba(59,130,246,0.3)] hover:brightness-110"
            onClick={() => void exportDayReportPdf(dayKey)}
          >
            PDF‑Bericht
          </button>
        </div>
        <p className="mt-4 text-xs text-slate-500">
          Hinweis: Steuerrechtlich ist ein fiskalischer Z‑Bon ggf. gesondert
          erforderlich – diese Übersicht dient der Vereinsinternen Kontrolle.
        </p>
      </div>
    </div>
  )
}
