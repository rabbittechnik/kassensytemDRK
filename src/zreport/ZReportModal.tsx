import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { db } from '../db/database'
import { todayKey, formatMoney } from '../lib/format'
import { exportDayReportPdf, exportSalesCsv } from '../export/exportSales'
import { useDemoMode, useDemoSales } from '../demo/demoStore'
import { exportDemoDayReportPdf, exportDemoSalesCsv } from '../export/exportDemo'
import { tryBluetoothPrintPlainText } from '../receipt/bluetoothPrint'
import { getStoredToken } from '../api/config'
import { ApiError } from '../api/http'
import {
  apiCreateDailyClosing,
  apiDownloadDailyClosingFile,
  downloadBlobAsFile,
} from '../api/dailyClosing'
import { buildZBonPlainText } from './zBonFormat'

export function ZReportModal(props: { dataMode: 'api' | 'offline'; onClose: () => void }) {
  const demoMode = useDemoMode()
  const demoSales = useDemoSales()
  const dayKey = useMemo(() => todayKey(), [])
  const isServerMode = props.dataMode === 'api' && Boolean(getStoredToken()) && !demoMode

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [statusMsg, setStatusMsg] = useState<string | null>(null)

  const salesTodayDex = useLiveQuery(
    () => db.sales.where('dayKey').equals(dayKey).toArray(),
    [dayKey],
  )

  const linesTodayDex = useLiveQuery(async () => {
    const sales = await db.sales.where('dayKey').equals(dayKey).toArray()
    const ids = new Set(sales.map((s) => s.id))
    const all = await db.saleLines.toArray()
    return all.filter((l) => ids.has(l.saleId))
  }, [dayKey])

  const categories = useLiveQuery(() => db.categories.toArray(), [])

  const categoryNames = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of categories ?? []) m.set(c.id, c.name)
    if (demoMode) {
      for (const s of demoSales) {
        for (const l of s.lines) {
          if (!m.has(l.categoryId)) m.set(l.categoryId, l.categoryName)
        }
      }
    }
    return m
  }, [categories, demoMode, demoSales])

  const salesToday = demoMode
    ? demoSales.filter((s) => s.dayKey === dayKey)
    : salesTodayDex

  const byCategory = useMemo(() => {
    const m = new Map<string, number>()
    if (demoMode) {
      for (const s of demoSales.filter((x) => x.dayKey === dayKey)) {
        for (const l of s.lines) {
          m.set(l.categoryId, (m.get(l.categoryId) ?? 0) + l.lineTotalCents)
        }
      }
    } else {
      for (const l of linesTodayDex ?? []) {
        m.set(l.categoryId, (m.get(l.categoryId) ?? 0) + l.lineTotalCents)
      }
    }
    return m
  }, [demoMode, demoSales, dayKey, linesTodayDex])

  const cashTotal =
    salesToday?.filter((s) => s.paymentMethod === 'cash').reduce((a, s) => a + s.totalCents, 0) ??
    0
  const cardTotal =
    salesToday?.filter((s) => s.paymentMethod === 'card').reduce((a, s) => a + s.totalCents, 0) ??
    0
  const invoiceTotal =
    salesToday?.filter((s) => s.paymentMethod === 'invoice').reduce((a, s) => a + s.totalCents, 0) ??
    0

  const grand =
    (salesToday ?? []).reduce((a, s) => a + s.totalCents, 0) ?? 0

  async function runZBonAfterConfirm() {
    setBusy(true)
    setStatusMsg(null)
    try {
      if (demoMode) {
        exportDemoDayReportPdf(dayKey, demoSales)
        const byCatLines = [...byCategory.entries()].map(([id, cents]) => ({
          label: categoryNames.get(id) ?? id,
          cents,
        }))
        const printText = buildZBonPlainText({
          headline: 'Z-Bon (DEMO)',
          dayKey,
          closingLine: 'DEMO – kein Server-Abschluss',
          salesCount: salesToday?.length ?? 0,
          cashCents: cashTotal,
          cardCents: cardTotal,
          invoiceCents: invoiceTotal,
          grandCents: grand,
          byCategory: byCatLines,
          tailLines: ['Dieser Bon ist eine Simulation.'],
        })
        const pr = await tryBluetoothPrintPlainText(printText)
        setStatusMsg(
          pr.ok
            ? 'Demo: PDF gespeichert, Z-Bon an Drucker gesendet.'
            : `Demo: PDF gespeichert. Druck: ${pr.message}`,
        )
        return
      }

      if (isServerMode) {
        const created = await apiCreateDailyClosing({ dayKey })
        const blob = await apiDownloadDailyClosingFile(created.id, 'pdf')
        const name =
          created.pdfRelPath?.split('/').pop() ?? `z-bon-${created.closingNumber}-${dayKey}.pdf`
        downloadBlobAsFile(blob, name)

        const byCatLines = (created.byCategory ?? []).map((row) => ({
          label: categoryNames.get(row.categoryId) ?? row.categoryId,
          cents: row.totalCents,
        }))
        const printText = buildZBonPlainText({
          headline: 'Z-Bon / Tagesabschluss',
          dayKey: created.dayKey ?? dayKey,
          closingLine: `Abschluss-Nr. ${String(created.closingNumber).padStart(6, '0')}`,
          salesCount: created.salesCount,
          cashCents: created.cashTotalCents,
          cardCents: created.cardTotalCents,
          invoiceCents: created.invoiceTotalCents,
          grandCents: created.grossTotalCents,
          stornoCount: created.stornoCount,
          stornoTotalCents: created.stornoTotalCents,
          depositBalanceCents: created.depositBalanceCents,
          byCategory: byCatLines,
          tailLines: [
            'Server: Verkaeufe dieses Tages sind abgeschlossen.',
            created.backupRel ? `Backup: ${created.backupRel}` : '',
          ],
        })
        const pr = await tryBluetoothPrintPlainText(printText)
        setStatusMsg(
          pr.ok
            ? 'Tag auf dem Server abgeschlossen. PDF heruntergeladen, Z-Bon gedruckt.'
            : `Tag abgeschlossen, PDF heruntergeladen. Druck: ${pr.message}`,
        )
        return
      }

      await exportDayReportPdf(dayKey)
      const byCatLines = [...byCategory.entries()].map(([id, cents]) => ({
        label: categoryNames.get(id) ?? id,
        cents,
      }))
      const printText = buildZBonPlainText({
        headline: 'Z-Bon (lokal)',
        dayKey,
        closingLine: 'Lokal – kein Server-Tagesabschluss',
        salesCount: salesToday?.length ?? 0,
        cashCents: cashTotal,
        cardCents: cardTotal,
        invoiceCents: invoiceTotal,
        grandCents: grand,
        byCategory: byCatLines,
        tailLines: [
          'Hinweis: Ohne Server-Modus gibt es keine zentrale Sperre der Verkaeufe.',
        ],
      })
      const pr = await tryBluetoothPrintPlainText(printText)
      setStatusMsg(
        pr.ok
          ? 'PDF-Übersicht gespeichert, Z-Bon an Drucker gesendet.'
          : `PDF gespeichert. Druck: ${pr.message}`,
      )
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? String(e.message ?? e)
          : String((e as Error)?.message ?? e)
      setStatusMsg(`Fehler: ${msg}`)
    } finally {
      setBusy(false)
      setConfirmOpen(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 p-4 backdrop-blur-md sm:items-center"
      role="dialog"
      aria-modal
    >
      <div className="panel-dlrg max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl p-6 shadow-[0_0_40px_rgba(255,0,60,0.15)]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold text-white">
              {demoMode ? 'Tagesabschluss (DEMO – simuliert)' : 'Tagesabschluss'}
            </h2>
            <p className="text-slate-400">Kalendertag {dayKey}</p>
            {demoMode && (
              <p className="mt-2 rounded-lg border border-yellow-500/40 bg-yellow-950/25 px-3 py-2 text-xs font-bold text-yellow-200">
                DEMO-Tagesabschluss – nicht echt gespeichert. Nur Demo-Verkäufe
                werden ausgewertet.
              </p>
            )}
            {isServerMode && (
              <p className="mt-2 text-xs text-slate-500">
                Online-Modus: Z-Bon schließt den Tag auf dem Server (keine weiteren Stornos für
                diesen Tag).
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={props.onClose}
            className="rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-slate-200 hover:bg-white/10"
          >
            Schließen
          </button>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
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
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
            <div className="text-xs uppercase text-amber-200/90">Auf Rechnung</div>
            <div className="mt-1 text-2xl font-bold text-white">
              {formatMoney(invoiceTotal)}
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
            disabled={busy}
            className="rounded-xl bg-gradient-to-r from-emerald-600 to-teal-500 px-4 py-3 font-semibold text-white shadow-[0_0_24px_rgba(16,185,129,0.25)] hover:brightness-110 disabled:opacity-40"
            onClick={() => {
              setStatusMsg(null)
              setConfirmOpen(true)
            }}
          >
            Z-Bon: Tag abschließen (PDF &amp; Druck)
          </button>
          {!isServerMode && (
            <>
              <button
                type="button"
                disabled={busy}
                className="rounded-xl border border-white/15 bg-white/5 px-4 py-3 font-medium text-slate-100 hover:bg-white/10 disabled:opacity-40"
                onClick={() =>
                  demoMode
                    ? exportDemoSalesCsv(dayKey, demoSales)
                    : void exportSalesCsv(dayKey)
                }
              >
                {demoMode ? 'Demo-CSV (Tag)' : 'CSV (Tag)'}
              </button>
              <button
                type="button"
                disabled={busy}
                className="rounded-xl border border-white/15 bg-white/5 px-4 py-3 font-medium text-slate-100 hover:bg-white/10 disabled:opacity-40"
                onClick={() =>
                  demoMode
                    ? exportDemoDayReportPdf(dayKey, demoSales)
                    : void exportDayReportPdf(dayKey)
                }
              >
                {demoMode ? 'Demo-PDF (nur Übersicht)' : 'PDF-Übersicht (ohne Abschluss)'}
              </button>
            </>
          )}
        </div>
        {statusMsg && (
          <p className="mt-3 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-slate-200">
            {statusMsg}
          </p>
        )}
        <p className="mt-4 text-xs text-slate-500">
          Hinweis: Steuerrechtlich ist ein fiskalischer Z‑Bon ggf. gesondert
          erforderlich – diese Übersicht dient der Vereinsinternen Kontrolle.
        </p>
      </div>

      {confirmOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4"
          role="alertdialog"
          aria-modal
          aria-labelledby="zbon-confirm-title"
        >
          <div className="w-full max-w-md rounded-2xl border border-white/15 bg-neutral-950 p-6 shadow-2xl">
            <h3 id="zbon-confirm-title" className="text-lg font-bold text-white">
              Tag wirklich abschließen?
            </h3>
            <p className="mt-3 text-sm leading-relaxed text-slate-300">
              {demoMode ?
                <>
                  Es wird eine <strong className="text-white">Demo-PDF</strong> erzeugt und ein{' '}
                  <strong className="text-white">Z-Bon</strong> an den Bondrucker gesendet (falls
                  verbunden). Es erfolgt <strong className="text-white">keine</strong> echte
                  Server-Buchung.
                </>
              : isServerMode ?
                <>
                  Der Kalendertag <strong className="text-white">{dayKey}</strong> wird auf dem{' '}
                  <strong className="text-white">Server</strong> abgeschlossen. Die zugehörigen
                  Verkäufe können danach nicht mehr storniert werden. Es werden ein PDF erzeugt und
                  ein Z-Bon gedruckt.
                </>
              : <>
                  Es wird die <strong className="text-white">lokale PDF-Übersicht</strong> gespeichert
                  und ein <strong className="text-white">Z-Bon</strong> gedruckt. Ohne
                  Server-Modus gibt es <strong className="text-white">keinen</strong> zentralen
                  Tagesabschluss auf dem Server.
                </>
              }
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                className="flex-1 rounded-xl border border-white/20 py-3 font-medium text-slate-200 hover:bg-white/5 disabled:opacity-40"
                onClick={() => !busy && setConfirmOpen(false)}
              >
                Nein, abbrechen
              </button>
              <button
                type="button"
                disabled={busy}
                className="flex-1 rounded-xl bg-gradient-to-r from-rose-600 to-orange-500 py-3 font-bold text-white disabled:opacity-40"
                onClick={() => void runZBonAfterConfirm()}
              >
                {busy ? 'Bitte warten …' : 'Ja, abschließen'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
