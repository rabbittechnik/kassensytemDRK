import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { format } from 'date-fns'
import { de } from 'date-fns/locale'

import { db } from '../db/database'
import { defaultOutputGroupForProduct } from '../db/productOutputDefaults'
import {
  bumpLocalSalePrintSuccess,
  bumpRemoteArchivePrintSuccess,
  buildOutputReceiptStoredEntries,
  buildReceiptLineModelsFromCatalog,
  completeLocalSaleWithDualReceipts,
  getSetting,
  persistRemoteDualReceiptArchive,
  readReceiptFormattingContext,
  renderDualReceiptTexts,
} from '../db/sales'
import type { CartLine, CategoryRow, PaymentMethod, ProductRow } from '../types'
import type { ReceiptPayload } from '../receipt/escpos'
import { formatMoney, todayKey } from '../lib/format'
import { getSaleAvailability } from '../lib/saleAvailability'
import { receiptAsPlainText } from '../receipt/escpos'
import type { ReceiptLineModel } from '../receipt/receiptFormat'
import {
  downloadTextFile,
  tryBluetoothPrint,
  tryBluetoothPrintPlainBlocks,
  tryBluetoothPrintPlainText,
} from '../receipt/bluetoothPrint'
import { printCheckoutReceiptsAfterSale } from '../receipt/printAfterSale'
import { CardPaymentModal } from './CardPaymentModal'
import { SuccessToast } from './SuccessToast'
import { ProductVisual } from './productVisual'
import { CashTenderModal } from './CashTenderModal'
import { InvoiceSaleModal } from './InvoiceSaleModal'
import { hasApi } from '../api/config'
import { apiJson } from '../api/http'
import { apiCreateSale, type ApiPaymentBody } from '../api/sales'
import {
  addDemoSale,
  buildDemoLines,
  exitDemoMode,
  isDemoMode,
  nextDemoReceiptNo,
  useDemoMode,
  useDemoSales,
} from '../demo/demoStore'
import {
  formatDemoCustomerReceipt,
  formatDemoTestPrint,
} from '../demo/demoReceipts'
import { DemoCodeOverlay } from '../demo/DemoCodeOverlay'
import { logDemoModeAudit } from '../demo/demoAudit'
import { InstallAppButton } from '../pwa/InstallAppButton'
import { IosInstallGuide } from '../pwa/IosInstallGuide'
import { usePwaUpdate } from '../pwa/PwaUpdateProvider'
import {
  ReceiptPreviewModal,
  type DemoPreviewReceiptItem,
} from './ReceiptPreviewModal'

function RefreshIcon(props: { className?: string }) {
  return (
    <svg
      className={props.className}
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 12a9 9 0 1 1-3-6.7" />
      <path d="M21 3v6h-6" />
    </svg>
  )
}

