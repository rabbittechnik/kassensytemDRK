import { format } from 'date-fns'
import { de } from 'date-fns/locale'
import { jsPDF } from 'jspdf'
import { formatMoney } from '../lib/format'
import type { DemoSale } from '../demo/demoStore'

/**
 * Export-Funktionen fuer den Demo-Modus.
 * Lesen ausschliesslich Demo-Sales aus dem in-memory Store - niemals
 * db.sales / db.saleLines. Erzeugte Dateien sind klar als Demo markiert.
 */

function escapeCsvCell(s: string): string {
  if (/[",;\n]/.test(s)) return `"${s.replaceAll('"', '""')}"`
  return s
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

export function exportDemoSalesCsv(dayKey: string, sales: DemoSale[]): void {
  const dayly = sales
    .filter((s) => s.dayKey === dayKey)
    .sort((a, b) => a.createdAt - b.createdAt)

  const lines: string[] = [
    '# *** DEMO-EXPORT - NICHT FUER ECHTBETRIEB ***',
    'BonNr;Tag;BetragEUR;Zahlart;Zeitstempel',
  ]
  for (const s of dayly) {
    const ts = format(new Date(s.createdAt), 'dd.MM.yyyy HH:mm', { locale: de })
    const pay =
      s.paymentMethod === 'cash'
        ? 'BAR (DEMO)'
        : s.paymentMethod === 'card'
          ? 'KARTE (DEMO)'
          : 'RECHNUNG (DEMO)'
    lines.push(
      [
        escapeCsvCell(s.bonNumberLabel),
        escapeCsvCell(s.dayKey),
        escapeCsvCell((s.totalCents / 100).toFixed(2).replace('.', ',')),
        escapeCsvCell(pay),
        escapeCsvCell(ts),
      ].join(';'),
    )
  }

  lines.push('')
  lines.push('BonNr;Datum;Kategorie;Artikel;Menge;Einzel;Zeile')
  for (const s of dayly) {
    for (const li of s.lines) {
      lines.push(
        [
          escapeCsvCell(s.bonNumberLabel),
          escapeCsvCell(s.dayKey),
          escapeCsvCell(li.categoryName),
          escapeCsvCell(li.name),
          escapeCsvCell(String(li.qty)),
          escapeCsvCell((li.unitPriceCents / 100).toFixed(2).replace('.', ',')),
          escapeCsvCell((li.lineTotalCents / 100).toFixed(2).replace('.', ',')),
        ].join(';'),
      )
    }
  }

  const blob = new Blob([lines.join('\n')], {
    type: 'text/csv;charset=utf-8',
  })
  downloadBlob(blob, `demo-dlrg-verkaeufe-${dayKey}.csv`)
}

export function exportDemoDayReportPdf(dayKey: string, sales: DemoSale[]): void {
  const dayly = sales.filter((s) => s.dayKey === dayKey)
  const total = dayly.reduce((s, x) => s + x.totalCents, 0)
  const byCat = new Map<string, number>()
  for (const s of dayly) {
    for (const l of s.lines) {
      byCat.set(l.categoryName, (byCat.get(l.categoryName) ?? 0) + l.lineTotalCents)
    }
  }

  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  let y = 18
  doc.setFontSize(14)
  doc.setTextColor(180, 0, 0)
  doc.text('*** DEMO-TAGESABSCHLUSS - NICHT FUER ECHTBETRIEB ***', 20, y)
  y += 10
  doc.setTextColor(0, 0, 0)
  doc.setFontSize(16)
  doc.text('DLRG – DEMO-Tagesübersicht', 20, y)
  y += 10
  doc.setFontSize(11)
  doc.text(`Tag: ${dayKey}`, 20, y)
  y += 8
  doc.text(`Demo-Verkäufe: ${dayly.length}`, 20, y)
  y += 8
  doc.text(`Summe (DEMO): ${formatMoney(total)}`, 20, y)
  y += 12
  doc.setFontSize(12)
  doc.text('Nach Kategorie (DEMO)', 20, y)
  y += 8
  doc.setFontSize(10)
  for (const [k, cents] of [...byCat.entries()].sort((a, b) =>
    a[0].localeCompare(b[0], 'de'),
  )) {
    doc.text(`${k}: ${formatMoney(cents)}`, 24, y)
    y += 6
    if (y > 270) {
      doc.addPage()
      y = 20
    }
  }

  doc.save(`demo-dlrg-tagesbericht-${dayKey}.pdf`)
}
