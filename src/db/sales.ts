import { db } from './database'
import { defaultOutputGroupForProduct } from './productOutputDefaults'
import type { CartLine, CategoryRow, ProductRow } from '../types'
import type {
  DualReceiptArchiveRow,
  OutputReceiptStored,
  OutputStationKey,
  PaymentMethod,
  ProductOutputGroup,
  ReceiptReprintKind,
  ReceiptReprintLogRow,
} from '../types'
import { todayKey } from '../lib/format'
import {
  type FormatReceiptParams,
  OUTPUT_STATION_ORDER,
  formatBonNumber,
  formatOutputStationReceipt,
  formatReceipt,
  type ReceiptLineModel,
  outputStationStoredTitle,
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

function modelProductOutputGroup(p: ProductRow | undefined): ProductOutputGroup {
  if (p?.id) return p.outputGroup ?? defaultOutputGroupForProduct(p.id, p.name)
  return 'keine_ausgabe'
}

export function buildReceiptLineModelsFromCatalog(
  lines: CartLine[],
  products: ProductRow[],
  categories: CategoryRow[],
): ReceiptLineModel[] {
  const out: ReceiptLineModel[] = []
  for (const l of lines) {
    const p = products.find((x) => x.id === l.productId)
    const c = p ? categories.find((x) => x.id === p.categoryId) : undefined
    out.push({
      productId: l.productId,
      outputGroup: modelProductOutputGroup(p),
      name: l.name,
      qty: l.qty,
      unitCents: l.priceCents,
      lineCents: l.priceCents * l.qty,
      categoryId: p?.categoryId ?? 'unknown',
      categoryName: c?.name ?? 'Sonstige',
      categorySort: c?.sortOrder ?? 999,
    })
    const depEnabled = Boolean(p?.depositEnabled) || Number(p?.depositAmount ?? 0) > 0
    const depAmount = depEnabled ? Math.max(0, Number(p?.depositAmount ?? 0)) : 0
    if (depAmount > 0) {
      out.push({
        productId: `deposit:${l.productId}`,
        outputGroup: 'keine_ausgabe',
        name: `Pfand ${p?.depositName?.trim() || 'Pfand'}`,
        qty: l.qty,
        unitCents: depAmount,
        lineCents: depAmount * l.qty,
        categoryId: p?.categoryId ?? 'unknown',
        categoryName: c?.name ?? 'Sonstige',
        categorySort: c?.sortOrder ?? 999,
      })
    }
  }
  return out
}

export async function buildReceiptLineModels(lines: CartLine[]): Promise<ReceiptLineModel[]> {
  const out: ReceiptLineModel[] = []
  for (const l of lines) {
    const p = await db.products.get(l.productId)
    const c = p ? await db.categories.get(p.categoryId) : undefined
    out.push({
      productId: l.productId,
      outputGroup: modelProductOutputGroup(p),
      name: l.name,
      qty: l.qty,
      unitCents: l.priceCents,
      lineCents: l.priceCents * l.qty,
      categoryId: p?.categoryId ?? 'unknown',
      categoryName: c?.name ?? 'Sonstige',
      categorySort: c?.sortOrder ?? 999,
    })
    const depEnabled = Boolean(p?.depositEnabled) || Number(p?.depositAmount ?? 0) > 0
    const depAmount = depEnabled ? Math.max(0, Number(p?.depositAmount ?? 0)) : 0
    if (depAmount > 0) {
      out.push({
        productId: `deposit:${l.productId}`,
        outputGroup: 'keine_ausgabe',
        name: `Pfand ${p?.depositName?.trim() || 'Pfand'}`,
        qty: l.qty,
        unitCents: depAmount,
        lineCents: depAmount * l.qty,
        categoryId: p?.categoryId ?? 'unknown',
        categoryName: c?.name ?? 'Sonstige',
        categorySort: c?.sortOrder ?? 999,
      })
    }
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
      buildFormatParams(
        ctx,
        models,
        paymentMethod,
        receiptNo,
        createdAt,
        isReprint,
        teamName,
        'customer',
      ),
    ),
    serving: formatReceipt(
      buildFormatParams(
        ctx,
        models,
        paymentMethod,
        receiptNo,
        createdAt,
        isReprint,
        teamName,
        'serving',
      ),
    ),
  }
}