function withDemoOutputHeader(text: string): string {
  return [
    '*** DEMO-AUSGABE ***',
    'NICHT AUSGEBEN',
    '',
    text.trim(),
    '',
    'DEMO - KEIN ECHTER VERKAUF',
  ].join('\n')
}

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
  eventId?: string
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
  const { checkForUpdate, applyUpdate } = usePwaUpdate()
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
                imageUrl:
                  row.imageUrl != null ?
                    String(row.imageUrl)
                  : row.image_url != null ?
                    String(row.image_url)
                  : undefined,
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

  const demoMode = useDemoMode()
  const demoSales = useDemoSales()
  const [demoCodeOpen, setDemoCodeOpen] = useState(false)
  const [iosGuideOpen, setIosGuideOpen] = useState(false)

  /** Aktive Veranstaltung für Anzeige und event_id bei Verkäufen */
  const [activeEvent, setActiveEvent] = useState<{
    id: string
    name: string
    status?: string
    startDate: string
    endDate: string
    startTime?: string | null
    endTime?: string | null
  } | null>(null)
  const [allowSalesWithoutEvent, setAllowSalesWithoutEvent] = useState(true)

  useEffect(() => {
    let alive = true
    async function loadEventContext() {
      if (demoMode) {
        const today = new Date().toISOString().slice(0, 10)
        if (!alive) return
        setActiveEvent({
          id: 'demo-event',
          name: 'DEMO-Veranstaltung',
          status: 'active',
          startDate: today,
          endDate: today,
          startTime: '00:00:00',
          endTime: '23:59:59',
        })
        setAllowSalesWithoutEvent(true)
        return
      }
      if (remoteMode && apiJwt) {
        try {
          const av = await apiJson<{
            allowStandardSale?: boolean
            activeEvent?: Record<string, unknown> | null
          }>('/sales/availability')
          if (!alive) return
          const ev = av?.activeEvent
          if (ev && typeof ev.id === 'string') {
            setActiveEvent({
              id: String(ev.id),
              name: String(ev.name ?? ''),
              status: String(ev.status ?? 'active'),
              startDate: String(ev.startDate ?? ''),
              endDate: String(ev.endDate ?? ''),
              startTime: typeof ev.startTime === 'string' ? ev.startTime : null,
              endTime: typeof ev.endTime === 'string' ? ev.endTime : null,
            })
          } else {
            setActiveEvent(null)
          }
          setAllowSalesWithoutEvent(Boolean(av?.allowStandardSale))
        } catch {
          if (!alive) return
          setActiveEvent(null)
        }
        return
      }
      const allow = (await getSetting('allow_sales_without_event')) !== '0'
      const eid = (await getSetting('active_event_id'))?.trim()
      if (!alive) return
      setAllowSalesWithoutEvent(allow)
      if (eid) {
        const row = await db.events.get(eid)
        if (row && row.status === 'active') {
          setActiveEvent({
            id: row.id,
            name: row.name,
            status: row.status,
            startDate: row.startDate,
            endDate: row.endDate,
            startTime: row.startTime ?? null,
            endTime: row.endTime ?? null,
          })
        } else {
          setActiveEvent(null)
        }
      } else {
        setActiveEvent(null)
      }
    }
    void loadEventContext()
    const t = window.setInterval(() => void loadEventContext(), 60_000)
    return () => {
      alive = false
      window.clearInterval(t)
    }
  }, [remoteMode, apiJwt, demoMode])

  const dayKey = useMemo(() => todayKey(), [])
  const salesDex = useLiveQuery(
    () => db.sales.where('dayKey').equals(dayKey).toArray(),
    [dayKey],
  )
  const tagesumsatz = useMemo(() => {
    if (demoMode) return demoSales.reduce((a, s) => a + s.totalCents, 0)
    if (remoteMode) return null
    return salesDex?.reduce((a, s) => a + s.totalCents, 0) ?? 0
  }, [demoMode, demoSales, remoteMode, salesDex])

  const [cart, setCart] = useState<CartLine[]>([])

  // Cart beim Verlassen des Demo-Modus leeren, damit keine Demo-Reste in
  // einem realen Verkauf landen.
  useEffect(() => {
    if (!demoMode) setCart([])
  }, [demoMode])

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
  /** Offline: vor Bar-Flow mit Bon vs. Nur-Abschluss ohne Bondruck */
  const [offlineCashVariant, setOfflineCashVariant] = useState<
    'withBon' | 'noBon' | null
  >(null)
  const [invoiceOpen, setInvoiceOpen] = useState(false)

  const openCashModal = useCallback(
    (offlineWhenLocal: 'withBon' | 'noBon') => {
      setOfflineCashVariant(remoteMode ? null : offlineWhenLocal)
      setCashOpen(true)
    },
    [remoteMode],
  )

  const closeCashModal = useCallback(() => {
    setCashOpen(false)
    setOfflineCashVariant(null)
  }, [])
  const [toast, setToast] = useState<string | null>(null)
  const [printBusy, setPrintBusy] = useState(false)
  const [pwaCheckBusy, setPwaCheckBusy] = useState(false)
  const [pwaUpdateOfferOpen, setPwaUpdateOfferOpen] = useState(false)
  const [demoPreviewOpen, setDemoPreviewOpen] = useState(false)
  const [demoPreviewReceipts, setDemoPreviewReceipts] = useState<DemoPreviewReceiptItem[]>([])
  const [demoPreviewSelectedId, setDemoPreviewSelectedId] = useState<string | null>(null)
  const [syncingOutbox, setSyncingOutbox] = useState(false)

  const total = useMemo(() => cart.reduce((s, l) => s + l.priceCents * l.qty, 0), [cart])
  const saleAvailability = useMemo(
    () =>
      getSaleAvailability({
        allowStandardSale: allowSalesWithoutEvent,
        activeEvent,
        nowMs: now.getTime(),
      }),
    [allowSalesWithoutEvent, activeEvent, now],
  )

  const saleBlockedText = useMemo(() => {
    if (saleAvailability.canSell) return null
    if (saleAvailability.reason === 'event_not_started') {
      return 'Verkauf gesperrt: Die ausgewählte Veranstaltung ist noch nicht gestartet.'
    }
    if (saleAvailability.reason === 'event_ended') {
      return 'Verkauf gesperrt: Die Veranstaltung ist bereits beendet.'
    }
    return 'Verkauf gesperrt: Es ist keine aktive Veranstaltung angelegt.'
  }, [saleAvailability])

  function showToast(msg: string, ms = 2800) {
    setToast(msg)
    window.setTimeout(() => setToast(null), ms)
  }

  const handlePwaUpdateCheck = useCallback(async () => {
    setPwaCheckBusy(true)
    try {
      const r = await checkForUpdate()
      if (r === 'offline') {
        showToast('Updateprüfung nicht möglich – keine Verbindung.', 4200)
      } else if (r === 'error') {
        showToast('Update konnte nicht geprüft werden.', 4200)
      } else if (r === 'current') {
        showToast('Die App ist aktuell.', 3200)
      } else {
        setPwaUpdateOfferOpen(true)
      }
    } finally {
      setPwaCheckBusy(false)
    }
  }, [checkForUpdate])

  const addProduct = useCallback(
    (productId: string, name: string, priceCents: number) => {
      if (!saleAvailability.canSell) {
        showToast(
          saleBlockedText ??
            'Verkauf gesperrt: Keine aktive Veranstaltung ausgewählt.',
          3600,
        )
        return
      }
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
    [pushPast, saleAvailability.canSell, saleBlockedText],
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

  /** Abschluss: lokal IndexedDB oder API */
  const settleAndPrint = useCallback(
    async (
      method: PaymentMethod,
      apiPay?: ApiPaymentBody,
      opts?: {
        offlineSkipReceiptPrint?: boolean
        teamName?: string
        teamId?: string
        eventId?: string
        eventName?: string
        contactName?: string
        note?: string
      },
    ) => {
      if (!saleAvailability.canSell) {
        showToast(
          'Verkauf kann nicht abgeschlossen werden, da keine aktive Veranstaltung ausgewählt ist.',
          4500,
        )
        return
      }
      if (cart.length === 0 || total <= 0) return
      const snap = [...cart]

      // ---------- DEMO-MODUS ----------
      // Niemals echte Persistenz: kein apiCreateSale, kein
      // completeLocalSaleWithDualReceipts, keine Bestandsaenderung,
      // keine TSE. Stattdessen reine in-memory Demo-Sale.
      if (isDemoMode()) {
        try {
          const cats = remoteMode ? (remoteCategories ?? []) : (dexCategories ?? [])
          const prods = remoteMode ? remoteProducts : (dexProducts ?? [])
          const lookup = (id: string) => {
            const p = prods.find((x) => x.id === id)
            if (!p) return null
            const c = cats.find((x) => x.id === p.categoryId)
            const og =
              p.outputGroup ?? defaultOutputGroupForProduct(p.id, p.name)
            return {
              categoryId: p.categoryId,
              categoryName: c?.name ?? 'Sonstige',
              categorySort: c?.sortOrder ?? 999,
              outputGroup: og,
            }
          }
          const lines = buildDemoLines(snap, lookup)
          const totalCents = lines.reduce((s, l) => s + l.lineTotalCents, 0)
          const { n: demoNo, label } = nextDemoReceiptNo()
          const createdAt = Date.now()
          const teamName = opts?.teamName
          const teamId = opts?.teamId
          const eventId = opts?.eventId ?? activeEvent?.id
          const eventName = opts?.eventName ?? activeEvent?.name
          const contactName = opts?.contactName
          const note = opts?.note
          const customer = formatDemoCustomerReceipt({
            bonNumberLabel: label,
            createdAt,
            lines,
            totalCents,
            paymentMethod: method,
            teamName,
          })
          const ctxDemo = await readReceiptFormattingContext()
          const demoModels: ReceiptLineModel[] = lines.map((l) => ({
            productId: l.productId,
            outputGroup: l.outputGroup,
            name: l.name,
            qty: l.qty,
            unitCents: l.unitPriceCents,
            lineCents: l.lineTotalCents,
            categoryId: l.categoryId,
            categoryName: l.categoryName,
            categorySort: l.categorySort,
          }))
          const outputReceipts = buildOutputReceiptStoredEntries(
            ctxDemo,
            demoModels,
            method,
            demoNo,
            createdAt,
            false,
            teamName,
          )
          const demoOutputReceipts = outputReceipts.map((o) => ({
            ...o,
            text: withDemoOutputHeader(o.text),
          }))
          addDemoSale({
            id: `demo-sale-${crypto.randomUUID()}`,
            demoNo,
            bonNumberLabel: label,
            createdAt,
            dayKey: todayKey(new Date(createdAt)),
            totalCents,
            paymentMethod: method,
            lines,
            customerReceiptText: customer,
            outputReceipts: demoOutputReceipts,
            teamName,
            teamId,
            eventId,
            eventName,
            contactName,
            note,
          })
          setCart([])

          const width = ctxDemo.widthMm
          const previewItems: DemoPreviewReceiptItem[] = [
            {
              id: `demo-${label}-customer`,
              type: 'customer',
              title: 'Kassenbeleg',
              text: customer,
              width,
              canPrint: true,
            },
            ...demoOutputReceipts.map((o) => ({
              id: `demo-${label}-${o.type}`,
              type: o.type,
              title:
                o.type === 'getraenke' ? 'Ausgabe Getränke'
                : o.type === 'kuchen_suess' ? 'Ausgabe Kuchen / Süßes'
                : 'Ausgabe Heißes Essen',
              text: o.text,
              width,
              canPrint: true,
            })),
          ]
          setDemoPreviewReceipts(previewItems)
          setDemoPreviewSelectedId(previewItems[0]?.id ?? null)
          setDemoPreviewOpen(true)

          const autoPrintDemo = (await getSetting('demoAutoPrintReceipts')) === '1'
          if (autoPrintDemo) {
            try {
              const blocks = [
                customer,
                ...demoOutputReceipts.map((o) => o.text),
              ].filter((t) => t.trim().length > 0)
              if (blocks.length === 1)
                await tryBluetoothPrintPlainText(blocks[0])
              else if (blocks.length > 1) await tryBluetoothPrintPlainBlocks(blocks)
            } catch {
              /* ignore */
            }
          }
          showToast(
            `DEMO-Verkauf simuliert (${label}). Keine echte Buchung.`,
            3200,
          )
        } catch (e) {
          showToast(`Demo-Fehler: ${String((e as Error).message ?? e)}`, 4000)
        }
        return
      }
      // -------- /DEMO-MODUS ----------

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
            eventId: activeEvent?.id ?? null,
          })
          setCart([])
          if (sale.duplicate) {
            showToast('Erneuter Druck – bereits verbucht.', 2600)
            return
          }
          const teamName = opts?.teamName
          const cats = remoteCategories ?? []
          const prods = remoteProducts ?? []
          const models = buildReceiptLineModelsFromCatalog(snap, prods, cats)
          const ctx = await readReceiptFormattingContext()
          const { customer } = renderDualReceiptTexts(
            ctx,
            models,
            method,
            sale.receiptNo,
            sale.createdAt,
            false,
            method === 'invoice' ? teamName : undefined,
          )
          const outputReceipts = buildOutputReceiptStoredEntries(
            ctx,
            models,
            method,
            sale.receiptNo,
            sale.createdAt,
            false,
            method === 'invoice' ? teamName : undefined,
          )
          const archiveId = await persistRemoteDualReceiptArchive({
            serverSaleId: sale.id,
            receiptNo: sale.receiptNo,
            createdAt: sale.createdAt,
            paymentMethod: method,
            totalCents: snap.reduce((s, l) => s + l.priceCents * l.qty, 0),
            eventId: activeEvent?.id ?? null,
            teamName: method === 'invoice' ? teamName : undefined,
            linesJson: JSON.stringify(models),
            customerReceiptText: customer,
            servingReceiptText: '',
            outputReceiptsJson: JSON.stringify(outputReceipts),
            printedCustomerReceipt: false,
            printedServingReceipt: false,
            customerReceiptPrintCount: 0,
            servingReceiptPrintCount: 0,
          })
          const printRes = await printCheckoutReceiptsAfterSale({
            customerText: customer,
            outputReceipts,
            receiptNo: sale.receiptNo,
            skipAutoPrint: false,
            bumps: {
              bumpCustomer: async () => bumpRemoteArchivePrintSuccess(archiveId, 'customer'),
              bumpOutput: async (station) =>
                bumpRemoteArchivePrintSuccess(archiveId, station),
            },
          })
          if (printRes.hadFailure) showToast(printRes.message, 5000)
          else if (printRes.printedAnything) showToast('Verbucht (Server). Bons gedruckt.', 2600)
          else showToast('Verbucht (Server).', 2600)
        } else {
          if (method === 'invoice') throw new Error('Rechnung nur mit Server-API.')
          const r = await completeLocalSaleWithDualReceipts(snap, method, {
            eventId: activeEvent?.id ?? null,
          })
          setCart([])
          const skipPrint = opts?.offlineSkipReceiptPrint === true && method === 'cash'
          const printRes = await printCheckoutReceiptsAfterSale({
            customerText: r.customerReceiptText,
            outputReceipts: r.outputReceipts,
            receiptNo: r.receiptNo,
            skipAutoPrint: skipPrint,
            bumps: {
              bumpCustomer: async () => bumpLocalSalePrintSuccess(r.saleId, 'customer'),
              bumpOutput: async (station) =>
                bumpLocalSalePrintSuccess(r.saleId, station),
            },
          })
          if (printRes.hadFailure) showToast(printRes.message, 5000)
          else if (printRes.printedAnything)
            showToast(method === 'cash' ? 'Barzahlung verbucht.' : 'Kartenzahlung verbucht.', 2600)
          else
            showToast(
              method === 'cash'
                ? skipPrint
                  ? 'Verbucht.'
                  : 'Barzahlung verbucht.'
                : 'Kartenzahlung verbucht.',
            )
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
            eventId: activeEvent?.id,
          }
          writeOutbox([...readOutbox(), pending])
          setCart([])
          showToast('Offline gespeichert. Wird beim nächsten Sync gesendet.', 5000)
          return
        }
        showToast(String((e as Error).message ?? e), 5000)
      }
    },
    [
      cart,
      total,
      remoteMode,
      remoteCategories,
      remoteProducts,
      dexCategories,
      dexProducts,
      activeEvent,
      saleAvailability.canSell,
    ],
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
          eventId: it.eventId ?? null,
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
    queueMicrotask(() => {
      void syncOutbox()
    })
    const onOnline = () => {
      void syncOutbox()
    }
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [remoteMode, syncOutbox])

  const handleTestPrint = useCallback(async () => {
    const text = formatDemoTestPrint()
    setPrintBusy(true)
    try {
      const res = await tryBluetoothPrintPlainText(text)
      if (res.ok) {
        showToast('Testbon gesendet.', 2400)
      } else {
        downloadTextFile(`dlrg-testbon.txt`, text)
        showToast('Bluetooth nicht möglich – Testbon als Datei.', 3500)
      }
    } finally {
      setPrintBusy(false)
    }
  }, [])

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
        if (!saleAvailability.canSell || cart.length === 0 || printBusy) return
        openCashModal('withBon')
      } else if (e.key === 'F11') {
        e.preventDefault()
        if (saleAvailability.canSell && cart.length > 0) setCardOpen(true)
      } else if (e.key === 'F10') {
        e.preventDefault()
        if (cart.length > 0 && !printBusy) void handlePrintDraft()
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (!saleAvailability.canSell || cart.length === 0) return
        openCashModal('noBon')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    modalsBlockKeys,
    cart.length,
    printBusy,
    saleAvailability.canSell,
    remoteMode,
    openCashModal,
    handlePrintDraft,
    undoLast,
  ])

  const revLabel =
    typeof tagesumsatz === 'number' ? formatMoney(tagesumsatz) : '(API‑Modus)'
  const revHeading = demoMode ? 'DEMO‑Tagesumsatz' : 'Tagesumsatz'

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
      <div
        className={[
          'border-b px-3 py-2.5 text-center text-[13px] font-semibold leading-snug',
          saleAvailability.canSell && saleAvailability.mode === 'event'
            ? 'border-emerald-500/40 bg-emerald-950/35 text-emerald-50'
            : saleAvailability.canSell
              ? 'border-amber-500/40 bg-amber-950/35 text-amber-100'
              : 'border-rose-500/50 bg-rose-950/40 text-rose-100',
        ].join(' ')}
      >
        {saleAvailability.canSell && saleAvailability.mode === 'event' && activeEvent ? (
          <>
            Aktive Veranstaltung:{' '}
            <span className="font-black">{activeEvent.name}</span>
            {' · Zeitraum '}
            {format(new Date(activeEvent.startDate + 'T12:00:00'), 'dd.MM.yyyy', {
              locale: de,
            })}{' '}
            –{' '}
            {format(new Date(activeEvent.endDate + 'T12:00:00'), 'dd.MM.yyyy', {
              locale: de,
            })}
          </>
        ) : saleAvailability.canSell ? (
          <>
            Standardverkauf aktiv – keine Veranstaltung zugeordnet.
          </>
        ) : (
          <>
            <span className="font-black uppercase">Verkauf gesperrt.</span>{' '}
            {saleBlockedText}{' '}
            Bitte Veranstaltung aktivieren oder Standardverkauf in den Einstellungen erlauben.
          </>
        )}
      </div>
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
                {revHeading}
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
          <InstallAppButton
            variant="pos"
            onShowIosGuide={() => setIosGuideOpen(true)}
          />
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
            <div className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-4">
              {products.map((p) => {
                const soldOut = Boolean(
                  p.stockTracking && Number(p.stockQty ?? 0) <= 0,
                )
                return (
                  <button
                    key={p.id}
                    type="button"
                    disabled={soldOut || !saleAvailability.canSell}
                    onClick={() => addProduct(p.id, p.name, p.priceCents)}
                    className={[
                      'flex h-[5.85rem] w-full shrink-0 items-stretch overflow-hidden rounded-xl border-2 border-[#ff003c] bg-black text-left transition-transform active:scale-[0.98] sm:h-[6.35rem]',
                      'shadow-[0_0_22px_rgba(255,0,60,0.35)] hover:shadow-[0_0_32px_rgba(255,0,60,0.5)]',
                      soldOut || !saleAvailability.canSell ? 'opacity-50 grayscale' : '',
                      tapId === p.id ? 'animate-tap' : '',
                    ].join(' ')}
                  >
                    <ProductVisual
                      key={`${p.id}:${p.imageUrl ?? ''}`}
                      productId={p.id}
                      name={p.name}
                      categoryId={p.categoryId}
                      imageUrl={p.imageUrl}
                    />
                    <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 py-2 pl-2 pr-2 leading-tight sm:pl-2.5">
                      {soldOut && (
                        <span className="text-[10px] font-black uppercase tracking-wider text-red-400">
                          AUSVERKAUFT
                        </span>
                      )}
                      <span className="text-sm font-bold leading-snug text-white sm:text-[0.9375rem]">
                        {p.name}
                      </span>
                      <span className="text-base font-black tabular-nums text-[#FFD700] sm:text-lg">
                        {formatMoney(p.priceCents)}
                      </span>
                    </div>
                  </button>
                )
              })}
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
            disabled={!saleAvailability.canSell || cart.length === 0 || printBusy}
            onClick={() => openCashModal('withBon')}
            className="flex min-h-[64px] flex-col items-center justify-center rounded-xl border-2 border-[#ff003c] bg-red-950/30 px-4 py-2 text-lg font-black uppercase text-white shadow-[0_0_24px_rgba(255,0,60,0.25)] transition enabled:hover:bg-red-950/50 disabled:opacity-35"
          >
            Barzahlung
            <span className="text-xs font-bold text-[#FFD700]">F12</span>
          </button>
          <button
            type="button"
            disabled={!saleAvailability.canSell || cart.length === 0}
            onClick={() => setCardOpen(true)}
            className="flex min-h-[64px] flex-col items-center justify-center rounded-xl border-2 border-[#FFD700] bg-black px-4 py-2 text-lg font-black uppercase text-[#FFD700] shadow-[0_0_20px_rgba(255,215,0,0.15)] transition enabled:hover:bg-neutral-950 disabled:opacity-35"
          >
            Kartenzahlung
            <span className="text-xs font-bold text-neutral-400">F11</span>
          </button>
          <button
            type="button"
            disabled={!saleAvailability.canSell || cart.length === 0 || (!remoteMode && !demoMode)}
            onClick={() => setInvoiceOpen(true)}
            title={!remoteMode && !demoMode ? 'Erfordert API + Login' : ''}
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
            disabled={!saleAvailability.canSell || cart.length === 0}
            onClick={() => openCashModal('noBon')}
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
            {demoMode ? (
              <>
                <button
                  type="button"
                  disabled={printBusy}
                  onClick={() => void handleTestPrint()}
                  className="rounded-lg border border-yellow-400/60 bg-yellow-950/30 px-3 py-2 text-xs font-bold uppercase text-yellow-200 hover:bg-yellow-950/50 disabled:opacity-40"
                >
                  Testbon drucken
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void logDemoModeAudit('leave')
                    exitDemoMode()
                  }}
                  className="rounded-lg border-2 border-amber-400/70 bg-amber-500/15 px-3 py-2 text-xs font-black uppercase text-amber-100 hover:bg-amber-500/25"
                >
                  Demo-Modus verlassen
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setDemoCodeOpen(true)}
                className="rounded-lg border border-yellow-500/50 bg-neutral-900 px-3 py-2 text-xs font-bold uppercase text-yellow-200 hover:bg-yellow-950/40"
                title="Demo-Modus für Vorführungen"
              >
                Demo-Modus
              </button>
            )}
            <button
              type="button"
              disabled={pwaCheckBusy}
              onClick={() => void handlePwaUpdateCheck()}
              className="inline-flex items-center gap-1.5 rounded-lg border-2 border-[#ff003c]/55 border-t-[#FFD700]/55 bg-neutral-950 px-3 py-2 text-xs font-bold uppercase text-[#FFD700] shadow-[0_0_14px_rgba(255,0,60,0.15)] hover:bg-black disabled:opacity-40"
              title="Neue App-Version vom Server laden (ohne Kassendaten zu löschen)"
            >
              <RefreshIcon className={pwaCheckBusy ? 'animate-spin' : ''} />
              {pwaCheckBusy ? 'Prüfe…' : 'Update prüfen'}
            </button>
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

      {cashOpen && (
        <CashTenderModal
          subtitleHint={
            !remoteMode && offlineCashVariant === 'noBon'
              ? 'Schnellabschluss: Kunden- und Servierbon werden gespeichert, aber nicht automatisch gedruckt. Nachdruck unter Admin → Einstellungen → Bon‑Verwaltung.'
              : undefined
          }
          totalCents={total}
          onCancel={closeCashModal}
          onConfirm={async (given) => {
            const skipBon = offlineCashVariant === 'noBon'
            closeCashModal()
            if (given < total) {
              showToast('Gegeben zu niedrig.')
              return
            }
            if (cart.length === 0) return
            const change = given - total
            showToast(`Rückgeld: ${formatMoney(change)}`, 2400)

            if (remoteMode) {
              await settleAndPrint('cash', {
                method: 'cash',
                amountTenderedCents: given,
              })
            } else {
              await settleAndPrint('cash', undefined, {
                offlineSkipReceiptPrint: skipBon,
              })
            }
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
          defaultEventId={activeEvent?.id}
          onCancel={() => setInvoiceOpen(false)}
          onConfirmed={async (p) => {
            await settleAndPrint(
              'invoice',
              {
                method: 'invoice',
                teamId: p.teamId,
                eventId: p.eventId,
                contactName: p.contactName,
                note: p.note,
              },
              {
                teamName: p.teamName,
                teamId: p.teamId,
                eventId: p.eventId,
                eventName: p.eventName,
                contactName: p.contactName,
                note: p.note,
              },
            )
            setInvoiceOpen(false)
          }}
        />
      )}

      {pwaUpdateOfferOpen ? (
        <div
          className="fixed inset-0 z-[130] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal
          aria-labelledby="pwa-update-title"
        >
          <div className="panel-glass w-full max-w-md rounded-2xl border-2 border-[#ff003c]/50 p-6 shadow-[0_0_40px_rgba(255,215,0,0.12)]">
            <h2
              id="pwa-update-title"
              className="text-lg font-black uppercase tracking-wide text-[#FFD700]"
            >
              Neue Version
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-slate-200">
              Neue Version verfügbar. Jetzt aktualisieren? Es werden nur
              App-Dateien neu geladen – Verkäufe, Bons und Einstellungen bleiben
              erhalten (IndexedDB / Server).
            </p>
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                className="rounded-xl border border-white/20 px-4 py-2 text-sm font-semibold text-slate-300 hover:bg-white/5"
                onClick={() => setPwaUpdateOfferOpen(false)}
              >
                Später
              </button>
              <button
                type="button"
                className="rounded-xl border-2 border-[#FFD700]/60 bg-gradient-to-r from-[#ff003c]/90 to-rose-700/90 px-4 py-2 text-sm font-black uppercase text-white hover:opacity-95"
                onClick={() => {
                  void (async () => {
                    try {
                      await applyUpdate()
                    } catch {
                      showToast('Update konnte nicht angewendet werden.', 4500)
                    }
                  })()
                }}
              >
                Jetzt aktualisieren
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <ReceiptPreviewModal
        open={demoPreviewOpen}
        receipts={demoPreviewReceipts}
        selectedId={demoPreviewSelectedId}
        onSelect={setDemoPreviewSelectedId}
        onClose={() => setDemoPreviewOpen(false)}
        onPrintCurrent={() => {
          const current = demoPreviewReceipts.find((r) => r.id === demoPreviewSelectedId)
          if (!current) return
          void (async () => {
            const res = await tryBluetoothPrintPlainText(current.text)
            if (res.ok) showToast('Demo-Bon testweise gedruckt.', 2400)
            else showToast(`Druck fehlgeschlagen: ${res.message}`, 4200)
          })()
        }}
        onPrintAll={() => {
          void (async () => {
            const blocks = demoPreviewReceipts.map((r) => r.text).filter((x) => x.trim())
            if (blocks.length === 0) return
            const res = await tryBluetoothPrintPlainBlocks(blocks)
            if (res.ok) showToast('Alle Demo-Bons testweise gedruckt.', 2600)
            else showToast(`Druck fehlgeschlagen: ${res.message}`, 4200)
          })()
        }}
        onCopyCurrent={() => {
          const current = demoPreviewReceipts.find((r) => r.id === demoPreviewSelectedId)
          if (!current) return
          void navigator.clipboard
            .writeText(current.text)
            .then(() => showToast('Bontext kopiert.', 1800))
            .catch(() => showToast('Kopieren fehlgeschlagen.', 2600))
        }}
      />

      {toast && <SuccessToast message={toast} />}

      {demoCodeOpen && (
        <DemoCodeOverlay onClose={() => setDemoCodeOpen(false)} />
      )}

      {iosGuideOpen && (
        <IosInstallGuide variant="modal" onClose={() => setIosGuideOpen(false)} />
      )}
    </div>
  )
}
