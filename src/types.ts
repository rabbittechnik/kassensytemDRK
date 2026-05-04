export type PaymentMethod = 'cash' | 'card' | 'invoice'

export interface CartLine {
  key: string
  productId: string
  name: string
  priceCents: number
  qty: number
}

export interface CategoryRow {
  id: string
  name: string
  sortOrder: number
}

export interface ProductRow {
  id: string
  categoryId: string
  name: string
  priceCents: number
  active: boolean
  sortOrder: number
  stockTracking?: boolean
  stockQty?: number | null
  stockMin?: number | null
}

export interface SaleRow {
  id: string
  createdAt: number
  dayKey: string
  totalCents: number
  paymentMethod: PaymentMethod
  receiptNo: number
}

export interface SaleLineRow {
  id: string
  saleId: string
  categoryId: string
  productId: string
  name: string
  qty: number
  unitPriceCents: number
  lineTotalCents: number
}

/** Architektur-Hooks für spätere Erweiterungen (Mehrere Stände, Nutzer, …) */
export interface OrgContextExtensions {
  standId?: string
  cashierId?: string
  orgId?: string
}
