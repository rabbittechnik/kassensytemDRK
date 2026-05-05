import { apiJson } from './http'

export type ApiPaymentBody =
  | { method: 'cash'; amountTenderedCents: number }
  | { method: 'card' }
  | {
      method: 'invoice'
      teamId: string
      eventId: string
      contactName?: string
      note?: string
    }

export async function apiCreateSale(params: {
  lines: {
    productId: string
    qty: number
    unitPriceCents?: number
    name?: string
  }[]
  payment: ApiPaymentBody
  clientUuid?: string
  /** Bar/Karte: aktive Veranstaltung (Server validiert gegen Settings). */
  eventId?: string | null
}) {
  return apiJson<{
    id: string
    receiptNo: number
    createdAt: number
    receiptPdfRelPath: string
    duplicate?: boolean
  }>('/sales', {
    method: 'POST',
    body: JSON.stringify({
      lines: params.lines,
      payment: params.payment,
      clientUuid: params.clientUuid,
      eventId: params.eventId,
    }),
  })
}
