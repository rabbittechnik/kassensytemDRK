import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import PDFDocument from 'pdfkit'
import type BetterSqlite3 from 'better-sqlite3'
import { appendAudit } from '../audit.js'
import type { JwtUser } from '../types.js'

function dayKey(ts = Date.now()) {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function fmtEur(cents: number) {
  return `${(cents / 100).toFixed(2).replace('.', ',')} EUR`
}

function csvEscape(v: unknown) {
  const s = String(v ?? '')
  return /[;"\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s
}

export function createBackup(params: { dbPath: string; dataRoot: string; reason: string }) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const name = `db-${stamp}-${params.reason}.sqlite`
  const relPath = `backups/${name}`
  const outPath = path.join(params.dataRoot, relPath.replace(/\//g, path.sep))
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.copyFileSync(params.dbPath, outPath)
  return relPath
}

export function listBackups(dataRoot: string) {
  const dir = path.join(dataRoot, 'backups')
  fs.mkdirSync(dir, { recursive: true })
  return fs
    .readdirSync(dir)
    .filter((x) => x.endsWith('.sqlite'))
    .map((name) => {
      const abs = path.join(dir, name)
      const st = fs.statSync(abs)
      return { name, size: st.size, createdAt: st.mtimeMs }
    })
    .sort((a, b) => b.createdAt - a.createdAt)
}

export function reprintReceipt(params: {
  db: BetterSqlite3.Database
  dataRoot: string
  user: JwtUser
  saleId: string
  reason?: string
}) {
  const sale = params.db
    .prepare(
      `SELECT id, receipt_no as receiptNo, created_at as createdAt, receipt_pdf_rel_path as receiptPdfRelPath
       FROM sales WHERE id = ?`,
    )
    .get(params.saleId) as
    | { id: string; receiptNo: number; createdAt: number; receiptPdfRelPath: string | null }
    | undefined
  if (!sale) throw new Error('NOT_FOUND')
  params.db
    .prepare(`INSERT INTO sale_reprints (id, sale_id, reprinted_at, user_id, reason) VALUES (?,?,?,?,?)`)
    .run(crypto.randomUUID(), sale.id, Date.now(), params.user.sub, params.reason ?? null)
  appendAudit({
    db: params.db,
    dataRoot: params.dataRoot,
    type: 'receipt_reprint',
    userId: params.user.sub,
    payload: { saleId: sale.id, receiptNo: sale.receiptNo },
  })
  return sale
}

export function stornoSale(params: {
  db: BetterSqlite3.Database
  dataRoot: string
  user: JwtUser
  saleId: string
  reason?: string
}) {
  const sale = params.db
    .prepare(
      `SELECT * FROM sales WHERE id = ?`,
    )
    .get(params.saleId) as Record<string, unknown> | undefined
  if (!sale) throw new Error('NOT_FOUND')
  if (Number(sale.is_stornoed ?? 0) === 1) throw new Error('ALREADY_STORNOED')
  if (String(sale.lifecycle_status ?? '') === 'closed_day') throw new Error('DAY_CLOSED')

  const lines = params.db
    .prepare(`SELECT * FROM sale_lines WHERE sale_id = ?`)
    .all(params.saleId) as Array<Record<string, unknown>>
  if (lines.length === 0) throw new Error('EMPTY_LINES')

  const now = Date.now()
  const newSaleId = crypto.randomUUID()
  const receiptNoRow = params.db
    .prepare(`SELECT value FROM settings WHERE key='next_receipt_no'`)
    .get() as { value: string } | undefined
  const next = receiptNoRow ? Number(receiptNoRow.value) : 1
  params.db
    .prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('next_receipt_no', ?)`)
    .run(String(next + 1))

  const total = -Math.abs(Number(sale.total_cents ?? 0))

  const tx = params.db.transaction(() => {
    params.db
      .prepare(
        `INSERT INTO sales (
          id, created_at, day_key, total_cents, receipt_no, payment_method, status, lifecycle_status,
          cashier_user_id, team_id, event_id, invoice_contact_snapshot, cashier_note, amount_tendered_cents,
          change_cents, invoice_state, is_stornoed, reverses_sale_id, receipt_pdf_rel_path, tse_status,
          tse_transaction_number, tse_start_time, tse_end_time, tse_process_type, tse_process_data,
          tax_mode_snapshot, cashier_name_snapshot, deposit_total_cents
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        newSaleId,
        now,
        dayKey(now),
        total,
        next,
        sale.payment_method,
        'completed',
        'refunded',
        params.user.sub,
        sale.team_id ?? null,
        sale.event_id ?? null,
        sale.invoice_contact_snapshot ?? null,
        params.reason ?? null,
        null,
        null,
        'na',
        0,
        params.saleId,
        '',
        'inactive',
        `TSE-${next}`,
        now,
        now,
        'Storno',
        JSON.stringify({ originalSaleId: params.saleId, reason: params.reason ?? '' }),
        sale.tax_mode_snapshot ?? null,
        params.user.username ?? null,
        -Math.abs(Number(sale.deposit_total_cents ?? 0)),
      )

    const insLine = params.db.prepare(
      `INSERT INTO sale_lines (
        id, sale_id, category_id, product_id, name, qty, unit_price_cents, line_total_cents, vat_rate_percent,
        deposit_amount_cents, deposit_qty, deposit_total_cents
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    const updStock = params.db.prepare(`UPDATE products SET stock_qty = COALESCE(stock_qty, 0) + ? WHERE id = ?`)
    for (const ln of lines) {
      const qty = Number(ln.qty ?? 0)
      const lineTotal = -Math.abs(Number(ln.line_total_cents ?? 0))
      insLine.run(
        crypto.randomUUID(),
        newSaleId,
        ln.category_id,
        ln.product_id,
        ln.name,
        -qty,
        ln.unit_price_cents,
        lineTotal,
        ln.vat_rate_percent ?? 19,
        ln.deposit_amount_cents ?? 0,
        -(Math.abs(Number(ln.deposit_qty ?? 0))),
        -(Math.abs(Number(ln.deposit_total_cents ?? 0))),
      )
      const p = params.db
        .prepare(`SELECT stock_tracking FROM products WHERE id = ?`)
        .get(ln.product_id) as { stock_tracking: number } | undefined
      if (p?.stock_tracking) updStock.run(Math.abs(qty), ln.product_id)
    }

    params.db.prepare(`UPDATE sales SET is_stornoed = 1 WHERE id = ?`).run(params.saleId)
    params.db
      .prepare(
        `UPDATE deposit_vouchers
         SET status='cancelled'
         WHERE sale_id = ? AND status = 'open'`,
      )
      .run(params.saleId)
  })
  tx()

  appendAudit({
    db: params.db,
    dataRoot: params.dataRoot,
    type: 'sale_storno',
    userId: params.user.sub,
    payload: { originalSaleId: params.saleId, stornoSaleId: newSaleId, reason: params.reason ?? '' },
  })
  return { stornoSaleId: newSaleId, receiptNo: next }
}

export function createDailyClosing(params: {
  db: BetterSqlite3.Database
  dataRoot: string
  user: JwtUser
  day: string
  actualCashDrawerCents?: number
  /** Veranstaltung; null = alle Verkäufe des Tages (Kompatibilität). */
  eventId?: string | null
}) {
  const periodStart = new Date(`${params.day}T00:00:00`).getTime()
  const periodEnd = new Date(`${params.day}T23:59:59.999`).getTime()

  const eid = params.eventId?.trim() || null

  const existing = eid
    ? (params.db
        .prepare(`SELECT id FROM day_closings WHERE day_key = ? AND event_id = ?`)
        .get(params.day, eid) as { id: string } | undefined)
    : (params.db
        .prepare(`SELECT id FROM day_closings WHERE day_key = ? AND (event_id IS NULL OR event_id = '')`)
        .get(params.day) as { id: string } | undefined)
  if (existing) throw new Error('DAY_ALREADY_CLOSED')

  const sales = eid
    ? (params.db
        .prepare(`SELECT * FROM sales WHERE day_key = ? AND event_id = ? ORDER BY created_at`)
        .all(params.day, eid) as Array<Record<string, unknown>>)
    : (params.db
        .prepare(`SELECT * FROM sales WHERE day_key = ? ORDER BY created_at`)
        .all(params.day) as Array<Record<string, unknown>>)
  const lines = eid
    ? (params.db
        .prepare(
          `SELECT sl.*, p.name as product_name
           FROM sale_lines sl
           LEFT JOIN products p ON p.id = sl.product_id
           WHERE sl.sale_id IN (SELECT id FROM sales WHERE day_key = ? AND event_id = ?)`,
        )
        .all(params.day, eid) as Array<Record<string, unknown>>)
    : (params.db
        .prepare(
          `SELECT sl.*, p.name as product_name
           FROM sale_lines sl
           LEFT JOIN products p ON p.id = sl.product_id
           WHERE sl.sale_id IN (SELECT id FROM sales WHERE day_key = ?)`,
        )
        .all(params.day) as Array<Record<string, unknown>>)

  const total = sales.reduce((s, x) => s + Number(x.total_cents ?? 0), 0)
  const cash = sales
    .filter((s) => s.payment_method === 'cash')
    .reduce((a, s) => a + Number(s.total_cents ?? 0), 0)
  const card = sales
    .filter((s) => s.payment_method === 'card')
    .reduce((a, s) => a + Number(s.total_cents ?? 0), 0)
  const invoice = sales
    .filter((s) => s.payment_method === 'invoice')
    .reduce((a, s) => a + Number(s.total_cents ?? 0), 0)
  const stornoCount = sales.filter((s) => Number(s.reverses_sale_id ? 1 : 0) === 1).length
  const stornoTotal = sales
    .filter((s) => Number(s.reverses_sale_id ? 1 : 0) === 1)
    .reduce((a, s) => a + Math.abs(Number(s.total_cents ?? 0)), 0)

  const catMap = new Map<string, number>()
  for (const ln of lines) {
    const cat = String(ln.category_id ?? 'unknown')
    catMap.set(cat, (catMap.get(cat) ?? 0) + Number(ln.line_total_cents ?? 0))
  }
  const byCategory = [...catMap.entries()].map(([categoryId, totalCents]) => ({ categoryId, totalCents }))

  const userSet = new Set<string>()
  for (const s of sales) {
    const u = String(s.cashier_name_snapshot ?? '').trim()
    if (u) userSet.add(u)
  }
  const users = [...userSet]

  const seq = params.db
    .prepare(`SELECT COALESCE(MAX(closing_number), 0) + 1 as n FROM day_closings`)
    .get() as { n: number }
  const closingNo = seq.n
  const id = crypto.randomUUID()

  const dcDir = path.join(params.dataRoot, 'daily-closing')
  fs.mkdirSync(dcDir, { recursive: true })
  const fileStem = `${String(closingNo).padStart(6, '0')}-${params.day}`
  const csvRel = `daily-closing/${fileStem}.csv`
  const pdfRel = `daily-closing/${fileStem}.pdf`
  const csvAbs = path.join(params.dataRoot, csvRel.replace(/\//g, path.sep))
  const pdfAbs = path.join(params.dataRoot, pdfRel.replace(/\//g, path.sep))

  const csvRows: string[] = []
  csvRows.push('feld;wert')
  csvRows.push(`datum;${params.day}`)
  csvRows.push(`startzeit;${new Date(periodStart).toISOString()}`)
  csvRows.push(`endzeit;${new Date(periodEnd).toISOString()}`)
  csvRows.push(`gesamtumsatz_cents;${total}`)
  csvRows.push(`bar_cents;${cash}`)
  csvRows.push(`karte_cents;${card}`)
  csvRows.push(`rechnung_cents;${invoice}`)
  csvRows.push(`event_id;${eid ?? ''}`)
  csvRows.push(`anzahl_verkaeufe;${sales.length}`)
  csvRows.push(`anzahl_stornos;${stornoCount}`)
  csvRows.push(`storno_summe_cents;${stornoTotal}`)
  csvRows.push(`kassen_soll_cents;${cash}`)
  csvRows.push(`kassen_ist_cents;${params.actualCashDrawerCents ?? ''}`)
  csvRows.push(
    `kassen_diff_cents;${params.actualCashDrawerCents == null ? '' : params.actualCashDrawerCents - cash}`,
  )
  csvRows.push('')
  csvRows.push('kategorie;umsatz_cents')
  for (const x of byCategory) csvRows.push(`${csvEscape(x.categoryId)};${x.totalCents}`)
  fs.writeFileSync(csvAbs, csvRows.join('\n'), 'utf8')

  const doc = new PDFDocument({ size: 'A4', margin: 40 })
  const out = fs.createWriteStream(pdfAbs)
  doc.pipe(out)
  doc.fontSize(18).text(`Tagesabschluss ${String(closingNo).padStart(6, '0')}`)
  doc.moveDown(0.5)
  doc.fontSize(11).text(`Datum: ${params.day}`)
  if (eid) doc.text(`Veranstaltungs-ID: ${eid}`)
  doc.text(`Zeitraum: ${new Date(periodStart).toLocaleString('de-DE')} - ${new Date(periodEnd).toLocaleString('de-DE')}`)
  doc.text(`Verkäufe: ${sales.length} | Stornos: ${stornoCount}`)
  doc.text(`Gesamtumsatz: ${fmtEur(total)}`)
  doc.text(`Bar: ${fmtEur(cash)} | Karte: ${fmtEur(card)} | Rechnung: ${fmtEur(invoice)}`)
  doc.text(`Storno-Summe: ${fmtEur(stornoTotal)}`)
  if (params.actualCashDrawerCents != null) {
    doc.text(`Kassen-Ist: ${fmtEur(params.actualCashDrawerCents)}`)
    doc.text(`Differenz: ${fmtEur(params.actualCashDrawerCents - cash)}`)
  }
  doc.moveDown(0.8)
  doc.text(`Kassierer: ${users.join(', ') || '-'}`)
  doc.moveDown(0.8)
  doc.text('Nach Kategorie')
  for (const x of byCategory) doc.text(`- ${x.categoryId}: ${fmtEur(x.totalCents)}`)
  doc.moveDown(1)
  doc.fontSize(8).fillColor('#555').text('Testsystem - nicht für steuerlich produktiven Echtbetrieb freigegeben.')
  doc.end()

  const done = new Promise<void>((resolve, reject) => {
    out.on('finish', () => resolve())
    out.on('error', reject)
  })

  return done.then(() => {
    params.db
      .prepare(
        `INSERT INTO day_closings (
          id, closing_number, day_key, period_start, period_end, gross_total_cents, cash_total_cents,
          card_total_cents, invoice_total_cents, storno_count, storno_total_cents, sales_count,
          users_json, by_category_json, expected_cash_drawer_cents, actual_cash_drawer_cents,
          drawer_diff_cents, csv_rel_path, pdf_rel_path, created_by_user_id, created_at, event_id
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        closingNo,
        params.day,
        periodStart,
        periodEnd,
        total,
        cash,
        card,
        invoice,
        stornoCount,
        stornoTotal,
        sales.length,
        JSON.stringify(users),
        JSON.stringify(byCategory),
        cash,
        params.actualCashDrawerCents ?? null,
        params.actualCashDrawerCents == null ? null : params.actualCashDrawerCents - cash,
        csvRel,
        pdfRel,
        params.user.sub,
        Date.now(),
        eid,
      )

    const ids = sales.map((s) => String(s.id))
    const upd = params.db.prepare(`UPDATE sales SET lifecycle_status = 'closed_day' WHERE id = ?`)
    const tx = params.db.transaction(() => {
      for (const saleId of ids) upd.run(saleId)
    })
    tx()

    appendAudit({
      db: params.db,
      dataRoot: params.dataRoot,
      type: 'daily_closing_created',
      userId: params.user.sub,
      payload: { closingId: id, closingNumber: closingNo, day: params.day },
    })
    return { id, closingNumber: closingNo, csvRelPath: csvRel, pdfRelPath: pdfRel }
  })
}

export function exportRecords(params: {
  db: BetterSqlite3.Database
  dataRoot: string
  user: JwtUser
  fromTs: number
  toTs: number
}) {
  const rows = {
    sales: params.db.prepare(`SELECT * FROM sales WHERE created_at BETWEEN ? AND ?`).all(params.fromTs, params.toTs),
    saleLines: params.db
      .prepare(
        `SELECT sl.* FROM sale_lines sl JOIN sales s ON s.id = sl.sale_id WHERE s.created_at BETWEEN ? AND ?`,
      )
      .all(params.fromTs, params.toTs),
    dayClosings: params.db
      .prepare(`SELECT * FROM day_closings WHERE created_at BETWEEN ? AND ?`)
      .all(params.fromTs, params.toTs),
    products: params.db.prepare(`SELECT * FROM products`).all(),
    users: params.db.prepare(`SELECT id, username, role, created_at FROM users`).all(),
    audit: params.db
      .prepare(`SELECT * FROM audit_events WHERE created_at BETWEEN ? AND ?`)
      .all(params.fromTs, params.toTs),
  }

  const exportsDir = path.join(params.dataRoot, 'exports')
  fs.mkdirSync(exportsDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const rel = `exports/export-${stamp}.zip`
  const abs = path.join(params.dataRoot, rel.replace(/\//g, path.sep))

  const bundle = JSON.stringify(rows)
  const gz = zlib.gzipSync(Buffer.from(bundle, 'utf8'))
  fs.writeFileSync(abs, gz)

  appendAudit({
    db: params.db,
    dataRoot: params.dataRoot,
    type: 'records_export',
    userId: params.user.sub,
    payload: { fromTs: params.fromTs, toTs: params.toTs, relPath: rel },
  })
  return { relPath: rel, size: gz.length }
}
