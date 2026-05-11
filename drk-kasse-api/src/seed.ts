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

/** Feste IDs: INSERT OR IGNORE bei jedem Start – fehlende Vereine nachziehen, keine Duplikate. */
const DEFAULT_TEAMS: Array<{
  id: string
  name: string
  shortName: string
  billingAddress: string
  invoiceEmail: string
}> = [
  {
    id: 'team-dlrg-bezirk-tuebingen',
    name: 'DLRG Bezirk Tübingen',
    shortName: 'Bezirk Tübingen',
    billingAddress: 'Mühlbachstr. 8, 72411 Bodelshausen',
    invoiceEmail: 'info@bez-tuebingen.dlrg.de',
  },
  {
    id: 'team-dlrg-og-dettenhausen',
    name: 'DLRG Ortsgruppe Dettenhausen',
    shortName: 'Dettenhausen',
    billingAddress: 'Birkenwaldstr. 8, 72135 Dettenhausen',
    invoiceEmail: 'info@dettenhausen.dlrg.de',
  },
  {
    id: 'team-dlrg-og-kirchentellinsfurt',
    name: 'DLRG Ortsgruppe Kirchentellinsfurt',
    shortName: 'Kirchentellinsfurt',
    billingAddress: 'Neue Steige 25, 72138 Kirchentellinsfurt',
    invoiceEmail: 'info@kirchentellinsfurt.dlrg.de',
  },
  {
    id: 'team-dlrg-og-moessingen',
    name: 'DLRG Ortsgruppe Mössingen',
    shortName: 'Mössingen',
    billingAddress: 'Albblickstraße 35, 72116 Mössingen',
    invoiceEmail: 'info@moessingen.dlrg.de',
  },
  {
    id: 'team-dlrg-og-rottenburg',
    name: 'DLRG Ortsgruppe Rottenburg',
    shortName: 'Rottenburg',
    billingAddress: 'Sülchenstraße 24, 72108 Rottenburg',
    invoiceEmail: 'info@rottenburg.dlrg.de',
  },
  {
    id: 'team-dlrg-og-tuebingen',
    name: 'DLRG Ortsgruppe Tübingen',
    shortName: 'Tübingen',
    billingAddress: 'Karlstr. 2/1, 72072 Tübingen',
    invoiceEmail: 'info@tuebingen.dlrg.de',
  },
]

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

  const insTeam = db.prepare(
    `INSERT OR IGNORE INTO teams (
      id, name, short_name, contact_name, invoice_email, phone, billing_address,
      customer_no, internal_note, active, default_payment_days,
      cost_center, department, local_group, created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
  const nowTeams = Date.now()
  for (const t of DEFAULT_TEAMS) {
    insTeam.run(
      t.id,
      t.name,
      t.shortName,
      '',
      t.invoiceEmail,
      '',
      t.billingAddress,
      null,
      '',
      1,
      14,
      null,
      null,
      null,
      nowTeams,
      nowTeams,
    )
  }
}
