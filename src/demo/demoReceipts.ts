import { asciiReceipt, formatMoney } from '../lib/format'
import type { PaymentMethod } from '../types'
import type { DemoSaleLine } from './demoStore'

/**
 * Bonformat fuer den Demo-Modus.
 * Klar gekennzeichnet, keine Persistenz, keine TSE-Transaktion.
 */

const WIDTH = 32

function pad(s: string, w: number): string {
  const t = s.slice(0, w)
  return t + ' '.repeat(Math.max(0, w - t.length))
}
function lpad(s: string, w: number): string {
  const t = s.slice(0, w)
  return ' '.repeat(Math.max(0, w - t.length)) + t
}
function center(s: string, w: number): string {
  const t = s.slice(0, w)
  if (t.length >= w) return t
  const left = Math.floor((w - t.length) / 2)
  return ' '.repeat(left) + t + ' '.repeat(w - t.length - left)
}
function fill(ch: string, w: number): string {
  return ch.repeat(w)
}

function payCustomer(p: PaymentMethod): string {
  if (p === 'cash') return 'BAR SIMULIERT'
  if (p === 'card') return 'KARTE SIMULIERT'
  return 'AUF RECHNUNG (DEMO)'
}
export interface DemoReceiptInput {
  bonNumberLabel: string
  createdAt: number
  lines: DemoSaleLine[]
  totalCents: number
  paymentMethod: PaymentMethod
  teamName?: string
  orgTitle?: string
}

export function formatDemoCustomerReceipt(p: DemoReceiptInput): string {
  const w = WIDTH
  const out: string[] = []
  out.push(center('*** DEMO-BON ***', w))
  out.push(center('NICHT FUER ECHTBETRIEB', w))
  out.push('')
  out.push(center(asciiReceipt(p.orgTitle ?? 'DLRG KASSE').toUpperCase(), w))
  out.push(`Bon: ${p.bonNumberLabel}`)
  out.push(
    `Datum: ${new Intl.DateTimeFormat('de-DE', {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(p.createdAt))}`,
  )
  out.push(fill('-', w))
  for (const l of p.lines) {
    const total = formatMoney(l.lineTotalCents).replace('€', 'EUR')
    const head = `${l.qty}x ${asciiReceipt(l.name)}`
    const tail = ` ${total}`
    const maxHead = Math.max(8, w - tail.length)
    out.push((pad(head, maxHead) + tail).slice(0, w))
  }
  out.push(fill('-', w))
  out.push(lpad(`Gesamt: ${formatMoney(p.totalCents).replace('€', 'EUR')}`, w))
  out.push(`Zahlung: ${payCustomer(p.paymentMethod)}`)
  if (p.paymentMethod === 'invoice' && p.teamName?.trim()) {
    out.push(`Team:    ${asciiReceipt(p.teamName.trim())}`)
  }
  out.push(fill('-', w))
  out.push('Keine echte Zahlung.')
  out.push('Keine Buchung gespeichert.')
  out.push('TSE: DEMO - keine TSE-Transaktion')
  return out.join('\n')
}

export function formatDemoTestPrint(orgTitle = 'DLRG KASSE'): string {
  const w = WIDTH
  const out: string[] = []
  out.push(center('*** TESTDRUCK ***', w))
  out.push('')
  out.push(center(asciiReceipt(orgTitle).toUpperCase(), w))
  out.push('')
  out.push('Drucker funktioniert.')
  out.push(
    new Intl.DateTimeFormat('de-DE', {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date()),
  )
  out.push('Keine Buchung.')
  out.push(fill('-', w))
  out.push(center('DEMO-MODUS', w))
  out.push(center('NICHT FUER ECHTBETRIEB', w))
  return out.join('\n')
}
