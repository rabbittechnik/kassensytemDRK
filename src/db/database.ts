import Dexie, { type EntityTable } from 'dexie'
import type {
  CategoryRow,
  DualReceiptArchiveRow,
  EventRow,
  ProductRow,
  ReceiptReprintLogRow,
  SaleLineRow,
  SaleRow,
} from '../types'
import { defaultOutputGroupForProduct } from './productOutputDefaults'

export interface SettingRow {
  key: string
  value: string
}

export class DrkKasseDB extends Dexie {
  categories!: EntityTable<CategoryRow, 'id'>
  products!: EntityTable<ProductRow, 'id'>
  sales!: EntityTable<SaleRow, 'id'>
  saleLines!: EntityTable<SaleLineRow, 'id'>
  settings!: EntityTable<SettingRow, 'key'>
  dualReceiptArchive!: EntityTable<DualReceiptArchiveRow, 'id'>
  receiptReprintLogs!: EntityTable<ReceiptReprintLogRow, 'id'>
  events!: EntityTable<EventRow, 'id'>

  constructor() {
    super('drk-kasse-v1')
    this.version(1).stores({
      categories: 'id, sortOrder, name',
      products: 'id, categoryId, active, sortOrder, name',
      sales: 'id, dayKey, createdAt, receiptNo',
      saleLines: 'id, saleId, categoryId',
      settings: 'key',
    })
    this.version(2).stores({
      categories: 'id, sortOrder, name',
      products: 'id, categoryId, active, sortOrder, name',
      sales: 'id, dayKey, createdAt, receiptNo',
      saleLines: 'id, saleId, categoryId',
      settings: 'key',
      dualReceiptArchive: 'id, serverSaleId, receiptNo, createdAt',
      receiptReprintLogs: '++id, saleRef, at',
    })
    this.version(3).stores({
      categories: 'id, sortOrder, name',
      products: 'id, categoryId, active, sortOrder, name',
      sales: 'id, dayKey, createdAt, receiptNo, eventId',
      saleLines: 'id, saleId, categoryId',
      settings: 'key',
      dualReceiptArchive: 'id, serverSaleId, receiptNo, createdAt',
      receiptReprintLogs: '++id, saleRef, at',
      events: 'id, status, startDate, endDate, name',
    })
    this.version(4).stores({
      categories: 'id, sortOrder, name',
      products: 'id, categoryId, active, sortOrder, name',
      sales: 'id, dayKey, createdAt, receiptNo, eventId',
      saleLines: 'id, saleId, categoryId',
      settings: 'key',
      dualReceiptArchive: 'id, serverSaleId, receiptNo, createdAt',
      receiptReprintLogs: '++id, saleRef, at',
      events: 'id, status, startDate, endDate, name',
    }).upgrade(async (tx) => {
      const productsTbl = tx.table<ProductRow, string>('products')
      await productsTbl.toCollection().modify((p) => {
        if (!p.outputGroup) {
          p.outputGroup = defaultOutputGroupForProduct(p.id, p.name)
        }
      })
      const burgerId = 'p-maultaschen-burger'
      if ((await productsTbl.get(burgerId)) == null) {
        const cats = await tx.table<CategoryRow>('categories').toArray()
        const catFood = cats.find((c) => c.name === 'Essen')
        const catId = catFood?.id ?? 'cat-essen'
        const allProd = await productsTbl.toArray()
        const last = allProd.reduce((m, p) => Math.max(m, p.sortOrder ?? 0), 0)
        await productsTbl.add({
          id: burgerId,
          categoryId: catId,
          name: 'Maultaschen-Burger',
          priceCents: 600,
          active: true,
          sortOrder: last + 10,
          outputGroup: 'heisses_essen',
        })
      }
      const setTbl = tx.table('settings')
      const legacyPrint = await setTbl.get('printServingReceipt')
      if (legacyPrint && (await setTbl.get('printOutputBons')) == null) {
        await setTbl.put({
          key: 'printOutputBons',
          value: legacyPrint.value === '0' ? '0' : '1',
        })
      }
      for (const key of [
        'printOutputBonGetraenke',
        'printOutputBonKuchen',
        'printOutputBonHeiss',
      ]) {
        const ex = await setTbl.get(key)
        if (!ex) {
          const v = legacyPrint?.value === '0' ? '0' : '1'
          await setTbl.put({ key, value: v })
        }
      }
    })
  }
}

export const db = new DrkKasseDB()
