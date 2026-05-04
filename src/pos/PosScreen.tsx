import { useCallback, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/database'
import { saveSale, getSetting } from '../db/sales'
import type { CartLine, PaymentMethod } from '../types'
import type { ReceiptPayload } from '../receipt/escpos'
import { formatMoney } from '../lib/format'
import { receiptAsPlainText } from '../receipt/escpos'
import {
  downloadTextFile,
  tryBluetoothPrint,
} from '../receipt/bluetoothPrint'
import { CardPaymentModal } from './CardPaymentModal'
import { SuccessToast } from './SuccessToast'

const tabCls = (on: boolean) =>
  [
    'min-h-[52px] min-w-[120px] rounded-xl px-5 py-3 text-base font-semibold transition-all duration-200',
    'border',
    on
      ? 'border-cyan-400/70 bg-cyan-500/15 text-cyan-100 shadow-[0_0_24px_rgba(34,211,238,0.25)] scale-[1.02]'
      : 'border-white/10 bg-white/5 text-slate-300 hover:border-cyan-500/30 hover:bg-white/[0.07]',
  ].join(' ')

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

  const buildPayload = useCallback(
    async (
      lines: CartLine[],
      method: PaymentMethod,
      receiptNo: number,
      createdAt: number,
    ): Promise<ReceiptPayload> => {
      const org = (await getSetting('orgName')) ?? 'DRK'
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
        downloadTextFile(`drk-bon-${payload.receiptNo}.txt`, txt)
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

  const handlePrintDraft = useCallback(async () => {
    if (cart.length === 0) {
      showToast('Warenkorb ist leer.', 2000)
      return
    }
    setPrintBusy(true)
    const org = (await getSetting('orgName')) ?? 'DRK'
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
      downloadTextFile(`drk-bon-entwurf.txt`, txt)
      showToast('Bluetooth nicht möglich – Entwurf als Datei.', 3500)
    } else {
      showToast('Entwurf gesendet.')
    }
  }, [cart, total])

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3 md:p-4">
      <header className="flex flex-shrink-0 flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white md:text-3xl">
            DRK <span className="text-cyan-300">Kasse</span>
          </h1>
          <p className="text-sm text-slate-400">Touch · offline · lokal</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => props.onOpenZReport()}
            className="rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-sm text-slate-200 hover:bg-white/10"
          >
            Tages­abschluss
          </button>
          <button
            type="button"
            onClick={() => props.onOpenAdmin()}
            className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-sm font-medium text-rose-100 hover:bg-rose-500/20"
          >
            Admin
          </button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[1fr_380px] xl:grid-cols-[1fr_420px]">
        <section className="flex min-h-0 flex-col gap-3">
          <nav
            className="flex flex-shrink-0 flex-wrap gap-2"
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

          <div className="panel-glass min-h-0 flex-1 overflow-y-auto rounded-2xl p-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 2xl:grid-cols-4">
              {(products ?? []).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => addProduct(p.id, p.name, p.priceCents)}
                  className={[
                    'group relative flex min-h-[96px] flex-col justify-between rounded-2xl border border-cyan-400/25 bg-gradient-to-br from-slate-900/90 to-slate-800/80 p-4 text-left transition-all active:scale-[0.98]',
                    tapId === p.id ? 'animate-tap' : '',
                    'hover:border-cyan-300/50 hover:shadow-[0_0_30px_rgba(34,211,238,0.18)]',
                  ].join(' ')}
                >
                  <span className="text-lg font-semibold leading-snug text-white">
                    {p.name}
                  </span>
                  <span className="mt-2 text-xl font-bold text-cyan-200">
                    {formatMoney(p.priceCents)}
                  </span>
                  <span className="pointer-events-none absolute inset-0 rounded-2xl ring-0 ring-cyan-400/0 transition group-hover:ring-2 group-hover:ring-cyan-400/30" />
                </button>
              ))}
            </div>
          </div>
        </section>

        <aside
          className={[
            'panel-glass flex min-h-0 flex-col rounded-2xl',
            cartPulse ? 'animate-cart-pulse' : '',
          ].join(' ')}
        >
          <div className="border-b border-white/10 px-4 py-3">
            <h2 className="text-lg font-semibold text-white">Warenkorb</h2>
          </div>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3">
            {cart.length === 0 ? (
              <p className="px-2 py-8 text-center text-slate-500">
                Artikel antippen …
              </p>
            ) : (
              cart.map((l) => (
                <div
                  key={l.productId}
                  className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-slate-100">
                      {l.name}
                    </div>
                    <div className="text-sm text-slate-400">
                      {formatMoney(l.priceCents)} · Zeile{' '}
                      {formatMoney(l.priceCents * l.qty)}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      className="h-10 w-10 rounded-lg border border-white/15 bg-white/5 text-lg text-white hover:bg-white/10"
                      onClick={() => setQty(l.productId, l.qty - 1)}
                      aria-label="Menge verringern"
                    >
                      −
                    </button>
                    <span className="w-8 text-center font-semibold text-cyan-200">
                      {l.qty}
                    </span>
                    <button
                      type="button"
                      className="h-10 w-10 rounded-lg border border-white/15 bg-white/5 text-lg text-white hover:bg-white/10"
                      onClick={() => setQty(l.productId, l.qty + 1)}
                      aria-label="Menge erhöhen"
                    >
                      +
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="border-t border-white/10 px-4 py-4">
            <div className="mb-1 flex items-baseline justify-between">
              <span className="text-slate-400">Gesamt</span>
              <span className="text-3xl font-bold text-white">
                {formatMoney(total)}
              </span>
            </div>
          </div>
        </aside>
      </div>

      <footer className="flex-shrink-0 rounded-2xl border border-white/10 bg-black/25 p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
          <span className="text-sm text-slate-500">Zahlung &amp; Bon</span>
          <span className="font-mono text-lg font-bold text-white tabular-nums">
            {formatMoney(total)}
          </span>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-5">
          <button
            type="button"
            disabled={cart.length === 0 || printBusy}
            onClick={async () => {
              const r = await finalize('cash')
              if (r) await printPayload(r.payload)
            }}
            className="min-h-[56px] rounded-xl bg-gradient-to-r from-blue-600 to-cyan-500 px-4 py-3 text-lg font-bold text-white shadow-[0_0_28px_rgba(59,130,246,0.35)] transition enabled:hover:brightness-110 enabled:active:scale-[0.99] disabled:opacity-40"
          >
            Barzahlung + Bon
          </button>
          <button
            type="button"
            disabled={cart.length === 0}
            onClick={() => setCardOpen(true)}
            className="min-h-[56px] rounded-xl border border-violet-400/40 bg-violet-500/15 px-4 py-3 text-lg font-bold text-violet-100 transition enabled:hover:bg-violet-500/25 enabled:active:scale-[0.99] disabled:opacity-40"
          >
            Kartenzahlung
          </button>
          <button
            type="button"
            disabled={cart.length === 0 || printBusy}
            onClick={() => void handlePrintDraft()}
            className="min-h-[56px] rounded-xl border border-cyan-400/35 bg-cyan-500/10 px-4 py-3 text-lg font-semibold text-cyan-50 transition enabled:hover:bg-cyan-500/20 disabled:opacity-40"
          >
            Bon (Entwurf)
          </button>
          <button
            type="button"
            disabled={cart.length === 0}
            onClick={() => void finalize('cash')}
            className="min-h-[56px] rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-lg font-semibold text-slate-100 transition enabled:hover:bg-white/10 disabled:opacity-40"
          >
            Nur verbuchen (Bar)
          </button>
          <button
            type="button"
            onClick={() => setCart([])}
            disabled={cart.length === 0}
            className="min-h-[56px] rounded-xl border border-rose-500/30 bg-rose-500/5 px-4 py-3 text-lg font-semibold text-rose-100 transition enabled:hover:bg-rose-500/15 disabled:opacity-40"
          >
            Leeren
          </button>
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
