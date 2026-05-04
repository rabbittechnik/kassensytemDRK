import { asciiReceipt, formatMoney } from '../lib/format'
import type { PaymentMethod } from '../types'

/** ESC/POS Hilfsroutinen – viele Bondrucker verstehen CP437/ASCII; Umlaute werden transkribiert. */
const ESC = 0x1b
const GS = 0x1d

function initBuffer(): number[] {
  return [
    ESC,
    0x40, // init
  ]
}

function line(parts: string[]): Uint8Array {
  const text = parts.join('').trimEnd() + '\n'
  const ascii = asciiReceipt(text)
  return new TextEncoder().encode(ascii)
}

export interface ReceiptPayload {
  orgName: string
  createdAt: number
  receiptNo: number
  lines: { name: string; qty: number; unitCents: number; lineCents: number }[]
  totalCents: number
  payment: PaymentMethod
  footer?: string
}

export function buildEscPosBytes(payload: ReceiptPayload): Uint8Array {
  const chunks: Uint8Array[] = []
  const push = (u: Uint8Array) => chunks.push(u)

  push(new Uint8Array(initBuffer()))
  // Center title
  push(new Uint8Array([ESC, 0x61, 1]))
  push(line([payload.orgName]))
  push(new Uint8Array([ESC, 0x61, 0]))
  push(line(['']))
  const dt = new Date(payload.createdAt).toLocaleString('de-DE')
  push(line([`Bon Nr. ${payload.receiptNo}`]))
  push(line([dt]))
  push(line(['---']))
  for (const l of payload.lines) {
    const left = `${l.qty}x ${l.name}`.slice(0, 22)
    const right = formatMoney(l.lineCents)
    push(line([`${left} ${right}`]))
  }
  push(line(['']))
  push(new Uint8Array([ESC, 0x45, 1])) // bold
  push(line([`SUMME ${formatMoney(payload.totalCents)}`]))
  push(new Uint8Array([ESC, 0x45, 0]))
  const payLabel =
    payload.payment === 'cash'
      ? 'Bar'
      : payload.payment === 'invoice'
        ? 'Auf Rechnung'
        : 'Karte'
  push(line([`Zahlung: ${payLabel}`]))
  if (payload.footer) {
    push(line(['']))
    push(line([payload.footer]))
  }
  push(line(['']))
  push(new Uint8Array([GS, 0x56, 0x41, 3])) // partial cut (may vary by printer)

  const totalLen = chunks.reduce((a, c) => a + c.length, 0)
  const out = new Uint8Array(totalLen)
  let o = 0
  for (const c of chunks) {
    out.set(c, o)
    o += c.length
  }
  return out
}

export function receiptAsPlainText(payload: ReceiptPayload): string {
  const dt = new Date(payload.createdAt).toLocaleString('de-DE')
  const lines: string[] = [
    asciiReceipt(payload.orgName),
    `Bon Nr. ${payload.receiptNo}`,
    dt,
    '---',
  ]
  for (const l of payload.lines) {
    lines.push(
      `${l.qty}x ${asciiReceipt(l.name)}  ${formatMoney(l.lineCents)}`,
    )
  }
  lines.push('', `SUMME ${formatMoney(payload.totalCents)}`)
  const payLabel =
    payload.payment === 'cash'
      ? 'Bar'
      : payload.payment === 'invoice'
        ? 'Auf Rechnung'
        : 'Karte'
  lines.push(`Zahlung: ${payLabel}`)
  if (payload.footer) lines.push('', asciiReceipt(payload.footer))
  return lines.join('\n')
}
