import { asciiReceipt, formatMoney } from '../lib/format'

export type ZBonCategoryLine = { label: string; cents: number }

export function buildZBonPlainText(params: {
  headline: string
  dayKey: string
  closingLine: string
  salesCount: number
  cashCents: number
  cardCents: number
  invoiceCents: number
  grandCents: number
  stornoCount?: number
  stornoTotalCents?: number
  depositBalanceCents?: number
  byCategory: ZBonCategoryLine[]
  tailLines?: string[]
}): string {
  const lines: string[] = []
  lines.push('==============================')
  lines.push(asciiReceipt(params.headline))
  lines.push('==============================')
  lines.push(asciiReceipt(`Tag: ${params.dayKey}`))
  lines.push(asciiReceipt(params.closingLine))
  lines.push('')
  lines.push(asciiReceipt(`Verkaeufe: ${params.salesCount}`))
  lines.push(asciiReceipt(`Summe: ${formatMoney(params.grandCents)}`))
  lines.push(asciiReceipt(`Bar: ${formatMoney(params.cashCents)}`))
  lines.push(asciiReceipt(`Karte: ${formatMoney(params.cardCents)}`))
  lines.push(asciiReceipt(`Rechnung: ${formatMoney(params.invoiceCents)}`))
  if (params.stornoCount != null && params.stornoCount > 0) {
    lines.push(
      asciiReceipt(
        `Stornos: ${params.stornoCount} / ${formatMoney(params.stornoTotalCents ?? 0)}`,
      ),
    )
  }
  if (params.depositBalanceCents != null && params.depositBalanceCents !== 0) {
    lines.push(asciiReceipt(`Pfandsaldo: ${formatMoney(params.depositBalanceCents)}`))
  }
  lines.push('')
  lines.push(asciiReceipt('Nach Kategorie'))
  const cats = [...params.byCategory].sort((a, b) => a.label.localeCompare(b.label, 'de'))
  for (const c of cats) {
    lines.push(asciiReceipt(`${c.label}: ${formatMoney(c.cents)}`))
  }
  lines.push('')
  lines.push(asciiReceipt(`Zeit: ${new Intl.DateTimeFormat('de-DE', { dateStyle: 'short', timeStyle: 'short' }).format(new Date())}`))
  for (const t of params.tailLines ?? []) {
    if (t.trim()) lines.push(asciiReceipt(t))
  }
  lines.push('')
  lines.push(asciiReceipt('--- Ende Z-Bon ---'))
  lines.push('')
  return lines.join('\n')
}
