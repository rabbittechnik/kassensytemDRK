/**
 * Einfaches PDF der Detailansicht „offene Teamrechnung“ (Browser-Download).
 */
import { jsPDF } from 'jspdf'
import { formatMoney } from '../lib/format'
import type { TeamInvoiceDetailsModel } from './teamInvoiceDetailsModel'

function fmtDate(ts: number): string {
  return new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(ts))
}

function fmtTime(ts: number): string {
  return new Intl.DateTimeFormat('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(ts))
}

export function generateOpenTeamInvoiceDetailPdf(model: TeamInvoiceDetailsModel): Blob {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const m = 18
  let y = m

  doc.setFillColor(200, 16, 46)
  doc.rect(0, 0, 210, 16, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(12)
  doc.text('Offene Teamrechnung', 105, 10, { align: 'center' })

  y = 22
  doc.setTextColor(30, 30, 30)
  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')
  doc.text('Team/Verein:', m, y)
  doc.setFont('helvetica', 'normal')
  doc.text(model.teamName, m + 38, y)
  y += 7
  doc.setFont('helvetica', 'bold')
  doc.text('Veranstaltung:', m, y)
  doc.setFont('helvetica', 'normal')
  doc.text(model.eventName, m + 38, y)
  y += 7
  doc.setFont('helvetica', 'bold')
  doc.text('Status:', m, y)
  doc.setFont('helvetica', 'normal')
  doc.text(model.statusLabel, m + 38, y)
  y += 7
  doc.setFont('helvetica', 'bold')
  doc.text('Zeitraum:', m, y)
  doc.setFont('helvetica', 'normal')
  doc.text(
    `${fmtDate(model.firstPurchaseMs)} – ${fmtDate(model.lastPurchaseMs)}`,
    m + 38,
    y,
  )
  y += 10
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.text(`Gesamt offen: ${formatMoney(model.totalOpenCents)}`, m, y)
  y += 12

  doc.setFontSize(9)
  doc.setFont('helvetica', 'bold')
  doc.text('Einzelkäufe', m, y)
  y += 6
  doc.setFontSize(7)
  doc.setFont('helvetica', 'bold')
  doc.text('Datum', m, y)
  doc.text('Uhrzeit', m + 22, y)
  doc.text('Bon', m + 40, y)
  doc.text('Artikel', m + 58, y)
  doc.text('Menge', m + 118, y)
  doc.text('Einzel', m + 132, y)
  doc.text('Gesamt', m + 158, y)
  doc.text('Zahlung', m + 178, y)
  y += 4
  doc.setFont('helvetica', 'normal')
  for (const ln of model.detailLines) {
    if (y > 270) {
      doc.addPage()
      y = m
    }
    doc.text(fmtDate(ln.dateMs), m, y)
    doc.text(fmtTime(ln.dateMs), m + 22, y)
    doc.text(ln.bonLabel, m + 40, y)
    doc.text(ln.articleName.slice(0, 28), m + 58, y)
    doc.text(String(ln.qty), m + 122, y)
    doc.text(formatMoney(ln.unitPriceCents), m + 132, y)
    doc.text(formatMoney(ln.lineTotalCents), m + 158, y)
    doc.text(ln.paymentLabel, m + 178, y)
    y += 5
  }

  y += 6
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.text('Zusammenfassung nach Artikeln', m, y)
  y += 6
  doc.setFontSize(7)
  doc.text('Artikel', m, y)
  doc.text('Menge', m + 110, y)
  doc.text('Betrag', m + 158, y)
  y += 4
  doc.setFont('helvetica', 'normal')
  for (const s of model.summaryRows) {
    if (y > 275) {
      doc.addPage()
      y = m
    }
    doc.text(s.articleName.slice(0, 40), m, y)
    doc.text(String(s.totalQty), m + 118, y)
    doc.text(formatMoney(s.totalCents), m + 158, y)
    y += 5
  }

  return doc.output('blob')
}
