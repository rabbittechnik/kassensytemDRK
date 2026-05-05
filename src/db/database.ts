import Dexie, { type EntityTable } from 'dexie'
import type {
  CategoryRow,
  DualReceiptArchiveRow,
  EventRow,
  HelperConsumptionItemRow,
  HelperConsumptionRow,
  HelperRow,
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
  helpers!: EntityTable<HelperRow, 'id'>
  helperConsumptions!: EntityTable<HelperConsumptionRow, 'id'>
  helperConsumptionItems!: EntityTable<HelperConsumptionItemRow, 'id'>

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
    this.version(5).stores({
      categories: 'id, sortOrder, name',
      products: 'id, categoryId, active, sortOrder, name, depositEnabled',
      sales: 'id, dayKey, createdAt, receiptNo, eventId, depositVoucherNumber',
      saleLines: 'id, saleId, categoryId, productId',
      settings: 'key',
      dualReceiptArchive: 'id, serverSaleId, receiptNo, createdAt',
      receiptReprintLogs: '++id, saleRef, at',
      events: 'id, status, startDate, endDate, name',
      helpers: 'id, active, name',
      helperConsumptions: 'id, helperGroup, consumptionType, eventId, createdAt, saleLikeNumber',
      helperConsumptionItems: 'id, helperConsumptionId, productId',
    }).upgrade(async (tx) => {
      await tx.table<ProductRow, string>('products').toCollection().modify((p) => {
        if (p.depositEnabled == null) p.depositEnabled = false
        if (p.depositAmount == null) p.depositAmount = 0
        if (p.depositType == null) p.depositType = null
      })
      await tx.table<SaleRow, string>('sales').toCollection().modify((s) => {
        if (s.depositTotalCents == null) s.depositTotalCents = 0
        if (s.depositVoucherNumber == null) s.depositVoucherNumber = null
      })
      await tx.table<SaleLineRow, string>('saleLines').toCollection().modify((l) => {
        if (l.depositAmountCents == null) l.depositAmountCents = 0
        if (l.depositNameSnapshot == null) l.depositNameSnapshot = null
        if (l.depositQty == null) l.depositQty = 0
        if (l.depositTotalCents == null) l.depositTotalCents = 0
      })
    })
    this.version(6).stores({
      categories: 'id, sortOrder, name',
      products: 'id, categoryId, active, sortOrder, name, depositEnabled, depositName',
      sales: 'id, dayKey, createdAt, receiptNo, eventId, depositVoucherNumber',
      saleLines: 'id, saleId, categoryId, productId',
      settings: 'key',
      dualReceiptArchive: 'id, serverSaleId, receiptNo, createdAt',
      receiptReprintLogs: '++id, saleRef, at',
      events: 'id, status, startDate, endDate, name',
      helpers: 'id, active, name',
      helperConsumptions: 'id, helperGroup, consumptionType, eventId, createdAt, saleLikeNumber',
      helperConsumptionItems: 'id, helperConsumptionId, productId',
    }).upgrade(async (tx) => {
      await tx.table<ProductRow, string>('products').toCollection().modify((p) => {
        if (p.depositName == null && (p.depositEnabled || Number(p.depositAmount ?? 0) > 0)) {
          p.depositName = 'Flasche/Dose'
        }
      })
      await tx.table<SaleLineRow, string>('saleLines').toCollection().modify((l) => {
        if (l.depositNameSnapshot == null) l.depositNameSnapshot = null
      })
    })
  }
}

export const db = new DrkKasseDB()
