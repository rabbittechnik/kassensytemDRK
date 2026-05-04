import fs from 'node:fs'
import path from 'node:path'
import PDFDocument from 'pdfkit'
import QRCode from 'qrcode'
import { formatCentsEUR } from '../pdfMoney.js'

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

export async function writeCollectiveInvoicePdf(params: {
  dataRoot: string
  invoiceNo: string
  issueDateISO: string
  servicePeriod: { start: string; end: string }
  issuer: IssuerBlock
  recipientLines: string[]
  teamName: string
  eventName: string
  lines: AggregatedInvoiceLine[]
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
}): Promise<string> {
  const relDir = path.join('invoices', 'pdf').replace(/\\/g, '/')
  const file = `${params.invoiceNo.replace(/[^\w\-]+/g, '_')}.pdf`
  const relPath = `${relDir}/${file}`
  const abs = path.join(params.dataRoot, relPath.replace(/\//g, path.sep))
  fs.mkdirSync(path.dirname(abs), { recursive: true })

  const doc = new PDFDocument({ size: 'A4', margin: 48 })
  const ws = fs.createWriteStream(abs)

  return await new Promise((resolve, reject) => {
    ws.on('finish', () => resolve(relPath))
    ws.on('error', reject)
    doc.pipe(ws)

    void (async () => {
      try {
        doc.fontSize(14).text(params.isStorno ? 'STORNORECHNUNG' : 'RECHNUNG', {
          underline: true,
        })
        doc.fontSize(10).moveDown(0.3)
        doc.text(`Nr. ${params.invoiceNo}`)
        if (params.referencesInvoiceNo) {
          doc.text(`Zu Rechnung: ${params.referencesInvoiceNo}`)
        }
        doc.text(`Ausstellungsdatum: ${params.issueDateISO}`)
        doc.text(`Leistungszeitraum: ${params.servicePeriod.start} – ${params.servicePeriod.end}`)
        doc.moveDown()

        doc.fontSize(10).text('Rechnungsaussteller:', { underline: true })
        doc.text(params.issuer.name)
        if (params.issuer.street) doc.text(params.issuer.street)
        const cityLine = [params.issuer.postalCode, params.issuer.city].filter(Boolean).join(' ')
        if (cityLine) doc.text(cityLine)
        if (params.issuer.country) doc.text(params.issuer.country)
        if (params.issuer.phone) doc.text(`Tel.: ${params.issuer.phone}`)
        if (params.issuer.email) doc.text(params.issuer.email)
        if (params.issuer.taxNumber) doc.text(`Steuernummer: ${params.issuer.taxNumber}`)
        if (params.issuer.vatId) doc.text(`USt-IdNr.: ${params.issuer.vatId}`)

        doc.moveDown()
        doc.text('Rechnungsempfänger:', { underline: true })
        for (const line of params.recipientLines) doc.text(line)
        doc.moveDown()
        doc.text(`Team/Verein: ${params.teamName}`)
        doc.text(`Veranstaltung: ${params.eventName}`)
        doc.moveDown()

        doc.text('Positionen:', { underline: true })
        doc.moveDown(0.3)
        for (const l of params.lines) {
          const sign = l.lineTotalCents < 0 ? -1 : 1
          const qtyDisp = `${sign * Math.abs(l.qty)}×`
          doc.fontSize(9).text(`${qtyDisp} ${l.name} — ${formatCentsEUR(l.unitPriceCents)} / Einheit`)
          doc.text(`Summe Pos.: ${formatCentsEUR(Math.abs(l.lineTotalCents))}`, { align: 'right' })
          doc.text(`USt.-Satz: ${l.vatRatePercent}%`, { align: 'right' })
          doc.moveDown(0.35)
        }
        doc.fontSize(10)
        doc.text(`GESAMTBETRAG EUR ${formatCentsEUR(params.totalCents)}`, { align: 'right' })
        doc.moveDown()

        for (const n of params.vatNotes) doc.fontSize(8).fillColor('#333').text(n)
        doc.fillColor('#000')
        doc.moveDown()

        doc.fontSize(9).text(`Zahlungsziel: ${params.paymentTermsDays} Tage, fällig am ${params.dueDateISO}`)
        doc.moveDown(0.3)
        if (params.issuer.bankName || params.issuer.iban) {
          doc.text('Bankverbindung:')
          if (params.issuer.bankName) doc.text(params.issuer.bankName)
          if (params.issuer.iban) doc.text(`IBAN: ${params.issuer.iban}`)
          if (params.issuer.bic) doc.text(`BIC: ${params.issuer.bic}`)
        }
        doc.text(`Verwendungszweck: ${params.purposeReference}`)
        doc.text(
          'Bitte überweisen Sie den Gesamtbetrag unter Angabe der Rechnungsnummer.',
        )

        if (params.qrPayload && params.invoiceNo) {
          doc.moveDown(0.8)
          try {
            const dataUrl = await QRCode.toDataURL(params.qrPayload, {
              margin: 1,
              width: 120,
              errorCorrectionLevel: 'M',
            })
            const png = Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ''), 'base64')
            doc.image(png, { width: 100 })
          } catch {
            /* optional */
          }
        }

        if (params.attachReceiptListing && params.receiptRefs?.length) {
          doc.addPage()
          doc.fontSize(12).text('Anhang — Einzelbelege')
          doc.moveDown(0.5)
          doc.fontSize(9)
          for (const r of params.receiptRefs) {
            doc.text(`Bon Nr. ${r.receiptNo} — ${r.date} — EUR ${formatCentsEUR(r.amountCents)}`)
          }
        }

        doc.end()
      } catch (e) {
        reject(e)
      }
    })()
  })
}
