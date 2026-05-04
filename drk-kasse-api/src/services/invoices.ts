import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type BetterSqlite3 from 'better-sqlite3'
import nodemailer from 'nodemailer'
import { appendAudit } from '../audit.js'
import type { JwtUser } from '../types.js'
import { nextInvoiceNo } from './numbers.js'
import {
  writeCollectiveInvoicePdf,
  type AggregatedInvoiceLine,
  type IssuerBlock,
} from './pdfInvoice.js'
import { getIssuer, getTaxSettings } from './issuer.js'

export interface SmtpConfig {
  smtpHost: string
  smtpPort: number
  smtpSecure: boolean
  smtpUser: string
  smtpPass: string
  smtpFrom: string
}

function vatHints(taxMode: string, notice: string): string[] {
  const o: string[] = []
  if (notice.trim()) o.push(notice.trim())
  if (taxMode === 'small_business')
    o.push(
      'Gemäß § 19 UStG wird keine Umsatzsteuer ausgewiesen (Kleinunternehmerregelung).',
    )
  if (taxMode === 'tax_exempt_club') o.push('Steuerbefreiung / Vereinsregelungen gemäß Einstellung.')
  if (taxMode !== 'vat_liable')
    o.push('Steuerliche Einordnung bitte konsistent zu den Org.-Einstellungen prüfen.')
  return o
}

/** EPC credit transfer QR text (basic) when IBAN and amount known */
export function buildEpcQr(params: {
  iban?: string
  bic?: string
  name?: string
  amountCents: number
  reference: string
}): string | undefined {
  if (!params.iban) return undefined
  const amt = params.amountCents / 100
  const amtStr = amt.toFixed(2).replace('.', '')
  const name = (params.name ?? 'Creditor').slice(0, 70)
  return [
    `BCD`,
    `002`,
    `1`,
    `SCT`,
    (params.bic ?? '').slice(0, 11),
    name,
    params.iban.replace(/\s/g, ''),
    `EUR${amtStr}`,
    '',
    `${params.reference}`.slice(0, 140),
    '',
  ].join('\n')
}

export function listOpenInvoicePosts(db: BetterSqlite3.Database, eventId?: string) {
  const q = `
    SELECT 
      team_id AS teamId,
      event_id AS eventId,
      t.name AS teamName,
      e.name AS eventName,
      COUNT(*) AS openCount,
      SUM(s.total_cents) AS totalOpenCents,
      MIN(s.created_at) AS firstPurchaseAt,
      MAX(s.created_at) AS lastPurchaseAt
    FROM sales s
    JOIN teams t ON t.id = s.team_id
    JOIN events e ON e.id = s.event_id
    WHERE s.payment_method = 'invoice'
      AND s.invoice_state = 'open_for_invoicing'
      AND COALESCE(s.is_stornoed, 0) = 0
      ${eventId ? 'AND s.event_id = ?' : ''}
    GROUP BY team_id, event_id, t.name, e.name
    ORDER BY MAX(s.created_at) DESC
  `
  const stmt = db.prepare(q)
  return eventId
    ? (stmt.all(eventId) as unknown[])
    : (stmt.all() as unknown[])
}

export type OpenSaleDetail = Record<string, unknown>

export function listOpenSalesDetail(
  db: BetterSqlite3.Database,
  teamId: string,
  eventId: string,
) {
  const sales = db
    .prepare(
      `SELECT s.id as saleId, s.created_at as createdAt, s.receipt_no as receiptNo,
        s.day_key as dayKey, u.username as cashier, s.payment_method as paymentMethod,
        s.invoice_state as invoiceState, s.is_stornoed as isStornoed,
        s.receipt_pdf_rel_path as receiptPdfRelPath,
        sl.id as lineId, sl.product_id as productId, sl.name as articleName,
        sl.qty, sl.unit_price_cents as unitPriceCents,
        sl.line_total_cents as lineTotalCents
      FROM sales s
      LEFT JOIN users u ON u.id = s.cashier_user_id
      JOIN sale_lines sl ON sl.sale_id = s.id
      WHERE s.team_id = ? AND s.event_id = ?
        AND s.payment_method = 'invoice'
        AND s.invoice_state = 'open_for_invoicing'
        AND COALESCE(s.is_stornoed, 0) = 0
      ORDER BY s.created_at ASC`,
    )
    .all(teamId, eventId) as Record<string, unknown>[]

  /** Group lines by sale */
  const bySale = new Map<string, Record<string, unknown>>()
  for (const row of sales) {
    const sid = String(row.saleId)
    if (!bySale.has(sid)) {
      bySale.set(sid, {
        saleId: sid,
        createdAt: row.createdAt,
        receiptNo: row.receiptNo,
        dayKey: row.dayKey,
        cashier: row.cashier,
        paymentMethod: row.paymentMethod,
        invoiceState: row.invoiceState,
        isStornoed: row.isStornoed,
        receiptPdfRelPath: row.receiptPdfRelPath,
        lines: [] as unknown[],
      })
    }
    ;(bySale.get(sid)!.lines as unknown[]).push({
      productId: row.productId,
      articleName: row.articleName,
      qty: row.qty,
      unitPriceCents: row.unitPriceCents,
      lineTotalCents: row.lineTotalCents,
    })
  }
  return [...bySale.values()]
}

