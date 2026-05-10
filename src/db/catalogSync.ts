/**
 * Zweistufige Katalog-Synchronisation mit dem Server:
 * 1. Optional (nur Rolle admin, nicht DEMO): lokaler IndexedDB-Stamm → Server (/catalog/sync/full).
 * 2. Server-Katalog lesen → IndexedDB übernehmen (Ausgabe-Gruppe/Bild‑URL lokaler Felder soweit möglich behalten).
 *
 * Löschen: Admin ruft DELETE /catalog/products/:id auf (falls online/admin); sonst Warteschlange
 * `catalog_pending_deleted_product_ids`. Beim nächsten Admin-/sync/full werden IDs serverseitig entfernt.
 */
import { ApiError, apiJson } from '../api/http'
import { getStoredRole, getStoredToken, hasApi } from '../api/config'
import { isDemoMode } from '../demo/demoStore'
import type { CategoryRow, ProductRow } from '../types'
import { db } from './database'
import { defaultOutputGroupForProduct } from './productOutputDefaults'

/** Settings-Key (JSON Array von Produkt-IDs); gelöscht offline / bei fehlgeschlagener Server-Löschung */
export const CATALOG_PENDING_DELETED_PRODUCT_IDS = 'catalog_pending_deleted_product_ids'

const MAX_PENDING = 2000

export function parsePendingDeletedProductIdsFromValue(val: string | undefined | null): Set<string> {
  if (!val?.trim()) return new Set()
  try {
    const arr = JSON.parse(val) as unknown
    if (!Array.isArray(arr)) return new Set()
    return new Set(
      arr
        .filter((x): x is string => typeof x === 'string' && x.length > 0)
        .map((id) => id.trim())
        .filter(Boolean),
    )
  } catch {
    return new Set()
  }
}

async function readPendingDeletedProductIds(): Promise<string[]> {
  const row = await db.settings.get(CATALOG_PENDING_DELETED_PRODUCT_IDS)
  return [...parsePendingDeletedProductIdsFromValue(row?.value ?? null)]
}

async function writePendingDeletedProductIds(ids: string[]): Promise<void> {
  const uniq = [...new Set(ids)].slice(0, MAX_PENDING)
  if (uniq.length === 0) {
    await db.settings.delete(CATALOG_PENDING_DELETED_PRODUCT_IDS)
    return
  }
  await db.settings.put({
    key: CATALOG_PENDING_DELETED_PRODUCT_IDS,
    value: JSON.stringify(uniq),
  })
}

async function addPendingDeletedProductId(id: string): Promise<void> {
  const t = id.trim()
  if (!t) return
  const cur = await readPendingDeletedProductIds()
  if (!cur.includes(t)) cur.push(t)
  await writePendingDeletedProductIds(cur)
}

/** Nach erfolgreicher Admin-Synchronisation: Server hat alle Entfernen-Befehle angewendet */
export async function clearPendingDeletedProductIdsAfterSuccessfulPush(): Promise<void> {
  await db.settings.delete(CATALOG_PENDING_DELETED_PRODUCT_IDS)
}

