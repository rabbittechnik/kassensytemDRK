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
import { API_BASE_URL, apiBaseUrl, hasApi } from '../api/config'
import { apiJson, resolveApiUrl, checkServerReachability, describeApiReachability } from '../api/http'
import {
  apiCreateManualDepositRedemption,
  apiCreateHelperConsumption,
  apiCreateSale,
  type ApiPaymentBody,
} from '../api/sales'
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
import { buildMetaSummary } from '../lib/buildMeta'
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

function withHelperOutputHeader(text: string): string {
  return [
    'HELFERVERPFLEGUNG - NICHT KASSIEREN',
    'GRUPPE: HELFER ALLGEMEIN',
    '',
    text.trim(),
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

type DepositOption = {
  name: string
  amountCents: number
  type: string | null
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
  apiReachable?: boolean
  dataMode?: 'api' | 'offline'
  onActivateOnlineMode?: () => void
  onActivateOfflineMode?: () => void
  onApiLogout?: () => void
}

export function PosScreen({
  onOpenAdmin,
  onOpenZReport,
  apiJwt,
  apiReachable = false,
  dataMode = 'offline',
  onActivateOnlineMode,
  onActivateOfflineMode,
  onApiLogout,
}: PosScreenProps) {
  const { checkForUpdate, applyUpdate } = usePwaUpdate()
  const remoteMode = Boolean(hasApi() && apiJwt && dataMode === 'api')

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
                depositEnabled:
                  typeof row.depositEnabled === 'boolean'
                    ? row.depositEnabled
                    : Boolean(Number(row.deposit_enabled ?? 0)),
                depositAmount:
                  typeof row.depositAmount === 'number'
                    ? row.depositAmount
                    : Number(row.deposit_amount ?? 0),
                depositType:
                  row.depositType == null && row.deposit_type == null ?
                    null
                  : String(row.depositType ?? row.deposit_type) as ProductRow['depositType'],
                depositName:
                  row.depositName == null && row.deposit_name == null ?
                    null
                  : String(row.depositName ?? row.deposit_name),
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
  const [cacheRefreshBusy, setCacheRefreshBusy] = useState(false)
  const [onlineModeCheckBusy, setOnlineModeCheckBusy] = useState(false)
  const [onlineModeCheckResult, setOnlineModeCheckResult] = useState<{
    reachable: boolean
    requiresAuth: boolean
    status: number | null
  } | null>(null)
  const [diagPanelOpen, setDiagPanelOpen] = useState(false)
  const [pwaUpdateOfferOpen, setPwaUpdateOfferOpen] = useState(false)
  const [demoPreviewOpen, setDemoPreviewOpen] = useState(false)
  const [demoPreviewReceipts, setDemoPreviewReceipts] = useState<DemoPreviewReceiptItem[]>([])
  const [demoPreviewSelectedId, setDemoPreviewSelectedId] = useState<string | null>(null)
  const [syncingOutbox, setSyncingOutbox] = useState(false)
  const [helperModalOpen, setHelperModalOpen] = useState(false)
  const [helperNote, setHelperNote] = useState('')
  const [helperBusy, setHelperBusy] = useState(false)
  const [depositModalOpen, setDepositModalOpen] = useState(false)
  const [depositQty, setDepositQty] = useState(1)
  const [depositAmountCents, setDepositAmountCents] = useState(25)
  const [depositName, setDepositName] = useState('Flasche/Dose')
  const [depositType, setDepositType] = useState<string | null>(null)
  const [depositNote, setDepositNote] = useState('')
  const [depositBusy, setDepositBusy] = useState(false)
  const [apiDiag, setApiDiag] = useState<{
    baseSet: boolean
    baseUrl: string
    healthReachable: boolean
    apiReachable: boolean
    depositEndpointReachable: boolean
    lastCheckedAt: number
  }>({
    baseSet: Boolean(String(API_BASE_URL ?? '').trim()),
    baseUrl: apiBaseUrl(),
    healthReachable: false,
    apiReachable: false,
    depositEndpointReachable: false,
    lastCheckedAt: 0,
  })

  const productsForCart = remoteMode ? remoteProducts : (dexProducts ?? [])
  const productById = useMemo(
    () => new Map(productsForCart.map((p) => [p.id, p])),
    [productsForCart],
  )
  const cartDepositDetails = useMemo(
    () =>
      cart.map((l) => {
        const p = productById.get(l.productId)
        const enabled = Boolean(p?.depositEnabled) || Number(p?.depositAmount ?? 0) > 0
        const amountCents = enabled ? Math.max(0, Number(p?.depositAmount ?? 0)) : 0
        const depositName = (p?.depositName?.trim() || 'Pfand').trim()
        return {
          productId: l.productId,
          qty: l.qty,
          amountCents,
          depositName,
          depositType: p?.depositType ?? null,
          totalCents: amountCents * l.qty,
        }
      }),
    [cart, productById],
  )
  const wareTotal = useMemo(
    () => cart.reduce((s, l) => s + l.priceCents * l.qty, 0),
    [cart],
  )
  const depositTotal = useMemo(
    () => cartDepositDetails.reduce((s, d) => s + d.totalCents, 0),
    [cartDepositDetails],
  )
  const totalWithDeposit = wareTotal + depositTotal
  const depositOptions = useMemo(() => {
    const map = new Map<string, DepositOption>()
    for (const p of productsForCart) {
      const enabled = Boolean(p.depositEnabled) || Number(p.depositAmount ?? 0) > 0
      const amount = Math.max(0, Number(p.depositAmount ?? 0))
      if (!enabled || amount <= 0) continue
      const name = p.depositName?.trim() || 'Pfand'
      const key = `${name}|${amount}|${p.depositType ?? ''}`
      if (!map.has(key)) {
        map.set(key, { name, amountCents: amount, type: p.depositType ?? null })
      }
    }
    return [...map.values()].sort((a, b) => a.amountCents - b.amountCents || a.name.localeCompare(b.name, 'de'))
  }, [productsForCart])
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

  const runApiDiagnostics = useCallback(async () => {
    const base = apiBaseUrl()
    const diag = {
      baseSet: Boolean(base),
      baseUrl: base,
      healthReachable: false,
      apiReachable: false,
      depositEndpointReachable: false,
      lastCheckedAt: Date.now(),
    }
    if (!diag.baseSet) {
      setApiDiag(diag)
      return diag
    }
    const checks = await Promise.allSettled([
      fetch(resolveApiUrl('/health'), { method: 'GET' }),
      fetch(base, { method: 'GET' }),
      fetch(resolveApiUrl('/deposit-vouchers/DIAG-PING-000000'), { method: 'GET' }),
    ])
    const okish = (r: PromiseSettledResult<Response>) =>
      r.status === 'fulfilled' && r.value.status > 0
    diag.healthReachable = okish(checks[0])
    diag.apiReachable = okish(checks[1])
    diag.depositEndpointReachable = okish(checks[2])
    setApiDiag(diag)
    return diag
  }, [])

  useEffect(() => {
    void runApiDiagnostics()
    const t = window.setInterval(() => void runApiDiagnostics(), 20_000)
    const onOnline = () => void runApiDiagnostics()
    window.addEventListener('online', onOnline)
    return () => {
      window.clearInterval(t)
      window.removeEventListener('online', onOnline)
    }
  }, [runApiDiagnostics])

  const apiConnected = apiDiag.healthReachable && apiDiag.apiReachable
  const modeLabel = demoMode ? 'Demo' : remoteMode ? 'Online / Server' : 'Offline / Lokal'

  useEffect(() => {
    let alive = true
    void (async () => {
      if (remoteMode) {
        try {
          const settings = await apiJson<{ deposit_default_amount?: string | number }>(
            '/settings',
          )
          const raw = settings?.deposit_default_amount
          const parsed =
            typeof raw === 'number' ? raw : Number(String(raw ?? '').trim())
          if (!alive) return
          setDepositAmountCents(Number.isFinite(parsed) && parsed > 0 ? parsed : 25)
          return
        } catch {
          // fallback to local setting below
        }
      }
      const localRaw = await getSetting('deposit_default_amount')
      if (!alive) return
      const localParsed = Number(localRaw ?? '25')
      setDepositAmountCents(
        Number.isFinite(localParsed) && localParsed > 0 ? localParsed : 25,
      )
    })()
    return () => {
      alive = false
    }
  }, [remoteMode])

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

  const handleActivateOnlineMode = useCallback(async () => {
    // If we already know the server is unreachable, skip the network probe
    if (!apiReachable) {
      showToast('Server nicht erreichbar. Bitte Netzwerk und Backend prüfen.', 5000)
      return
    }
    // If server is reachable but no JWT, go to login instead of probing
    if (!apiJwt) {
      onOpenAdmin()
      return
    }
    setOnlineModeCheckBusy(true)
    setOnlineModeCheckResult(null)
    try {
      const result = await checkServerReachability('/health')
      setOnlineModeCheckResult(result)
      if (!result.reachable && !result.requiresAuth) {
        showToast('Server nicht erreichbar. Bitte Netzwerk und Backend prüfen.', 5000)
        return
      }
      if (result.requiresAuth) {
        onOpenAdmin()
        return
      }
      // Server reachable and no auth issue → switch to online mode
      onActivateOnlineMode?.()
    } finally {
      setOnlineModeCheckBusy(false)
    }
  }, [apiReachable, apiJwt, onOpenAdmin, onActivateOnlineMode])

  const handleCacheRefresh = useCallback(async () => {
    setCacheRefreshBusy(true)
    try {
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations()
        await Promise.all(
          registrations.map(async (reg) => {
            await reg.update()
            if (reg.waiting) {
              reg.waiting.postMessage({ type: 'SKIP_WAITING' })
            }
          }),
        )
      }
      showToast('Cache wird aktualisiert – Seite lädt neu …', 2000)
      window.setTimeout(() => window.location.reload(), 2200)
    } catch {
      showToast('Cache-Aktualisierung fehlgeschlagen.', 3500)
      setCacheRefreshBusy(false)
    }
  }, [])

  const handleDepositRedeem = useCallback(async () => {
    if (!demoMode) {
      const diag = await runApiDiagnostics()
      const apiConnected =
        diag.healthReachable && diag.apiReachable && diag.depositEndpointReachable
      if (!apiJwt) {
        showToast(
          'Die Kasse läuft aktuell im Offline-Modus. Pfand-Auszahlung ist nur im Servermodus möglich.',
          5200,
        )
        return
      }
      if (!apiConnected) {
        if (navigator.onLine) {
          showToast(
            'Internet ist vorhanden, aber der Kassen-Server ist nicht erreichbar. Pfand-Auszahlung ist deshalb gesperrt.',
            6200,
          )
        } else {
          showToast(
            'Keine Serververbindung für Pfand-Auszahlung. Bitte Netzwerk und Kassen-Server prüfen.',
            5200,
          )
        }
        return
      }
    }
    setDepositQty(1)
    setDepositNote('')
    const first = depositOptions[0]
    if (first) {
      setDepositName(first.name)
      setDepositAmountCents(first.amountCents)
      setDepositType(first.type)
    }
    setDepositModalOpen(true)
  }, [apiJwt, demoMode, runApiDiagnostics, depositOptions])

  const submitManualDepositRedemption = useCallback(async () => {
    if (depositBusy) return
    const qty = Math.max(1, Math.floor(depositQty))
    const amount = Math.max(1, Math.floor(depositAmountCents))
    const totalCents = qty * amount
    setDepositBusy(true)
    try {
      if (demoMode) {
        showToast(
          `DEMO: Pfand ausgezahlt ${qty}x ${formatMoney(amount)} = ${formatMoney(totalCents)}.`,
          4200,
        )
      } else {
        await apiCreateManualDepositRedemption({
          eventId: activeEvent?.id ?? null,
          quantity: qty,
          amountCents: amount,
          depositName,
          depositType,
          note: depositNote.trim() || undefined,
        })
        showToast(`Pfand ausgezahlt: ${formatMoney(totalCents)} (${qty}x).`, 4200)
      }
      setDepositModalOpen(false)
      setDepositNote('')
      setDepositQty(1)
    } catch (e) {
      showToast(`Pfand-Auszahlung fehlgeschlagen: ${String((e as Error).message ?? e)}`, 5000)
    } finally {
      setDepositBusy(false)
    }
  }, [activeEvent?.id, demoMode, depositAmountCents, depositBusy, depositNote, depositQty, depositName, depositType])

  const handleHelperConsumption = useCallback(async () => {
    if (cart.length === 0) {
      showToast('Warenkorb ist leer.', 2400)
      return
    }
    setHelperModalOpen(true)
  }, [cart.length])

  const submitHelperConsumption = useCallback(async () => {
    if (cart.length === 0 || helperBusy) return
    setHelperBusy(true)
    try {
      let bookingNo = ''
      if (remoteMode) {
        const out = await apiCreateHelperConsumption({
          eventId: activeEvent?.id ?? null,
          note: helperNote.trim() || undefined,
          lines: cart.map((l) => ({
            productId: l.productId,
            qty: l.qty,
            unitPriceCents: l.priceCents,
            name: l.name,
          })),
        })
        bookingNo = out.saleLikeNumber
      } else {
        const now = Date.now()
        const year = new Date(now).getFullYear()
        const seqKey = `nextHelperConsumptionNo_${year}`
        const current = Number((await getSetting(seqKey)) ?? '1') || 1
        bookingNo = `HV-${year}-${String(current).padStart(6, '0')}`
        await db.transaction('rw', db.helperConsumptions, db.helperConsumptionItems, db.products, db.settings, async () => {
          await db.settings.put({ key: seqKey, value: String(current + 1) })
          const id = crypto.randomUUID()
          for (const l of cart) {
            const p = await db.products.get(l.productId)
            if (p?.stockTracking) {
              const left = Number(p.stockQty ?? 0) - l.qty
              if (left < 0) throw new Error('OUT_OF_STOCK')
              await db.products.update(l.productId, { stockQty: left })
            }
            await db.helperConsumptionItems.add({
              id: crypto.randomUUID(),
              helperConsumptionId: id,
              productId: l.productId,
              productNameSnapshot: l.name,
              quantity: l.qty,
              unitPriceSnapshotCents: l.priceCents,
              totalValueCents: l.priceCents * l.qty,
            })
          }
          await db.helperConsumptions.add({
            id,
            helperGroup: 'Helfer allgemein',
            consumptionType: 'helper_general',
            eventId: activeEvent?.id ?? null,
            saleLikeNumber: bookingNo,
            totalValueCents: cart.reduce((s, l) => s + l.priceCents * l.qty, 0),
            paymentTotalCents: 0,
            createdAt: now,
            note: helperNote.trim() || null,
          })
        })
      }
      const linesTotal = cart.reduce((s, l) => s + l.priceCents * l.qty, 0)
      const modelLines = buildReceiptLineModelsFromCatalog(
        cart,
        remoteMode ? remoteProducts : (dexProducts ?? []),
        remoteMode ? (remoteCategories ?? []) : (dexCategories ?? []),
      )
      const ctx = await readReceiptFormattingContext()
      const outputs = buildOutputReceiptStoredEntries(
        ctx,
        modelLines,
        'cash',
        0,
        Date.now(),
        false,
      ).map((o) => ({ ...o, text: withHelperOutputHeader(o.text) }))
      if (outputs.length > 0) {
        await tryBluetoothPrintPlainBlocks(outputs.map((o) => o.text))
      }
      setCart([])
      setHelperNote('')
      setHelperModalOpen(false)
      showToast(`Helferverpflegung erfasst (${bookingNo}).`, 3600)
      showToast(`Warenwert dokumentiert: ${formatMoney(linesTotal)} · Zu zahlen: 0,00 EUR`, 4200)
    } catch (e) {
      showToast(`Helferverpflegung fehlgeschlagen: ${String((e as Error).message ?? e)}`, 5000)
    } finally {
      setHelperBusy(false)
    }
  }, [
    activeEvent?.id,
    cart,
    helperBusy,
    helperNote,
    remoteCategories,
    remoteMode,
    remoteProducts,
    dexProducts,
    dexCategories,
  ])

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
      if (cart.length === 0 || totalWithDeposit <= 0) return
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
              depositEnabled: Boolean(p.depositEnabled) || Number(p.depositAmount ?? 0) > 0,
              depositAmount: Number(p.depositAmount ?? 0),
              depositName: p.depositName ?? null,
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
            totalCents: totalWithDeposit,
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
      totalWithDeposit,
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
      totalCents: totalWithDeposit,
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
  }, [cart, totalWithDeposit])

  const modalsBlockKeys =
    cardOpen || cashOpen || invoiceOpen || helperModalOpen || depositModalOpen

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
        openCashModal('withBon')
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
                  {cart.flatMap((l) => {
                    const rows: any[] = []
                    rows.push(
                      <tr
                        key={`item-${l.productId}`}
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
                      </tr>,
                    )
                    const dep = cartDepositDetails.find((d) => d.productId === l.productId)
                    if (dep && dep.totalCents > 0) {
                      rows.push(
                        <tr key={`dep-${l.productId}`} className="text-[12px] text-sky-200">
                          <td className="py-1 pl-6">+ Pfand {dep.depositName}</td>
                          <td className="py-1 tabular-nums">{dep.qty}x</td>
                          <td className="py-1 tabular-nums">{formatMoney(dep.amountCents)}</td>
                          <td className="py-1 tabular-nums">{formatMoney(dep.totalCents)}</td>
                          <td />
                        </tr>,
                      )
                    }
                    return rows
                  })}
                </tbody>
              </table>
            )}
          </div>

          <div className="space-y-1 border-t border-[#ff003c]/35 bg-black/40 px-4 py-4">
            <div className="flex items-baseline justify-between text-sm text-slate-300">
              <span>Warenwert</span>
              <span className="tabular-nums">{formatMoney(wareTotal)}</span>
            </div>
            <div className="flex items-baseline justify-between text-sm text-sky-200">
              <span>Pfand</span>
              <span className="tabular-nums">{formatMoney(depositTotal)}</span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-lg font-black text-[#FFD700]">Gesamtbetrag</span>
              <span className="text-3xl font-black tabular-nums text-[#FFD700] md:text-4xl">
                {formatMoney(totalWithDeposit)}
              </span>
            </div>
          </div>
        </aside>
      </div>

      <footer className="flex-shrink-0 space-y-3 border-t border-[#ff003c]/30 bg-black px-3 pb-4 pt-3 md:px-5">
        <div className="rounded-xl border border-[#ff003c]/40 bg-neutral-950/40 p-3">
          <p className="mb-2 text-xs font-black uppercase tracking-[0.12em] text-[#FFD700]">
            Abschlussart wählen
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <button
            type="button"
            disabled={!saleAvailability.canSell || cart.length === 0 || printBusy}
            onClick={() => openCashModal('withBon')}
            title="Kunde bezahlt bar."
            className="flex min-h-[72px] flex-col items-center justify-center rounded-xl border-2 border-emerald-400/70 bg-emerald-900/30 px-4 py-2 text-lg font-black uppercase text-emerald-50 shadow-[0_0_22px_rgba(16,185,129,.28)] transition enabled:hover:bg-emerald-900/45 disabled:opacity-35"
          >
            Barzahlung
            <span className="text-xs font-bold text-emerald-200">F12 / Enter</span>
          </button>
          <button
            type="button"
            disabled={!saleAvailability.canSell || cart.length === 0}
            onClick={() => setCardOpen(true)}
            title="Kunde bezahlt per Karte."
            className="flex min-h-[72px] flex-col items-center justify-center rounded-xl border-2 border-cyan-400/70 bg-cyan-950/25 px-4 py-2 text-lg font-black uppercase text-cyan-100 shadow-[0_0_20px_rgba(34,211,238,.22)] transition enabled:hover:bg-cyan-950/40 disabled:opacity-35"
          >
            Kartenzahlung
            <span className="text-xs font-bold text-cyan-200">F11</span>
          </button>
          <button
            type="button"
            disabled={!saleAvailability.canSell || cart.length === 0 || (!remoteMode && !demoMode)}
            onClick={() => setInvoiceOpen(true)}
            title={!remoteMode && !demoMode ? 'Auf Team/Verein buchen. (Erfordert API + Login)' : 'Auf Team/Verein buchen.'}
            className="flex min-h-[72px] flex-col items-center justify-center rounded-xl border-2 border-cyan-500/70 bg-cyan-950/20 px-4 py-2 text-lg font-black uppercase text-cyan-200 shadow-[0_0_22px_rgba(34,211,238,.2)] transition enabled:hover:bg-cyan-950/35 disabled:opacity-35"
          >
            Auf Rechnung
          </button>
          <button
            type="button"
            disabled={!saleAvailability.canSell || cart.length === 0}
            onClick={() => void handleHelperConsumption()}
            title="Kostenlose Helferausgabe dokumentieren."
            className="flex min-h-[72px] flex-col items-center justify-center rounded-xl border-2 border-orange-400/70 bg-orange-900/25 px-4 py-2 text-lg font-black uppercase text-orange-100 shadow-[0_0_22px_rgba(251,146,60,.24)] transition enabled:hover:bg-orange-900/40 disabled:opacity-35"
          >
            Helferverpflegung
            <span className="text-xs font-bold text-orange-200">0,00 EUR - dokumentieren</span>
          </button>
        </div>
        </div>
        <div className="rounded-xl border border-sky-500/35 bg-sky-950/15 p-3">
          <p className="mb-2 text-xs font-black uppercase tracking-[0.12em] text-sky-200">
            Sonderfunktion
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => void handleDepositRedeem()}
            title="Pfandbon prüfen und Pfand zurückzahlen."
            className="flex min-h-[62px] flex-col items-center justify-center rounded-lg border border-sky-500/60 bg-sky-950/25 px-3 py-2 text-sm font-bold uppercase text-sky-100 hover:bg-sky-950/40 disabled:opacity-35"
          >
            Pfand auszahlen
            <span className="text-[11px] font-semibold text-sky-200">Flasche/Bon zurück</span>
          </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-2">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={cart.length === 0 || printBusy}
              onClick={() => void handlePrintDraft()}
              title="Bon-Entwurf drucken."
              className="rounded-lg border border-neutral-600 bg-neutral-900 px-3 py-2 text-xs font-bold uppercase text-neutral-300 hover:border-[#FFD700]/50 disabled:opacity-35"
            >
              Bon Entwurf
            </button>
            <button
              type="button"
              disabled={cart.length === 0}
              onClick={clearWholeCart}
              title="Warenkorb komplett leeren."
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
              title="Artikel und Stammdaten verwalten."
              className="rounded-lg border border-neutral-600 bg-neutral-900 px-3 py-2 text-xs font-bold uppercase text-neutral-300 hover:border-[#FFD700]/50"
            >
              Artikel verwalten
            </button>
            <button
              type="button"
              onClick={() => onOpenZReport()}
              title="Tagesbericht und Abschlüsse anzeigen."
              className="rounded-lg border border-neutral-600 bg-neutral-900 px-3 py-2 text-xs font-bold uppercase text-neutral-300 hover:border-[#FFD700]/50"
            >
              Tagesbericht
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            <div className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-slate-300">
              <button
                type="button"
                className="mb-1 font-black text-slate-300 hover:text-white"
                onClick={() => setDiagPanelOpen((v) => !v)}
                title="API-Diagnose ein-/ausblenden"
              >
                Betriebsmodus:{' '}
                <span className="font-black text-white">{modeLabel}</span>
                {' · '}API-Status:{' '}
                <span className={`font-black ${apiConnected ? 'text-emerald-300' : 'text-rose-300'}`}>
                  {apiConnected ? 'verbunden' : 'nicht verbunden'}
                </span>
                {' · '}Backend-URL:{' '}
                <span className="font-mono normal-case text-slate-200">{apiDiag.baseUrl || '/api'}</span>
                {' '}▾
              </button>
              {diagPanelOpen && (() => {
                const { version, buildFormatted } = buildMetaSummary()
                return (
                  <div className="mt-1 space-y-0.5 normal-case text-[10px] text-slate-400">
                    <div>API_BASE_URL: <span className="font-mono text-slate-200">{apiDiag.baseUrl || '/api'}</span></div>
                    <div>Health-URL: <span className="font-mono text-slate-200">{describeApiReachability('/health')}</span></div>
                    <div>
                      /health:{' '}
                      <span className={apiDiag.healthReachable ? 'text-emerald-300' : 'text-rose-300'}>
                        {apiDiag.healthReachable ? 'ok' : 'fail'}
                      </span>
                      {onlineModeCheckResult && (
                        <span className="ml-1 text-slate-400">
                          (letzter Check: HTTP {onlineModeCheckResult.status ?? 'Netzwerkfehler'}
                          {onlineModeCheckResult.requiresAuth ? ' – Auth erforderlich' : ''})
                        </span>
                      )}
                    </div>
                    <div>/api: <span className={apiDiag.apiReachable ? 'text-emerald-300' : 'text-rose-300'}>{apiDiag.apiReachable ? 'ok' : 'fail'}</span></div>
                    <div>Pfand-Endpunkt: <span className={apiDiag.depositEndpointReachable ? 'text-emerald-300' : 'text-rose-300'}>{apiDiag.depositEndpointReachable ? 'ok' : 'fail'}</span></div>
                    <div>JWT: <span className={apiJwt ? 'text-emerald-300' : 'text-rose-300'}>{apiJwt ? 'vorhanden' : 'nicht gesetzt'}</span></div>
                    <div>Modus (bevorzugt / aktiv): <span className="text-slate-200">{remoteMode ? 'api' : 'offline'} / {dataMode}</span></div>
                    <div>Demo: <span className="text-slate-200">{demoMode ? 'ja' : 'nein'}</span></div>
                    <div>Version: <span className="text-slate-200">{version}</span> · Build: <span className="text-slate-200">{buildFormatted}</span></div>
                  </div>
                )
              })()}
            </div>
            {!demoMode && (
              <>
                {!remoteMode ? (
                  <button
                    type="button"
                    disabled={onlineModeCheckBusy || !apiReachable}
                    onClick={() => void handleActivateOnlineMode()}
                    className="rounded-lg border border-emerald-500/50 bg-emerald-950/30 px-3 py-2 text-xs font-bold uppercase text-emerald-100 hover:bg-emerald-950/45 disabled:cursor-not-allowed disabled:opacity-35"
                    title={
                      !apiReachable
                        ? 'Server nicht erreichbar'
                        : !apiJwt
                          ? 'Server erreichbar – Anmeldung erforderlich'
                          : 'Online-Modus aktivieren'
                    }
                  >
                    {onlineModeCheckBusy
                      ? 'Prüfe Server …'
                      : !apiReachable
                        ? 'Server nicht erreichbar'
                        : !apiJwt
                          ? 'Jetzt anmelden / Online-Modus aktivieren'
                          : 'Jetzt Online-Modus verwenden'}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => onActivateOfflineMode?.()}
                    className="rounded-lg border border-amber-500/45 bg-amber-950/25 px-3 py-2 text-xs font-bold uppercase text-amber-100 hover:bg-amber-950/40"
                    title="Auf Offline-/Lokalmodus wechseln."
                  >
                    Auf Offline-Modus wechseln
                  </button>
                )}
              </>
            )}
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
              disabled={cacheRefreshBusy}
              onClick={() => void handleCacheRefresh()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-sky-500/50 bg-sky-950/20 px-3 py-2 text-xs font-bold uppercase text-sky-200 hover:bg-sky-950/35 disabled:opacity-40"
              title="Service-Worker-Cache leeren und Seite neu laden"
            >
              <RefreshIcon className={cacheRefreshBusy ? 'animate-spin' : ''} />
              {cacheRefreshBusy ? 'Aktualisiere…' : 'Cache aktualisieren'}
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
          totalCents={totalWithDeposit}
          onCancel={closeCashModal}
          onConfirm={async (given) => {
            const skipBon = offlineCashVariant === 'noBon'
            closeCashModal()
            if (given < totalWithDeposit) {
              showToast('Gegeben zu niedrig.')
              return
            }
            if (cart.length === 0) return
            const change = given - totalWithDeposit
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
          totalCents={totalWithDeposit}
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
          totalCents={totalWithDeposit}
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

      {helperModalOpen && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="panel-glass w-full max-w-lg rounded-2xl border border-emerald-500/50 p-5">
            <h3 className="text-lg font-black uppercase text-emerald-100">Helferverpflegung buchen</h3>
            <p className="mt-3 text-sm text-slate-200">
              Dieser Warenkorb wird als kostenlose Helferverpflegung dokumentiert.
              Es entsteht kein Umsatz.
            </p>
            <p className="mt-3 text-sm text-slate-200">
              Warenwert: <span className="font-black text-[#FFD700]">{formatMoney(wareTotal)}</span><br />
              Zu zahlen: <span className="font-black text-emerald-200">0,00 EUR</span>
            </p>
            <label className="mt-4 block text-xs text-slate-400">Notiz (optional)</label>
            <textarea
              className="mt-1 min-h-[80px] w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-white"
              value={helperNote}
              onChange={(e) => setHelperNote(e.target.value)}
            />
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={helperBusy}
                onClick={() => {
                  setHelperModalOpen(false)
                  setHelperNote('')
                }}
                className="rounded-xl border border-white/20 px-4 py-2 text-sm font-semibold text-slate-300"
              >
                Abbrechen
              </button>
              <button
                type="button"
                disabled={helperBusy}
                onClick={() => void submitHelperConsumption()}
                className="rounded-xl border border-emerald-400/60 bg-emerald-700/80 px-4 py-2 text-sm font-black uppercase text-white disabled:opacity-50"
              >
                {helperBusy ? 'Buchen…' : 'Helferverpflegung buchen'}
              </button>
            </div>
          </div>
        </div>
      )}

      {depositModalOpen && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="panel-glass w-full max-w-md rounded-2xl border border-sky-500/50 p-5">
            <h3 className="text-lg font-black uppercase text-sky-100">Pfand auszahlen</h3>
            <p className="mt-3 text-sm text-slate-200">
              Pfandbetrag pro Stück:{' '}
              <span className="font-black text-[#FFD700]">{formatMoney(depositAmountCents)}</span>
            </p>
            <label className="mt-3 block text-xs text-slate-400">Pfandart</label>
            <select
              className="mt-1 w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-white"
              value={`${depositName}|${depositAmountCents}|${depositType ?? ''}`}
              onChange={(e) => {
                const [name, amount, type] = e.target.value.split('|')
                setDepositName(name)
                setDepositAmountCents(Number(amount))
                setDepositType(type || null)
              }}
            >
              {(depositOptions.length > 0 ? depositOptions : [{ name: 'Flasche/Dose', amountCents: depositAmountCents, type: depositType }]).map((opt) => (
                <option
                  key={`${opt.name}|${opt.amountCents}|${opt.type ?? ''}`}
                  value={`${opt.name}|${opt.amountCents}|${opt.type ?? ''}`}
                >
                  {opt.name} - {formatMoney(opt.amountCents)}
                </option>
              ))}
            </select>
            <div className="mt-4 flex items-center gap-2">
              <span className="text-sm text-slate-300">Menge</span>
              <button
                type="button"
                disabled={depositBusy}
                className="h-9 w-9 rounded border border-sky-500/60 text-lg text-sky-100 hover:bg-sky-950/35 disabled:opacity-40"
                onClick={() => setDepositQty((v) => Math.max(1, v - 1))}
              >
                −
              </button>
              <span className="w-10 text-center text-lg font-black text-[#FFD700]">{depositQty}</span>
              <button
                type="button"
                disabled={depositBusy}
                className="h-9 w-9 rounded border border-sky-500/60 text-lg text-sky-100 hover:bg-sky-950/35 disabled:opacity-40"
                onClick={() => setDepositQty((v) => v + 1)}
              >
                +
              </button>
            </div>
            <p className="mt-4 text-sm text-slate-200">
              Auszahlungsbetrag:{' '}
              <span className="font-black text-sky-200">-{formatMoney(depositQty * depositAmountCents)}</span>
            </p>
            <label className="mt-4 block text-xs text-slate-400">Notiz (optional)</label>
            <textarea
              className="mt-1 min-h-[70px] w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-white"
              value={depositNote}
              onChange={(e) => setDepositNote(e.target.value)}
            />
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={depositBusy}
                onClick={() => {
                  setDepositModalOpen(false)
                  setDepositNote('')
                  setDepositQty(1)
                }}
                className="rounded-xl border border-white/20 px-4 py-2 text-sm font-semibold text-slate-300"
              >
                Abbrechen
              </button>
              <button
                type="button"
                disabled={depositBusy}
                onClick={() => void submitManualDepositRedemption()}
                className="rounded-xl border border-sky-400/60 bg-sky-700/80 px-4 py-2 text-sm font-black uppercase text-white disabled:opacity-50"
              >
                {depositBusy ? 'Buchen…' : 'Pfand auszahlen'}
              </button>
            </div>
          </div>
        </div>
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
