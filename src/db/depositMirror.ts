import { db } from './database'
import { getSetting } from './sales'
import type { ProductRow } from '../types'

export const PFAND_PAYOUT_CATEGORY_SETTING = 'pfand_payout_category_id'

export async function getPfandPayoutCategoryId(): Promise<string | null> {
  const v = await getSetting(PFAND_PAYOUT_CATEGORY_SETTING)
  const t = v?.trim()
  return t && t.length > 0 ? t : null
}

async function mirrorsForSource(sourceId: string): Promise<ProductRow[]> {
  return db.products.filter((p) => p.depositMirrorSourceId === sourceId).toArray()
}

export async function removeDepositMirrorsBySourceId(sourceId: string): Promise<void> {
  const mirrors = await mirrorsForSource(sourceId)
  await Promise.all(mirrors.map((m) => db.products.delete(m.id)))
}

/**
 * Pfand-Spiegel in der konfigurierten Pfand-Kategorie anlegen/aktualisieren,
 * wenn der Quellartikel Pfand hat und nicht selbst diese Kategorie ist.
 */
export async function syncDepositMirrorForProduct(productId: string): Promise<void> {
  const pfandCatId = await getPfandPayoutCategoryId()
  const source = await db.products.get(productId)
  if (!source) return

  /** Spiegel-Artikel erzeugen keine weiteren Spiegel */
  if (source.depositMirrorSourceId) return

  const existing = await mirrorsForSource(source.id)

  const depAmount = Math.max(0, Number(source.depositAmount ?? 0))
  const hasDeposit =
    depAmount > 0 &&
    (Boolean(source.depositEnabled) || Number(source.depositAmount ?? 0) > 0)

  async function wipeMirrors(): Promise<void> {
    await removeDepositMirrorsBySourceId(productId)
  }

  if (pfandCatId && source.categoryId === pfandCatId) {
    await wipeMirrors()
    return
  }

  if (!hasDeposit || !pfandCatId) {
    await wipeMirrors()
    return
  }

  const depName = (source.depositName?.trim() || 'Pfand').trim()
  const depType = source.depositType ?? null
  const mirrorName = `Pfand: ${source.name.trim()}`.slice(0, 200)

  const catProducts = await db.products.where('categoryId').equals(pfandCatId).toArray()
  const maxSort = catProducts.reduce((m, p) => Math.max(m, Number(p.sortOrder ?? 0)), 0)

  const basePatch = {
    name: mirrorName,
    categoryId: pfandCatId,
    priceCents: 0,
    active: Boolean(source.active),
    outputGroup: 'keine_ausgabe' as ProductRow['outputGroup'],
    depositEnabled: true,
    depositAmount: depAmount,
    depositName: depName,
    depositType: depType,
    depositMirrorSourceId: source.id,
    imageUrl: null,
  }

  const primary = existing[0]
  if (primary) {
    await db.products.update(primary.id, basePatch)
    await Promise.all(
      existing.slice(1).map((m) => db.products.delete(m.id)),
    )
  } else {
    await db.products.add({
      id: crypto.randomUUID(),
      sortOrder: maxSort + 10,
      ...basePatch,
    })
  }
}
