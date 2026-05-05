import crypto from 'node:crypto'
import type BetterSqlite3 from 'better-sqlite3'
import type { JwtUser } from '../types.js'
import { appendAudit } from '../audit.js'
import {
  nextDepositVoucherNo,
  nextHelperConsumptionNo,
  nextReceiptNo,
} from './numbers.js'
import { writeReceiptPdfPromise } from './pdfReceipt.js'
import {
  getIssuer,
  getOrgName,
  getReceiptFooter,
  getTaxSettings,
} from './issuer.js'
import {
  evaluateEventWindow,
  getEventById,
  getSaleAvailability,
} from './saleAvailability.js'

export type PaymentBody =
  | { method: 'cash'; amountTenderedCents: number }
  | { method: 'card' }
  | {
      method: 'invoice'
      teamId: string
      eventId: string
      contactName?: string
      note?: string
    }

export interface CartLineBody {
  productId: string
  name?: string
  qty: number
  unitPriceCents: number
}

export interface HelperConsumptionLineBody {
  productId: string
  qty: number
  unitPriceCents?: number
  name?: string
}

function dayKey(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export async function createSale(params: {
  db: BetterSqlite3.Database
  dataRoot: string
  user: JwtUser
  lines: CartLineBody[]
  payment: PaymentBody
  clientUuid?: string
  /** Bar/Karte: aus Client oder Fallback aktiv_event_id; bei Rechnung ignoriert (payment.eventId). */
  saleEventId?: string | null
}): Promise<{
  id: string
  receiptNo: number
  createdAt: number
  receiptPdfRelPath: string
  duplicate?: boolean
  depositVoucherNumber?: string
  depositTotalCents?: number
}> {
  const { db, lines, payment, user, clientUuid } = params
  const startedAt = Date.now()

  const availability = getSaleAvailability({ db, nowMs: startedAt })
  if (!availability.canSell) {
    if (availability.reason === 'event_not_started') throw new Error('EVENT_NOT_STARTED')
    if (availability.reason === 'event_ended') throw new Error('EVENT_ENDED')
    throw new Error('NO_SALE_PERMISSION')
  }

  let eventId: string | null = null
  if (payment.method === 'invoice') {
    const invoiceEvent = getEventById(db, payment.eventId)
    if (!invoiceEvent) throw new Error('INVALID_EVENT')
    const invoiceVerdict = evaluateEventWindow(invoiceEvent, startedAt)
    if (!invoiceVerdict.valid) {
      if (invoiceVerdict.reason === 'event_not_started') throw new Error('EVENT_NOT_STARTED')
      if (invoiceVerdict.reason === 'event_ended') throw new Error('EVENT_ENDED')
      throw new Error('EVENT_NOT_ACTIVE')
    }
    eventId = payment.eventId
  } else {
    eventId =
      availability.mode === 'event' ? (availability.activeEvent?.id ?? null) : null

    // Optional eventId from client (cash/card) must still be valid if sent.
    const explicit = params.saleEventId?.trim()
    if (explicit) {
      const explicitEvent = getEventById(db, explicit)
      if (!explicitEvent) throw new Error('INVALID_EVENT')
      const explicitVerdict = evaluateEventWindow(explicitEvent, startedAt)
      if (!explicitVerdict.valid) {
        if (explicitVerdict.reason === 'event_not_started') throw new Error('EVENT_NOT_STARTED')
        if (explicitVerdict.reason === 'event_ended') throw new Error('EVENT_ENDED')
        throw new Error('EVENT_NOT_ACTIVE')
      }
      eventId = explicitEvent.id
    }
  }

  if (lines.length === 0) throw new Error('EMPTY_CART')

  let totalGuess = lines.reduce((s, l) => s + l.unitPriceCents * l.qty, 0)
  /** Resolve prices from backend products if qty given without prices */
  const prodStmt = db.prepare(
    `SELECT category_id, name, price_cents, vat_rate_percent, stock_tracking, stock_qty, deposit_enabled, deposit_amount
     FROM products WHERE id = ?`,
  )

  totalGuess = 0
  for (const l of lines) {
    const pr = prodStmt.get(l.productId) as
      | {
          category_id: string
          name: string
          price_cents: number
          vat_rate_percent: number
          stock_tracking: number
          stock_qty: number | null
        }
      | undefined
    const unit =
      typeof l.unitPriceCents === 'number' && l.unitPriceCents >= 0
        ? l.unitPriceCents
        : (pr?.price_cents ?? 0)
    totalGuess += unit * l.qty
  }

  if (payment.method === 'cash') {
    if (payment.amountTenderedCents < totalGuess) throw new Error('INSUFFICIENT_CASH')
  }

  if (clientUuid) {
    const dup = db
      .prepare(
        `SELECT id, receipt_no, created_at as createdAt, receipt_pdf_rel_path as receiptPdfRelPath FROM sales WHERE client_uuid = ?`,
      )
      .get(clientUuid) as
      | {
          id: string
          receipt_no: number
          createdAt: number
          receiptPdfRelPath: string | null
        }
      | undefined
    if (dup) {
      return {
        id: dup.id,
        receiptNo: dup.receipt_no,
        createdAt: dup.createdAt,
        receiptPdfRelPath: dup.receiptPdfRelPath ?? '',
        duplicate: true,
      }
    }
  }

  const teamId = payment.method === 'invoice' ? payment.teamId : null

  if (payment.method === 'invoice') {
    const team = db
      .prepare(`SELECT active FROM teams WHERE id = ?`)
      .get(teamId) as { active: number } | undefined
    if (!team || !team.active) throw new Error('INVALID_TEAM')
  }

  const usr = db
    .prepare(`SELECT username FROM users WHERE id = ?`)
    .get(user.sub) as { username: string } | undefined

  const issuer = getIssuer(db)
  const orgName = issuer.name ?? getOrgName(db)
  const footer = getReceiptFooter(db)
  const { taxMode } = getTaxSettings(db)

  const built = db.transaction(() => {
    const saleId = crypto.randomUUID()
    const createdAt = startedAt
    const dk = dayKey(createdAt)
    const receiptNo = nextReceiptNo(db)
    const tseTxn = `TSE-${receiptNo}`

    let sum = 0
    let depositTotalCents = 0
    let depositQtyTotal = 0
    type PdfLn = {
      name: string
      qty: number
      unitPriceCents: number
      lineTotalCents: number
    }
    const pdfLines: PdfLn[] = []

    const lineIns = db.prepare(
      `INSERT INTO sale_lines (
        id, sale_id, category_id, product_id, name, qty, unit_price_cents, line_total_cents, vat_rate_percent,
        deposit_amount_cents, deposit_qty, deposit_total_cents
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    const voucherIns = db.prepare(
      `INSERT INTO deposit_vouchers (
        id, voucher_number, sale_id, event_id, amount_cents, quantity, status, issued_at, redeemed_at, redeemed_by, created_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    )

    for (const l of lines) {
      const pr = prodStmt.get(l.productId) as
        | {
            category_id: string
            name: string
            price_cents: number
            vat_rate_percent: number
            stock_tracking: number
            stock_qty: number | null
            deposit_enabled: number
            deposit_amount: number
          }
        | undefined
      const name = (l.name && l.name.trim()) || pr?.name || 'Artikel'
      const unitPriceCents =
        typeof l.unitPriceCents === 'number' && l.unitPriceCents >= 0
          ? l.unitPriceCents
          : (pr?.price_cents ?? 0)
      const categoryId = pr?.category_id ?? 'unknown'
      const vat = pr?.vat_rate_percent ?? 19
      const lineTotal = unitPriceCents * l.qty
      const depositAmountCents =
        Number(pr?.deposit_enabled ?? 0) === 1 ? Number(pr?.deposit_amount ?? 0) : 0
      const lineDepositTotal = depositAmountCents * l.qty
      sum += lineTotal
      depositTotalCents += lineDepositTotal
      depositQtyTotal += depositAmountCents > 0 ? l.qty : 0

      pdfLines.push({
        name,
        qty: l.qty,
        unitPriceCents,
        lineTotalCents: lineTotal,
      })

      lineIns.run(
        crypto.randomUUID(),
        saleId,
        categoryId,
        l.productId,
        name,
        l.qty,
        unitPriceCents,
        lineTotal,
        vat,
        depositAmountCents,
        depositAmountCents > 0 ? l.qty : 0,
        lineDepositTotal,
      )

      if (pr?.stock_tracking) {
        const qtyLeft = Number(pr.stock_qty ?? 0) - l.qty
        if (qtyLeft < 0) throw new Error('OUT_OF_STOCK')
        db.prepare(`UPDATE products SET stock_qty = ? WHERE id = ?`).run(qtyLeft, l.productId)
      }
    }

    let amountTendered: number | null = null
    let changeAmt: number | null = null
    if (payment.method === 'cash') {
      amountTendered = payment.amountTenderedCents
      changeAmt = payment.amountTenderedCents - sum
      if ((changeAmt ?? 0) < 0) throw new Error('INSUFFICIENT_CASH')
    }

    const invoiceStateStr =
      payment.method === 'invoice' ? 'open_for_invoicing' : 'na'

    let paymentLabel = 'Barzahlung'
    if (payment.method === 'card') paymentLabel = 'Karte'
    if (payment.method === 'invoice') paymentLabel = 'Auf Rechnung (Team)'

    let contactSnap: string | null = null
    if (payment.method === 'invoice') {
      if (payment.contactName?.trim())
        contactSnap = payment.contactName.trim()
      else if (payment.teamId) {
        const t = db.prepare(`SELECT contact_name FROM teams WHERE id=?`).get(payment.teamId) as {
          contact_name: string | null
        } | null
        contactSnap = t?.contact_name?.trim() || null
      }
    }

    const noteRaw = payment.method === 'invoice' && payment.note?.trim()

    db.prepare(
      `INSERT INTO sales (
        id, created_at, day_key, total_cents, receipt_no, payment_method, status,
        lifecycle_status,
        cashier_user_id, team_id, event_id, invoice_contact_snapshot, cashier_note,
        client_uuid, amount_tendered_cents, change_cents, invoice_state,
        receipt_pdf_rel_path, tse_status, tse_transaction_number, tse_start_time, tse_end_time,
        tse_process_type, tse_process_data, tax_mode_snapshot, cashier_name_snapshot, deposit_total_cents
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      saleId,
      createdAt,
      dk,
      sum,
      receiptNo,
      payment.method,
      'completed',
      'completed',
      user.sub,
      teamId,
      eventId,
      contactSnap,
      noteRaw ?? null,
      clientUuid ?? null,
      amountTendered,
      changeAmt,
      invoiceStateStr,
      '',
      'inactive',
      tseTxn,
      createdAt,
      Date.now(),
      payment.method === 'cash' ? 'KassenbelegBar' : payment.method === 'card' ? 'KassenbelegCard' : 'KassenbelegInvoice',
      JSON.stringify({
        receiptNo,
        method: payment.method,
        totalCents: sum,
      }),
      taxMode,
      usr?.username ?? null,
      depositTotalCents,
    )

    let depositVoucherNumber: string | undefined
    if (depositTotalCents > 0) {
      const voucherNo = nextDepositVoucherNo(db, createdAt)
      depositVoucherNumber = voucherNo
      voucherIns.run(
        crypto.randomUUID(),
        voucherNo,
        saleId,
        eventId,
        depositTotalCents,
        depositQtyTotal,
        'open',
        createdAt,
        null,
        null,
        createdAt,
      )
    }

    appendAudit({
      db,
      dataRoot: params.dataRoot,
      type:
        payment.method === 'invoice' ? 'sale_invoice' : 'sale_completed',
      userId: user.sub,
      payload: { saleId, receiptNo, paymentMethod: payment.method },
    })

    const extraCash =
      payment.method === 'cash' && amountTendered != null && changeAmt != null
        ? [
            `Gegeben EUR ${(amountTendered / 100).toFixed(2).replace('.', ',')}`,
            `Rückgeld EUR ${(changeAmt / 100).toFixed(2).replace('.', ',')}`,
          ]
        : []
    const extraNote =
      payment.method === 'invoice' && noteRaw ? [`Hinweis: ${noteRaw}`] : []
    const extraLines = [...extraCash, ...extraNote]

    return {
      saleId,
      createdAt,
      receiptNo,
      pdfLines,
      totalCents: sum,
      depositTotalCents,
      depositVoucherNumber,
      paymentLabel,
      extraLines,
    }
  })()

  const receiptPdfRelPath = await writeReceiptPdfPromise({
    dataRoot: params.dataRoot,
    receiptNo: built.receiptNo,
    createdAt: built.createdAt,
    orgName,
    footer,
    lines: built.pdfLines,
    totalCents: built.totalCents,
    paymentLabel: built.paymentLabel,
    extraLines: built.extraLines,
  })

  db.prepare(`UPDATE sales SET receipt_pdf_rel_path = ? WHERE id = ?`).run(
    receiptPdfRelPath,
    built.saleId,
  )

  appendAudit({
    db,
    dataRoot: params.dataRoot,
    type: 'receipt_pdf_written',
    userId: user.sub,
    payload: {
      saleId: built.saleId,
      receiptPdfRelPath,
    },
  })

  return {
    id: built.saleId,
    receiptNo: built.receiptNo,
    createdAt: built.createdAt,
    receiptPdfRelPath,
    depositVoucherNumber: built.depositVoucherNumber,
    depositTotalCents: built.depositTotalCents,
  }
}

export function getDepositVoucherByNumber(params: {
  db: BetterSqlite3.Database
  voucherNumber: string
}) {
  const no = params.voucherNumber.trim().toUpperCase()
  return params.db
    .prepare(
      `SELECT id, voucher_number as voucherNumber, sale_id as saleId, event_id as eventId,
              amount_cents as amountCents, quantity, status, issued_at as issuedAt,
              redeemed_at as redeemedAt, redeemed_by as redeemedBy, created_at as createdAt
       FROM deposit_vouchers WHERE voucher_number = ?`,
    )
    .get(no)
}

export function redeemDepositVoucher(params: {
  db: BetterSqlite3.Database
  dataRoot: string
  user: JwtUser
  voucherNumber: string
  note?: string
}) {
  const no = params.voucherNumber.trim().toUpperCase()
  const row = params.db
    .prepare(
      `SELECT id, voucher_number, amount_cents, quantity, status
       FROM deposit_vouchers WHERE voucher_number = ?`,
    )
    .get(no) as
    | {
        id: string
        voucher_number: string
        amount_cents: number
        quantity: number
        status: 'open' | 'redeemed' | 'cancelled'
      }
    | undefined
  if (!row) throw new Error('DEPOSIT_VOUCHER_NOT_FOUND')
  if (row.status === 'redeemed') throw new Error('DEPOSIT_VOUCHER_ALREADY_REDEEMED')
  if (row.status === 'cancelled') throw new Error('DEPOSIT_VOUCHER_CANCELLED')

  const now = Date.now()
  const tx = params.db.transaction(() => {
    const changed = params.db
      .prepare(
        `UPDATE deposit_vouchers
         SET status='redeemed', redeemed_at=?, redeemed_by=?
         WHERE id=? AND status='open'`,
      )
      .run(now, params.user.username ?? params.user.sub, row.id)
    if (changed.changes !== 1) throw new Error('DEPOSIT_VOUCHER_ALREADY_REDEEMED')

    params.db
      .prepare(
        `INSERT INTO deposit_redemptions (id, voucher_id, amount_cents, quantity, cashier, redeemed_at, note)
         VALUES (?,?,?,?,?,?,?)`,
      )
      .run(
        crypto.randomUUID(),
        row.id,
        row.amount_cents,
        row.quantity,
        params.user.username ?? params.user.sub,
        now,
        params.note ?? null,
      )
  })
  tx()

  appendAudit({
    db: params.db,
    dataRoot: params.dataRoot,
    type: 'deposit_redeemed',
    userId: params.user.sub,
    payload: { voucherNumber: row.voucher_number, amountCents: row.amount_cents },
  })

  return {
    voucherNumber: row.voucher_number,
    amountCents: row.amount_cents,
    quantity: row.quantity,
    redeemedAt: now,
  }
}

export function createHelperConsumption(params: {
  db: BetterSqlite3.Database
  dataRoot: string
  user: JwtUser
  eventId?: string | null
  note?: string
  lines: HelperConsumptionLineBody[]
}) {
  if (!params.lines.length) throw new Error('EMPTY_CART')
  const createdAt = Date.now()
  const id = crypto.randomUUID()
  const saleLikeNumber = nextHelperConsumptionNo(params.db, createdAt)

  const prod = params.db.prepare(
    `SELECT name, price_cents, stock_tracking, stock_qty FROM products WHERE id = ?`,
  )
  const insParent = params.db.prepare(
    `INSERT INTO helper_consumptions (
      id, helper_id, helper_name_snapshot, event_id, sale_like_number, total_value_cents, payment_total_cents,
      created_at, cashier, note, helper_group, consumption_type
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
  const insItem = params.db.prepare(
    `INSERT INTO helper_consumption_items (
      id, helper_consumption_id, product_id, product_name_snapshot, quantity, unit_price_snapshot_cents, total_value_cents
    ) VALUES (?,?,?,?,?,?,?)`,
  )
  const stockUpd = params.db.prepare(`UPDATE products SET stock_qty = ? WHERE id = ?`)

  let totalValueCents = 0
  const tx = params.db.transaction(() => {
    for (const ln of params.lines) {
      const pr = prod.get(ln.productId) as
        | { name: string; price_cents: number; stock_tracking: number; stock_qty: number | null }
        | undefined
      const unit = ln.unitPriceCents != null ? ln.unitPriceCents : Number(pr?.price_cents ?? 0)
      const lineTotal = unit * ln.qty
      totalValueCents += lineTotal
      insItem.run(
        crypto.randomUUID(),
        id,
        ln.productId,
        ln.name?.trim() || pr?.name || 'Artikel',
        ln.qty,
        unit,
        lineTotal,
      )
      if (Number(pr?.stock_tracking ?? 0) === 1) {
        const qtyLeft = Number(pr?.stock_qty ?? 0) - ln.qty
        if (qtyLeft < 0) throw new Error('OUT_OF_STOCK')
        stockUpd.run(qtyLeft, ln.productId)
      }
    }
    insParent.run(
      id,
      null,
      'Helfer allgemein',
      params.eventId ?? null,
      saleLikeNumber,
      totalValueCents,
      0,
      createdAt,
      params.user.username ?? params.user.sub,
      params.note ?? null,
      'Helfer allgemein',
      'helper_general',
    )
  })
  tx()

  appendAudit({
    db: params.db,
    dataRoot: params.dataRoot,
    type: 'helper_consumption_created',
    userId: params.user.sub,
    payload: { id, saleLikeNumber, totalValueCents },
  })

  return { id, saleLikeNumber, totalValueCents, createdAt }
}