/** Zeilen ohne Preise für eine Ausgabestelle, zusammengefasst nach Artikel-ID. */
export function aggregateLinesForOutputStation(
  models: ReceiptLineModel[],
  station: OutputStationKey,
): { name: string; qty: number }[] {
  const acc = new Map<string, { name: string; qty: number }>()
  for (const m of models) {
    const g = m.outputGroup ?? 'keine_ausgabe'
    if (g !== station) continue
    const key = m.productId ?? `${m.name}|${m.unitCents}`
    const cur = acc.get(key)
    if (cur) cur.qty += m.qty
    else acc.set(key, { name: m.name, qty: m.qty })
  }
  return [...acc.values()].sort((a, b) => a.name.localeCompare(b.name, 'de'))
}

export function buildOutputReceiptStoredEntries(
  ctx: Awaited<ReturnType<typeof readReceiptFormattingContext>>,
  models: ReceiptLineModel[],
  paymentMethod: PaymentMethod,
  receiptNo: number,
  createdAt: number,
  isReprint: boolean,
  teamName?: string,
): OutputReceiptStored[] {
  const label = formatBonNumber(createdAt, receiptNo)
  const list: OutputReceiptStored[] = []
  for (const station of OUTPUT_STATION_ORDER) {
    const agg = aggregateLinesForOutputStation(models, station)
    if (agg.length === 0) continue
    const text = formatOutputStationReceipt({
      station,
      widthMm: ctx.widthMm,
      isReprint,
      orgTitle: ctx.orgTitle,
      bonNumberLabel: label,
      createdAt,
      payment: paymentMethod,
      teamName,
      lines: agg,
    })
    list.push({
      type: station,
      title: outputStationStoredTitle(station),
      text,
      printed: false,
      print_count: 0,
    })
  }
  return list
}

/**
 * Lokaler Verkauf (Bar/Karte): Verkauf speichern; Kundenbon + Stations-Ausgabe-Bons.
 */
