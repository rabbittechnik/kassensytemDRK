/**
 * Demo-Sammelrechnung als PDF (jsPDF) — Layout analog zur Server-Vorlage,
 * ohne Speicherung unter /DATA (nur Browser-Download).
 */
import { jsPDF } from 'jspdf'
import type { DemoInvoice, DemoSale, DemoTeam } from '../demo/demoStore'
import { formatMoney } from './format'

export interface CollectivePdfIssuer {
  orgName?: string
  name?: string
  street?: string
  postalCode?: string
  city?: string
  email?: string
  phone?: string
  bankName?: string
  iban?: string
  bic?: string
  taxNumber?: string
  vatId?: string
}

const RED: [number, number, number] = [200, 16, 46]
const HEADER_SUB: [number, number, number] = [255, 248, 220]
const DEMO_BG: [number, number, number] = [254, 243, 199]
const DEMO_TXT: [number, number, number] = [146, 64, 14]
const TABLE_HEAD: [number, number, number] = [229, 229, 229]
const ALT_ROW: [number, number, number] = [247, 247, 247]

function slugTeam(name: string): string {
  const map: Record<string, string> = {
    ä: 'ae',
    ö: 'oe',
    ü: 'ue',
    Ä: 'Ae',
    Ö: 'Oe',
    Ü: 'Ue',
    ß: 'ss',
  }
  let s = name
  for (const [k, v] of Object.entries(map)) s = s.split(k).join(v)
  return s.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 56) || 'Team'
}

function fmtDate(ts: number): string {
  const d = new Date(ts)
  return new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d)
}

