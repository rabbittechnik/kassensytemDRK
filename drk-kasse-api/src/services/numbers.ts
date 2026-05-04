import type BetterSqlite3 from 'better-sqlite3'

export function nextReceiptNo(db: BetterSqlite3.Database): number {
  const row = db
    .prepare(`SELECT COALESCE(MAX(receipt_no), 0) AS m FROM sales`)
    .get() as { m: number }
  return row.m + 1
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
