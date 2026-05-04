import fs from 'node:fs'
import path from 'node:path'
import PDFDocument from 'pdfkit'
import { formatCentsEUR } from '../pdfMoney.js'

export interface ReceiptPdfInput {
  dataRoot: string
  receiptNo: number
  createdAt: number
  orgName: string
  footer?: string
  lines: { name: string; qty: number; unitPriceCents: number; lineTotalCents: number }[]
  totalCents: number
  paymentLabel: string
  extraLines?: string[]
}

export function writeReceiptPdfPromise(input: ReceiptPdfInput): Promise<string> {
  const d = new Date(input.createdAt)
  const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const dir = path.join(input.dataRoot, 'receipts', ds)
  fs.mkdirSync(dir, { recursive: true })
  const relPath = path.join('receipts', ds, `bon-${input.receiptNo}.pdf`).replace(/\\/g, '/')
  const abs = path.join(input.dataRoot, relPath.replace(/\//g, path.sep))

  const doc = new PDFDocument({ size: 'A4', margin: 48 })
  const ws = fs.createWriteStream(abs)

  return new Promise((resolve, reject) => {
    ws.on('finish', () => resolve(relPath))
    ws.on('error', reject)
    doc.pipe(ws)

    doc.fontSize(18).text(input.orgName, { align: 'center' })
    doc.moveDown()
    doc.fontSize(11).fillColor('#444')
    doc.text(`Bon Nr. ${input.receiptNo}`, { align: 'center' })
    doc.text(d.toLocaleString('de-DE'), { align: 'center' })
    doc.fillColor('#000')
    doc.moveDown()
    doc.fontSize(11)
    doc.text(`Zahlung: ${input.paymentLabel}`)
    doc.moveDown(0.5)
    doc.fontSize(10)
    for (const l of input.lines) {
      doc.text(`${l.qty}× ${l.name}`)
      doc.text(`${formatCentsEUR(l.unitPriceCents)} / Stk → ${formatCentsEUR(l.lineTotalCents)}`, {
        align: 'right',
      })
      doc.moveDown(0.3)
    }
    doc.moveDown()
    doc.fontSize(13).fillColor('#c00').text(`SUMME EUR ${formatCentsEUR(input.totalCents)}`, {
      align: 'right',
    })
    doc.fillColor('#000')

    const extras = [...(input.extraLines ?? [])]
    if (input.footer) extras.push(input.footer)

    extras.push(
      'TESTSYSTEM – nicht für steuerlichen Echtbetrieb freigegeben.',
      'TSE: inaktiv (Testbetrieb)',
    )

    doc.moveDown(1.5)
    doc.fontSize(8).fillColor('#666')
    for (const e of extras) {
      doc.text(e, { width: doc.page.width - 96 })
      doc.moveDown(0.2)
    }

    doc.end()
  })
}
