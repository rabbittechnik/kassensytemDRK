import { sha256Hex } from '../lib/pin'
import { db } from './database'
import { defaultOutputGroupForProduct } from './productOutputDefaults'

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

function defaultProducts(): {
  id: string
  categoryId: string
  name: string
  priceCents: number
  sortOrder: number
}[] {
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
    p('p-apfelschorle', CAT_IDS.drinks, 'Apfelschorle', 250),
    p('p-energy', CAT_IDS.drinks, 'Energy', 300),
    p('p-eistee', CAT_IDS.drinks, 'Eistee', 250),
    p('p-limo', CAT_IDS.drinks, 'Limo', 250),
    p('p-orangensaft', CAT_IDS.drinks, 'Orangensaft', 250),
    p('p-bitterlemon', CAT_IDS.drinks, 'Bitter Lemon', 250),
    p('p-rote', CAT_IDS.food, 'Rote Wurst', 350),
    p('p-curry', CAT_IDS.food, 'Currywurst', 450),
    p('p-pommes', CAT_IDS.food, 'Pommes', 300),
    p('p-broetchen', CAT_IDS.food, 'Brötchen', 180),
    p('p-veg', CAT_IDS.food, 'Vegetarisches Gericht', 500),
    p('p-kuchenstueck', CAT_IDS.cake, 'Kuchenstück', 250),
    p('p-torte', CAT_IDS.cake, 'Torte', 350),
    p('p-muffin', CAT_IDS.cake, 'Muffin', 200),
    p('p-kk', CAT_IDS.cake, 'Kaffee + Kuchen Kombi', 400),
    p('p-maultaschen-burger', CAT_IDS.food, 'Maultaschen-Burger', 600),
  ]
}

function defaultDepositForProduct(id: string): {
  depositEnabled: boolean
  depositAmount: number
  depositName: string | null
  depositType: 'flasche_dose' | 'becher' | 'schale' | 'teller' | 'sonstiges' | null
} {
  if (
    [
      'p-wasser',
      'p-cola',
      'p-fanta',
      'p-spezi',
      'p-apfelschorle',
      'p-energy',
      'p-eistee',
      'p-limo',
      'p-orangensaft',
      'p-bitterlemon',
    ].includes(id)
  ) {
    return { depositEnabled: true, depositAmount: 25, depositName: 'Flasche/Dose', depositType: 'flasche_dose' }
  }
  return { depositEnabled: false, depositAmount: 0, depositName: null, depositType: null }
}

/** Zusätzliche Artikel & DLRG-Branding für bestehende Installationen */
async function migrateDlrgExtras(): Promise<void> {
  const org = await db.settings.get('orgName')
  if (org?.value === 'DRK') {
    await db.settings.put({ key: 'orgName', value: 'DLRG' })
  }
  const last = (await db.products.orderBy('sortOrder').last())?.sortOrder ?? 0
  let o = last + 10
  const extras = defaultProducts().filter((row) =>
    [
      'p-apfelschorle',
      'p-energy',
      'p-eistee',
      'p-limo',
      'p-orangensaft',
      'p-bitterlemon',
    ].includes(row.id),
  )
  for (const row of extras) {
    const exists = await db.products.get(row.id)
    if (!exists) {
      await db.products.add({
        ...row,
        sortOrder: o,
        active: true,
        outputGroup: defaultOutputGroupForProduct(row.id, row.name),
        ...defaultDepositForProduct(row.id),
      })
      o += 10
    } else if (!exists.outputGroup) {
      await db.products.update(row.id, {
        outputGroup: defaultOutputGroupForProduct(row.id, row.name),
      })
    }
  }
}

async function ensureEventSettings(): Promise<void> {
  const defs: [string, string][] = [
    ['active_event_id', ''],
    ['allow_sales_without_event', '1'],
  ]
  for (const [k, v] of defs) {
    const ex = await db.settings.get(k)
    if (!ex) await db.settings.put({ key: k, value: v })
  }
}

async function ensureBonSettings(): Promise<void> {
  const defs: [string, string][] = [
    ['receiptWidthMm', '58'],
    ['printCustomerReceipt', '1'],
    ['printServingReceipt', '1'],
    ['printOutputBons', '1'],
    ['printOutputBonGetraenke', '1'],
    ['printOutputBonKuchen', '1'],
    ['printOutputBonHeiss', '1'],
    ['demoAutoPrintReceipts', '0'],
    ['deposit_feature_enabled', '1'],
    ['deposit_default_amount', '25'],
    ['deposit_auto_print_voucher', '1'],
    ['deposit_print_redemption_receipt', '0'],
    ['deposit_show_on_output_bons', '0'],
    ['helpers_deposit_enabled', '0'],
    ['preferredDataMode', 'offline'],
    [
      'receiptTagline',
      'Fuer ECHT. Wenn keiner damit rechnet, sind WIR da.',
    ],
    ['registerName', 'Hauptkasse'],
    ['cashierName', 'Admin'],
  ]
  for (const [k, v] of defs) {
    const ex = await db.settings.get(k)
    if (!ex) await db.settings.put({ key: k, value: v })
  }
}

export async function ensureSeed(): Promise<void> {
  const n = await db.categories.count()
  if (n === 0) {
    await db.transaction('rw', db.categories, db.products, db.settings, async () => {
      for (const c of defaultCategories) {
        await db.categories.add(c)
      }
      for (const row of defaultProducts()) {
        await db.products.add({
          ...row,
          active: true,
          outputGroup: defaultOutputGroupForProduct(row.id, row.name),
          ...defaultDepositForProduct(row.id),
        })
      }
      const hash = await sha256Hex('1234')
      await db.settings.bulkPut([
        { key: 'seedVersion', value: '2' },
        { key: 'orgName', value: 'DLRG' },
        { key: 'receiptFooter', value: 'Vielen Dank für Ihren Einkauf' },
        { key: 'nextReceiptNo', value: '1' },
        { key: 'adminPinHash', value: hash },
        { key: 'sumupNote', value: 'Betrag in SumUp / SIM-App eingeben und Kartenzahlung am Gerät durchführen.' },
      ])
    })
  } else {
    const hasPin = await db.settings.get('adminPinHash')
    if (!hasPin) {
      const hash = await sha256Hex('1234')
      await db.settings.put({ key: 'adminPinHash', value: hash })
    }
    await migrateDlrgExtras()
  }
  await ensureBonSettings()
  await ensureEventSettings()
}