/** Mappt einen /catalog/products-Datensatz (camelCase oder snake_case) auf ProductRow. */
export function mapRemoteCatalogProduct(p: Record<string, unknown>): ProductRow {
  return {
    id: String(p.id),
    categoryId: String(p.categoryId ?? p.category_id),
    name: String(p.name),
    priceCents:
      typeof p.priceCents === 'number'
        ? p.priceCents
        : Number(p.price_cents ?? 0),
    active:
      typeof p.active === 'boolean'
        ? p.active
        : Boolean(Number(p.active ?? 1)),
    sortOrder:
      typeof p.sortOrder === 'number' ? p.sortOrder : Number(p.sort_order ?? 0),
    stockTracking:
      typeof p.stockTracking === 'boolean'
        ? p.stockTracking
        : Boolean(Number(p.stock_tracking ?? 0)),
    stockQty:
      typeof p.stockQty === 'number'
        ? p.stockQty
        : p.stock_qty == null
          ? null
          : Number(p.stock_qty),
    stockMin:
      typeof p.stockMin === 'number'
        ? p.stockMin
        : p.stock_min == null
          ? null
          : Number(p.stock_min),
    depositEnabled:
      typeof p.depositEnabled === 'boolean'
        ? p.depositEnabled
        : Boolean(Number(p.deposit_enabled ?? 0)),
    depositAmount:
      typeof p.depositAmount === 'number'
        ? p.depositAmount
        : Number(p.deposit_amount ?? 0),
    depositType:
      p.depositType == null && p.deposit_type == null ?
        null
      : (String(p.depositType ?? p.deposit_type) as ProductRow['depositType']),
    depositName:
      p.depositName == null && p.deposit_name == null ?
        null
      : String(p.depositName ?? p.deposit_name),
    imageUrl:
      p.imageUrl != null ?
        String(p.imageUrl)
      : p.image_url != null ?
        String(p.image_url)
      : null,
    outputGroup: undefined,
  }
}

export function mapRemoteCategoryRow(raw: Record<string, unknown>): CategoryRow {
  return {
    id: String(raw.id),
    name: String(raw.name),
    sortOrder:
      typeof raw.sortOrder === 'number' ?
        raw.sortOrder
      : Number(raw.sort_order ?? 0),
  }
}

async function pushDexieCatalogToServerAdmin(): Promise<void> {
  const pendingDeletes = await readPendingDeletedProductIds()
  const categories = await db.categories.orderBy('sortOrder').toArray()
  const products = await db.products.toArray()
  await apiJson<{ ok: boolean }>(
    '/catalog/sync/full',
    {
      method: 'POST',
      body: JSON.stringify({
        removedProductIds: pendingDeletes,
        categories: categories.map((c) => ({
          id: c.id,
          name: c.name.trim(),
          sortOrder: Number(c.sortOrder ?? 0),
        })),
        products: products.map((p) => ({
          id: p.id,
          categoryId: p.categoryId,
          name: p.name.trim(),
          priceCents: Math.max(0, Number(p.priceCents ?? 0)),
          active: Boolean(p.active),
          sortOrder: Number(p.sortOrder ?? 0),
          stockTracking: Boolean(p.stockTracking),
          stockQty: p.stockQty == null ? null : Number(p.stockQty),
          stockMin: p.stockMin == null ? null : Number(p.stockMin),
          depositEnabled: Boolean(p.depositEnabled ?? false) || Number(p.depositAmount ?? 0) > 0,
          depositAmount: Math.max(0, Number(p.depositAmount ?? 0)),
          depositName: p.depositName ?? null,
          depositType: p.depositType ?? null,
        })),
      }),
      skipDemoHeader: true,
    },
  )
  await clearPendingDeletedProductIdsAfterSuccessfulPush()
}

/**
 * Produkt lokale löschen und Server informieren:
 * Bei Admin+Online DELETE /catalog/products/:id (404 = bereits weg).
 * Sonst oder bei Fehler: ID in Pending-Liste für nächstes catalog/sync/full.
 */
