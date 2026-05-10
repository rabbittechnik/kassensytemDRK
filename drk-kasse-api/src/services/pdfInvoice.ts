import fs from 'node:fs'
import path from 'node:path'
import PDFDocument from 'pdfkit'
import QRCode from 'qrcode'
import { formatCentsEUR } from '../pdfMoney.js'

type PdfKitDoc = InstanceType<typeof PDFDocument>

/** DLRG-Rot, Kontrast Gelb/Weiß im Kopf */
export const INVOICE_THEME = {
  red: '#C8102E',
  headerSubtext: '#FFF8DC',
  tableHeadBg: '#E5E5E5',
  tableAltRow: '#F7F7F7',
  text: '#1a1a1a',
  muted: '#444444',
  demoBg: '#FEF3C7',
  demoText: '#92400E',
} as const

export interface IssuerBlock {
  name: string
  street?: string
  postalCode?: string
  city?: string
  country?: string
  email?: string
  phone?: string
  bankName?: string
  iban?: string
  bic?: string
  taxNumber?: string
  vatId?: string
}

export interface AggregatedInvoiceLine {
  productId?: string
  name: string
  qty: number
  unitPriceCents: number
  lineTotalCents: number
  vatRatePercent: number
}

/** Eine Zeile der Positions-/Detailtabelle (je Verkaufszeile). */
export interface InvoicePdfDetailLine {
  createdAt: number
  receiptNo: number
  bonLabel: string
  articleName: string
  qty: number
  unitPriceCents: number
  lineTotalCents: number
  cashier?: string
  note?: string
}

export function formatReceiptBonLabel(createdAtMs: number, receiptNo: number): string {
  const y = new Date(createdAtMs).getFullYear()
  return `${y}-${String(receiptNo).padStart(6, '0')}`
}

function formatIsoDateDE(iso: string): string {
  const d = iso.slice(0, 10)
  const [y, m, day] = d.split('-')
  if (!y || !m || !day) return iso
  return `${day}.${m}.${y}`
}

function formatMsDateDE(ms: number): string {
  const d = new Date(ms)
  const day = String(d.getDate()).padStart(2, '0')
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const y = d.getFullYear()
  return `${day}.${m}.${y}`
}

