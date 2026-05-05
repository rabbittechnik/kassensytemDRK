import { asciiReceipt, formatMoney } from '../lib/format'
import type { OutputStationKey, PaymentMethod, ProductOutputGroup } from '../types'

export const RECEIPT_COPY_HEADER = '*** KOPIE / NACHDRUCK ***'

export type ReceiptFormatType = 'customer' | 'serving'

export interface ReceiptLineModel {
  /** Für Ausgabe-Bons-Zusammenführung */
  productId?: string
  outputGroup?: ProductOutputGroup
  name: string
  qty: number
  unitCents: number
  lineCents: number
  categoryId: string
  categoryName: string
  categorySort: number
}

/** Reihenfolge beim Drucken mehrerer Ausgabe-Bons. */
export const OUTPUT_STATION_ORDER: OutputStationKey[] = [
  'getraenke',
  'kuchen_suess',
  'heisses_essen',
]

const OUTPUT_STATION_BANNER: Record<OutputStationKey, string> = {
  getraenke: 'AUSGABE GETRÄNKE',
  kuchen_suess: 'AUSGABE KUCHEN/SÜSS',
  heisses_essen: 'AUSGABE HEISSES ESSEN',
}

const OUTPUT_STATION_FOOTER: Record<OutputStationKey, string> = {
  getraenke: 'GETRÄNKE AUSGEBEN',
  kuchen_suess: 'KUCHEN AUSGEBEN',
  heisses_essen: 'ESSEN AUSGEBEN',
}

export function isOutputStationGroup(g?: ProductOutputGroup): g is OutputStationKey {
  return g === 'getraenke' || g === 'kuchen_suess' || g === 'heisses_essen'
}

export interface FormatOutputStationReceiptParams {
  station: OutputStationKey
  widthMm: 58 | 80
  isReprint: boolean
  orgTitle: string
  bonNumberLabel: string
  createdAt: number
  payment: PaymentMethod
  teamName?: string
  lines: { name: string; qty: number }[]
}

export function outputStationStoredTitle(station: OutputStationKey): string {
  return OUTPUT_STATION_BANNER[station]
}

export interface FormatReceiptParams {
  type: ReceiptFormatType
  widthMm: 58 | 80
  isReprint: boolean
  orgTitle: string
  tagline: string
  bonNumberLabel: string
  createdAt: number
  registerLabel: string
  cashierLabel: string
  lines: ReceiptLineModel[]
  totalCents: number
  payment: PaymentMethod
  /** Nur bei Rechnung */
  teamName?: string
  footerThanks: string
  tseSummary?: string
}

export function receiptCharWidth(widthMm: 58 | 80): number {
  return widthMm === 80 ? 48 : 32
}

export function formatBonNumber(createdAt: number, receiptNo: number): string {
  const y = new Date(createdAt).getFullYear()
  return `${y}-${String(receiptNo).padStart(6, '0')}`
}

function padCenter(s: string, w: number): string {
  const t = asciiReceipt(s)
  if (t.length >= w) return t.slice(0, w)
  const pad = w - t.length
  const left = Math.floor(pad / 2)
  return ' '.repeat(left) + t + ' '.repeat(pad - left)
}

function fillLine(ch: string, w: number): string {
  return ch.repeat(Math.max(0, w)).slice(0, w)
}

function payLabelOutputStation(p: PaymentMethod): string {
  if (p === 'cash') return 'BAR BEZAHLT'
  if (p === 'card') return 'KARTE BEZAHLT'
  return 'AUF RECHNUNG'
}

/**
 * Ein Ausgabe-Bon für Getränke / Kuchen / heißes Essen — ohne Einzelpreise.
 */
