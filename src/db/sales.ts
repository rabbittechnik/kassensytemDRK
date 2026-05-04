import { db } from './database'
import type { CartLine } from '../types'
import type { PaymentMethod } from '../types'
import { todayKey } from '../lib/format'

function uid(): string {
  return crypto.randomUUID()
}

async function getNextReceiptNo(): Promise<number> {
  const row = await db.settings.get('nextReceiptNo')
  const n = row ? parseInt(row.value, 10) || 1 : 1
  await db.settings.put({ key: 'nextReceiptNo', value: String(n + 1) })
  return n
}

export async function saveSale(
  lines: CartLine[],
  paymentMethod: PaymentMethod,
): Promise<{ saleId: string; receiptNo: number; createdAt: number }> {
  if (paymentMethod === 'invoice') {
    throw new Error(
      'Rechnungsverkäufe erfordern die Server-API (VITE_API_BASE_URL + Anmeldung).',
    )
  }

  const totalCents = lines.reduce(
    (s, l) => s + l.priceCents * l.qty,
    0,
  )
  const createdAt = Date.now()
  const dayKey = todayKey(new Date(createdAt))
  const receiptNo = await getNextReceiptNo()
  const saleId = uid()

  await db.transaction('rw', db.sales, db.saleLines, async () => {
    await db.sales.add({
      id: saleId,
      createdAt,
      dayKey,
      totalCents,
      paymentMethod,
      receiptNo,
    })
    for (const l of lines) {
      const cat = await db.products.get(l.productId)
      const categoryId = cat?.categoryId ?? 'unknown'
      await db.saleLines.add({
        id: uid(),
        saleId,
        categoryId,
        productId: l.productId,
        name: l.name,
        qty: l.qty,
        unitPriceCents: l.priceCents,
        lineTotalCents: l.priceCents * l.qty,
      })
    }
  })

  return { saleId, receiptNo, createdAt }
}

export async function getSetting(key: string): Promise<string | undefined> {
  const r = await db.settings.get(key)
  return r?.value
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db.settings.put({ key, value })
}