export async function deleteCatalogProductLocalAndRemote(productId: string): Promise<void> {
  const id = productId.trim()
  if (!id) return

  if (isDemoMode()) {
    await db.products.delete(id)
    return
  }

  let needPending = false
  const jwt = getStoredToken()
  const role = getStoredRole()
  if (hasApi() && jwt && role === 'admin' && !isDemoMode()) {
    try {
      await apiJson<{ ok?: boolean }>(`/catalog/products/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        skipDemoHeader: true,
      })
    } catch (e: unknown) {
      if (e instanceof ApiError && e.status === 404) {
        /* bereits entfernt */
      } else {
        needPending = true
      }
    }
  } else {
    needPending = true
  }

  if (needPending) await addPendingDeletedProductId(id)
  await db.products.delete(id)

  /** Wenn Produkt bereits auf Server wegwar, Pending-Eintrag ggf. entfernen */
  if (!needPending)
    await writePendingDeletedProductIds(
      (await readPendingDeletedProductIds()).filter((x) => x !== id),
    )
}

/** Holt den Server-Katalog und schreibt ihn in IndexedDB (Ausgabe/Bild‑URL vorherige Werte vorrangig). */
export async function pullServerCatalogIntoDexie(): Promise<void> {
  const c = await apiJson<unknown[]>('/catalog/categories')
  const pr = await apiJson<unknown[]>('/catalog/products')

  const pending = await readPendingDeletedProductIds()
  const pendingSet = new Set(pending)

  const rawProducts = Array.isArray(pr) ? pr : []

  /** Solange Pending-Löschen und Server liefert die Zeile noch: nicht zurück in IndexedDB/Pull-Merge schreiben */
  const mergedRaw = rawProducts.filter((row) => {
    const rec = row as Record<string, unknown>
    const id = String(rec.id ?? '')
    return id && !pendingSet.has(id)
  })

  /** Pending-Einträge entfernen, sobald GET sie nicht mehr liefert (Server hat gelöscht) */
  const remoteIdsFull = new Set(
    rawProducts.map((row) => String((row as Record<string, unknown>).id ?? '').trim()).filter(Boolean),
  )
  const stillPending = pending.filter((pid) => remoteIdsFull.has(pid))
  await writePendingDeletedProductIds(stillPending)

  const prev = await db.products.toArray()
  const preserve = new Map<
    string,
    { outputGroup?: ProductRow['outputGroup']; imageUrl?: string | null }
  >(prev.map((p) => [p.id, { outputGroup: p.outputGroup, imageUrl: p.imageUrl ?? null }]))

  const cats: CategoryRow[] = (Array.isArray(c) ? c : []).map((row) =>
    mapRemoteCategoryRow(row as Record<string, unknown>),
  )
  const prods: ProductRow[] = mergedRaw.map((raw) => {
    const row = raw as Record<string, unknown>
    const base = mapRemoteCatalogProduct(row)
    const ex = preserve.get(base.id)
    return {
      ...base,
      outputGroup:
        ex?.outputGroup ?? defaultOutputGroupForProduct(base.id, base.name),
      imageUrl: ex?.imageUrl ?? base.imageUrl ?? null,
    }
  })

  await db.transaction('rw', db.categories, db.products, async () => {
    await db.categories.clear()
    await db.products.clear()
    if (cats.length) await db.categories.bulkPut(cats)
    if (prods.length) await db.products.bulkPut(prods)
  })
}

export type CatalogSyncOutcome = {
  ok: boolean
  /** Lokaler Stamm wurde zum Server geschrieben (nur Admin) */
  pushed: boolean
  error?: string
}

/**
 * Offline-Stamm als Quelle für den Server (Admin), dann Server → IndexedDB.
 * Kassierer: nur Pull vom Server → lokale Datenbank entspricht dem Server-Stamm für Offline später.
 */
export async function syncCatalogBidirectional(): Promise<CatalogSyncOutcome> {
  if (isDemoMode()) {
    return { ok: false, pushed: false, error: 'Im Demo-Modus keine Katalog-Synchronisation.' }
  }

  const role = getStoredRole()
  let pushed = false
  if (role === 'admin') {
    try {
      await pushDexieCatalogToServerAdmin()
      pushed = true
    } catch (e: unknown) {
      const apiErr =
        e instanceof ApiError ? e.message : ((e as Error)?.message ?? String(e))
      return {
        ok: false,
        pushed: false,
        error:
          `${apiErr} — lokale Daten wurden nicht überschrieben (Abbrechen / erneut versuchen).`,
      }
    }
  }

  try {
    await pullServerCatalogIntoDexie()
  } catch (e: unknown) {
    const apiErr =
      e instanceof ApiError ? e.message : ((e as Error)?.message ?? String(e))
    return {
      ok: false,
      pushed,
      error: apiErr || 'Pull fehlgeschlagen.',
    }
  }

  return { ok: true, pushed }
}