export function formatOutputStationReceipt(p: FormatOutputStationReceiptParams): string {
  const w = receiptCharWidth(p.widthMm)
  const lines: string[] = []
  const eq = fillLine('=', w)
  if (p.isReprint) {
    lines.push(padCenter(RECEIPT_COPY_HEADER, w))
    lines.push('')
  }
  lines.push(eq)
  lines.push(padCenter(OUTPUT_STATION_BANNER[p.station], w))
  lines.push(padCenter(asciiReceipt(p.orgTitle).toUpperCase(), w))
  lines.push(eq)
  lines.push(`BON: ${p.bonNumberLabel}`)
  lines.push(
    `ZEIT: ${new Intl.DateTimeFormat('de-DE', { timeStyle: 'short' }).format(new Date(p.createdAt))}`,
  )
  lines.push(`ZAHLUNG: ${payLabelOutputStation(p.payment)}`)
  if (p.payment === 'invoice') {
    if (p.teamName?.trim()) {
      lines.push(`TEAM: ${asciiReceipt(p.teamName.trim().toUpperCase())}`)
    }
    lines.push(padCenter('NICHT KASSIEREN', w))
    lines.push(padCenter('AUF TEAMRECHNUNG GEBUCHT', w))
  }
  lines.push(fillLine('-', w))
  for (const row of p.lines) {
    lines.push(`  ${row.qty}x ${asciiReceipt(row.name).toUpperCase()}`)
  }
  lines.push(fillLine('-', w))
  lines.push(padCenter(OUTPUT_STATION_FOOTER[p.station], w))
  lines.push(eq)
  return lines.join('\n')
}

function wrapAscii(text: string, w: number): string[] {
  const t = asciiReceipt(text).trim()
  if (!t) return []
  const words = t.split(/\s+/)
  const out: string[] = []
  let cur = ''
  for (const word of words) {
    const tryLine = cur ? `${cur} ${word}` : word
    if (tryLine.length <= w) cur = tryLine
    else {
      if (cur) out.push(cur)
      cur = word.length > w ? word.slice(0, w) : word
      while (cur.length > w) {
        out.push(cur.slice(0, w))
        cur = cur.slice(w)
      }
    }
  }
  if (cur) out.push(cur)
  return out
}

function payLabelCustomer(p: PaymentMethod): string {
  if (p === 'cash') return 'BAR'
  if (p === 'card') return 'KARTE'
  return 'AUF RECHNUNG'
}

function payLabelServing(p: PaymentMethod): string {
  if (p === 'cash') return 'BAR BEZAHLT'
  if (p === 'card') return 'KARTE BEZAHLT'
  return 'AUF RECHNUNG'
}

/** Öffentliche API: eine flexible zentrale Formatierung. */
export function formatReceipt(p: FormatReceiptParams): string {
  const w = receiptCharWidth(p.widthMm)
  if (p.type === 'customer') return formatCustomerReceipt(p, w)
  return formatServingReceipt(p, w)
}

export type CustomerReceiptParams = Omit<FormatReceiptParams, 'widthMm' | 'type'>
export type ServingReceiptParams = Omit<FormatReceiptParams, 'widthMm' | 'type'>

export function formatCustomerReceipt58mm(p: CustomerReceiptParams): string {
  return formatReceipt({ ...p, widthMm: 58, type: 'customer' })
}

export function formatCustomerReceipt80mm(p: CustomerReceiptParams): string {
  return formatReceipt({ ...p, widthMm: 80, type: 'customer' })
}

export function formatServingReceipt58mm(p: ServingReceiptParams): string {
  return formatReceipt({ ...p, widthMm: 58, type: 'serving' })
}

export function formatServingReceipt80mm(p: ServingReceiptParams): string {
  return formatReceipt({ ...p, widthMm: 80, type: 'serving' })
}

