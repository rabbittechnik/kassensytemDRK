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
    depositVoucherNumber?: string
    depositTotalCents?: number
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

export async function apiGetDepositVoucher(voucherNumber: string) {
  return apiJson<{
    id: string
    voucherNumber: string
    saleId: string
    eventId?: string | null
    amountCents: number
    quantity: number
    status: 'open' | 'redeemed' | 'cancelled'
    issuedAt: number
    redeemedAt?: number | null
    redeemedBy?: string | null
    createdAt: number
  }>(`/deposit-vouchers/${encodeURIComponent(voucherNumber)}`)
}

export async function apiRedeemDepositVoucher(params: {
  voucherNumber: string
  note?: string
}) {
  return apiJson<{
    voucherNumber: string
    amountCents: number
    quantity: number
    redeemedAt: number
  }>('/deposit-vouchers/redeem', {
    method: 'POST',
    body: JSON.stringify(params),
  })
}

export async function apiCreateManualDepositRedemption(params: {
  eventId?: string | null
  quantity: number
  amountCents: number
  depositName?: string
  depositType?: string | null
  note?: string
}) {
  return apiJson<{
    id: string
    mode: 'manual_simple'
    quantity: number
    amountCents: number
    totalCents: number
    createdAt: number
  }>('/deposit-redemptions/manual', {
    method: 'POST',
    body: JSON.stringify(params),
  })
}

export async function apiCreateHelperConsumption(params: {
  eventId?: string | null
  note?: string
  lines: { productId: string; qty: number; unitPriceCents?: number; name?: string }[]
}) {
  return apiJson<{
    id: string
    saleLikeNumber: string
    totalValueCents: number
    createdAt: number
  }>('/helper-consumptions', {
    method: 'POST',
    body: JSON.stringify(params),
  })
}
