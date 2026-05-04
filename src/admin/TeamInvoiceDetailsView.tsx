import { useMemo, useState } from 'react'
import { formatMoney } from '../lib/format'
import type { TeamInvoiceDetailsModel } from './teamInvoiceDetailsModel'

function fmtDate(ts: number): string {
  return new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(ts))
}

function fmtTime(ts: number): string {
  return new Intl.DateTimeFormat('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(ts))
}

function fmtRange(firstMs: number, lastMs: number): string {
  return `${fmtDate(firstMs)} · ${fmtTime(firstMs)} ⇢ ${fmtDate(lastMs)} · ${fmtTime(lastMs)}`
}

type Props = {
  model: TeamInvoiceDetailsModel | null
  loading: boolean
  error: string | null
  canCollectiveInvoice: boolean
  onClose: () => void
  onCollectiveInvoice: () => void
  onDownloadPdf?: () => void
}

export function TeamInvoiceDetailsView(props: Props) {
  const {
    model,
    loading,
    error,
    canCollectiveInvoice,
    onClose,
    onCollectiveInvoice,
    onDownloadPdf,
  } = props

  const [receiptOpen, setReceiptOpen] = useState<
    null | { title: string; body: string }
  >(null)

  const showBonButtons = Boolean(
    model?.demoCustomerReceiptText?.trim() || model?.demoServingReceiptText?.trim(),
  )

  const periodLabel = useMemo(() => {
    if (!model) return '—'
    return fmtRange(model.firstPurchaseMs, model.lastPurchaseMs)
  }, [model])

  return (
    <>
      <div className="panel-dlrg rounded-2xl border border-cyan-500/35 bg-neutral-950/75 p-6 shadow-[0_0_48px_rgba(0,200,255,0.08)]">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 pb-4">
          <div>
            <h3 className="text-xl font-black uppercase tracking-wide text-[#FFD700]">
              Offene Teamrechnung
            </h3>
            {model?.isDemo ? (
              <p className="mt-2 rounded-lg border border-yellow-500/45 bg-yellow-950/25 px-4 py-2 text-xs font-bold leading-snug text-yellow-100">
                DEMO-MODUS – keine echte Rechnung · Daten nur simuliert
              </p>
            ) : null}
          </div>
          <button
            type="button"
            className="rounded-lg border border-white/20 px-4 py-2 text-xs font-bold uppercase tracking-wide text-neutral-300 hover:bg-white/5"
            onClick={onClose}
          >
            Zurück
          </button>
        </div>

        {loading ? (
          <p className="mt-6 text-sm font-semibold text-neutral-400">Lade Details…</p>
        ) : null}

        {error ? (
          <p className="mt-6 rounded-lg border border-red-500/40 bg-red-950/30 px-4 py-3 text-sm text-red-200">
            {error}
          </p>
        ) : null}

        {!loading && model ? (
          <>
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-[#ff003c]/35 bg-black/40 px-5 py-4">
                <p className="text-[10px] font-black uppercase tracking-wider text-[#ff003c]">
                  Team / Verein
                </p>
                <p className="mt-1 text-lg font-bold text-white">{model.teamName}</p>
              </div>
              <div className="rounded-xl border border-cyan-500/35 bg-black/40 px-5 py-4">
                <p className="text-[10px] font-black uppercase tracking-wider text-cyan-300">
                  Event / Veranstaltung
                </p>
                <p className="mt-1 text-lg font-bold text-white">{model.eventName}</p>
              </div>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-3">
              <div className="rounded-xl border border-white/10 bg-neutral-900/60 px-4 py-3">
                <p className="text-[10px] font-bold uppercase text-neutral-500">Status</p>
                <p className="mt-1 font-semibold text-neutral-100">{model.statusLabel}</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-neutral-900/60 px-4 py-3 md:col-span-2">
                <p className="text-[10px] font-bold uppercase text-neutral-500">
                  Zeitraum (erster → letzter Kauf)
                </p>
                <p className="mt-1 font-semibold text-neutral-200">{periodLabel}</p>
              </div>
            </div>

            <div className="mt-6 rounded-2xl border border-[#FFD700]/40 bg-gradient-to-br from-[#FFD700]/10 to-transparent px-6 py-5">
              <p className="text-[10px] font-black uppercase tracking-widest text-[#FFD700]">
                Gesamtsumme offen
              </p>
              <p className="mt-2 text-3xl font-black tabular-nums text-[#FFD700]">
                {formatMoney(model.totalOpenCents)}
              </p>
            </div>

            <div className="mt-8">
              <h4 className="text-sm font-black uppercase tracking-wide text-cyan-200">
                Einzelkäufe
              </h4>
              <div className="mt-3 overflow-x-auto rounded-xl border border-white/10">
                <table className="w-full min-w-[900px] text-left text-xs">
                  <thead className="bg-white/5 text-[10px] font-black uppercase tracking-wide text-neutral-400">
                    <tr>
                      <th className="px-3 py-2">Datum</th>
                      <th className="px-3 py-2">Uhrzeit</th>
                      <th className="px-3 py-2">Bon-Nr.</th>
                      <th className="px-3 py-2">Artikel</th>
                      <th className="px-3 py-2 text-right">Menge</th>
                      <th className="px-3 py-2 text-right">Einzelpreis</th>
                      <th className="px-3 py-2 text-right">Gesamtpreis</th>
                      <th className="px-3 py-2">Zahlungsart</th>
                      <th className="px-3 py-2">Notiz</th>
                    </tr>
                  </thead>
                  <tbody>
                    {model.detailLines.map((ln, idx) => (
                      <tr
                        key={`${ln.bonLabel}-${idx}-${ln.articleName}`}
                        className={
                          idx % 2 === 0 ? 'border-t border-white/5 bg-black/20' : 'border-t border-white/5'
                        }
                      >
                        <td className="whitespace-nowrap px-3 py-2 text-neutral-200">
                          {fmtDate(ln.dateMs)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-neutral-300">
                          {fmtTime(ln.dateMs)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 font-mono text-[11px] text-cyan-100">
                          {ln.bonLabel}
                        </td>
                        <td className="max-w-[220px] px-3 py-2 font-semibold text-white">
                          {ln.articleName}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{ln.qty}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-neutral-300">
                          {formatMoney(ln.unitPriceCents)}
                        </td>
                        <td className="px-3 py-2 text-right font-semibold tabular-nums text-[#FFD700]">
                          {formatMoney(ln.lineTotalCents)}
                        </td>
                        <td className="px-3 py-2 text-neutral-400">{ln.paymentLabel}</td>
                        <td className="max-w-[160px] px-3 py-2 text-[11px] text-neutral-500">
                          {ln.note ?? '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="mt-10">
              <h4 className="text-sm font-black uppercase tracking-wide text-[#FFD700]">
                Zusammenfassung nach Artikeln
              </h4>
              <div className="mt-3 overflow-x-auto rounded-xl border border-[#FFD700]/25">
                <table className="w-full min-w-[520px] text-left text-xs">
                  <thead className="bg-[#FFD700]/10 text-[10px] font-black uppercase tracking-wide text-[#FFD700]">
                    <tr>
                      <th className="px-4 py-2">Artikel</th>
                      <th className="px-4 py-2 text-right">Gesamtmenge</th>
                      <th className="px-4 py-2 text-right">Gesamtbetrag</th>
                    </tr>
                  </thead>
                  <tbody>
                    {model.summaryRows.map((s, idx) => (
                      <tr key={`${s.articleName}-${idx}`} className="border-t border-white/10">
                        <td className="px-4 py-2 font-semibold text-white">{s.articleName}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{s.totalQty}</td>
                        <td className="px-4 py-2 text-right font-bold tabular-nums text-[#FFD700]">
                          {formatMoney(s.totalCents)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="mt-8 flex flex-wrap items-center justify-end gap-3 border-t border-white/10 pt-6">
              <p className="mr-auto text-lg font-black text-white">
                Gesamt offen:{' '}
                <span className="text-[#FFD700]">{formatMoney(model.totalOpenCents)}</span>
              </p>
              {onDownloadPdf ? (
                <button
                  type="button"
                  className="rounded-xl border border-cyan-500/50 px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-cyan-200 hover:bg-cyan-500/10"
                  onClick={onDownloadPdf}
                >
                  Details als PDF
                </button>
              ) : null}
              {showBonButtons ? (
                <>
                  <button
                    type="button"
                    className="rounded-xl border border-white/20 px-4 py-2 text-[11px] font-bold uppercase text-neutral-200 hover:bg-white/5"
                    onClick={() =>
                      setReceiptOpen({
                        title: 'Kundenbon (Demo)',
                        body: model.demoCustomerReceiptText ?? '',
                      })
                    }
                    disabled={!model.demoCustomerReceiptText?.trim()}
                  >
                    Bon anzeigen
                  </button>
                  <button
                    type="button"
                    className="rounded-xl border border-white/20 px-4 py-2 text-[11px] font-bold uppercase text-neutral-200 hover:bg-white/5"
                    onClick={() =>
                      setReceiptOpen({
                        title: 'Servierbon (Demo)',
                        body: model.demoServingReceiptText ?? '',
                      })
                    }
                    disabled={!model.demoServingReceiptText?.trim()}
                  >
                    Servierbon anzeigen
                  </button>
                </>
              ) : null}
              {canCollectiveInvoice ? (
                <button
                  type="button"
                  className="rounded-xl border border-[#FFD700]/60 bg-[#FFD700]/10 px-5 py-2 text-[11px] font-black uppercase tracking-wide text-[#FFD700] hover:bg-[#FFD700]/20"
                  onClick={onCollectiveInvoice}
                >
                  Sammelrechnung erstellen
                </button>
              ) : null}
            </div>
          </>
        ) : null}
      </div>

      {receiptOpen ? (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal
        >
          <div className="panel-dlrg max-h-[85vh] w-full max-w-lg overflow-hidden rounded-2xl border border-[#ff003c]/40 shadow-xl">
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
              <h4 className="font-bold text-[#FFD700]">{receiptOpen.title}</h4>
              <button
                type="button"
                className="text-sm text-neutral-400 hover:text-white"
                onClick={() => setReceiptOpen(null)}
              >
                Schließen
              </button>
            </div>
            <pre className="max-h-[65vh] overflow-auto whitespace-pre-wrap bg-black/50 px-5 py-4 font-mono text-[11px] leading-relaxed text-neutral-200">
              {receiptOpen.body || '—'}
            </pre>
          </div>
        </div>
      ) : null}
    </>
  )
}
