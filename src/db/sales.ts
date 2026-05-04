import { db } from './database'
import type { CartLine, CategoryRow, ProductRow } from '../types'
import type { DualReceiptArchiveRow, PaymentMethod, ReceiptReprintLogRow } from '../types'
import { todayKey } from '../lib/format'
import {
  type FormatReceiptParams,
  formatBonNumber,
  formatReceipt,
  type ReceiptLineModel,
} from '../receipt/receiptFormat'

function uid(): string {
  return crypto.randomUUID()
}

async function getNextReceiptNoInTx(): Promise<number> {
  const row = await db.settings.get('nextReceiptNo')
  const n = row ? parseInt(row.value, 10) || 1 : 1
  await db.settings.put({ key: 'nextReceiptNo', value: String(n + 1) })
  return n
}

export async function getSetting(key: string): Promise<string | undefined> {
  const r = await db.settings.get(key)
  return r?.value
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db.settings.put({ key, value })
}

export function buildReceiptLineModelsFromCatalog(
  lines: CartLine[],
  products: ProductRow[],
  categories: CategoryRow[],
): ReceiptLineModel[] {
  return lines.map((l) => {
    const p = products.find((x) => x.id === l.productId)
    const c = p ? categories.find((x) => x.id === p.categoryId) : undefined
    return {
      name: l.name,
      qty: l.qty,
      unitCents: l.priceCents,
      lineCents: l.priceCents * l.qty,
      categoryId: p?.categoryId ?? 'unknown',
      categoryName: c?.name ?? 'Sonstige',
      categorySort: c?.sortOrder ?? 999,
    }
  })
}

export async function buildReceiptLineModels(lines: CartLine[]): Promise<ReceiptLineModel[]> {
  const out: ReceiptLineModel[] = []
  for (const l of lines) {
    const p = await db.products.get(l.productId)
    const c = p ? await db.categories.get(p.categoryId) : undefined
    out.push({
      name: l.name,
      qty: l.qty,
      unitCents: l.priceCents,
      lineCents: l.priceCents * l.qty,
      categoryId: p?.categoryId ?? 'unknown',
      categoryName: c?.name ?? 'Sonstige',
      categorySort: c?.sortOrder ?? 999,
    })
  }
  return out
}

export async function readReceiptFormattingContext(): Promise<{
  widthMm: 58 | 80
  orgTitle: string
  tagline: string
  footerThanks: string
  registerLabel: string
  cashierLabel: string
}> {
  const w = (await getSetting('receiptWidthMm')) === '80' ? 80 : 58
  const orgTitle = (await getSetting('orgName'))?.trim() || 'DLRG Kasse'
  const tagline =
    (await getSetting('receiptTagline'))?.trim() ||
    'Fuer ECHT. Wenn keiner damit rechnet, sind WIR da.'
  const footerThanks = (await getSetting('receiptFooter'))?.trim() || 'Vielen Dank!'
  const registerLabel = (await getSetting('registerName'))?.trim() || 'Hauptkasse'
  const cashierLabel = (await getSetting('cashierName'))?.trim() || 'Admin'
  return { widthMm: w, orgTitle, tagline, footerThanks, registerLabel, cashierLabel }
}

function buildFormatParams(
  ctx: Awaited<ReturnType<typeof readReceiptFormattingContext>>,
  models: ReceiptLineModel[],
  paymentMethod: PaymentMethod,
  receiptNo: number,
  createdAt: number,
  isReprint: boolean,
  teamName: string | undefined,
  type: 'customer' | 'serving',
): FormatReceiptParams {
  const totalCents = models.reduce((s, l) => s + l.lineCents, 0)
  return {
    type,
    widthMm: ctx.widthMm,
    isReprint,
    orgTitle: ctx.orgTitle,
    tagline: ctx.tagline,
    bonNumberLabel: formatBonNumber(createdAt, receiptNo),
    createdAt,
    registerLabel: ctx.registerLabel,
    cashierLabel: ctx.cashierLabel,
    lines: models,
    totalCents,
    payment: paymentMethod,
    teamName,
    footerThanks: ctx.footerThanks,
    tseSummary: 'TSE: (nicht aktiv / Testsystem)',
  }
}

export function renderDualReceiptTexts(
  ctx: Awaited<ReturnType<typeof readReceiptFormattingContext>>,
  models: ReceiptLineModel[],
  paymentMethod: PaymentMethod,
  receiptNo: number,
  createdAt: number,
  isReprint: boolean,
  teamName?: string,
): { customer: string; serving: string } {
  return {
    customer: formatReceipt(
      buildFormatParams(ctx, models, paymentMethod, receiptNo, createdAt, isReprint, teamName, 'customer'),
    ),
    serving: formatReceipt(
      buildFormatParams(ctx, models, paymentMethod, receiptNo, createdAt, isReprint, teamName, 'serving'),
    ),
  }
}

/**
 * Lokaler Verkauf (Bar/Karte): Verkauf speichern, Kunden- und Servierbon erzeugen und am Verkauf ablegen.
 */