function formatMsTimeDE(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function formatMoneyCol(cents: number): string {
  return `${formatCentsEUR(cents)} €`
}

function slugifyTeamName(name: string): string {
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

function docFooterY(doc: PdfKitDoc): number {
  return doc.page.height - 42
}

function drawPageFooter(
  doc: PdfKitDoc,
  pageIndex: number,
  totalPages: number,
  issuer: IssuerBlock,
  orgDisplayName?: string,
) {
  const y0 = docFooterY(doc)
  doc.fontSize(7).fillColor(INVOICE_THEME.muted).font('Helvetica')
  doc.text(
    `DLRG Kasse · Sammelrechnung · Seite ${pageIndex} von ${totalPages}`,
    48,
    y0,
    { width: doc.page.width - 96, align: 'center' },
  )
  const y = y0 + 10
  const legal: string[] = []
  if (orgDisplayName?.trim()) legal.push(orgDisplayName.trim())
  if (issuer.name?.trim()) legal.push(issuer.name.trim())
  const streetCity = [issuer.street, [issuer.postalCode, issuer.city].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ')
  if (streetCity.trim()) legal.push(streetCity.trim())
  if (issuer.email?.trim()) legal.push(issuer.email.trim())
  if (issuer.phone?.trim()) legal.push(`Tel. ${issuer.phone.trim()}`)
  if (issuer.taxNumber?.trim()) legal.push(`St.-Nr.: ${issuer.taxNumber.trim()}`)
  if (issuer.vatId?.trim()) legal.push(`USt-IdNr.: ${issuer.vatId.trim()}`)
  if (legal.length) {
    doc.text(legal.join(' · '), 48, y, { width: doc.page.width - 96, align: 'center' })
  }
}

export async function writeCollectiveInvoicePdf(params: {
  dataRoot: string
  invoiceNo: string
  issueDateISO: string
  servicePeriod: { start: string; end: string }
  issuer: IssuerBlock
  /** Anzeigename Ortsverein / Team */
  recipientDisplayName: string
  /** Mehrzeilige Rechnungsanschrift */
  recipientAddressLines: string[]
  teamName: string
  eventName: string
  /** Aggregierte Summenzeilen (Zusammenfassung nach Artikeln) */
  lines: AggregatedInvoiceLine[]
  /** Positionsdetail (Käufe); optional leer → nur Summenblock */
  detailLines: InvoicePdfDetailLine[]
  vatNotes: string[]
  totalCents: number
  paymentTermsDays: number
  dueDateISO: string
  purposeReference: string
  attachReceiptListing?: boolean
  receiptRefs?: Array<{ receiptNo: number; date: string; amountCents: number }>
  qrPayload?: string
  isStorno?: boolean
  referencesInvoiceNo?: string
  /** z. B. Offen, Bezahlt */
  invoiceStatusLabel: string
  /** Demo-PDF Kennzeichnung */
  isDemo?: boolean
  /** z. B. settings org_name im Footer */
  orgDisplayName?: string
}): Promise<string> {
  const relDir = path.join('invoices', 'pdf').replace(/\\/g, '/')
  const safeInv = params.invoiceNo.replace(/[^\w\-]+/g, '_')
  const slug = slugifyTeamName(params.teamName)
  const file = `${safeInv}-${slug}.pdf`
  const relPath = `${relDir}/${file}`
  const abs = path.join(params.dataRoot, relPath.replace(/\//g, path.sep))
  fs.mkdirSync(path.dirname(abs), { recursive: true })

  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 48, bottom: 52, left: 48, right: 48 },
  })
  const ws = fs.createWriteStream(abs)

  return await new Promise((resolve, reject) => {
    ws.on('finish', () => resolve(relPath))
    ws.on('error', reject)
    doc.pipe(ws)

    void (async () => {
      try {
        const margin = 48
        const pageW = doc.page.width
        const contentBottom = doc.page.height - 52

        let y = 0

        const ensureSpace = (needed: number, onNewPage: () => void) => {
          if (y + needed > contentBottom) {
            doc.addPage()
            y = margin
            onNewPage()
          }
        }

        const drawContinuationBanner = () => {
          doc.save()
          doc.rect(margin, y, pageW - 2 * margin, 22).fill(INVOICE_THEME.tableHeadBg)
          doc.fillColor(INVOICE_THEME.text).font('Helvetica-Bold').fontSize(9)
          doc.text(
            `${params.isStorno ? 'STORNORECHNUNG' : 'DLRG-Sammelrechnung'} · ${params.invoiceNo} · Fortsetzung Positionsliste`,
            margin + 6,
            y + 6,
            { width: pageW - 2 * margin - 12 },
          )
          doc.restore()
          y += 28
        }

        const drawDetailTableHeader = () => {
          const rowH = 20
          doc.save()
          doc.rect(margin, y, pageW - 2 * margin, rowH).fill(INVOICE_THEME.tableHeadBg)
          doc.fillColor(INVOICE_THEME.text).font('Helvetica-Bold').fontSize(8)
          const x0 = margin + 4
          doc.text('Datum', x0, y + 6, { width: 48 })
          doc.text('Uhrzeit', x0 + 50, y + 6, { width: 34 })
          doc.text('Bon-Nr.', x0 + 86, y + 6, { width: 54 })
          doc.text('Artikel', x0 + 142, y + 6, { width: 188 })
          doc.text('Menge', x0 + 332, y + 6, { width: 28 })
          doc.text('Einzelpreis', x0 + 360, y + 6, { width: 54 })
          doc.text('Gesamt', x0 + 414, y + 6, { width: 54, align: 'right' })
          doc.restore()
          y += rowH
        }

        // ----- Seite 1: Kopfbalken -----
        doc.save()
        doc.rect(0, 0, pageW, 78).fill(INVOICE_THEME.red)
        const headTitle = params.isStorno ? 'DLRG-STORNORECHNUNG' : 'DLRG-SAMMELRECHNUNG'
        doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(17)
        doc.text(headTitle, 0, 22, { width: pageW, align: 'center' })
        doc.font('Helvetica').fontSize(9).fillColor(INVOICE_THEME.headerSubtext)
        doc.text('Verpflegung / Veranstaltungskasse', 0, 50, { width: pageW, align: 'center' })
        doc.restore()

        y = 88

        if (params.isDemo) {
          doc.save()
          const boxH = 30
          doc.rect(margin, y, pageW - 2 * margin, boxH).fill(INVOICE_THEME.demoBg)
          doc.fillColor(INVOICE_THEME.demoText).font('Helvetica-Bold').fontSize(8.5)
          doc.text(
            'DEMO-RECHNUNG    ·    NICHT FÜR ECHTBETRIEB    ·    KEINE ZAHLUNG ERFORDERLICH',
            margin + 6,
            y + 9,
            { width: pageW - 2 * margin - 12, align: 'center' },
          )
          doc.restore()
          y += boxH + 10
        }

        // Empfänger links, Infoblock rechts
        const blockTop = y
        const leftW = (pageW - 2 * margin) * 0.52
        const rightX = margin + leftW + 12

        doc.fillColor(INVOICE_THEME.text).font('Helvetica-Bold').fontSize(10)
        doc.text('Rechnung für:', margin, y)
        doc.font('Helvetica').fontSize(11)
        doc.text(params.recipientDisplayName, margin, y + 14, { width: leftW - 8 })
        let ry = y + 14 + doc.heightOfString(params.recipientDisplayName, { width: leftW - 8 })
        for (const line of params.recipientAddressLines) {
          doc.text(line, margin, ry, { width: leftW - 8 })
          ry += doc.heightOfString(line, { width: leftW - 8 }) + 2
        }

        const infoLabelX = rightX
        const infoValX = rightX + 118
        let iy = blockTop
        doc.font('Helvetica').fontSize(9).fillColor(INVOICE_THEME.muted)
        const infoPairs: [string, string][] = [
          ['Rechnungsnummer:', params.invoiceNo],
          ['Rechnungsdatum:', formatIsoDateDE(params.issueDateISO)],
          [
            'Leistungszeitraum:',
            `${formatIsoDateDE(params.servicePeriod.start)} – ${formatIsoDateDE(params.servicePeriod.end)}`,
          ],
          ['Veranstaltung:', params.eventName],
          ['Zahlungsziel:', `${params.paymentTermsDays} Tage`],
          ['Fällig am:', formatIsoDateDE(params.dueDateISO)],
          ['Status:', params.invoiceStatusLabel],
        ]
        if (params.referencesInvoiceNo) {
          infoPairs.splice(1, 0, ['Zu Rechnung Nr.:', params.referencesInvoiceNo])
        }
        for (const [lab, val] of infoPairs) {
          doc.fillColor(INVOICE_THEME.muted).text(lab, infoLabelX, iy, { width: 112 })
          doc.fillColor(INVOICE_THEME.text).font('Helvetica-Bold').text(val, infoValX, iy, {
            width: pageW - infoValX - margin,
          })
          iy += 14
        }

        y = Math.max(ry, iy) + 16

        doc.moveTo(margin, y).lineTo(pageW - margin, y).strokeColor('#cccccc').lineWidth(0.5).stroke()
        y += 14

        // Detailtabelle
        const sortedDetails = [...params.detailLines].sort((a, b) => a.createdAt - b.createdAt)

        if (sortedDetails.length > 0) {
          doc.fillColor(INVOICE_THEME.text).font('Helvetica-Bold').fontSize(11)
          doc.text('Positionsliste / Einzelkäufe', margin, y)
          y += 18

          drawDetailTableHeader()

          const rowBase = 16
          for (let i = 0; i < sortedDetails.length; i++) {
            const d = sortedDetails[i]
            const alt = i % 2 === 1
            const artH = Math.max(
              rowBase,
              doc.heightOfString(d.articleName, { width: 188, lineGap: 1 }),
            )
            const rowH = artH + 6
            ensureSpace(rowH + 4, () => {
              drawContinuationBanner()
              drawDetailTableHeader()
            })

            if (alt) {
              doc.save()
              doc.rect(margin, y, pageW - 2 * margin, rowH).fill(INVOICE_THEME.tableAltRow)
              doc.restore()
            }

            const x0 = margin + 4
            doc.fillColor(INVOICE_THEME.text).font('Helvetica').fontSize(8)
            doc.text(formatMsDateDE(d.createdAt), x0, y + 3, { width: 48 })
            doc.text(formatMsTimeDE(d.createdAt), x0 + 50, y + 3, { width: 34 })
            doc.text(d.bonLabel, x0 + 86, y + 3, { width: 54 })
            doc.text(d.articleName, x0 + 142, y + 3, { width: 188, lineGap: 1 })
            doc.text(String(d.qty), x0 + 332, y + 3, { width: 28, align: 'right' })
            doc.text(formatMoneyCol(d.unitPriceCents), x0 + 360, y + 3, { width: 54, align: 'right' })
            doc.font('Helvetica-Bold').text(
              formatMoneyCol(d.lineTotalCents),
              x0 + 414,
              y + 3,
              { width: 54, align: 'right' },
            )
            let extraY = y + rowH
            if (d.cashier || d.note) {
              doc.font('Helvetica').fontSize(7).fillColor(INVOICE_THEME.muted)
              const bits = [d.cashier ? `Kasse: ${d.cashier}` : '', d.note ? `Hinweis: ${d.note}` : '']
                .filter(Boolean)
                .join(' · ')
              if (bits) {
                doc.text(bits, x0 + 142, y + artH - 2, { width: 320 })
                extraY = y + rowH + 8
              }
            }
            y = extraY
          }
          y += 10
        }

        // Zusammenfassung nach Artikeln
        ensureSpace(120 + params.lines.length * 18, () => {
          drawContinuationBanner()
        })

        doc.fillColor(INVOICE_THEME.text).font('Helvetica-Bold').fontSize(11)
        doc.text('Zusammenfassung nach Artikeln', margin, y)
        y += 16

        const sumHeadH = 18
        doc.save()
        doc.rect(margin, y, pageW - 2 * margin, sumHeadH).fill(INVOICE_THEME.tableHeadBg)
        doc.fillColor(INVOICE_THEME.text).font('Helvetica-Bold').fontSize(8)
        doc.text('Artikel', margin + 6, y + 5, { width: 260 })
        doc.text('Gesamtmenge', margin + 270, y + 5, { width: 72, align: 'center' })
        doc.text('Gesamtbetrag', margin + 390, y + 5, { width: 92, align: 'right' })
        doc.restore()
        y += sumHeadH

        for (const l of params.lines) {
          const rowH = 16
          ensureSpace(rowH + 4, () => {
            drawContinuationBanner()
          })
          doc.font('Helvetica').fontSize(9)
          doc.text(l.name, margin + 6, y + 3, { width: 260 })
          doc.text(String(Math.abs(l.qty)), margin + 270, y + 3, { width: 72, align: 'center' })
          doc.font('Helvetica-Bold').text(formatMoneyCol(l.lineTotalCents), margin + 390, y + 3, {
            width: 92,
            align: 'right',
          })
          y += rowH
        }

        y += 12

        // Gesamtbetrag
        ensureSpace(56, () => {
          drawContinuationBanner()
        })
        doc.font('Helvetica-Bold').fontSize(14).fillColor(INVOICE_THEME.text)
        doc.text(
          `Gesamtbetrag: ${formatMoneyCol(params.totalCents)}`,
          margin,
          y,
          { width: pageW - 2 * margin, align: 'right' },
        )
        y += 28

        // USt-Hinweise
        for (const n of params.vatNotes) {
          ensureSpace(16, () => {
            drawContinuationBanner()
          })
          doc.font('Helvetica').fontSize(8).fillColor(INVOICE_THEME.muted).text(n, margin, y, {
            width: pageW - 2 * margin,
          })
          y += 12
        }
        y += 6

        // Zahlungshinweis
        ensureSpace(140, () => {
          drawContinuationBanner()
        })
        doc.font('Helvetica').fontSize(9).fillColor(INVOICE_THEME.text)
        doc.text(
          'Bitte überweisen Sie den Rechnungsbetrag unter Angabe der Rechnungsnummer als Verwendungszweck.',
          margin,
          y,
          { width: pageW - 2 * margin },
        )
        y += 28
        doc.font('Helvetica-Bold').text('Verwendungszweck:', margin, y)
        doc.font('Helvetica-Bold').fillColor(INVOICE_THEME.red).text(params.purposeReference, margin + 118, y)
        y += 22

        doc.fillColor(INVOICE_THEME.text).font('Helvetica-Bold').text('Bankverbindung:', margin, y)
        y += 14
        doc.font('Helvetica').fontSize(9)
        const hasBank =
          (params.issuer.iban && params.issuer.iban.trim()) ||
          (params.issuer.bankName && params.issuer.bankName.trim())
        if (hasBank) {
          doc.text(`Kontoinhaber: ${params.issuer.name ?? '—'}`, margin, y, {
            width: pageW - 2 * margin,
          })
          y += 12
          if (params.issuer.bankName) {
            doc.text(params.issuer.bankName, margin, y)
            y += 12
          }
          if (params.issuer.iban) {
            doc.text(`IBAN: ${params.issuer.iban}`, margin, y)
            y += 12
          }
          if (params.issuer.bic) {
            doc.text(`BIC: ${params.issuer.bic}`, margin, y)
            y += 12
          }
        } else {
          doc.fillColor(INVOICE_THEME.muted).text(
            'Bankverbindung bitte in den Einstellungen hinterlegen.',
            margin,
            y,
          )
          y += 14
        }

        if (params.qrPayload && params.invoiceNo && !params.isDemo) {
          ensureSpace(130, () => {
            drawContinuationBanner()
          })
          y += 6
          try {
            const dataUrl = await QRCode.toDataURL(params.qrPayload, {
              margin: 1,
              width: 120,
              errorCorrectionLevel: 'M',
            })
            const png = Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ''), 'base64')
            doc.image(png, margin, y, { width: 88 })
            y += 96
          } catch {
            /* optional */
          }
        }

        doc.font('Helvetica').fontSize(7.5).fillColor(INVOICE_THEME.muted)
        y += 8
        doc.text(
          'Hinweis: Diese Sammelrechnung wird nach Erstellung unverändert archiviert. Änderungen erfolgen ausschließlich über Storno- oder Korrekturrechnung.',
          margin,
          y,
          { width: pageW - 2 * margin },
        )
        y += 28

        if (params.attachReceiptListing && params.receiptRefs?.length) {
          ensureSpace(40 + params.receiptRefs.length * 14, () => {
            drawContinuationBanner()
          })
          doc.font('Helvetica-Bold').fontSize(10).fillColor(INVOICE_THEME.text)
          doc.text('Anhang — Bonübersicht (Summen)', margin, y)
          y += 14
          doc.font('Helvetica').fontSize(8)
          for (const r of params.receiptRefs) {
            doc.text(
              `Bon ${r.receiptNo} · ${r.date} · ${formatMoneyCol(r.amountCents)}`,
              margin,
              y,
            )
            y += 13
          }
        }

        const range = doc.bufferedPageRange()
        const totalPages = range.count
        for (let pi = 0; pi < totalPages; pi++) {
          doc.switchToPage(range.start + pi)
          drawPageFooter(doc, pi + 1, totalPages, params.issuer, params.orgDisplayName)
        }

        doc.end()
      } catch (e) {
        reject(e)
      }
    })()
  })
}
