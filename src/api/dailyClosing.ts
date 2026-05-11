import { apiBlob, apiJson } from './http'

export type DailyClosingByCategory = { categoryId: string; totalCents: number }

export type DailyClosingCreateResult = {
  id: string
  closingNumber: number
  csvRelPath: string
  pdfRelPath: string
  backupRel?: string
  dayKey: string
  eventId?: string | null
  grossTotalCents: number
  cashTotalCents: number
  cardTotalCents: number
  invoiceTotalCents: number
  salesCount: number
  stornoCount: number
  stornoTotalCents: number
  depositBalanceCents: number
  byCategory: DailyClosingByCategory[]
}

export async function apiCreateDailyClosing(body: {
  dayKey?: string
  actualCashDrawerCents?: number
  eventId?: string | null
}): Promise<DailyClosingCreateResult> {
  return apiJson<DailyClosingCreateResult>('/daily-closings/create', {
    method: 'POST',
    body: JSON.stringify(body ?? {}),
  })
}

export async function apiDownloadDailyClosingFile(
  id: string,
  kind: 'pdf' | 'csv',
): Promise<Blob> {
  return apiBlob(`/daily-closings/${encodeURIComponent(id)}/file?kind=${kind}`)
}

export function downloadBlobAsFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
