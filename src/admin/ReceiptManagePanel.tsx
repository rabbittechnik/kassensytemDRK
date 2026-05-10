import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useState } from 'react'
import { db } from '../db/database'
import {
  appendReceiptReprintLog,
  bumpLocalSalePrintSuccess,
  bumpRemoteArchivePrintSuccess,
  formatReprintTextForLocalSale,
  formatReprintTextForRemoteArchive,
  getSetting,
} from '../db/sales'
import { formatMoney, formatDateTime } from '../lib/format'
import { tryBluetoothPrintPlainText } from '../receipt/bluetoothPrint'
import type { OutputReceiptStored, OutputStationKey, ReceiptReprintKind } from '../types'

function parseStoredOutputs(json?: string): OutputReceiptStored[] {
  if (!json?.trim()) return []
  try {
    const x = JSON.parse(json) as OutputReceiptStored[]
    return Array.isArray(x) ? x : []
  } catch {
    return []
  }
}

const ST_PREVIEW: Record<OutputStationKey, string> = {
  getraenke: 'Ausgabe Getränke',
  kuchen_suess: 'Ausgabe Kuchen/Süßes',
  heisses_essen: 'Ausgabe Heißes Essen',
}

export function ReceiptManagePanel() {
  const sales = useLiveQuery(async () => {
    const rows = await db.sales.orderBy('createdAt').reverse().limit(60).toArray()
    return rows.filter((s) => Boolean(s.customerReceiptText))
  }, [])
  const archives = useLiveQuery(
    () =>
      db.dualReceiptArchive.orderBy('createdAt').reverse().limit(40).toArray(),
    [],
  )
  const [preview, setPreview] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const userLabel = useCallback(async () => (await getSetting('cashierName'))?.trim() || 'Kasse', [])

  const reprintLocal = useCallback(
    async (saleId: string, kind: ReceiptReprintKind) => {
      setBusy(true)
      try {
        const txt = await formatReprintTextForLocalSale(saleId, kind)
        if (!txt) {
          alert('Kein Bon-Text vorhanden.')
          return
        }
        const res = await tryBluetoothPrintPlainText(txt)
        if (res.ok) {
          const u = await userLabel()
          await appendReceiptReprintLog({
            saleRef: saleId,
            kind,
            at: Date.now(),
            userLabel: u,
          })
          await bumpLocalSalePrintSuccess(saleId, kind)
        } else {
          alert(`Bon konnte nicht gedruckt werden.\n${res.message}`)
        }
      } finally {
        setBusy(false)
      }
    },
    [userLabel],
  )

  const reprintRemote = useCallback(
    async (archiveId: string, kind: ReceiptReprintKind) => {
      setBusy(true)
      try {
        const txt = await formatReprintTextForRemoteArchive(archiveId, kind)
        if (!txt) {
          alert('Kein Bon-Text vorhanden.')
          return
        }
        const res = await tryBluetoothPrintPlainText(txt)
        if (res.ok) {
          const u = await userLabel()
          await appendReceiptReprintLog({
            saleRef: `arch:${archiveId}`,
            kind,
            at: Date.now(),
            userLabel: u,
          })
          await bumpRemoteArchivePrintSuccess(archiveId, kind)
        } else {
          alert(`Bon konnte nicht gedruckt werden.\n${res.message}`)
        }
      } finally {
        setBusy(false)
      }
    },
    [userLabel],
  )

  return (
    <div className="mt-8 space-y-4 border-t border-white/10 pt-6">
      <h3 className="text-lg font-semibold text-white">Bon‑Verwaltung / Nachdruck</h3>
      <p className="text-xs text-slate-400">
        Nachdrucke sind mit «KOPIE / NACHDRUCK» gekennzeichnet und werden protokolliert. Es wird kein neuer
        Umsatz erzeugt.
      </p>

      {preview && (
        <div className="rounded-xl border border-cyan-500/30 bg-black/50 p-3">
          <div className="mb-2 flex justify-between gap-2">
            <span className="text-xs text-cyan-200">Vorschau</span>
            <button
              type="button"
              className="text-xs text-neutral-400 underline"
              onClick={() => setPreview(null)}
            >
              Schließen
            </button>
          </div>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-neutral-200">
            {preview}
          </pre>
        </div>
      )}

      <div>
        <h4 className="text-sm font-bold text-[#FFD700]">Lokale Verkäufe</h4>
        <ul className="mt-2 space-y-2 text-sm">
          {(sales ?? []).map((s) => {
            const outs = parseStoredOutputs(s.outputReceiptsJson)
            const legacyServing =
              !!(s.servingReceiptText ?? '').trim() && outs.length === 0
            return (
              <li
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2"
              >
                <span className="text-neutral-300">
                  Bon {s.receiptNo} · {formatDateTime(s.createdAt)} · {formatMoney(s.totalCents)} ·{' '}
                  {s.paymentMethod}
                </span>
                <span className="flex max-w-full flex-wrap gap-1">
                  <button
                    type="button"
                    disabled={busy}
                    className="rounded border border-white/20 px-2 py-1 text-[11px] text-neutral-200"
                    onClick={async () =>
                      setPreview((await formatReprintTextForLocalSale(s.id, 'customer')) ?? null)
                    }
                  >
                    Kundenbon
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    className="rounded border border-cyan-600/40 px-2 py-1 text-[11px] text-cyan-200"
                    onClick={() => void reprintLocal(s.id, 'customer')}
                  >
                    Kunde drucken
                  </button>
                  {outs.map((o) => (
                    <span key={o.type} className="inline-flex flex-wrap gap-1">
                      <button
                        type="button"
                        disabled={busy}
                        className="rounded border border-white/20 px-2 py-1 text-[11px] text-neutral-200"
                        onClick={async () =>
                          setPreview(
                            (await formatReprintTextForLocalSale(s.id, o.type)) ?? null,
                          )
                        }
                      >
                        {ST_PREVIEW[o.type]}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        className="rounded border border-amber-600/40 px-2 py-1 text-[11px] text-amber-200"
                        onClick={() => void reprintLocal(s.id, o.type)}
                      >
                        Drucken
                      </button>
                    </span>
                  ))}
                  {legacyServing ? (
                    <span className="inline-flex flex-wrap gap-1">
                      <button
                        type="button"
                        disabled={busy}
                        className="rounded border border-white/20 px-2 py-1 text-[11px] text-neutral-200"
                        onClick={async () =>
                          setPreview((await formatReprintTextForLocalSale(s.id, 'serving')) ?? null)
                        }
                      >
                        Servierbon (Alt)
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        className="rounded border border-amber-600/40 px-2 py-1 text-[11px] text-amber-200"
                        onClick={() => void reprintLocal(s.id, 'serving')}
                      >
                        Servier drucken
                      </button>
                    </span>
                  ) : null}
                </span>
              </li>
            )
          })}
        </ul>
      </div>

      <div>
        <h4 className="text-sm font-bold text-[#FFD700]">Server‑Verkäufe (lokal zwischengespeichert)</h4>
        <ul className="mt-2 space-y-2 text-sm">
          {(archives ?? []).map((a) => {
            const outs = parseStoredOutputs(a.outputReceiptsJson)
            const legacyServing =
              !!(a.servingReceiptText ?? '').trim() && outs.length === 0
            return (
              <li
                key={a.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2"
              >
                <span className="text-neutral-300">
                  Bon {a.receiptNo} · {formatDateTime(a.createdAt)} · {formatMoney(a.totalCents)} ·{' '}
                  {a.paymentMethod}
                </span>
                <span className="flex max-w-full flex-wrap gap-1">
                  <button
                    type="button"
                    disabled={busy}
                    className="rounded border border-white/20 px-2 py-1 text-[11px] text-neutral-200"
                    onClick={async () =>
                      setPreview((await formatReprintTextForRemoteArchive(a.id, 'customer')) ?? null)
                    }
                  >
                    Kundenbon
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    className="rounded border border-cyan-600/40 px-2 py-1 text-[11px] text-cyan-200"
                    onClick={() => void reprintRemote(a.id, 'customer')}
                  >
                    Kunde drucken
                  </button>
                  {outs.map((o) => (
                    <span key={`${a.id}-${o.type}`} className="inline-flex flex-wrap gap-1">
                      <button
                        type="button"
                        disabled={busy}
                        className="rounded border border-white/20 px-2 py-1 text-[11px] text-neutral-200"
                        onClick={async () =>
                          setPreview(
                            (await formatReprintTextForRemoteArchive(a.id, o.type)) ?? null,
                          )
                        }
                      >
                        {ST_PREVIEW[o.type]}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        className="rounded border border-amber-600/40 px-2 py-1 text-[11px] text-amber-200"
                        onClick={() => void reprintRemote(a.id, o.type)}
                      >
                        Drucken
                      </button>
                    </span>
                  ))}
                  {legacyServing ? (
                    <span className="inline-flex flex-wrap gap-1">
                      <button
                        type="button"
                        disabled={busy}
                        className="rounded border border-white/20 px-2 py-1 text-[11px] text-neutral-200"
                        onClick={async () =>
                          setPreview(
                            (await formatReprintTextForRemoteArchive(a.id, 'serving')) ?? null,
                          )
                        }
                      >
                        Servierbon (Alt)
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        className="rounded border border-amber-600/40 px-2 py-1 text-[11px] text-amber-200"
                        onClick={() => void reprintRemote(a.id, 'serving')}
                      >
                        Servier drucken
                      </button>
                    </span>
                  ) : null}
                </span>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
