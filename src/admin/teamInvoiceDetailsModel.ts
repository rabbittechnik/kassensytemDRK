import type { DemoSale } from '../demo/demoStore'

export interface TeamInvoiceDetailLine {
  dateMs: number
  bonLabel: string
  articleName: string
  qty: number
  unitPriceCents: number
  lineTotalCents: number
  paymentLabel: string
  note?: string
}

export interface TeamInvoiceSummaryRow {
  articleName: string
  totalQty: number
  totalCents: number
}

export interface TeamInvoiceDetailsModel {
  teamName: string
  eventName: string
  statusLabel: string
  isDemo: boolean
  firstPurchaseMs: number
  lastPurchaseMs: number
  totalOpenCents: number
  detailLines: TeamInvoiceDetailLine[]
  summaryRows: TeamInvoiceSummaryRow[]
  /** Demo: zusammengeführter Text für Vorschau */
  demoCustomerReceiptText?: string
  /** Demo: alle Stations-Ausgabe-Bons nacheinander */
  demoOutputReceiptTexts?: string
}

export function formatBonLabel(createdAtMs: number, receiptNo: number): string {
  const y = new Date(createdAtMs).getFullYear()
  return `${y}-${String(receiptNo).padStart(6, '0')}`
}

function paymentLabelDe(method: string | undefined): string {
  const m = String(method ?? '').toLowerCase()
  if (m === 'invoice') return 'Rechnung'
  if (m === 'cash') return 'Bar'
  if (m === 'card') return 'Karte'
  return method ? method : '—'
}

function aggregateSummary(lines: TeamInvoiceDetailLine[]): TeamInvoiceSummaryRow[] {
  const map = new Map<string, { articleName: string; totalQty: number; totalCents: number }>()
  for (const ln of lines) {
    const key = `${ln.articleName}|${ln.unitPriceCents}`
    const g = map.get(key) ?? {
      articleName: ln.articleName,
      totalQty: 0,
      totalCents: 0,
    }
    g.totalQty += ln.qty
    g.totalCents += ln.lineTotalCents
    map.set(key, g)
  }
  return [...map.values()].sort((a, b) =>
    a.articleName.localeCompare(b.articleName, 'de'),
  )
}

/** Aus Demo-Verkäufen (offene Rechnungsverkäufe eines Team/Event). */
export function buildTeamInvoiceDetailsFromDemo(
  sales: DemoSale[],
  teamName: string,
  eventName: string,
): TeamInvoiceDetailsModel {
  const sorted = [...sales].sort((a, b) => a.createdAt - b.createdAt)
  const detailLines: TeamInvoiceDetailLine[] = []

  for (const s of sorted) {
    const noteParts = [s.note, s.contactName].filter((x) => String(x ?? '').trim())
    const noteStr = noteParts.length ? noteParts.join(' · ') : undefined
    let firstLn = true
    for (const ln of s.lines) {
      detailLines.push({
        dateMs: s.createdAt,
        bonLabel: s.bonNumberLabel,
        articleName: ln.name,
        qty: ln.qty,
        unitPriceCents: ln.unitPriceCents,
        lineTotalCents: ln.lineTotalCents,
        paymentLabel: 'Rechnung',
        note: firstLn ? noteStr : undefined,
      })
      firstLn = false
    }
  }

  const times = sorted.map((s) => s.createdAt)
  const totalOpenCents = sorted.reduce((acc, s) => acc + s.totalCents, 0)

  const demoCustomerReceiptText = sorted
    .map((s) => s.customerReceiptText?.trim())
    .filter(Boolean)
    .join('\n\n──────────\n\n')

  const demoOutputReceiptTexts = sorted
    .flatMap((s) => s.outputReceipts ?? [])
    .map((r) => r.text?.trim())
    .filter(Boolean)
    .join('\n\n──────────\n\n')

  return {
    teamName,
    eventName,
    statusLabel: 'Demo (simuliert)',
    isDemo: true,
    firstPurchaseMs: times.length ? Math.min(...times) : Date.now(),
    lastPurchaseMs: times.length ? Math.max(...times) : Date.now(),
    totalOpenCents,
    detailLines,
    summaryRows: aggregateSummary(detailLines),
    demoCustomerReceiptText: demoCustomerReceiptText || undefined,
    demoOutputReceiptTexts: demoOutputReceiptTexts || undefined,
  }
}

type ApiSaleGroup = {
  createdAt?: number
  receiptNo?: number
  cashierNote?: string | null
  paymentMethod?: string
  lines?: Array<{
    articleName?: string
    qty?: number
    unitPriceCents?: number
    lineTotalCents?: number
  }>
}

/** Aus API GET /teams/:id/open-sales (gruppierte Verkäufe). */
export function buildTeamInvoiceDetailsFromApi(
  rows: unknown[],
  teamName: string,
  eventName: string,
): TeamInvoiceDetailsModel {
  const groups = (Array.isArray(rows) ? rows : []) as ApiSaleGroup[]
  const detailLines: TeamInvoiceDetailLine[] = []

  for (const g of groups) {
    const createdAt = Number(g.createdAt ?? 0)
    const receiptNo = Number(g.receiptNo ?? 0)
    const bonLabel =
      createdAt && receiptNo
        ? formatBonLabel(createdAt, receiptNo)
        : receiptNo
          ? String(receiptNo)
          : '—'
    const pay = paymentLabelDe(g.paymentMethod)
    const noteRaw = g.cashierNote != null ? String(g.cashierNote).trim() : ''
    const note = noteRaw || undefined

    const lines = Array.isArray(g.lines) ? g.lines : []
    let firstLine = true
    for (const ln of lines) {
      detailLines.push({
        dateMs: createdAt,
        bonLabel,
        articleName: String(ln.articleName ?? '—'),
        qty: Number(ln.qty ?? 0),
        unitPriceCents: Number(ln.unitPriceCents ?? 0),
        lineTotalCents: Number(ln.lineTotalCents ?? 0),
        paymentLabel: pay,
        note: firstLine ? note : undefined,
      })
      firstLine = false
    }
  }

  detailLines.sort((a, b) => a.dateMs - b.dateMs)

  const times = detailLines.map((l) => l.dateMs).filter((t) => t > 0)
  const totalOpenCents = detailLines.reduce((acc, l) => acc + l.lineTotalCents, 0)

  return {
    teamName,
    eventName,
    statusLabel: 'Offen',
    isDemo: false,
    firstPurchaseMs: times.length ? Math.min(...times) : Date.now(),
    lastPurchaseMs: times.length ? Math.max(...times) : Date.now(),
    totalOpenCents,
    detailLines,
    summaryRows: aggregateSummary(detailLines),
  }
}
