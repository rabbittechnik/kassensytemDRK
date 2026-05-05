import type { ProductOutputGroup } from '../types'

/** Erstzuordnung Ausgabegruppe nach Artikel-ID (Admin überschreibt pro Artikel). */
const BY_PRODUCT_ID: Record<string, ProductOutputGroup> = {
  'p-wasser': 'getraenke',
  'p-cola': 'getraenke',
  'p-fanta': 'getraenke',
  'p-spezi': 'getraenke',
  'p-kaffee': 'getraenke',
  'p-tee': 'getraenke',
  'p-apfelschorle': 'getraenke',
  'p-energy': 'getraenke',
  'p-eistee': 'getraenke',
  'p-limo': 'getraenke',
  'p-orangensaft': 'getraenke',
  'p-bitterlemon': 'getraenke',
  'p-kuchenstueck': 'kuchen_suess',
  'p-torte': 'kuchen_suess',
  'p-muffin': 'kuchen_suess',
  'p-kk': 'kuchen_suess',
  'p-rote': 'heisses_essen',
  'p-curry': 'heisses_essen',
  'p-pommes': 'heisses_essen',
  'p-broetchen': 'heisses_essen',
  'p-veg': 'heisses_essen',
  'p-maultaschen-burger': 'heisses_essen',
}

/**
 * Standard-Ausgabegruppe für Migration/Neuanlage; Kasse liest immer `ProductRow.outputGroup`.
 */
export function defaultOutputGroupForProduct(
  id: string,
  _name?: string,
): ProductOutputGroup {
  return BY_PRODUCT_ID[id] ?? 'keine_ausgabe'
}
