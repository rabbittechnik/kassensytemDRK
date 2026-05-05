import type BetterSqlite3 from 'better-sqlite3'

export function nextReceiptNo(db: BetterSqlite3.Database): number {
  const row = db
    .prepare(`SELECT COALESCE(MAX(receipt_no), 0) AS m FROM sales`)
    .get() as { m: number }
  return row.m + 1
}

function nextSettingSeq(db: BetterSqlite3.Database, key: string): number {
  const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as
    | { value: string }
    | undefined
  const n = row ? Number.parseInt(row.value, 10) || 1 : 1
  db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`).run(
    key,
    String(n + 1),
  )
  return n
}

export function nextDepositVoucherNo(db: BetterSqlite3.Database, atMs = Date.now()): string {
  const y = new Date(atMs).getFullYear()
  const seq = nextSettingSeq(db, `next_deposit_voucher_no_${y}`)
  return `PF-${y}-${String(seq).padStart(6, '0')}`
}

export function nextHelperConsumptionNo(
  db: BetterSqlite3.Database,
  atMs = Date.now(),
): string {
  const y = new Date(atMs).getFullYear()
  const seq = nextSettingSeq(db, `next_helper_consumption_no_${y}`)
  return `HV-${y}-${String(seq).padStart(6, '0')}`
}

/** RE-YYYY-NNNNNN or ST-YYYY-NNNNNN */
export function nextInvoiceNo(db: BetterSqlite3.Database, kind: 'RE' | 'ST'): string {
  const year = new Date().getFullYear()
  const row = db
    .prepare(
      `SELECT last_seq FROM invoice_sequences WHERE kind = ? AND year = ?`,
    )
    .get(kind, year) as { last_seq: number } | undefined
  const nextSeq = (row?.last_seq ?? 0) + 1
  db
    .prepare(
      `INSERT INTO invoice_sequences (kind, year, last_seq) VALUES (?, ?, ?)
       ON CONFLICT (kind, year) DO UPDATE SET last_seq = excluded.last_seq`,
    )
    .run(kind, year, nextSeq)
  const n = String(nextSeq).padStart(6, '0')
  return `${kind}-${year}-${n}`
}
