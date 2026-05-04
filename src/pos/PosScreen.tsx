import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { format } from 'date-fns'
import { de } from 'date-fns/locale'

import { db } from '../db/database'
import { getSetting, saveSale } from '../db/sales'
import type { CartLine, CategoryRow, PaymentMethod, ProductRow } from '../types'
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
import { CashTenderModal } from './CashTenderModal'
import { InvoiceSaleModal } from './InvoiceSaleModal'
import { hasApi } from '../api/config'
import { apiJson } from '../api/http'
import { apiCreateSale, type ApiPaymentBody } from '../api/sales'

function tabCls(active: boolean) {
  return [
    'min-h-[52px] min-w-[140px] rounded-lg px-6 py-3 text-base font-bold uppercase tracking-wide transition-all',
    active
      ? 'border-2 border-[#ff003c] bg-red-950/50 text-white shadow-[0_0_28px_rgba(255,0,60,0.45)]'
      : 'border-2 border-[#FFD700]/80 bg-black text-[#FFD700] hover:bg-neutral-950 hover:shadow-[0_0_16px_rgba(255,215,0,0.2)]',
  ].join(' ')
}

function cloneLines(lines: CartLine[]): CartLine[] {
  return lines.map((l) => ({ ...l }))
}

type PendingSale = {
  clientUuid: string
  lines: {
    productId: string
    qty: number
    unitPriceCents: number
    name?: string
  }[]
  payment: ApiPaymentBody
  createdAt: number
}

const OUTBOX_KEY = 'drk:pending-sales:v1'