function fmtTime(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function statusDe(s: string): string {
  const u = s.toUpperCase()
  if (u === 'OPEN' || u === 'OFFEN') return 'Offen'
  if (u === 'PAID') return 'Bezahlt'
  if (u === 'STORNO') return 'Storno'
  return s
}

function aggregateByArticle(sales: DemoSale[]): Array<{ name: string; qty: number; cents: number }> {
  const m = new Map<string, { name: string; qty: number; cents: number }>()
  for (const sale of sales) {
    for (const ln of sale.lines) {
      const key = `${ln.name}|${ln.unitPriceCents}`
      const g = m.get(key) ?? { name: ln.name, qty: 0, cents: 0 }
      g.qty += ln.qty
      g.cents += ln.lineTotalCents
      m.set(key, g)
    }
  }
  return [...m.values()].sort((a, b) => a.name.localeCompare(b.name, 'de'))
}

export function demoCollectivePdfFilename(inv: DemoInvoice): string {
  const slug = slugTeam(inv.teamName)
  const safeNo = inv.invoice_no.replace(/[^\w\-]+/g, '_')
  return `${safeNo}-${slug}.pdf`
}

/**
 * Erzeugt das PDF als Blob (Demo — wird nicht auf dem Server gespeichert).
 */
export function generateDemoCollectiveInvoicePdf(
  inv: DemoInvoice,
  sales: DemoSale[],
  team: DemoTeam | undefined,
  issuer?: CollectivePdfIssuer,
): Blob {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const m = 18
  const bottom = pageH - 14
  let y = 0

  const sortedSales = [...sales].sort((a, b) => a.createdAt - b.createdAt)
  const summaryRows = aggregateByArticle(sortedSales)

  const periodStart =
    sortedSales.length > 0
      ? fmtDate(Math.min(...sortedSales.map((s) => s.createdAt)))
      : fmtDate(inv.created_at)
  const periodEnd =
    sortedSales.length > 0
      ? fmtDate(Math.max(...sortedSales.map((s) => s.createdAt)))
      : fmtDate(inv.created_at)

  const pd = team?.paymentTermsDays ?? 14
  const dueTs = inv.created_at + pd * 86400000
  const dueStr = fmtDate(dueTs)

  const ensure = (h: number, onNew: () => void) => {
    if (y + h > bottom) {
      doc.addPage()
      y = m
      onNew()
    }
  }

  const drawCont = () => {
    doc.setFillColor(...TABLE_HEAD)
    doc.rect(m, y, pageW - 2 * m, 8, 'F')
    doc.setTextColor(0, 0, 0)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.text(`Fortsetzung · ${inv.invoice_no} · Positionsliste`, m + 2, y + 5.5)
    y += 10
  }

  const drawDetailHead = () => {
    doc.setFillColor(...TABLE_HEAD)
    doc.rect(m, y, pageW - 2 * m, 7, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    doc.text('Datum', m + 1, y + 5)
    doc.text('Uhrzeit', m + 22, y + 5)
    doc.text('Bon-Nr.', m + 37, y + 5)
    doc.text('Artikel', m + 56, y + 5)
    doc.text('Menge', m + 132, y + 5)
    doc.text('Einzel', m + 148, y + 5)
    doc.text('Gesamt', m + 170, y + 5)
    y += 8
  }

  // Kopfbalken
  doc.setFillColor(...RED)
  doc.rect(0, 0, pageW, 24, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.text('DLRG-SAMMELRECHNUNG', pageW / 2, 12, { align: 'center' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...HEADER_SUB)
  doc.text('Verpflegung / Veranstaltungskasse', pageW / 2, 19, { align: 'center' })

  y = 28

  doc.setFillColor(...DEMO_BG)
  doc.rect(m, y, pageW - 2 * m, 9, 'F')
  doc.setTextColor(...DEMO_TXT)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.text(
    'DEMO-RECHNUNG  ·  NICHT FÜR ECHTBETRIEB  ·  KEINE ZAHLUNG ERFORDERLICH',
    pageW / 2,
    y + 6,
    { align: 'center' },
  )
  y += 13

  doc.setTextColor(26, 26, 26)
  const leftW = (pageW - 2 * m) * 0.52
  const rightX = m + leftW + 6

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.text('Rechnung für:', m, y)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(11)
  doc.text(inv.teamName, m, y + 5)
  let ry = y + 5
  const addr = team?.billingAddress?.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) ?? []
  if (team?.contactName) {
    ry += 6
    doc.setFontSize(9)
    doc.text(`Ansprechpartner: ${team.contactName}`, m, ry)
  }
  for (const line of addr) {
    ry += 5
    doc.text(line, m, ry)
  }

  doc.setFontSize(8)
  let iy = y
  const pairs: [string, string][] = [
    ['Rechnungsnummer:', inv.invoice_no],
    ['Rechnungsdatum:', fmtDate(inv.created_at)],
    ['Leistungszeitraum:', `${periodStart} – ${periodEnd}`],
    ['Veranstaltung:', inv.eventName],
    ['Zahlungsziel:', `${pd} Tage`],
    ['Fällig am:', dueStr],
    ['Status:', statusDe(inv.derivedStatus)],
  ]
  for (const [a, b] of pairs) {
    doc.setTextColor(80, 80, 80)
    doc.text(a, rightX, iy)
    doc.setTextColor(26, 26, 26)
    doc.setFont('helvetica', 'bold')
    doc.text(b, rightX + 44, iy)
    doc.setFont('helvetica', 'normal')
    iy += 4.5
  }

  y = Math.max(ry, iy) + 6
  doc.setDrawColor(200, 200, 200)
  doc.line(m, y, pageW - m, y)
  y += 6

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text('Positionsliste / Einzelkäufe', m, y)
  y += 6
  drawDetailHead()

  let ri = 0
  for (const sale of sortedSales) {
    for (const ln of sale.lines) {
      const rowH = 6
      ensure(rowH + 2, () => {
        drawCont()
        drawDetailHead()
      })
      if (ri % 2 === 1) {
        doc.setFillColor(...ALT_ROW)
        doc.rect(m, y - 1, pageW - 2 * m, rowH + 1, 'F')
      }
      doc.setTextColor(26, 26, 26)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7)
      doc.text(fmtDate(sale.createdAt), m + 1, y + 4)
      doc.text(fmtTime(sale.createdAt), m + 22, y + 4)
      doc.text(sale.bonNumberLabel, m + 37, y + 4)
      doc.text(ln.name, m + 56, y + 4)
      doc.text(String(ln.qty), m + 138, y + 4, { align: 'right' })
      doc.text(formatMoney(ln.unitPriceCents), m + 156, y + 4, { align: 'right' })
      doc.setFont('helvetica', 'bold')
      doc.text(formatMoney(ln.lineTotalCents), m + 178, y + 4, { align: 'right' })
      doc.setFont('helvetica', 'normal')
      y += rowH
      ri += 1
    }
  }

  y += 4
  ensure(40, () => {
    drawCont()
  })

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text('Zusammenfassung nach Artikeln', m, y)
  y += 6

  doc.setFillColor(...TABLE_HEAD)
  doc.rect(m, y, pageW - 2 * m, 6, 'F')
  doc.setFontSize(7)
  doc.text('Artikel', m + 1, y + 4.3)
  doc.text('Gesamtmenge', m + 110, y + 4.3)
  doc.text('Gesamtbetrag', m + 158, y + 4.3)
  y += 8

  for (const r of summaryRows) {
    ensure(7, () => {
      drawCont()
    })
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.text(r.name, m + 1, y + 4)
    doc.text(String(r.qty), m + 118, y + 4, { align: 'right' })
    doc.setFont('helvetica', 'bold')
    doc.text(formatMoney(r.cents), m + 178, y + 4, { align: 'right' })
    doc.setFont('helvetica', 'normal')
    y += 7
  }

  y += 4
  ensure(30, () => {
    drawCont()
  })
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.text(`Gesamtbetrag: ${formatMoney(inv.total_cents)}`, pageW - m, y, { align: 'right' })
  y += 12

  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.text(
    'Bitte überweisen Sie den Rechnungsbetrag unter Angabe der Rechnungsnummer als Verwendungszweck.',
    m,
    y,
    { maxWidth: pageW - 2 * m },
  )
  y += 10
  doc.setFont('helvetica', 'bold')
  doc.text('Verwendungszweck:', m, y)
  doc.setTextColor(...RED)
  doc.text(inv.invoice_no, m + 38, y)
  doc.setTextColor(26, 26, 26)
  y += 8
  doc.text('Bankverbindung:', m, y)
  y += 6
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  const ib = issuer?.iban?.trim()
  const name = issuer?.name?.trim()
  if (ib || issuer?.bankName) {
    if (name) doc.text(`Kontoinhaber: ${name}`, m, y)
    y += 5
    if (issuer?.bankName) doc.text(issuer.bankName, m, y)
    y += 5
    if (ib) doc.text(`IBAN: ${ib}`, m, y)
    y += 5
    if (issuer?.bic?.trim()) doc.text(`BIC: ${issuer.bic}`, m, y)
  } else {
    doc.setTextColor(90, 90, 90)
    doc.text('Bankverbindung bitte in den Einstellungen hinterlegen.', m, y)
  }

  y += 10
  doc.setTextColor(90, 90, 90)
  doc.setFontSize(7.5)
  doc.text(
    'Hinweis: Diese Demo-Rechnung ist eine Simulation. Änderungen im Echtbetrieb erfolgen über Storno- oder Korrekturrechnung.',
    m,
    y,
    { maxWidth: pageW - 2 * m },
  )

  const totalPages = doc.getNumberOfPages()
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p)
    doc.setFontSize(7)
    doc.setTextColor(100, 100, 100)
    const bits = [
      issuer?.orgName?.trim(),
      issuer?.name?.trim(),
      [issuer?.street, [issuer?.postalCode, issuer?.city].filter(Boolean).join(' ')].filter(Boolean).join(', '),
      issuer?.email?.trim(),
      issuer?.phone?.trim() ? `Tel. ${issuer.phone}` : '',
      issuer?.taxNumber?.trim() ? `St.-Nr.: ${issuer.taxNumber}` : '',
      issuer?.vatId?.trim() ? `USt-IdNr.: ${issuer.vatId}` : '',
    ]
      .filter(Boolean)
      .join(' · ')
    doc.text(`DLRG Kasse · Sammelrechnung · Seite ${p} von ${totalPages}`, pageW / 2, pageH - 8, {
      align: 'center',
    })
    if (bits) {
      doc.text(bits, pageW / 2, pageH - 5, { align: 'center', maxWidth: pageW - 2 * m })
    }
  }

  return doc.output('blob')
}
