import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { format } from 'date-fns'
import { de } from 'date-fns/locale'
import { db } from '../db/database'
import { saveSale, getSetting } from '../db/sales'
import type { CartLine, PaymentMethod } from '../types'
import type { ReceiptPayload } from '../receipt/escpos'
import { formatMoney, todayKey } from '../lib/format'
import { receiptAsPlainText } from '../receipt/escpos'
import {
  downloadTextFile,
  tryBluetoothPrint,
} from '../receipt/bluetoothPrint'
import { CardPaymentModal } from './CardPaymentModal'
import { SuccessToast } from './SuccessToast'
import { ProductVisual } from './productVisual'

function tabCls(active: boolean) {
  return [
    'min-h-[52px] min-w-[140px] rounded-lg px-6 py-3 text-base font-bold uppercase tracking-wide transition-all',
    active
      ? 'border-2 border-[#ff003c] bg-red-950/50 text-white shadow-[0_0_28px_rgba(255,0,60,0.45)]'
      : 'border-2 border-[#FFD700]/80 bg-black text-[#FFD700] hover:bg-neutral-950 hover:shadow-[0_0_16px_rgba(255,215,0,0.2)]',
  ].join(' ')
}

export function PosScreen(props: {
  onOpenAdmin: () => void
  onOpenZReport: () => void
}) {
  const categories = useLiveQuery(
    () => db.categories.orderBy('sortOrder').toArray(),
    [],
  )
  const [activeCat, setActiveCat] = useState<string | null>(null)

  const effectiveCat =
    activeCat ?? (categories?.length ? categories[0].id : null)

  const products = useLiveQuery(async () => {
    const cat = effectiveCat
    if (!cat) return []
    const rows = await db.products.where('categoryId').equals(cat).toArray()
    return rows
      .filter((p) => p.active)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
  }, [effectiveCat])

  const dayKey = useMemo(() => todayKey(), [])
  const salesToday = useLiveQuery(
    () => db.sales.where('dayKey').equals(dayKey).toArray(),
    [dayKey],
  )
  const tagesumsatz = useMemo(
    () => salesToday?.reduce((a, s) => a + s.totalCents, 0) ?? 0,
    [salesToday],
  )

  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(t)
  }, [])

  const [cart, setCart] = useState<CartLine[]>([])
  const [cartPulse, setCartPulse] = useState(false)
  const [tapId, setTapId] = useState<string | null>(null)
  const [cardOpen, setCardOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [printBusy, setPrintBusy] = useState(false)

  const total = useMemo(
    () => cart.reduce((s, l) => s + l.priceCents * l.qty, 0),
    [cart],
  )

  function showToast(msg: string, ms = 2800) {
    setToast(msg)
    window.setTimeout(() => setToast(null), ms)
  }

  const addProduct = useCallback(
    (productId: string, name: string, priceCents: number) => {
      setTapId(productId)
      window.setTimeout(() => setTapId(null), 400)
      setCartPulse(true)
      window.setTimeout(() => setCartPulse(false), 600)
      setCart((prev) => {
        const ix = prev.findIndex((l) => l.productId === productId)
        if (ix >= 0) {
          const next = [...prev]
          next[ix] = { ...next[ix], qty: next[ix].qty + 1 }
          return next
        }
        return [
          ...prev,
          {
            key: productId,
            productId,
            name,
            priceCents,
            qty: 1,
          },
        ]
      })
    },
    [],
  )

  const setQty = useCallback((productId: string, qty: number) => {
    if (qty <= 0) {
      setCart((c) => c.filter((l) => l.productId !== productId))
      return
    }
    setCart((c) =>
      c.map((l) => (l.productId === productId ? { ...l, qty } : l)),
    )
  }, [])

  const removeLine = useCallback((productId: string) => {
    setCart((c) => c.filter((l) => l.productId !== productId))
  }, [])

  const buildPayload = useCallback(
    async (
      lines: CartLine[],
      method: PaymentMethod,
      receiptNo: number,
      createdAt: number,
    ): Promise<ReceiptPayload> => {
      const org = (await getSetting('orgName')) ?? 'DLRG'
      const footer = await getSetting('receiptFooter')
      const totalCents = lines.reduce(
        (s, l) => s + l.priceCents * l.qty,
        0,
      )
      return {
        orgName: org,
        createdAt,
        receiptNo,
        lines: lines.map((l) => ({
          name: l.name,
          qty: l.qty,
          unitCents: l.priceCents,
          lineCents: l.priceCents * l.qty,
        })),
        totalCents,
        payment: method,
        footer: footer || undefined,
      }
    },
    [],
  )

  const finalize = useCallback(
    async (
      method: PaymentMethod,
    ): Promise<{ payload: ReceiptPayload } | null> => {
      if (cart.length === 0 || total <= 0) return null
      const snapshot = [...cart]
      const { receiptNo, createdAt } = await saveSale(snapshot, method)
      setCart([])
      const payload = await buildPayload(
        snapshot,
        method,
        receiptNo,
        createdAt,
      )
      showToast(
        method === 'cash'
          ? 'Barzahlung verbucht.'
          : 'Kartenzahlung verbucht.',
        2400,
      )
      return { payload }
    },
    [cart, total, buildPayload],
  )

  const printPayload = useCallback(
    async (payload: ReceiptPayload) => {
      setPrintBusy(true)
      const res = await tryBluetoothPrint(payload)
      setPrintBusy(false)
      if (!res.ok) {
        const txt = receiptAsPlainText(payload)
        downloadTextFile(`dlrg-bon-${payload.receiptNo}.txt`, txt)
        showToast(
          res.message.includes('nicht verfügbar')
            ? 'Kein Bluetooth – Bon als Textdatei gespeichert.'
            : `${res.message} Text-Bon gespeichert.`,
          4000,
        )
      } else {
        showToast('Bon gesendet.')
      }
    },
    [],
  )

  const barzahlungMitBon = useCallback(async () => {
    const r = await finalize('cash')
    if (r) await printPayload(r.payload)
  }, [finalize, printPayload])

  const handlePrintDraft = useCallback(async () => {
    if (cart.length === 0) {
      showToast('Warenkorb ist leer.', 2000)
      return
    }
    setPrintBusy(true)
    const org = (await getSetting('orgName')) ?? 'DLRG'
    const footer = await getSetting('receiptFooter')
    const draft: ReceiptPayload = {
      orgName: `${org} – ENTWURF`,
      createdAt: Date.now(),
      receiptNo: 0,
      lines: cart.map((l) => ({
        name: l.name,
        qty: l.qty,
        unitCents: l.priceCents,
        lineCents: l.priceCents * l.qty,
      })),
      totalCents: total,
      payment: 'cash',
      footer: footer || 'Noch nicht bezahlt (Vorschau)',
    }
    const res = await tryBluetoothPrint(draft)
    setPrintBusy(false)
    if (!res.ok) {
      const txt = receiptAsPlainText(draft)
      downloadTextFile(`dlrg-bon-entwurf.txt`, txt)
      showToast('Bluetooth nicht möglich – Entwurf als Datei.', 3500)
    } else {
      showToast('Entwurf gesendet.')
    }
  }, [cart, total])

  const verkaufAbschliessen = useCallback(async () => {
    await finalize('cash')
  }, [finalize])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (cardOpen) return
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)
        return
      if (e.repeat) return
      if (e.key === 'F12') {
        e.preventDefault()
        if (cart.length > 0 && !printBusy) void barzahlungMitBon()
      } else if (e.key === 'F11') {
        e.preventDefault()
        if (cart.length > 0) setCardOpen(true)
      } else if (e.key === 'F10') {
        e.preventDefault()
        if (cart.length > 0 && !printBusy) void handlePrintDraft()
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (cart.length > 0) void verkaufAbschliessen()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    barzahlungMitBon,
    cardOpen,
    cart.length,
    handlePrintDraft,
    printBusy,
    verkaufAbschliessen,
  ])

  return (
    <div className="flex h-full min-h-0 flex-col bg-black font-bold text-white">
      <header className="flex flex-shrink-0 flex-wrap items-start justify-between gap-4 border-b border-[#ff003c]/40 px-4 py-3 md:px-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-4xl font-black tracking-tight text-[#FFD700] md:text-5xl">
              DLRG
            </span>
            <span className="text-3xl font-black tracking-wide text-white md:text-4xl">
              KASSE
            </span>
          </div>
          <p className="mt-2 max-w-2xl text-sm font-semibold leading-snug text-[#ff003c] md:text-base">
            Für ECHT. Wenn keiner damit rechnet, sind WIR da.
          </p>
        </div>

        <div className="flex flex-wrap items-stretch justify-end gap-2 md:gap-3">
          <div className="panel-widget flex min-w-[140px] items-center gap-2 rounded-lg px-3 py-2 md:min-w-[160px]">
            <span className="text-2xl" aria-hidden>
              🪙
            </span>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">
                Tagesumsatz
              </div>
              <div className="text-lg tabular-nums text-[#FFD700] md:text-xl">
                {formatMoney(tagesumsatz)}
              </div>
            </div>
          </div>
          <div className="panel-widget flex min-w-[130px] items-center gap-2 rounded-lg px-3 py-2">
            <span className="text-2xl" aria-hidden>
              📅
            </span>
            <div>
              <div className="text-sm tabular-nums text-white">
                {format(now, 'dd.MM.yyyy', { locale: de })}
              </div>
              <div className="text-xs font-semibold text-[#FFD700]">
                {format(now, 'HH:mm', { locale: de })} Uhr
              </div>
            </div>
          </div>
          <div className="panel-widget flex min-w-[120px] cursor-default items-center justify-between gap-2 rounded-lg px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="text-2xl" aria-hidden>
                👤
              </span>
              <span className="text-sm text-white">Admin</span>
            </div>
            <span className="text-neutral-400">▾</span>
          </div>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 p-3 lg:grid-cols-[1fr_min(420px,40vw)] lg:gap-4 lg:p-4">
        <section className="flex min-h-0 flex-col gap-3">
          <nav
            className="flex flex-shrink-0 flex-wrap gap-2 md:gap-3"
            aria-label="Kategorien"
          >
            {(categories ?? []).map((c) => (
              <button
                key={c.id}
                type="button"
                className={tabCls(effectiveCat === c.id)}
                onClick={() => setActiveCat(c.id)}
              >
                {c.name}
              </button>
            ))}
          </nav>

          <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-[#ff003c]/25 bg-neutral-950/80 p-3 shadow-[inset_0_0_40px_rgba(0,0,0,0.6)]">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
              {(products ?? []).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => addProduct(p.id, p.name, p.priceCents)}
                  className={[
                    'flex min-h-[104px] w-full overflow-hidden rounded-xl border-2 border-[#ff003c] bg-black text-left transition-transform active:scale-[0.98]',
                    'shadow-[0_0_22px_rgba(255,0,60,0.35)] hover:shadow-[0_0_32px_rgba(255,0,60,0.5)]',
                    tapId === p.id ? 'animate-tap' : '',
                  ].join(' ')}
                >
                  <ProductVisual name={p.name} categoryId={p.categoryId} />
                  <div className="flex min-w-0 flex-1 flex-col justify-center gap-1 px-3 py-2">
                    <span className="text-base font-bold leading-tight text-white md:text-lg">
                      {p.name}
                    </span>
                    <span className="text-lg font-black text-[#FFD700] md:text-xl">
                      {formatMoney(p.priceCents)}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </section>

        <aside
          className={[
            'panel-dlrg flex min-h-0 flex-col overflow-hidden rounded-xl',
            cartPulse ? 'animate-cart-pulse' : '',
          ].join(' ')}
        >
          <div className="flex items-center justify-between border-b border-[#ff003c]/35 px-4 py-3">
            <h2 className="text-xl font-black tracking-wide text-[#FFD700]">
              Warenkorb
            </h2>
            <button
              type="button"
              disabled={cart.length === 0}
              onClick={() => setCart([])}
              className="text-2xl text-[#ff003c] opacity-80 hover:opacity-100 disabled:opacity-20"
              title="Warenkorb leeren"
            >
              🗑
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
            {cart.length === 0 ? (
              <p className="py-10 text-center text-sm font-semibold text-neutral-500">
                Artikel antippen …
              </p>
            ) : (
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="text-left text-xs font-bold uppercase tracking-wide text-neutral-500">
                    <th className="pb-2 pl-1">Artikel</th>
                    <th className="pb-2">Menge</th>
                    <th className="pb-2">Preis</th>
                    <th className="pb-2">Gesamt</th>
                    <th className="pb-2 w-8" />
                  </tr>
                </thead>
                <tbody>
                  {cart.map((l) => (
                    <tr
                      key={l.productId}
                      className="border-t border-white/10 text-[13px] md:text-sm"
                    >
                      <td className="max-w-[120px] truncate py-2 pl-1 font-semibold text-white">
                        {l.name}
                      </td>
                      <td className="py-2">
                        <div className="flex items-center gap-0.5">
                          <button
                            type="button"
                            className="h-8 w-8 rounded border border-[#ff003c]/50 text-lg text-[#FFD700] hover:bg-red-950/50"
                            onClick={() => setQty(l.productId, l.qty - 1)}
                          >
                            −
                          </button>
                          <span className="w-7 text-center text-[#FFD700]">
                            {l.qty}
                          </span>
                          <button
                            type="button"
                            className="h-8 w-8 rounded border border-[#ff003c]/50 text-lg text-[#FFD700] hover:bg-red-950/50"
                            onClick={() => setQty(l.productId, l.qty + 1)}
                          >
                            +
                          </button>
                        </div>
                      </td>
                      <td className="py-2 tabular-nums text-neutral-300">
                        {formatMoney(l.priceCents)}
                      </td>
                      <td className="py-2 tabular-nums text-[#FFD700]">
                        {formatMoney(l.priceCents * l.qty)}
                      </td>
                      <td className="py-2">
                        <button
                          type="button"
                          className="font-bold text-[#ff003c] hover:text-red-400"
                          onClick={() => removeLine(l.productId)}
                          title="Entfernen"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="flex items-baseline justify-between border-t border-[#ff003c]/35 bg-black/40 px-4 py-4">
            <span className="text-lg font-black text-[#FFD700]">Gesamtbetrag</span>
            <span className="text-3xl font-black tabular-nums text-[#FFD700] md:text-4xl">
              {formatMoney(total)}
            </span>
          </div>
        </aside>
      </div>

      <footer className="flex-shrink-0 space-y-2 border-t border-[#ff003c]/30 bg-black px-3 pb-4 pt-3 md:px-5">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <button
            type="button"
            disabled={cart.length === 0 || printBusy}
            onClick={() => void barzahlungMitBon()}
            className="flex min-h-[64px] flex-col items-center justify-center rounded-xl border-2 border-[#ff003c] bg-red-950/30 px-4 py-2 text-lg font-black uppercase text-white shadow-[0_0_24px_rgba(255,0,60,0.25)] transition enabled:hover:bg-red-950/50 disabled:opacity-35"
          >
            Barzahlung
            <span className="text-xs font-bold text-[#FFD700]">F12</span>
          </button>
          <button
            type="button"
            disabled={cart.length === 0}
            onClick={() => setCardOpen(true)}
            className="flex min-h-[64px] flex-col items-center justify-center rounded-xl border-2 border-[#FFD700] bg-black px-4 py-2 text-lg font-black uppercase text-[#FFD700] shadow-[0_0_20px_rgba(255,215,0,0.15)] transition enabled:hover:bg-neutral-950 disabled:opacity-35"
          >
            Kartenzahlung
            <span className="text-xs font-bold text-neutral-400">F11</span>
          </button>
          <button
            type="button"
            disabled={cart.length === 0 || printBusy}
            onClick={() => void handlePrintDraft()}
            className="flex min-h-[64px] flex-col items-center justify-center rounded-xl border-2 border-[#ff003c] bg-black px-4 py-2 text-lg font-black uppercase text-white shadow-[0_0_20px_rgba(255,0,60,0.2)] transition enabled:hover:bg-red-950/20 disabled:opacity-35"
          >
            Bon drucken
            <span className="text-xs font-bold text-[#FFD700]">F10</span>
          </button>
          <button
            type="button"
            disabled={cart.length === 0}
            onClick={() => void verkaufAbschliessen()}
            className="flex min-h-[72px] flex-col items-center justify-center rounded-xl border-2 border-[#FFD700] bg-gradient-to-b from-[#8a7500]/40 to-black px-4 py-2 text-xl font-black uppercase text-[#FFD700] shadow-[0_0_28px_rgba(255,215,0,0.35)] transition enabled:hover:brightness-110 disabled:opacity-35"
          >
            <span className="text-2xl leading-none">✓</span>
            Verkauf abschließen
            <span className="text-xs font-bold text-white/80">Enter</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-2">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={cart.length === 0 || printBusy}
              onClick={() => void handlePrintDraft()}
              className="rounded-lg border border-neutral-600 bg-neutral-900 px-3 py-2 text-xs font-bold uppercase text-neutral-300 hover:border-[#FFD700]/50 disabled:opacity-35"
            >
              Bon Entwurf
            </button>
            <button
              type="button"
              disabled={cart.length === 0}
              onClick={() => {
                if (
                  cart.length > 0 &&
                  window.confirm('Warenkorb stornieren (leeren)?')
                )
                  setCart([])
              }}
              className="rounded-lg border border-neutral-600 bg-neutral-900 px-3 py-2 text-xs font-bold uppercase text-[#ff003c] hover:border-[#ff003c]/60 disabled:opacity-35"
            >
              Storno
            </button>
            <button
              type="button"
              onClick={() => props.onOpenAdmin()}
              className="rounded-lg border border-neutral-600 bg-neutral-900 px-3 py-2 text-xs font-bold uppercase text-neutral-300 hover:border-[#FFD700]/50"
            >
              Artikel verwalten
            </button>
            <button
              type="button"
              onClick={() => props.onOpenZReport()}
              className="rounded-lg border border-neutral-600 bg-neutral-900 px-3 py-2 text-xs font-bold uppercase text-neutral-300 hover:border-[#FFD700]/50"
            >
              Tagesbericht
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => props.onOpenAdmin()}
              className="rounded-lg border border-neutral-600 bg-neutral-900 px-3 py-2 text-xs font-bold uppercase text-neutral-300 hover:border-[#FFD700]/50"
            >
              Einstellungen
            </button>
            <button
              type="button"
              onClick={() => {
                if (window.confirm('Kassenterminal neu laden?')) {
                  window.location.reload()
                }
              }}
              className="rounded-lg border border-[#ff003c]/40 bg-neutral-900 px-3 py-2 text-xs font-bold uppercase text-[#ff003c] hover:bg-red-950/30"
            >
              Abmelden
            </button>
          </div>
        </div>
      </footer>

      {cardOpen && (
        <CardPaymentModal
          totalCents={total}
          onCancel={() => setCardOpen(false)}
          onConfirmSuccess={async () => {
            setCardOpen(false)
            const r = await finalize('card')
            if (r) await printPayload(r.payload)
          }}
        />
      )}

      {toast && <SuccessToast message={toast} />}
    </div>
  )
}