function readOutbox(): PendingSale[] {
  try {
    const raw = localStorage.getItem(OUTBOX_KEY)
    const arr = raw ? (JSON.parse(raw) as PendingSale[]) : []
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

function writeOutbox(items: PendingSale[]) {
  localStorage.setItem(OUTBOX_KEY, JSON.stringify(items.slice(-500)))
}

export type PosScreenProps = {
  onOpenAdmin: () => void
  onOpenZReport: () => void
  apiJwt?: string | null
  onApiLogout?: () => void
}

export function PosScreen({
  onOpenAdmin,
  onOpenZReport,
  apiJwt,
  onApiLogout,
}: PosScreenProps) {
  const remoteMode = Boolean(hasApi() && apiJwt)

  const dexCategories = useLiveQuery(
    () => db.categories.orderBy('sortOrder').toArray(),
    [],
  )
  const [remoteCategories, setRemoteCategories] = useState<CategoryRow[] | null>(
    null,
  )
  const [remoteProducts, setRemoteProducts] = useState<ProductRow[]>([])

  useEffect(() => {
    if (!remoteMode) return
    void (async () => {
      try {
        const c = await apiJson<CategoryRow[]>('/catalog/categories')
        const pr = await apiJson<unknown[]>('/catalog/products')
        const mapped: ProductRow[] = Array.isArray(pr)
          ? pr.map((p) => {
              const row = p as Record<string, unknown>
              return {
                id: String(row.id),
                categoryId: String(row.categoryId ?? row.category_id),
                name: String(row.name),
                priceCents:
                  typeof row.priceCents === 'number'
                    ? row.priceCents
                    : Number(row.price_cents ?? 0),
                active:
                  typeof row.active === 'boolean'
                    ? row.active
                    : Boolean(Number(row.active ?? 1)),
                sortOrder:
                  typeof row.sortOrder === 'number'
                    ? row.sortOrder
                    : Number(row.sort_order ?? 0),
                stockTracking:
                  typeof row.stockTracking === 'boolean'
                    ? row.stockTracking
                    : Boolean(Number(row.stock_tracking ?? 0)),
                stockQty:
                  typeof row.stockQty === 'number'
                    ? row.stockQty
                    : row.stock_qty == null
                      ? null
                      : Number(row.stock_qty),
                stockMin:
                  typeof row.stockMin === 'number'
                    ? row.stockMin
                    : row.stock_min == null
                      ? null
                      : Number(row.stock_min),
              }
            })
          : []
        setRemoteCategories(Array.isArray(c) ? (c as CategoryRow[]) : [])
        setRemoteProducts(mapped)
      } catch {
        setRemoteCategories([])
        setRemoteProducts([])
      }
    })()
  }, [remoteMode])

  const categories = remoteMode
    ? (remoteCategories ?? [])
    : (dexCategories ?? [])

  const firstCatId = categories.length ? String(categories[0].id) : null
  const [activeCat, setActiveCat] = useState<string | null>(null)
  const effectiveCat = activeCat ?? firstCatId

  const dexProducts = useLiveQuery(async () => {
    if (!effectiveCat) return []
    const rows = await db.products.where('categoryId').equals(effectiveCat).toArray()
    return rows
      .filter((p) => p.active)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
  }, [effectiveCat])

  const products = remoteMode
    ? remoteProducts
        .filter((p) => p.categoryId === effectiveCat && p.active)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    : (dexProducts ?? [])

  const dayKey = useMemo(() => todayKey(), [])
  const salesDex = useLiveQuery(
    () => db.sales.where('dayKey').equals(dayKey).toArray(),
    [dayKey],
  )
  const tagesumsatz = useMemo(() => {
    if (remoteMode) return null
    return salesDex?.reduce((a, s) => a + s.totalCents, 0) ?? 0
  }, [remoteMode, salesDex])

  const [cart, setCart] = useState<CartLine[]>([])
  const cartRef = useRef(cart)
  useEffect(() => {
    cartRef.current = cart
  }, [cart])
  const undoStack = useRef<CartLine[][]>([])
  const pushPast = useCallback(() => {
    undoStack.current = [...undoStack.current, cloneLines(cartRef.current)].slice(-25)
  }, [])
  const undoLast = useCallback(() => {
    const prev = undoStack.current.pop()
    if (prev) setCart(prev)
  }, [])

  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(t)
  }, [])

  const [cartPulse, setCartPulse] = useState(false)
  const [tapId, setTapId] = useState<string | null>(null)
  const [cardOpen, setCardOpen] = useState(false)
  const [cashOpen, setCashOpen] = useState(false)
  const [invoiceOpen, setInvoiceOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [printBusy, setPrintBusy] = useState(false)
  const [syncingOutbox, setSyncingOutbox] = useState(false)

  const total = useMemo(() => cart.reduce((s, l) => s + l.priceCents * l.qty, 0), [cart])

  function showToast(msg: string, ms = 2800) {
    setToast(msg)
    window.setTimeout(() => setToast(null), ms)
  }

  const addProduct = useCallback(
    (productId: string, name: string, priceCents: number) => {
      pushPast()
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
        return [...prev, { key: productId, productId, name, priceCents, qty: 1 }]
      })
    },
    [pushPast],
  )

  const setQty = useCallback(
    (productId: string, qty: number) => {
      pushPast()
      if (qty <= 0) {
        setCart((c) => c.filter((l) => l.productId !== productId))
        return
      }
      setCart((c) => c.map((l) => (l.productId === productId ? { ...l, qty } : l)))
    },
    [pushPast],
  )

  const removeLine = useCallback(
    (productId: string) => {
      pushPast()
      setCart((c) => c.filter((l) => l.productId !== productId))
    },
    [pushPast],
  )

  const clearWholeCart = useCallback(() => {
    if (
      cart.length === 1 ||
      window.confirm('Warenkorb leeren – alle Positionen werden entfernt?')
    ) {
      pushPast()
      setCart([])
    }
  }, [cart.length, pushPast])

  const buildPayload = useCallback(
    async (
      lines: CartLine[],
      method: PaymentMethod,
      receiptNo: number,
      createdAt: number,
    ): Promise<ReceiptPayload> => {
      let org = (await getSetting('orgName')) ?? 'DLRG'
      if (remoteMode && !String(org).trim()) {
        try {
          const s = await apiJson<{ org_name?: string }>('/settings')
          org = s.org_name ?? 'DLRG'
        } catch {
          org = 'DLRG'
        }
      }
      const footer = await getSetting('receiptFooter')
      const totalCents = lines.reduce((s, l) => s + l.priceCents * l.qty, 0)
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
    [remoteMode],
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

  /** Abschluss: lokal IndexedDB oder API */
  const settleAndPrint = useCallback(
    async (method: PaymentMethod, apiPay?: ApiPaymentBody) => {
      if (cart.length === 0 || total <= 0) return
      const snap = [...cart]
      try {
        if (remoteMode) {
          if (!apiPay) throw new Error('MISSING_PAYMENT')
          const clientUuid = crypto.randomUUID()
          const sale = await apiCreateSale({
            lines: snap.map((l) => ({
              productId: l.productId,
              qty: l.qty,
              unitPriceCents: l.priceCents,
              name: l.name,
            })),
            payment: apiPay,
            clientUuid,
          })
          setCart([])
          const payload = await buildPayload(snap, method, sale.receiptNo, sale.createdAt)
          await printPayload(payload)
          showToast(
            sale.duplicate ? 'Erneuter Druck – bereits verbucht.' : 'Verbucht (Server).',
            2600,
          )
        } else {
          const { receiptNo, createdAt } = await saveSale(snap, method)
          setCart([])
          const payload = await buildPayload(snap, method, receiptNo, createdAt)
          await printPayload(payload)
          showToast(method === 'cash' ? 'Barzahlung verbucht.' : 'Kartenzahlung verbucht.')
        }
      } catch (e) {
        if (remoteMode && apiPay) {
          const pending: PendingSale = {
            clientUuid: crypto.randomUUID(),
            lines: snap.map((l) => ({
              productId: l.productId,
              qty: l.qty,
              unitPriceCents: l.priceCents,
              name: l.name,
            })),
            payment: apiPay,
            createdAt: Date.now(),
          }
          writeOutbox([...readOutbox(), pending])
          setCart([])
          showToast('Offline gespeichert. Wird beim nächsten Sync gesendet.', 5000)
          return
        }
        showToast(String((e as Error).message ?? e), 5000)
      }
    },
    [cart, total, remoteMode, buildPayload, printPayload],
  )

  const syncOutbox = useCallback(async () => {
    if (!remoteMode || syncingOutbox) return
    const items = readOutbox()
    if (items.length === 0) return
    setSyncingOutbox(true)
    const pending: PendingSale[] = []
    let okCount = 0
    for (const it of items) {
      try {
        await apiCreateSale({
          lines: it.lines,
          payment: it.payment,
          clientUuid: it.clientUuid,
        })
        okCount += 1
      } catch {
        pending.push(it)
      }
    }
    writeOutbox(pending)
    setSyncingOutbox(false)
    if (okCount > 0) showToast(`${okCount} Offline-Verkäufe synchronisiert.`, 3000)
  }, [remoteMode, syncingOutbox])

  useEffect(() => {
    if (!remoteMode) return
    void syncOutbox()
    const onOnline = () => {
      void syncOutbox()
    }
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [remoteMode, syncOutbox])

  const barMitBonOffline = useCallback(async () => {
    if (cart.length === 0 || total <= 0) return
    const snap = [...cart]
    const { receiptNo, createdAt } = await saveSale(snap, 'cash')
    setCart([])
    const payload = await buildPayload(snap, 'cash', receiptNo, createdAt)
    await printPayload(payload)
    showToast('Barzahlung verbucht.', 2400)
  }, [cart, total, buildPayload, printPayload])

  const verkaufCashOhneBonOffline = useCallback(async () => {
    if (cart.length === 0 || total <= 0) return
    const snap = [...cart]
    await saveSale(snap, 'cash')
    setCart([])
    showToast('Verbucht.')
  }, [cart, total])

  const handlePrintDraft = useCallback(async () => {
    if (cart.length === 0) {
      showToast('Warenkorb ist leer.', 2000)
      return
    }
    setPrintBusy(true)
    const org =
      ((((await getSetting('orgName')) as string | undefined) ?? '') || 'DLRG')
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

  const modalsBlockKeys = cardOpen || cashOpen || invoiceOpen

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (modalsBlockKeys) return
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)
        return
      if (e.repeat) return

      if (e.ctrlKey && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        undoLast()
        return
      }

      if (e.key === 'F12') {
        e.preventDefault()
        if (cart.length === 0 || printBusy) return
        if (remoteMode) {
          setCashOpen(true)
        } else {
          void barMitBonOffline()
        }
      } else if (e.key === 'F11') {
        e.preventDefault()
        if (cart.length > 0) setCardOpen(true)
      } else if (e.key === 'F10') {
        e.preventDefault()
        if (cart.length > 0 && !printBusy) void handlePrintDraft()
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (cart.length === 0) return
        if (remoteMode) {
          setCashOpen(true)
        } else {
          void verkaufCashOhneBonOffline()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    modalsBlockKeys,
    cart.length,
    printBusy,
    remoteMode,
    barMitBonOffline,
    verkaufCashOhneBonOffline,
    handlePrintDraft,
    undoLast,
  ])

  const revLabel =
    typeof tagesumsatz === 'number' ? formatMoney(tagesumsatz) : '(API‑Modus)'

  return (
    <div className="flex h-full min-h-0 flex-col bg-black font-bold text-white">
      {remoteMode && (
        <div className="flex flex-wrap items-center justify-center gap-3 border-b border-yellow-900/60 bg-yellow-950/40 px-3 py-2 text-center text-[11px] font-bold uppercase tracking-wide text-yellow-200">
          <span>
            SERVER‑API aktiv · TESTSYSTEM · TSE inaktiv · Gegeben/Rückgeld bei Bar erforderlich
          </span>
          {readOutbox().length > 0 && <span>Offline-Warteschlange: {readOutbox().length}</span>}
          {onApiLogout && (
            <button
              type="button"
              onClick={() => onApiLogout()}
              className="rounded border border-yellow-600/50 px-2 py-0.5 text-[10px] font-black text-yellow-100 hover:bg-yellow-900/30"
            >
              API abmelden
            </button>
          )}
        </div>
      )}
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
                {revLabel}
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
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 p-3 lg:grid-cols-[1fr_min(420px,40vw)] lg:gap-4 lg:p-4">
        <section className="flex min-h-0 flex-col gap-3">
          <nav className="flex flex-shrink-0 flex-wrap gap-2 md:gap-3" aria-label="Kategorien">
            {categories.map((c) => (
              <button
                key={String(c.id)}
                type="button"
                className={tabCls(effectiveCat === c.id)}
                onClick={() => setActiveCat(String(c.id))}
              >
                {c.name}
              </button>
            ))}
          </nav>

          <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-[#ff003c]/25 bg-neutral-950/80 p-3 shadow-[inset_0_0_40px_rgba(0,0,0,0.6)]">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
              {products.map((p) => (
                (() => {
                  const soldOut = Boolean(p.stockTracking && Number(p.stockQty ?? 0) <= 0)
                  return (
                <button
                  key={p.id}
                  type="button"
                  disabled={soldOut}
                  onClick={() => addProduct(p.id, p.name, p.priceCents)}
                  className={[
                    'flex min-h-[104px] w-full overflow-hidden rounded-xl border-2 border-[#ff003c] bg-black text-left transition-transform active:scale-[0.98]',
                    'shadow-[0_0_22px_rgba(255,0,60,0.35)] hover:shadow-[0_0_32px_rgba(255,0,60,0.5)]',
                    soldOut ? 'opacity-50 grayscale' : '',
                    tapId === p.id ? 'animate-tap' : '',
                  ].join(' ')}
                >
                  <ProductVisual name={p.name} categoryId={p.categoryId} />
                  <div className="flex min-w-0 flex-1 flex-col justify-center gap-1 px-3 py-2">
                    {soldOut && (
                      <span className="text-xs font-black uppercase tracking-wider text-red-400">
                        AUSVERKAUFT
                      </span>
                    )}
                    <span className="text-base font-bold leading-tight text-white md:text-lg">
                      {p.name}
                    </span>
                    <span className="text-lg font-black text-[#FFD700] md:text-xl">
                      {formatMoney(p.priceCents)}
                    </span>
                  </div>
                </button>
                  )
                })()
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
            <h2 className="text-xl font-black tracking-wide text-[#FFD700]">Warenkorb</h2>
            <div className="flex gap-1">
              <button
                type="button"
                disabled={cart.length === 0}
                title="Letzte Änderung rückgängig (Ctrl+Z)"
                onClick={undoLast}
                className="rounded px-2 py-1 text-lg text-[#FFD700] hover:bg-neutral-950 disabled:opacity-20"
              >
                ⟲
              </button>
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
                    <th className="w-8 pb-2" />
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
                          <span className="w-7 text-center text-[#FFD700]">{l.qty}</span>
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
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <button
            type="button"
            disabled={cart.length === 0 || printBusy}
            onClick={() => {
              if (remoteMode) setCashOpen(true)
              else void barMitBonOffline()
            }}
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
            disabled={cart.length === 0 || !remoteMode}
            onClick={() => setInvoiceOpen(true)}
            title={!remoteMode ? 'Erfordert API + Login' : ''}
            className="flex min-h-[64px] flex-col items-center justify-center rounded-xl border-2 border-cyan-500/70 bg-black px-4 py-2 text-lg font-black uppercase text-cyan-200 shadow-[0_0_22px_rgba(34,211,238,.2)] transition enabled:hover:bg-neutral-950 disabled:opacity-35"
          >
            Auf Rechnung
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
            onClick={() =>
              remoteMode ? setCashOpen(true) : void verkaufCashOhneBonOffline()
            }
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
              onClick={clearWholeCart}
              className="rounded-lg border border-neutral-600 bg-neutral-900 px-3 py-2 text-xs font-bold uppercase text-[#ff003c] hover:border-[#ff003c]/60 disabled:opacity-35"
            >
              Warenkorb leeren
            </button>
            <button
              type="button"
              disabled={cart.length === 0}
              onClick={undoLast}
              className="rounded-lg border border-neutral-600 bg-neutral-900 px-3 py-2 text-xs font-bold uppercase text-[#FFD700] hover:border-[#FFD700]/50 disabled:opacity-35"
              title="Ctrl+Z"
            >
              Undo
            </button>
            <button
              type="button"
              onClick={() => onOpenAdmin()}
              className="rounded-lg border border-neutral-600 bg-neutral-900 px-3 py-2 text-xs font-bold uppercase text-neutral-300 hover:border-[#FFD700]/50"
            >
              Artikel verwalten
            </button>
            <button
              type="button"
              onClick={() => onOpenZReport()}
              className="rounded-lg border border-neutral-600 bg-neutral-900 px-3 py-2 text-xs font-bold uppercase text-neutral-300 hover:border-[#FFD700]/50"
            >
              Tagesbericht
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onOpenAdmin()}
              className="rounded-lg border border-neutral-600 bg-neutral-900 px-3 py-2 text-xs font-bold uppercase text-neutral-300 hover:border-[#FFD700]/50"
            >
              Einstellungen
            </button>
            <button
              type="button"
              onClick={() => {
                if (window.confirm('Kassenterminal neu laden?')) window.location.reload()
              }}
              className="rounded-lg border border-[#ff003c]/40 bg-neutral-900 px-3 py-2 text-xs font-bold uppercase text-[#ff003c] hover:bg-red-950/30"
            >
              Neu laden
            </button>
          </div>
        </div>
      </footer>

      {cashOpen && remoteMode && (
        <CashTenderModal
          totalCents={total}
          onCancel={() => setCashOpen(false)}
          onConfirm={async (given) => {
            setCashOpen(false)
            if (given < total) {
              showToast('Gegeben zu niedrig.')
              return
            }
            if (cart.length === 0) return
            const change = given - total
            showToast(`Rückgeld: ${formatMoney(change)}`, 2400)

            await settleAndPrint('cash', { method: 'cash', amountTenderedCents: given })
          }}
        />
      )}

      {cardOpen && (
        <CardPaymentModal
          totalCents={total}
          onCancel={() => setCardOpen(false)}
          onConfirmSuccess={async () => {
            setCardOpen(false)
            await settleAndPrint('card', remoteMode ? { method: 'card' } : undefined)
          }}
        />
      )}

      {invoiceOpen && (
        <InvoiceSaleModal
          cartLines={cart}
          totalCents={total}
          onCancel={() => setInvoiceOpen(false)}
          onConfirmed={async (p) => {
            await settleAndPrint('invoice', {
              method: 'invoice',
              teamId: p.teamId,
              eventId: p.eventId,
              contactName: p.contactName,
              note: p.note,
            })
            setInvoiceOpen(false)
          }}
        />
      )}

      {toast && <SuccessToast message={toast} />}
    </div>
  )
}
