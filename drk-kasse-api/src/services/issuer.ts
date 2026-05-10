import type BetterSqlite3 from 'better-sqlite3'
import type { IssuerBlock } from './pdfInvoice.js'
import { DEFAULT_ISSUER } from '../seed.js'

export function getIssuer(db: BetterSqlite3.Database): IssuerBlock {
  const row = db
    .prepare(`SELECT value FROM settings WHERE key = 'issuer_snapshot'`)
    .get() as { value: string } | undefined
  if (!row) return { ...DEFAULT_ISSUER }
  try {
    return { ...DEFAULT_ISSUER, ...JSON.parse(row.value) } as IssuerBlock
  } catch {
    return { ...DEFAULT_ISSUER }
  }
}

export function getOrgName(db: BetterSqlite3.Database): string {
  const row = db
    .prepare(`SELECT value FROM settings WHERE key = 'org_name'`)
    .get() as { value: string } | undefined
  return row?.value ?? DEFAULT_ISSUER.name
}

export function getReceiptFooter(db: BetterSqlite3.Database): string {
  const row = db
    .prepare(`SELECT value FROM settings WHERE key = 'receipt_footer'`)
    .get() as { value: string } | undefined
  return row?.value ?? ''
}

export function getTaxSettings(db: BetterSqlite3.Database): {
  taxMode: string
  taxNotice: string
} {
  const m =
    (
      db
        .prepare(`SELECT value FROM settings WHERE key = 'tax_mode'`)
        .get() as { value: string } | undefined
    )?.value ?? 'vat_liable'
  const n =
    (
      db
        .prepare(`SELECT value FROM settings WHERE key = 'tax_notice'`)
        .get() as { value: string } | undefined
    )?.value ?? ''
  return { taxMode: m, taxNotice: n }
}
