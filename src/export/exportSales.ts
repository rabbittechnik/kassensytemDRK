import { format } from 'date-fns'
import { de } from 'date-fns/locale'
import { jsPDF } from 'jspdf'
import { db } from '../db/database'
import { formatMoney } from '../lib/format'

function escapeCsvCell(s: string): string {
  if (/[",;\n]/.test(s)) return `"${s.replaceAll('"', '""')}"`
  return s
}

export async function exportSalesCsv(dayKey?: string): Promise<void> {
  const sales = dayKey
    ? await db.sales.where('dayKey').equals(dayKey).toArray()
    : await db.sales.orderBy('createdAt').toArray()
  sales.sort((a, b) => a.createdAt - b.createdAt)

  const lines: string[] = ['BonNr;Tag;BetragEUR;Zahlart;Zeitstempel']
  for (const s of sales) {
    const ts = format(new Date(s.createdAt), 'dd.MM.yyyy HH:mm', { locale: de })
    const pay = s.paymentMethod === 'cash' ? 'Bar' : 'Karte'
    lines.push(
      [
        escapeCsvCell(String(s.receiptNo)),
        escapeCsvCell(s.dayKey),
        escapeCsvCell((s.totalCents / 100).toFixed(2).replace('.', ',')),
        escapeCsvCell(pay),
        escapeCsvCell(ts),
      ].join(';'),
    )
  }

  const detailHeader =
    'BonNr;Datum;Kategorie;Artikel;Menge;Einzel;Zeile'
  const detailLines: string[] = []
  for (const s of sales) {
    const slines = await db.saleLines
      .where('saleId')
      .equals(s.id)
      .toArray()
    for (const li of slines) {
      const cat = await db.categories.get(li.categoryId)
      detailLines.push(
        [
          escapeCsvCell(String(s.receiptNo)),
          escapeCsvCell(s.dayKey),
          escapeCsvCell(cat?.name ?? li.categoryId),
          escapeCsvCell(li.name),
          escapeCsvCell(String(li.qty)),
          escapeCsvCell((li.unitPriceCents / 100).toFixed(2).replace('.', ',')),
          escapeCsvCell((li.lineTotalCents / 100).toFixed(2).replace('.', ',')),
        ].join(';'),
      )
    }
  }

  const out = [lines.join('\n'), '', detailHeader, ...detailLines].join('\n')
  const blob = new Blob([out], { type: 'text/csv;charset=utf-8' })
  const name = dayKey
    ? `dlrg-verkaeufe-${dayKey}.csv`
    : `dlrg-verkaeufe-${format(new Date(), 'yyyyMMdd-HHmm')}.csv`
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

export async function exportDayReportPdf(dayKey: string): Promise<void> {
  const sales = await db.sales.where('dayKey').equals(dayKey).toArray()
  const total = sales.reduce((s, x) => s + x.totalCents, 0)
  const cashTotal = sales
    .filter((s) => s.paymentMethod === 'cash')
    .reduce((a, s) => a + s.totalCents, 0)
  const cardTotal = sales
    .filter((s) => s.paymentMethod === 'card')
    .reduce((a, s) => a + s.totalCents, 0)
  const invoiceTotal = sales
    .filter((s) => s.paymentMethod === 'invoice')
    .reduce((a, s) => a + s.totalCents, 0)

  const lines = await db.saleLines.toArray()
  const dayLines = lines.filter((l) => {
    const sale = sales.find((s) => s.id === l.saleId)
    return !!sale
  })

  const byCat = new Map<string, number>()
  for (const l of dayLines) {
    const cat = await db.categories.get(l.categoryId)
    const name = cat?.name ?? 'Sonstiges'
    byCat.set(name, (byCat.get(name) ?? 0) + l.lineTotalCents)
  }

  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  let y = 20
  doc.setFontSize(16)
  doc.text('DLRG – Tagesübersicht', 20, y)
  y += 10
  doc.setFontSize(11)
  doc.text(`Tag: ${dayKey}`, 20, y)
  y += 8
  doc.text(`Verkäufe: ${sales.length}`, 20, y)
  y += 8
  doc.text(`Summe: ${formatMoney(total)}`, 20, y)
  y += 8
  doc.text(`Bar: ${formatMoney(cashTotal)}`, 20, y)
  y += 6
  doc.text(`Karte: ${formatMoney(cardTotal)}`, 20, y)
  y += 6
  doc.text(`Auf Rechnung: ${formatMoney(invoiceTotal)}`, 20, y)
  y += 12
  doc.setFontSize(12)
  doc.text('Nach Kategorie', 20, y)
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

  doc.save(`dlrg-tagesbericht-${dayKey}.pdf`)
}
