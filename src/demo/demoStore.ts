import { useSyncExternalStore } from 'react'
import type { CartLine, OutputReceiptStored, PaymentMethod, ProductOutputGroup } from '../types'
import { defaultOutputGroupForProduct } from '../db/productOutputDefaults'
import { DEMO_TEAM_TEMPLATES, type DemoTeamTemplate } from './demoTeams'

/**
 * Geschuetzter Demo-Modus.
 * Aktivierung nur ueber DEMO_CODE = '2005'.
 * Speichert AUSSCHLIESSLICH in-memory und beruehrt KEINE echte Tabelle
 * (sales, receipts, invoices, teams, payments, daily_closings,
 *  stock_movements, tse_transactions).
 */
export const DEMO_CODE = '2005'

export interface DemoTeam {
  id: string
  name: string
  shortName?: string
  contactName?: string
  invoiceEmail?: string
  phone?: string
  billingAddress?: string
  paymentTermsDays: number
  active: boolean
  isDemo: true
}

export interface DemoSaleLine {
  productId: string
  name: string
  qty: number
  unitPriceCents: number
  lineTotalCents: number
  categoryId: string
  categoryName: string
  categorySort: number
  outputGroup: ProductOutputGroup
}

export interface DemoSale {
  id: string
  demoNo: number
  /** "DEMO-000001" */
  bonNumberLabel: string
  createdAt: number
  dayKey: string
  totalCents: number
  paymentMethod: PaymentMethod
  lines: DemoSaleLine[]
  customerReceiptText: string
  outputReceipts: OutputReceiptStored[]
  teamName?: string
  /** Rechnungsverkauf: Team-/Event-Zuordnung fuer Demo-Open-Posts */
  teamId?: string
  eventId?: string
  eventName?: string
  contactName?: string
  note?: string
  /** Nach Demo-Sammelrechnung: Verkauf gilt als abgerechnet */
  demoInvoiceAllocationId?: string
}

/** Simulierte Sammelrechnung (nur Demo, in-memory). */
export interface DemoInvoice {
  id: string
  invoice_no: string
  total_cents: number
  created_at: number
  teamId: string
  eventId: string
  teamName: string
  eventName: string
  derivedStatus: string
}

interface DemoState {
  demoMode: boolean
  enteredAt: number | null
  demoTeams: DemoTeam[]
  demoSales: DemoSale[]
  demoInvoices: DemoInvoice[]
  nextNo: number
  nextInvoiceSeq: number
}

const initialState: DemoState = {
  demoMode: false,
  enteredAt: null,
  demoTeams: [],
  demoSales: [],
  demoInvoices: [],
  nextNo: 1,
  nextInvoiceSeq: 1,
}

let state: DemoState = initialState
const listeners = new Set<() => void>()

function emit() {
  for (const fn of listeners) fn()
}

function setState(patch: Partial<DemoState>) {
  state = { ...state, ...patch }
  emit()
}

function freshDemoTeams(): DemoTeam[] {
  return DEMO_TEAM_TEMPLATES.map((t: DemoTeamTemplate) => ({
    id: `demo-team-${crypto.randomUUID()}`,
    name: t.name,
    shortName: t.short_name,
    contactName: t.contact_person,
    invoiceEmail: t.email,
    phone: t.phone,
    billingAddress: t.billing_address,
    paymentTermsDays: t.payment_terms_days,
    active: t.active,
    isDemo: true,
  }))
}

export function getDemoState(): DemoState {
  return state
}

export function isDemoMode(): boolean {
  return state.demoMode
}

