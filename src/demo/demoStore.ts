import { useSyncExternalStore } from 'react'
import type { CartLine, PaymentMethod } from '../types'
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
  servingReceiptText: string
  teamName?: string
}

interface DemoState {
  demoMode: boolean
  enteredAt: number | null
  demoTeams: DemoTeam[]
  demoSales: DemoSale[]
  nextNo: number
}

const initialState: DemoState = {
  demoMode: false,
  enteredAt: null,
  demoTeams: [],
  demoSales: [],
  nextNo: 1,
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
    nextNo: 1,
  })
  return true
}

export function exitDemoMode(): void {
  setState({
    demoMode: false,
    enteredAt: null,
    demoTeams: [],
    demoSales: [],
    nextNo: 1,
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

/** Convenience-Snapshot fuer non-React Aufrufer. */
export function snapshotDemoSales(): DemoSale[] {
  return state.demoSales
}

/** Hilfs-Konvertierung Cart -> demo-Lines mit Kategorien. */
export function buildDemoLines(
  cart: CartLine[],
  productLookup: (id: string) => { categoryId: string; categoryName: string; categorySort: number } | null,
): DemoSaleLine[] {
  return cart.map((l) => {
    const meta = productLookup(l.productId) ?? {
      categoryId: 'unknown',
      categoryName: 'Sonstige',
      categorySort: 999,
    }
    return {
      productId: l.productId,
      name: l.name,
      qty: l.qty,
      unitPriceCents: l.priceCents,
      lineTotalCents: l.priceCents * l.qty,
      categoryId: meta.categoryId,
      categoryName: meta.categoryName,
      categorySort: meta.categorySort,
    }
  })
}