export async function completeLocalSaleWithDualReceipts(
  lines: CartLine[],
  paymentMethod: 'cash' | 'card',
  opts?: { invoiceTeamName?: string },
): Promise<{
  saleId: string
  receiptNo: number
  createdAt: number
  customerReceiptText: string
  servingReceiptText: string
}> {
  const totalCents = lines.reduce((s, l) => s + l.priceCents * l.qty, 0)
  const createdAt = Date.now()
  const dayKey = todayKey(new Date(createdAt))
  const saleId = uid()
  const ctx = await readReceiptFormattingContext()
  const models = await buildReceiptLineModels(lines)

  await db.transaction('rw', db.sales, db.saleLines, db.settings, async () => {
    const receiptNo = await getNextReceiptNoInTx()
    const { customer, serving } = renderDualReceiptTexts(
      ctx,
      models,
      paymentMethod,
      receiptNo,
      createdAt,
      false,
      opts?.invoiceTeamName,
    )
    await db.sales.add({
      id: saleId,
      createdAt,
      dayKey,
      totalCents,
      paymentMethod,
      receiptNo,
      customerReceiptText: customer,
      servingReceiptText: serving,
      printedCustomerReceipt: false,
      printedServingReceipt: false,
      customerReceiptPrintCount: 0,
      servingReceiptPrintCount: 0,
      invoiceTeamNameSnapshot: opts?.invoiceTeamName,
    })
    for (const l of lines) {
      const cat = await db.products.get(l.productId)
      const categoryId = cat?.categoryId ?? 'unknown'
      await db.saleLines.add({
        id: uid(),
        saleId,
        categoryId,
        productId: l.productId,
        name: l.name,
        qty: l.qty,
        unitPriceCents: l.priceCents,
        lineTotalCents: l.priceCents * l.qty,
      })
    }
  })

  const row = await db.sales.get(saleId)
  if (!row) throw new Error('SALE_NOT_FOUND')
  return {
    saleId,
    receiptNo: row.receiptNo,
    createdAt,
    customerReceiptText: row.customerReceiptText ?? '',
    servingReceiptText: row.servingReceiptText ?? '',
  }
}

/** @deprecated — nutzt `completeLocalSaleWithDualReceipts` */
export async function saveSale(
  lines: CartLine[],
  paymentMethod: PaymentMethod,
): Promise<{ saleId: string; receiptNo: number; createdAt: number }> {
  if (paymentMethod === 'invoice') {
    throw new Error(
      'Rechnungsverkäufe erfordern die Server-API und eine gültige API-Anmeldung.',
    )
  }
  const r = await completeLocalSaleWithDualReceipts(lines, paymentMethod)
  return { saleId: r.saleId, receiptNo: r.receiptNo, createdAt: r.createdAt }
}

export async function persistRemoteDualReceiptArchive(
  row: Omit<DualReceiptArchiveRow, 'id'>,
): Promise<string> {
  const id = uid()
  await db.dualReceiptArchive.add({ ...row, id })
  return id
}

export async function appendReceiptReprintLog(
  entry: Omit<ReceiptReprintLogRow, 'id'>,
): Promise<void> {
  await db.receiptReprintLogs.add(entry)
}

export async function bumpLocalSalePrintSuccess(
  saleId: string,
  which: 'customer' | 'serving',
): Promise<void> {
  const s = await db.sales.get(saleId)
  if (!s) return
  if (which === 'customer') {
    await db.sales.update(saleId, {
      printedCustomerReceipt: true,
      customerReceiptPrintCount: (s.customerReceiptPrintCount ?? 0) + 1,
    })
  } else {
    await db.sales.update(saleId, {
      printedServingReceipt: true,
      servingReceiptPrintCount: (s.servingReceiptPrintCount ?? 0) + 1,
    })
  }
}

export async function bumpRemoteArchivePrintSuccess(
  archiveId: string,
  which: 'customer' | 'serving',
): Promise<void> {
  const s = await db.dualReceiptArchive.get(archiveId)
  if (!s) return
  if (which === 'customer') {
    await db.dualReceiptArchive.update(archiveId, {
      printedCustomerReceipt: true,
      customerReceiptPrintCount: (s.customerReceiptPrintCount ?? 0) + 1,
    })
  } else {
    await db.dualReceiptArchive.update(archiveId, {
      printedServingReceipt: true,
      servingReceiptPrintCount: (s.servingReceiptPrintCount ?? 0) + 1,
    })
  }
}

export async function loadSaleLinesForReceipt(saleId: string): Promise<ReceiptLineModel[]> {
  const lines = await db.saleLines.where('saleId').equals(saleId).toArray()
  const out: ReceiptLineModel[] = []
  for (const l of lines) {
    const c = await db.categories.get(l.categoryId)
    out.push({
      name: l.name,
      qty: l.qty,
      unitCents: l.unitPriceCents,
      lineCents: l.lineTotalCents,
      categoryId: l.categoryId,
      categoryName: c?.name ?? 'Sonstige',
      categorySort: c?.sortOrder ?? 999,
    })
  }
  return out
}

export async function formatReprintTextForLocalSale(
  saleId: string,
  which: 'customer' | 'serving',
): Promise<string | null> {
  const sale = await db.sales.get(saleId)
  if (!sale?.customerReceiptText || !sale.servingReceiptText) return null
  const models = await loadSaleLinesForReceipt(saleId)
  const ctx = await readReceiptFormattingContext()
  const { customer, serving } = renderDualReceiptTexts(
    ctx,
    models,
    sale.paymentMethod,
    sale.receiptNo,
    sale.createdAt,
    true,
    sale.invoiceTeamNameSnapshot,
  )
  return which === 'customer' ? customer : serving
}

export async function formatReprintTextForRemoteArchive(
  archiveId: string,
  which: 'customer' | 'serving',
): Promise<string | null> {
  const row = await db.dualReceiptArchive.get(archiveId)
  if (!row?.linesJson) return null
  let models: ReceiptLineModel[]
  try {
    models = JSON.parse(row.linesJson) as ReceiptLineModel[]
    if (!Array.isArray(models)) return null
  } catch {
    return null
  }
  const ctx = await readReceiptFormattingContext()
  const { customer, serving } = renderDualReceiptTexts(
    ctx,
    models,
    row.paymentMethod,
    row.receiptNo,
    row.createdAt,
    true,
    row.teamName,
  )
  return which === 'customer' ? customer : serving
}