function formatCustomerReceipt(p: FormatReceiptParams, w: number): string {
  const lines: string[] = []
  if (p.isReprint) {
    lines.push(padCenter(RECEIPT_COPY_HEADER, w))
    lines.push('')
  }
  lines.push(padCenter(asciiReceipt(p.orgTitle).toUpperCase(), w))
  for (const ln of wrapAscii(p.tagline, w)) lines.push(padCenter(ln, w))
  lines.push('')
  lines.push(`Bon-Nr: ${p.bonNumberLabel}`)
  lines.push(`Datum: ${new Intl.DateTimeFormat('de-DE', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(p.createdAt))}`)
  lines.push(`Kasse: ${asciiReceipt(p.registerLabel)}`)
  lines.push(`Kassierer: ${asciiReceipt(p.cashierLabel)}`)
  lines.push(fillLine('-', w))
  lines.push('Artikel / Menge / Einzel / Gesamt')
  lines.push(fillLine('-', w))
  for (const row of p.lines) {
    const unit = formatMoney(row.unitCents)
    const tot = formatMoney(row.lineCents)
    const amounts = ` ${unit}  ${tot}`
    const head = `${row.qty}x ${asciiReceipt(row.name)}`
    const maxHead = Math.max(8, w - amounts.length)
    const chunks = wrapAscii(head, maxHead)
    chunks.forEach((chunk, i) => {
      const isLast = i === chunks.length - 1
      lines.push(
        isLast ? (rpad(chunk, w - amounts.length) + amounts).slice(0, w) : chunk.slice(0, w),
      )
    })
  }
  lines.push(fillLine('-', w))
  lines.push(lpad(`Gesamt: ${formatMoney(p.totalCents)}`, w))
  lines.push(`Zahlung: ${payLabelCustomer(p.payment)}`)
  if (p.payment === 'invoice' && p.teamName?.trim()) {
    lines.push(`Team/Verein: ${asciiReceipt(p.teamName.trim())}`)
  }
  lines.push(fillLine('-', w))
  if (p.tseSummary?.trim()) {
    for (const ln of wrapAscii(p.tseSummary.trim(), w)) lines.push(ln)
    lines.push(fillLine('-', w))
  }
  lines.push(asciiReceipt(p.footerThanks))
  lines.push('')
  lines.push(padCenter('DLRG', w))
  return lines.join('\n')
}

function rpad(s: string, len: number): string {
  const t = s.slice(0, len)
  return t + ' '.repeat(Math.max(0, len - t.length))
}

function lpad(s: string, len: number): string {
  const t = s.slice(0, len)
  return ' '.repeat(Math.max(0, len - t.length)) + t
}

function formatServingReceipt(p: FormatReceiptParams, w: number): string {
  const lines: string[] = []
  const eq = fillLine('=', w)
  lines.push(eq)
  lines.push(padCenter('AUSGABE', w))
  lines.push(padCenter(asciiReceipt(p.orgTitle).toUpperCase(), w))
  lines.push(eq)
  if (p.isReprint) {
    lines.push(padCenter(RECEIPT_COPY_HEADER, w))
  }
  lines.push(`BON: ${p.bonNumberLabel}`)
  lines.push(
    `ZEIT: ${new Intl.DateTimeFormat('de-DE', { timeStyle: 'short' }).format(new Date(p.createdAt))}`,
  )
  lines.push(`ZAHLUNG: ${payLabelServing(p.payment)}`)
  if (p.payment === 'invoice' && p.teamName?.trim()) {
    lines.push(`TEAM: ${asciiReceipt(p.teamName.trim().toUpperCase())}`)
  }
  lines.push(fillLine('-', w))
  const sorted = [...p.lines].sort((a, b) => {
    if (a.categorySort !== b.categorySort) return a.categorySort - b.categorySort
    return a.categoryName.localeCompare(b.categoryName, 'de')
  })
  let lastCat = ''
  for (const row of sorted) {
    const cat = asciiReceipt(row.categoryName).toUpperCase()
    if (cat !== lastCat) {
      if (lastCat) lines.push('')
      lines.push(cat)
      lastCat = cat
    }
    lines.push(`  ${row.qty}x ${asciiReceipt(row.name).toUpperCase()}`)
  }
  lines.push(fillLine('-', w))
  if (p.payment === 'invoice') {
    lines.push(padCenter('NICHT KASSIEREN', w))
    lines.push(padCenter('AUF TEAMRECHNUNG GEBUCHT', w))
  } else {
    lines.push(padCenter('KOMPLETT AUSGEBEN', w))
  }
  lines.push(eq)
  return lines.join('\n')
}
