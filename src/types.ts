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
  /** z.B. `/assets/products/wasser.png`; leer: Emoji oder Dateiname aus Artikel-ID */
  imageUrl?: string | null
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
  /** Kassenbeleg (Kundenbon), ohne Nachdruck-Kopf */
  customerReceiptText?: string
  /** Servierbon / Ausgabe, ohne Nachdruck-Kopf */
  servingReceiptText?: string
  customerReceiptPdfPath?: string
  servingReceiptPdfPath?: string
  printedCustomerReceipt?: boolean
  printedServingReceipt?: boolean
  customerReceiptPrintCount?: number
  servingReceiptPrintCount?: number
  /** z. B. Teamname bei Rechnung (lokal derzeit nur Bar/Karte) */
  invoiceTeamNameSnapshot?: string
}

/** Server-Verkäufe: Bons clientseitig für Nachdruck (IndexedDB) */
export interface DualReceiptArchiveRow {
  id: string
  serverSaleId: string
  receiptNo: number
  createdAt: number
  paymentMethod: PaymentMethod
  totalCents: number
  teamName?: string
  /** JSON `ReceiptLineModel[]` für Nachdruck-Layout */
  linesJson: string
  customerReceiptText: string
  servingReceiptText: string
  printedCustomerReceipt: boolean
  printedServingReceipt: boolean
  customerReceiptPrintCount: number
  servingReceiptPrintCount: number
}

export interface ReceiptReprintLogRow {
  id?: number
  /** lokale `sale.id` oder `remote:${serverSaleId}` bzw. Archiv-`id` */
  saleRef: string
  kind: 'customer' | 'serving'
  at: number
  userLabel: string
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
