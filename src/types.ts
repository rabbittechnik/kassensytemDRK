export type PaymentMethod = 'cash' | 'card' | 'invoice'

/** Zuordnung zu Ausgabestellen für Servier-/Ausgabe-Bons (nicht gleich Produkt-Kategorie). */
export type ProductOutputGroup =
  | 'getraenke'
  | 'kuchen_suess'
  | 'heisses_essen'
  | 'keine_ausgabe'

/** Stations-Bons ohne «keine Ausgabe». */
export type OutputStationKey = 'getraenke' | 'kuchen_suess' | 'heisses_essen'

/** Pro Verkauf persistierte Ausgabe-Bons. */
export interface OutputReceiptStored {
  type: OutputStationKey
  title: string
  text: string
  printed: boolean
  print_count: number
}

/** Nachdruck / Protokoll: Kundenbon, je Station oder alter Servierbon. */
export type ReceiptReprintKind =
  | 'customer'
  | 'serving'
  | OutputStationKey

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
  /** Ausgabegruppe für getrennte Ausgabe-Bons; Standard über Migration/Seed */
  outputGroup?: ProductOutputGroup
  stockTracking?: boolean
  stockQty?: number | null
  stockMin?: number | null
}

export type EventStatus = 'planned' | 'active' | 'completed' | 'archived'

/** Lokale oder API-gespiegelte Veranstaltung (IndexedDB). */
export interface EventRow {
  id: string
  name: string
  startDate: string
  endDate: string
  startTime?: string | null
  endTime?: string | null
  location?: string | null
  description?: string | null
  status: EventStatus
  createdAt: number
  updatedAt: number
  closedAt?: number | null
}

export interface SaleRow {
  id: string
  createdAt: number
  dayKey: string
  totalCents: number
  paymentMethod: PaymentMethod
  receiptNo: number
  /** Verknüpfung mit Veranstaltung (Server oder Offline-Kasse). */
  eventId?: string | null
  /** Kassenbeleg (Kundenbon), ohne Nachdruck-Kopf */
  customerReceiptText?: string
  /** Alter gemeinsamer Servierbon (Migration); bei neuen Verkäufen leer */
  servingReceiptText?: string
  /** Persistierte Stations-Ausgabe-Bons inkl. Druck-Zähler (JSON Array) */
  outputReceiptsJson?: string
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
  eventId?: string | null
  teamName?: string
  /** JSON `ReceiptLineModel[]` für Nachdruck-Layout */
  linesJson: string
  customerReceiptText: string
  servingReceiptText?: string
  outputReceiptsJson?: string
  printedCustomerReceipt: boolean
  printedServingReceipt?: boolean
  customerReceiptPrintCount: number
  servingReceiptPrintCount?: number
}

export interface ReceiptReprintLogRow {
  id?: number
  /** lokale `sale.id` oder `remote:${serverSaleId}` bzw. Archiv-`id` */
  saleRef: string
  kind: ReceiptReprintKind
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