/** Summarize aggregated lines AND optional receipt listing */
function summarizeOpenSales(db: BetterSqlite3.Database, teamId: string, eventId: string) {
  const rows = db
    .prepare(
      `SELECT sl.product_id AS productId, sl.name AS name,
        SUM(sl.qty) AS qty, sl.unit_price_cents AS unitPriceCents,
        sl.vat_rate_percent AS vatRate
      FROM sales s JOIN sale_lines sl ON sl.sale_id = s.id
      WHERE s.team_id = ? AND s.event_id = ?
        AND s.payment_method = 'invoice'
        AND s.invoice_state = 'open_for_invoicing'
        AND COALESCE(s.is_stornoed, 0) = 0
      GROUP BY sl.product_id, sl.name, sl.unit_price_cents, sl.vat_rate_percent
      ORDER BY sl.name COLLATE NOCASE`,
    )
    .all(teamId, eventId) as Array<{
    productId: string
    name: string
    qty: number
    unitPriceCents: number
    vatRate: number
  }>

  const agg: AggregatedInvoiceLine[] = rows.map((r) => ({
    productId: r.productId,
    name: r.name,
    qty: r.qty,
    unitPriceCents: r.unitPriceCents,
    lineTotalCents: r.unitPriceCents * r.qty,
    vatRatePercent: r.vatRate,
  }))

  const saleRows = db
    .prepare(
      `SELECT s.id AS id, s.receipt_no AS receiptNo,
        datetime(s.created_at/1000, 'unixepoch', 'localtime') AS d,
        s.total_cents AS totalCents
      FROM sales s
      WHERE s.team_id = ? AND s.event_id = ?
        AND s.payment_method = 'invoice'
        AND s.invoice_state = 'open_for_invoicing'
        AND COALESCE(s.is_stornoed, 0) = 0
      ORDER BY s.created_at`,
    )
    .all(teamId, eventId) as Array<{
    id: string
    receiptNo: number
    d: string
    totalCents: number
  }>

  return { aggLines: agg, receipts: saleRows }
}

/** Derive overdue from due date */
export function deriveInvoiceFrontendStatus(inv: {
  status: string
  due_date: string
  total_cents: number
}): string {
  if (inv.status === 'paid' || inv.status === 'cancelled') return inv.status
  const due = Date.parse(inv.due_date.slice(0, 10))
  const unpaid = parseFloat(String(inv.total_cents ?? 0)) > 0
  if (
    unpaid &&
    inv.status !== 'draft' &&
    inv.status !== 'cancelled' &&
    Date.now() > due &&
    due > 0
  ) {
    if (inv.status === 'paid') return inv.status
    return 'overdue'
  }
  return inv.status
}