export function subscribeDemo(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function enterDemoMode(code: string): boolean {
  if (code.trim() !== DEMO_CODE) return false
  setState({
    demoMode: true,
    enteredAt: Date.now(),
    demoTeams: freshDemoTeams(),
    demoSales: [],
    demoInvoices: [],
    nextNo: 1,
    nextInvoiceSeq: 1,
  })
  return true
}

export function exitDemoMode(): void {
  setState({
    demoMode: false,
    enteredAt: null,
    demoTeams: [],
    demoSales: [],
    demoInvoices: [],
    nextNo: 1,
    nextInvoiceSeq: 1,
  })
}

export function nextDemoReceiptNo(): { n: number; label: string } {
  const n = state.nextNo
  setState({ nextNo: n + 1 })
  return { n, label: `DEMO-${String(n).padStart(6, '0')}` }
}

export function addDemoSale(sale: DemoSale): void {
  setState({ demoSales: [...state.demoSales, sale] })
}

/** Offene Posten-Zeilen fuer TeamsBilling (API-Form). */
export function buildDemoOpenPostRows(
  sales: DemoSale[],
  teams: DemoTeam[],
): Record<string, unknown>[] {
  const pending = sales.filter(
    (s) =>
      s.paymentMethod === 'invoice' &&
      s.teamId &&
      s.eventId &&
      !s.demoInvoiceAllocationId,
  )
  const byKey = new Map<
    string,
    { teamId: string; eventId: string; sales: DemoSale[] }
  >()
  for (const s of pending) {
    const teamId = s.teamId!
    const eventId = s.eventId!
    const key = `${teamId}|${eventId}`
    let g = byKey.get(key)
    if (!g) {
      g = { teamId, eventId, sales: [] }
      byKey.set(key, g)
    }
    g.sales.push(s)
  }
  const teamLabel = (id: string) => teams.find((t) => t.id === id)?.name ?? 'Team'
  const rows: Record<string, unknown>[] = []
  for (const { teamId, eventId, sales: grp } of byKey.values()) {
    const cents = grp.reduce((a, s) => a + s.totalCents, 0)
    const times = grp.map((s) => s.createdAt)
    const eventName = grp[0]?.eventName ?? '—'
    rows.push({
      teamId,
      eventId,
      team_name: teamLabel(teamId),
      event_name: eventName,
      open_count: grp.length,
      total_open_cents: cents,
      firstPurchaseAt: Math.min(...times),
      lastPurchaseAt: Math.max(...times),
    })
  }
  rows.sort((a, b) =>
    String(a.team_name).localeCompare(String(b.team_name), 'de'),
  )
  return rows
}

/**
 * Demo-Sammelrechnung: bucht offene Demo-Rechnungsverkaeufe auf eine
 * simulierte Rechnung (in-memory).
 */
export function createDemoCollectiveInvoice(teamId: string, eventId: string): DemoInvoice | null {
  const pending = state.demoSales.filter(
    (s) =>
      s.paymentMethod === 'invoice' &&
      s.teamId === teamId &&
      s.eventId === eventId &&
      !s.demoInvoiceAllocationId,
  )
  if (pending.length === 0) return null
  const invId = `demo-inv-${crypto.randomUUID()}`
  const seq = state.nextInvoiceSeq
  const invoiceNo = `DEMO-RE-${String(seq).padStart(4, '0')}`
  const total = pending.reduce((a, s) => a + s.totalCents, 0)
  const teamName =
    state.demoTeams.find((t) => t.id === teamId)?.name ?? pending[0]?.teamName ?? 'Team'
  const eventName = pending[0]?.eventName ?? '—'
  const inv: DemoInvoice = {
    id: invId,
    invoice_no: invoiceNo,
    total_cents: total,
    created_at: Date.now(),
    teamId,
    eventId,
    teamName,
    eventName,
    derivedStatus: 'OPEN',
  }
  setState({
    demoInvoices: [...state.demoInvoices, inv],
    nextInvoiceSeq: seq + 1,
    demoSales: state.demoSales.map((s) =>
      pending.some((p) => p.id === s.id)
        ? { ...s, demoInvoiceAllocationId: invId }
        : s,
    ),
  })
  return inv
}

export function updateDemoInvoice(
  id: string,
  patch: Partial<Pick<DemoInvoice, 'derivedStatus'>>,
): void {
  setState({
    demoInvoices: state.demoInvoices.map((i) =>
      i.id === id ? { ...i, ...patch } : i,
    ),
  })
}

export function addDemoTeam(input: Omit<DemoTeam, 'id' | 'isDemo'>): DemoTeam {
  const t: DemoTeam = {
    ...input,
    id: `demo-team-${crypto.randomUUID()}`,
    isDemo: true,
  }
  setState({ demoTeams: [...state.demoTeams, t] })
  return t
}

export function updateDemoTeam(id: string, patch: Partial<Omit<DemoTeam, 'id' | 'isDemo'>>): void {
  setState({
    demoTeams: state.demoTeams.map((t) => (t.id === id ? { ...t, ...patch } : t)),
  })
}

export function archiveDemoTeam(id: string): void {
  updateDemoTeam(id, { active: false })
}

export function toggleDemoTeamActive(id: string, active: boolean): void {
  updateDemoTeam(id, { active })
}

/* React hooks ----------------------------------------------------------- */

export function useDemoMode(): boolean {
  return useSyncExternalStore(
    subscribeDemo,
    () => state.demoMode,
    () => false,
  )
}

export function useDemoTeams(): DemoTeam[] {
  return useSyncExternalStore(
    subscribeDemo,
    () => state.demoTeams,
    () => initialState.demoTeams,
  )
}

export function useDemoSales(): DemoSale[] {
  return useSyncExternalStore(
    subscribeDemo,
    () => state.demoSales,
    () => initialState.demoSales,
  )
}

export function useDemoInvoices(): DemoInvoice[] {
  return useSyncExternalStore(
    subscribeDemo,
    () => state.demoInvoices,
    () => initialState.demoInvoices,
  )
}

/** Convenience-Snapshot fuer non-React Aufrufer. */
export function snapshotDemoSales(): DemoSale[] {
  return state.demoSales
}

/** Hilfs-Konvertierung Cart -> demo-Lines mit Kategorien. */
export function buildDemoLines(
  cart: CartLine[],
  productLookup: (
    id: string,
  ) => {
    categoryId: string
    categoryName: string
    categorySort: number
    outputGroup: ProductOutputGroup
    depositEnabled?: boolean
    depositAmount?: number
    depositName?: string | null
  } | null,
): DemoSaleLine[] {
  const out: DemoSaleLine[] = []
  for (const l of cart) {
    const meta = productLookup(l.productId) ?? {
      categoryId: 'unknown',
      categoryName: 'Sonstige',
      categorySort: 999,
      outputGroup: defaultOutputGroupForProduct(l.productId, l.name),
      depositEnabled: false,
      depositAmount: 0,
      depositName: null,
    }
    out.push({
      productId: l.productId,
      name: l.name,
      qty: l.qty,
      unitPriceCents: l.priceCents,
      lineTotalCents: l.priceCents * l.qty,
      categoryId: meta.categoryId,
      categoryName: meta.categoryName,
      categorySort: meta.categorySort,
      outputGroup: meta.outputGroup,
    })
    const depEnabled = Boolean(meta.depositEnabled) || Number(meta.depositAmount ?? 0) > 0
    const depAmount = depEnabled ? Math.max(0, Number(meta.depositAmount ?? 0)) : 0
    if (depAmount > 0) {
      out.push({
        productId: `deposit:${l.productId}`,
        name: `Pfand ${meta.depositName?.trim() || 'Pfand'}`,
        qty: l.qty,
        unitPriceCents: depAmount,
        lineTotalCents: depAmount * l.qty,
        categoryId: meta.categoryId,
        categoryName: meta.categoryName,
        categorySort: meta.categorySort,
        outputGroup: 'keine_ausgabe',
      })
    }
  }
  return out
}
