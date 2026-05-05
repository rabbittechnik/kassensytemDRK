import crypto from 'node:crypto'
import type BetterSqlite3 from 'better-sqlite3'
import type { JwtUser } from '../types.js'
import { appendAudit } from '../audit.js'
import { nextReceiptNo } from './numbers.js'
import { writeReceiptPdfPromise } from './pdfReceipt.js'
import {
  getIssuer,
  getOrgName,
  getReceiptFooter,
  getTaxSettings,
} from './issuer.js'

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

function dayKey(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function getSetting(db: BetterSqlite3.Database, key: string): string | undefined {
  const r = db
    .prepare(`SELECT value FROM settings WHERE key = ?`)
    .get(key) as { value: string } | undefined
  return r?.value
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
}> {
  const { db, lines, payment, user, clientUuid } = params
  const startedAt = Date.now()

  const allowNoEvent = getSetting(db, 'allow_sales_without_event') !== '0'
  const activeFromSettings = getSetting(db, 'active_event_id')?.trim() ?? ''

  let eventId: string | null = null
  if (payment.method === 'invoice') {
    eventId = payment.eventId
  } else {
    const explicit = params.saleEventId?.trim()
    eventId = explicit || activeFromSettings || null
  }

  if (!eventId) {
    if (!allowNoEvent) throw new Error('NO_EVENT')
  } else {
    const ev = db
      .prepare(`SELECT status FROM events WHERE id = ?`)
      .get(eventId) as { status: string } | undefined
    if (!ev) throw new Error('INVALID_EVENT')
    if (ev.status !== 'active') throw new Error('EVENT_NOT_ACTIVE')
  }

  if (lines.length === 0) throw new Error('EMPTY_CART')

  let totalGuess = lines.reduce((s, l) => s + l.unitPriceCents * l.qty, 0)
  /** Resolve prices from backend products if qty given without prices */
  const prodStmt = db.prepare(
    `SELECT category_id, name, price_cents, vat_rate_percent, stock_tracking, stock_qty FROM products WHERE id = ?`,
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
    type PdfLn = {
      name: string
      qty: number
      unitPriceCents: number
      lineTotalCents: number
    }
    const pdfLines: PdfLn[] = []

    const lineIns = db.prepare(
      `INSERT INTO sale_lines (id, sale_id, category_id, product_id, name, qty, unit_price_cents, line_total_cents, vat_rate_percent)
       VALUES (?,?,?,?,?,?,?,?,?)`,
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
      sum += lineTotal

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
        tse_process_type, tse_process_data, tax_mode_snapshot, cashier_name_snapshot
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
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
    )

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
  }
}
