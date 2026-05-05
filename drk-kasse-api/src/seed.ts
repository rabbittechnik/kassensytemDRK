import crypto from 'node:crypto'
import type BetterSqlite3 from 'better-sqlite3'
import { sha256Hex } from './lib/pin.js'

const CAT_IDS = {
  drinks: 'cat-getraenke',
  food: 'cat-essen',
  cake: 'cat-kuchen',
} as const

const defaultCategories = [
  { id: CAT_IDS.drinks, name: 'Getränke', sortOrder: 10 },
  { id: CAT_IDS.food, name: 'Essen', sortOrder: 20 },
  { id: CAT_IDS.cake, name: 'Kuchen', sortOrder: 30 },
]

function products(): Array<{
  id: string
  categoryId: string
  name: string
  priceCents: number
  sortOrder: number
}> {
  let o = 0
  const p = (
    id: string,
    categoryId: string,
    name: string,
    priceCents: number,
  ) => ({ id, categoryId, name, priceCents, sortOrder: o++ })
  return [
    p('p-wasser', CAT_IDS.drinks, 'Wasser', 150),
    p('p-cola', CAT_IDS.drinks, 'Cola', 250),
    p('p-fanta', CAT_IDS.drinks, 'Fanta', 250),
    p('p-spezi', CAT_IDS.drinks, 'Spezi', 250),
    p('p-kaffee', CAT_IDS.drinks, 'Kaffee', 200),
    p('p-tee', CAT_IDS.drinks, 'Tee', 200),
    p('p-broetchen', CAT_IDS.food, 'Brötchen', 180),
    p('p-kuchenstueck', CAT_IDS.cake, 'Kuchenstück', 250),
  ]
}

/** Default issuer / tax placeholders for invoicing PDFs */
export const DEFAULT_ISSUER = {
  name: 'DLRG Ortsverein',
  street: '',
  postalCode: '',
  city: '',
  country: 'DE',
  email: '',
  phone: '',
  bankName: '',
  iban: '',
  bic: '',
  taxNumber: '',
  vatId: '',
}

export function seedIfNeeded(
  db: BetterSqlite3.Database,
  opts: {
    adminPinPlain: string
    cashierPinPlain: string
  },
) {
  const u = db.prepare(`SELECT COUNT(*) as c FROM users`).get() as { c: number }
  if (u.c === 0) {
    const aid = crypto.randomUUID()
    const cid = crypto.randomUUID()
    db.prepare(
      `INSERT INTO users (id, username, role, pin_hash, created_at) VALUES (?,?,?,?,?)`,
    ).run(aid, 'admin', 'admin', sha256Hex(opts.adminPinPlain), Date.now())
    db.prepare(
      `INSERT INTO users (id, username, role, pin_hash, created_at) VALUES (?,?,?,?,?)`,
    ).run(cid, 'kasse', 'cashier', sha256Hex(opts.cashierPinPlain), Date.now())
  }

  const pc = db.prepare(`SELECT COUNT(*) as c FROM categories`).get() as { c: number }
  if (pc.c === 0) {
    const ic = db.prepare(
      `INSERT INTO categories (id, name, sort_order) VALUES (?,?,?)`,
    )
    const ip = db.prepare(
      `INSERT INTO products (id, category_id, name, price_cents, active, sort_order, vat_rate_percent, deposit_enabled, deposit_amount, deposit_name, deposit_type)
       VALUES (?,?,?,?,1,?,19,?,?,?,?)`,
    )
    for (const c of defaultCategories) ic.run(c.id, c.name, c.sortOrder)
    for (const p of products()) {
      const isDrinkDeposit = ['p-wasser', 'p-cola', 'p-fanta', 'p-spezi'].includes(p.id)
      ip.run(
        p.id,
        p.categoryId,
        p.name,
        p.priceCents,
        p.sortOrder,
        isDrinkDeposit ? 1 : 0,
        isDrinkDeposit ? 25 : 0,
        isDrinkDeposit ? 'Flasche/Dose' : null,
        isDrinkDeposit ? 'flasche_dose' : null,
      )
    }
  }

  const ins = db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES (?,?)`)
  const defs: [string, string][] = [
    ['org_name', DEFAULT_ISSUER.name],
    ['receipt_footer', 'Vielen Dank für Ihren Einkauf'],
    ['tax_mode', 'vat_liable'],
    ['tax_notice', ''],
    ['issuer_snapshot', JSON.stringify(DEFAULT_ISSUER)],
  ]
  for (const [k, v] of defs) ins.run(k, v)

  ins.run('active_event_id', '')
  ins.run('allow_sales_without_event', '1')
}
