import Dexie, { type EntityTable } from 'dexie'
import type {
  CategoryRow,
  DualReceiptArchiveRow,
  ProductRow,
  ReceiptReprintLogRow,
  SaleLineRow,
  SaleRow,
} from '../types'

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
  }
}

export const db = new DrkKasseDB()