export async function createCollectiveInvoice(opts: {
  db: BetterSqlite3.Database
  dataRoot: string
  user: JwtUser
  teamId: string
  eventId: string
  attachReceiptDetails?: boolean
}): Promise<{ invoiceId: string; invoiceNo: string; pdfRelPath: string; totalCents: number }> {
  const { db, teamId, eventId } = opts
  const tax = getTaxSettings(db)
  const issuer = getIssuer(opts.db)

  const teamRow = opts.db
    .prepare(
      `SELECT * FROM teams WHERE id = ? AND active = 1`,
    )
    .get(teamId) as Record<string, unknown> | undefined
  if (!teamRow) throw new Error('TEAM')

  const eventRow = opts.db
    .prepare(`SELECT * FROM events WHERE id = ?`)
    .get(eventId) as { name: string; start_date: string; end_date: string; status: string } | undefined
  if (!eventRow || eventRow.status !== 'active') throw new Error('EVENT')

  const preview = summarizeOpenSales(opts.db, teamId, eventId)
  if (preview.aggLines.length === 0 || preview.receipts.length === 0)
    throw new Error('NO_OPEN_POSTS')

  const total = preview.aggLines.reduce((s, l) => s + l.lineTotalCents, 0)

  const built = opts.db.transaction(() => {
    const invoiceId = crypto.randomUUID()
    const invoiceNo = nextInvoiceNo(opts.db, 'RE')
    const today = new Date().toISOString().slice(0, 10)
    const pd = typeof teamRow.default_payment_days === 'number'
      ? Number(teamRow.default_payment_days)
      : parseInt(String(teamRow.default_payment_days ?? 14), 10)
    const due = new Date()
    due.setDate(due.getDate() + (Number.isFinite(pd) ? pd : 14))
    const dueStr = due.toISOString().slice(0, 10)

    const recipientLines = [
      String(teamRow.name ?? ''),
      teamRow.contact_name ? `Ansprechpartner: ${teamRow.contact_name}` : '',
      teamRow.customer_no ? `KundenNr.: ${teamRow.customer_no}` : '',
      String(teamRow.billing_address ?? ''),
    ].filter(Boolean)

    const issuerSnap: IssuerBlock = issuer
    const structured = {
      type: 'collective_invoice' as const,
      schemaVersion: 1,
      issuer: issuerSnap,
      recipientName: teamRow.name,
      recipientAddressLines: recipientLines.slice(2),
      teamId,
      eventId,
      lines: preview.aggLines,
      totals: {
        grossCents: total,
      },
      vatHints: tax,
    }

    const pdfRelPlaceholder = ''

    opts.db.prepare(
      `INSERT INTO invoices (
       id, invoice_no, kind, references_invoice_id, team_id, event_id, status,
       issue_date, service_period_start, service_period_end, currency,
       subtotal_cents, vat_breakdown_json, total_cents, payment_terms_days, due_date,
       issuer_snapshot_json, recipient_snapshot_json, tax_settings_snapshot_json,
       aggregated_lines_json, optional_detail_attachment_json,
       structured_payload_json, pdf_rel_path,
       paid_cents, cancelled_at, storno_reason, storno_invoice_id, created_at, sent_at, paid_full_at
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      invoiceId,
      invoiceNo,
      'normal',
      null,
      teamId,
      eventId,
      'open',
      today,
      eventRow.start_date,
      eventRow.end_date,
      'EUR',
      total,
      JSON.stringify(preview.aggLines),
      total,
      pd || 14,
      dueStr,
      JSON.stringify(issuerSnap),
      JSON.stringify(teamRow),
      JSON.stringify({ tax_mode: tax.taxMode, notice: tax.taxNotice }),
      JSON.stringify(preview.aggLines),
      opts.attachReceiptDetails ? JSON.stringify(preview.receipts) : null,
      JSON.stringify(structured),
      pdfRelPlaceholder,
      0,
      null,
      null,
      null,
      Date.now(),
      null,
      null,
    )

    /** Link sales */
    const link = opts.db.prepare(
      `INSERT INTO invoice_sale_links (invoice_id, sale_id) VALUES (?,?)`,
    )
    const upd = opts.db.prepare(
      `UPDATE sales SET invoice_state = 'invoiced' WHERE id = ?`,
    )
    for (const sr of preview.receipts) {
      link.run(invoiceId, sr.id)
      upd.run(sr.id)
    }

    appendAudit({
      db: opts.db,
      dataRoot: opts.dataRoot,
      type: 'invoice_created',
      userId: opts.user.sub,
      payload: { invoiceId, invoiceNo, totalCents: total },
    })

    return { invoiceId, invoiceNo, invoiceNoOut: invoiceNo, totalCents: total, structured, issuerSnap: issuer, recipientLines, preview, today, dueStr: dueStr!, pdDays: pd || 14 }
  })()

  const qrPayload = buildEpcQr({
    iban: built.issuerSnap.iban?.replace(/\s/g, ''),
    bic: built.issuerSnap.bic,
    name: built.issuerSnap.name,
    amountCents: built.totalCents,
    reference: built.invoiceNoOut,
  })

  const pdfRelPath = await writeCollectiveInvoicePdf({
    dataRoot: opts.dataRoot,
    invoiceNo: built.invoiceNoOut,
    issueDateISO: built.today,
    servicePeriod: {
      start: eventRow!.start_date,
      end: eventRow!.end_date,
    },
    issuer: built.issuerSnap,
    recipientLines: built.recipientLines.join('\n').split('\n'),
    teamName: String(teamRow!.name ?? ''),
    eventName: eventRow!.name,
    lines: built.preview.aggLines,
    vatNotes: vatHints(tax.taxMode, tax.taxNotice),
    totalCents: built.totalCents,
    paymentTermsDays: built.pdDays,
    dueDateISO: built.dueStr,
    purposeReference: built.invoiceNoOut,
    attachReceiptListing: !!opts.attachReceiptDetails,
    receiptRefs: preview.receipts.map((r) => ({
      receiptNo: r.receiptNo,
      date: r.d,
      amountCents: r.totalCents,
    })),
    qrPayload,
  })

  opts.db.prepare(`UPDATE invoices SET pdf_rel_path = ?, status = ? WHERE id = ?`).run(
    pdfRelPath,
    'open',
    built.invoiceId,
  )

  return {
    invoiceId: built.invoiceId,
    invoiceNo: built.invoiceNoOut,
    pdfRelPath,
    totalCents: built.totalCents,
  }
}

/** Storno-Rechnung: negative positions (mirror aggregates) */
export async function stornoInvoice(opts: {
  db: BetterSqlite3.Database
  dataRoot: string
  user: JwtUser
  invoiceId: string
  reason: string
}): Promise<{ stornoInvoiceId: string; invoiceNo: string; pdfRelPath: string }> {
  const inv = opts.db
    .prepare(`SELECT * FROM invoices WHERE id = ?`)
    .get(opts.invoiceId) as Record<string, unknown> | undefined
  if (!inv) throw new Error('NOT_FOUND')
  if ((inv.kind as string) !== 'normal') throw new Error('NOT_REVERSIBLE')
  if ((inv.status as string) === 'cancelled') throw new Error('ALREADY_CANCELLED')

  const originalLines = JSON.parse(String(inv.aggregated_lines_json ?? '[]')) as AggregatedInvoiceLine[]
  const negative = originalLines.map((l) => ({
    ...l,
    qty: -Math.abs(l.qty),
    lineTotalCents: -Math.abs(l.lineTotalCents),
    unitPriceCents: l.unitPriceCents,
  }))
  const totalNeg = negative.reduce((s, l) => s + l.lineTotalCents, 0)

  const taxRaw = JSON.parse(String(inv.tax_settings_snapshot_json ?? '{}'))

  const teamRow = opts.db
    .prepare(`SELECT * FROM teams WHERE id = ?`)
    .get(inv.team_id) as Record<string, unknown>
  const eventRow = opts.db
    .prepare(`SELECT * FROM events WHERE id = ?`)
    .get(inv.event_id) as Record<string, unknown>

  const built = opts.db.transaction(() => {
    const nid = crypto.randomUUID()
    const stNo = nextInvoiceNo(opts.db, 'ST')
    const issuerSnap = JSON.parse(String(inv.issuer_snapshot_json)) as IssuerBlock
    const today = new Date().toISOString().slice(0, 10)
    opts.db.prepare(
      `INSERT INTO invoices (
       id, invoice_no, kind, references_invoice_id, team_id, event_id, status,
       issue_date, service_period_start, service_period_end, currency,
       subtotal_cents, vat_breakdown_json, total_cents, payment_terms_days, due_date,
       issuer_snapshot_json, recipient_snapshot_json, tax_settings_snapshot_json,
       aggregated_lines_json, optional_detail_attachment_json,
       structured_payload_json, pdf_rel_path,
       paid_cents, cancelled_at, storno_reason, storno_invoice_id, created_at, sent_at, paid_full_at
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      nid,
      stNo,
      'storno',
      opts.invoiceId,
      inv.team_id,
      inv.event_id,
      'open',
      today,
      inv.service_period_start,
      inv.service_period_end,
      'EUR',
      totalNeg,
      JSON.stringify(negative),
      totalNeg,
      0,
      today,
      String(inv.issuer_snapshot_json ?? '{}'),
      String(inv.recipient_snapshot_json ?? '{}'),
      JSON.stringify(taxRaw),
      JSON.stringify(negative),
      JSON.stringify([]),
      JSON.stringify({
        kind: 'storno',
        refs: opts.invoiceId,
        reason: opts.reason,
      }),
      '',
      0,
      null,
      opts.reason,
      null,
      Date.now(),
      null,
      null,
    )

    opts.db.prepare(`UPDATE invoices SET status = ?, cancelled_at = ?, storno_invoice_id = ?, storno_reason = ? WHERE id = ?`).run(
      'cancelled',
      Date.now(),
      nid,
      opts.reason,
      opts.invoiceId,
    )

    appendAudit({
      db: opts.db,
      dataRoot: opts.dataRoot,
      type: 'invoice_storno',
      userId: opts.user.sub,
      payload: {
        original: opts.invoiceId,
        stornoId: nid,
        stornoNo: stNo,
      },
    })

    return { nid, stNo, issuerSnap, agg: negative }
  })()

  const recipientLinesRaw = typeof teamRow.billing_address === 'string'
    ? `${teamRow.name}\n${teamRow.billing_address}`
    : String(teamRow.name)

  const pdfRelPath = await writeCollectiveInvoicePdf({
    dataRoot: opts.dataRoot,
    invoiceNo: built.stNo,
    issueDateISO: new Date().toISOString().slice(0, 10),
    servicePeriod: {
      start: String(inv.service_period_start),
      end: String(inv.service_period_end),
    },
    issuer: built.issuerSnap,
    recipientLines: recipientLinesRaw.split('\n').filter(Boolean),
    teamName: String(teamRow.name),
    eventName: String(eventRow.name),
    lines: built.agg,
    vatNotes: [opts.reason],
    totalCents: totalNeg,
    paymentTermsDays: 0,
    dueDateISO: new Date().toISOString().slice(0, 10),
    purposeReference: built.stNo,
    isStorno: true,
    referencesInvoiceNo: String(inv.invoice_no),
  })

  opts.db.prepare(`UPDATE invoices SET pdf_rel_path = ?, status = ? WHERE id = ?`).run(
    pdfRelPath,
    'open',
    built.nid,
  )

  return {
    stornoInvoiceId: built.nid,
    invoiceNo: built.stNo,
    pdfRelPath,
  }
}

export function recordInvoicePayment(opts: {
  db: BetterSqlite3.Database
  dataRoot: string
  user: JwtUser
  invoiceId: string
  amountCents: number
  paidAt: number
  note?: string
  bankReference?: string
}) {
  const inv = opts.db
    .prepare(`SELECT total_cents, COALESCE((SELECT SUM(amount_cents) FROM invoice_payments WHERE invoice_id = invoices.id),0) AS prev FROM invoices WHERE id = ?`)
    .get(opts.invoiceId) as { total_cents: number; prev: number } | undefined

  if (!inv) throw new Error('INV')
  if (opts.amountCents <= 0) throw new Error('AMOUNT')

  const id = crypto.randomUUID()
  opts.db.prepare(
    `INSERT INTO invoice_payments (id, invoice_id, paid_at, amount_cents, method, note, bank_reference, created_by_user_id, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  ).run(
    id,
    opts.invoiceId,
    opts.paidAt,
    opts.amountCents,
    'transfer',
    opts.note ?? '',
    opts.bankReference ?? '',
    opts.user.sub,
    Date.now(),
  )

  const sums = opts.db
    .prepare(
      `SELECT COALESCE(SUM(amount_cents),0) AS s FROM invoice_payments WHERE invoice_id = ?`,
    )
    .get(opts.invoiceId) as { s: number }

  const totalDue = Math.abs(Number(inv.total_cents))
  const paidSum = sums.s
  let status = 'partially_paid'
  let paidFullAt: number | null = null
  if (paidSum >= totalDue) {
    status = 'paid'
    paidFullAt = Date.now()
  }

  if (status === 'paid' && paidFullAt) {
    opts.db.prepare(`UPDATE invoices SET paid_cents = ?, status = ?, paid_full_at = ? WHERE id = ?`).run(
      paidSum,
      status,
      paidFullAt,
      opts.invoiceId,
    )
  } else {
    opts.db.prepare(`UPDATE invoices SET paid_cents = ?, status = ? WHERE id = ?`).run(
      paidSum,
      status,
      opts.invoiceId,
    )
  }

  appendAudit({
    db: opts.db,
    dataRoot: opts.dataRoot,
    type: 'invoice_payment',
    userId: opts.user.sub,
    payload: {
      invoiceId: opts.invoiceId,
      amountCents: opts.amountCents,
    },
  })
}

/** Send invoice email — admin only externally */
export async function sendInvoiceEmail(opts: {
  db: BetterSqlite3.Database
  dataRoot: string
  user: JwtUser
  invoiceId: string
  mailer: SmtpConfig
  teamEmailOverride?: string
}) {
  if (!opts.mailer.smtpHost) throw new Error('NO_SMTP')

  const inv = opts.db.prepare(`SELECT * FROM invoices WHERE id = ?`).get(opts.invoiceId) as
    | Record<string, unknown>
    | undefined
  if (!inv) throw new Error('INV')

  const teamRow = opts.db
    .prepare(`SELECT * FROM teams WHERE id = ?`)
    .get(inv.team_id) as Record<string, unknown>

  const to = opts.teamEmailOverride || String(teamRow.invoice_email || '')
  if (!to.trim()) throw new Error('NO_EMAIL')

  const orgRow = opts.db.prepare(`SELECT value FROM settings WHERE key='org_name'`).get() as
    | { value?: string }
    | undefined

  const issuer = getIssuer(opts.db)
  const subject = `Rechnung ${orgRow?.value ?? issuer.name ?? 'Veranstaltung'} – ${teamRow.name} – Rechnung Nr. ${inv.invoice_no}`

  const text = [
    'Hallo,',
    '',
    'anbei erhalten Sie die Rechnung für die Verpflegung im Rahmen der Veranstaltung.',
    '',
    'Bitte überweisen Sie den Rechnungsbetrag unter Angabe der Rechnungsnummer als Verwendungszweck.',
    '',
    'Vielen Dank.',
    '',
    '',
    `${orgRow?.value ?? issuer.name ?? 'Kasse'} Gruppe`,
  ].join('\n')

  const absPdf = path.join(
    opts.dataRoot,
    String(inv.pdf_rel_path ?? '').replace(/\//g, path.sep),
  )
  if (!fs.existsSync(absPdf)) throw new Error('PDF_MISSING')

  const transporter = nodemailer.createTransport({
    host: opts.mailer.smtpHost,
    port: opts.mailer.smtpPort,
    secure: opts.mailer.smtpSecure,
    auth:
      opts.mailer.smtpUser && opts.mailer.smtpPass
        ? { user: opts.mailer.smtpUser, pass: opts.mailer.smtpPass }
        : undefined,
  })

  await transporter.sendMail({
    from: opts.mailer.smtpFrom || opts.mailer.smtpUser || 'noreply@localhost',
    to,
    subject,
    text,
    attachments: [{ filename: `rechnung-${inv.invoice_no}.pdf`, path: absPdf }],
  })

  const now = Date.now()
  const curRow = opts.db.prepare(`SELECT status FROM invoices WHERE id=?`).get(opts.invoiceId) as
    | { status: string }
    | undefined
  const keep =
    curRow?.status === 'paid' ||
    curRow?.status === 'partially_paid' ||
    curRow?.status === 'cancelled'
      ? curRow.status
      : 'sent'

  opts.db.prepare(`UPDATE invoices SET status = ?, sent_at = COALESCE(sent_at, ?) WHERE id = ?`).run(
    keep,
    now,
    opts.invoiceId,
  )

  const emailLogDir = path.join(opts.dataRoot, 'invoices', 'email-log')
  fs.mkdirSync(emailLogDir, { recursive: true })
  fs.appendFileSync(
    path.join(emailLogDir, `email-${new Date(now).toISOString().slice(0, 10)}.jsonl`),
    JSON.stringify({
      at: now,
      invoice_id: opts.invoiceId,
      to,
      subject,
      ok: true,
    }) + '\n',
    'utf8',
  )

  appendAudit({
    db: opts.db,
    dataRoot: opts.dataRoot,
    type: 'invoice_emailed',
    userId: opts.user.sub,
    payload: { invoiceId: opts.invoiceId, to },
  })
}