export async function completeLocalSaleWithDualReceipts(
  lines: CartLine[],
  paymentMethod: 'cash' | 'card',
  opts?: { invoiceTeamName?: string; eventId?: string | null },
): Promise<{
  saleId: string
  receiptNo: number
  createdAt: number
  customerReceiptText: string
  outputReceipts: OutputReceiptStored[]
}> {
  let depositTotalCents = 0
  for (const l of lines) {
    const p = await db.products.get(l.productId)
    const depEnabled = Boolean(p?.depositEnabled) || Number(p?.depositAmount ?? 0) > 0
    const depAmount = depEnabled ? Math.max(0, Number(p?.depositAmount ?? 0)) : 0
    depositTotalCents += depAmount * l.qty
  }
  const totalCents = lines.reduce((s, l) => s + l.priceCents * l.qty, 0) + depositTotalCents
  const createdAt = Date.now()
  const dayKey = todayKey(new Date(createdAt))
  const saleId = uid()
  const ctx = await readReceiptFormattingContext()
  const models = await buildReceiptLineModels(lines)

  await db.transaction('rw', db.sales, db.saleLines, db.settings, async () => {
    const receiptNo = await getNextReceiptNoInTx()
    const customer = formatReceipt(
      buildFormatParams(
        ctx,
        models,
        paymentMethod,
        receiptNo,
        createdAt,
        false,
        opts?.invoiceTeamName,
        'customer',
      ),
    )
    const outputReceipts = buildOutputReceiptStoredEntries(
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
      servingReceiptText: '',
      outputReceiptsJson: JSON.stringify(outputReceipts),
      printedCustomerReceipt: false,
      printedServingReceipt: false,
      customerReceiptPrintCount: 0,
      servingReceiptPrintCount: 0,
      invoiceTeamNameSnapshot: opts?.invoiceTeamName,
      depositTotalCents,
      ...(opts?.eventId ? { eventId: opts.eventId } : {}),
    })
    for (const l of lines) {
      const cat = await db.products.get(l.productId)
      const categoryId = cat?.categoryId ?? 'unknown'
      const depEnabled = Boolean(cat?.depositEnabled) || Number(cat?.depositAmount ?? 0) > 0
      const depAmount = depEnabled ? Math.max(0, Number(cat?.depositAmount ?? 0)) : 0
      await db.saleLines.add({
        id: uid(),
        saleId,
        categoryId,
        productId: l.productId,
        name: l.name,
        qty: l.qty,
        unitPriceCents: l.priceCents,
        lineTotalCents: l.priceCents * l.qty,
        depositAmountCents: depAmount,
        depositNameSnapshot: depAmount > 0 ? (cat?.depositName?.trim() || 'Pfand') : null,
        depositQty: depAmount > 0 ? l.qty : 0,
        depositTotalCents: depAmount * l.qty,
      })
    }
  })

  const row = await db.sales.get(saleId)
  if (!row?.outputReceiptsJson || !row.customerReceiptText)
    throw new Error('SALE_NOT_FOUND')

  let outputReceipts: OutputReceiptStored[] = []
  try {
    outputReceipts = JSON.parse(row.outputReceiptsJson) as OutputReceiptStored[]
    if (!Array.isArray(outputReceipts)) outputReceipts = []
  } catch {
    outputReceipts = []
  }

  return {
    saleId,
    receiptNo: row.receiptNo,
    createdAt,
    customerReceiptText: row.customerReceiptText ?? '',
    outputReceipts,
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

async function hydrateModelsOutputGroup(models: ReceiptLineModel[]): Promise<ReceiptLineModel[]> {
  for (const m of models) {
    if (m.outputGroup != null) continue
    const pid = m.productId
    if (pid) {
      const p = await db.products.get(pid)
      m.outputGroup = p?.outputGroup ?? defaultOutputGroupForProduct(pid, m.name)
    } else {
      m.outputGroup = 'keine_ausgabe'
    }
  }
  return models
}

export async function bumpLocalSalePrintSuccess(
  saleId: string,
  which: ReceiptReprintKind,
): Promise<void> {
  const s = await db.sales.get(saleId)
  if (!s) return
  if (which === 'customer') {
    await db.sales.update(saleId, {
      printedCustomerReceipt: true,
      customerReceiptPrintCount: (s.customerReceiptPrintCount ?? 0) + 1,
    })
    return
  }
  if (which === 'serving') {
    await db.sales.update(saleId, {
      printedServingReceipt: true,
      servingReceiptPrintCount: (s.servingReceiptPrintCount ?? 0) + 1,
    })
    return
  }
  const raw = s.outputReceiptsJson
  if (!raw?.trim()) return
  try {
    const arr = JSON.parse(raw) as OutputReceiptStored[]
    if (!Array.isArray(arr)) return
    const next = arr.map((e) =>
      e.type === which ?
        {
          ...e,
          printed: true,
          print_count: (e.print_count ?? 0) + 1,
        }
      : e,
    )
    await db.sales.update(saleId, { outputReceiptsJson: JSON.stringify(next) })
  } catch {
    /* ignore */
  }
}

export async function bumpRemoteArchivePrintSuccess(
  archiveId: string,
  which: ReceiptReprintKind,
): Promise<void> {
  const row = await db.dualReceiptArchive.get(archiveId)
  if (!row) return
  if (which === 'customer') {
    await db.dualReceiptArchive.update(archiveId, {
      printedCustomerReceipt: true,
      customerReceiptPrintCount: (row.customerReceiptPrintCount ?? 0) + 1,
    })
    return
  }
  if (which === 'serving') {
    await db.dualReceiptArchive.update(archiveId, {
      printedServingReceipt: true,
      servingReceiptPrintCount: (row.servingReceiptPrintCount ?? 0) + 1,
    })
    return
  }
  const raw = row.outputReceiptsJson
  if (!raw?.trim()) return
  try {
    const arr = JSON.parse(raw) as OutputReceiptStored[]
    if (!Array.isArray(arr)) return
    const next = arr.map((e) =>
      e.type === which ?
        {
          ...e,
          printed: true,
          print_count: (e.print_count ?? 0) + 1,
        }
      : e,
    )
    await db.dualReceiptArchive.update(archiveId, {
      outputReceiptsJson: JSON.stringify(next),
    })
  } catch {
    /* ignore */
  }
}

export async function loadSaleLinesForReceipt(saleId: string): Promise<ReceiptLineModel[]> {
  const lines = await db.saleLines.where('saleId').equals(saleId).toArray()
  const out: ReceiptLineModel[] = []
  for (const l of lines) {
    const c = await db.categories.get(l.categoryId)
    const p = await db.products.get(l.productId)
    out.push({
      productId: l.productId,
      outputGroup: modelProductOutputGroup(p),
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
  which: ReceiptReprintKind,
): Promise<string | null> {
  const sale = await db.sales.get(saleId)
  if (!sale) return null

  const models = await loadSaleLinesForReceipt(saleId)
  const ctx = await readReceiptFormattingContext()

  if (which === 'customer') {
    if (!sale.customerReceiptText?.trim()) return null
    return formatReceipt(
      buildFormatParams(
        ctx,
        models,
        sale.paymentMethod,
        sale.receiptNo,
        sale.createdAt,
        true,
        sale.invoiceTeamNameSnapshot,
        'customer',
      ),
    )
  }

  if (which === 'serving') {
    const legacy = sale.servingReceiptText?.trim()
    if (!legacy) return null
    return formatReceipt(
      buildFormatParams(
        ctx,
        models,
        sale.paymentMethod,
        sale.receiptNo,
        sale.createdAt,
        true,
        sale.invoiceTeamNameSnapshot,
        'serving',
      ),
    )
  }

  const station = which as OutputStationKey
  const rebuilt = buildOutputReceiptStoredEntries(
    ctx,
    models,
    sale.paymentMethod,
    sale.receiptNo,
    sale.createdAt,
    true,
    sale.invoiceTeamNameSnapshot,
  )
  return rebuilt.find((e) => e.type === station)?.text ?? null
}

export async function formatReprintTextForRemoteArchive(
  archiveId: string,
  which: ReceiptReprintKind,
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
  await hydrateModelsOutputGroup(models)
  const ctx = await readReceiptFormattingContext()

  if (which === 'customer') {
    if (!row.customerReceiptText?.trim()) return null
    return formatReceipt(
      buildFormatParams(
        ctx,
        models,
        row.paymentMethod,
        row.receiptNo,
        row.createdAt,
        true,
        row.teamName,
        'customer',
      ),
    )
  }

  if (which === 'serving') {
    if (!row.servingReceiptText?.trim()) return null
    return formatReceipt(
      buildFormatParams(
        ctx,
        models,
        row.paymentMethod,
        row.receiptNo,
        row.createdAt,
        true,
        row.teamName,
        'serving',
      ),
    )
  }

  const station = which as OutputStationKey
  const rebuilt = buildOutputReceiptStoredEntries(
    ctx,
    models,
    row.paymentMethod,
    row.receiptNo,
    row.createdAt,
    true,
    row.teamName,
  )
  return rebuilt.find((e) => e.type === station)?.text ?? null
}
