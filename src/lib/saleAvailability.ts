export type SaleAvailabilityReason =
  | 'ok_event'
  | 'ok_standard'
  | 'no_active_event'
  | 'event_not_started'
  | 'event_ended'

export type SaleAvailabilityMode = 'event' | 'standard' | 'blocked'

export type SaleEventLike = {
  id: string
  name: string
  status?: string | null
  startDate: string
  endDate: string
  startTime?: string | null
  endTime?: string | null
}

function toLocalMs(
  date: string,
  time: string | null | undefined,
  fallback: string,
): number {
  return new Date(`${date}T${(time?.trim() || fallback).slice(0, 8)}`).getTime()
}

export function getSaleAvailability(params: {
  allowStandardSale: boolean
  activeEvent: SaleEventLike | null
  nowMs?: number
}): {
  canSell: boolean
  reason: SaleAvailabilityReason
  mode: SaleAvailabilityMode
  activeEvent?: SaleEventLike
} {
  const now = params.nowMs ?? Date.now()
  const ev = params.activeEvent
  if (!ev) {
    return params.allowStandardSale ?
        { canSell: true, reason: 'ok_standard', mode: 'standard' }
      : { canSell: false, reason: 'no_active_event', mode: 'blocked' }
  }

  if ((ev.status ?? 'active') !== 'active') {
    return params.allowStandardSale ?
        { canSell: true, reason: 'ok_standard', mode: 'standard' }
      : { canSell: false, reason: 'no_active_event', mode: 'blocked' }
  }

  const startMs = toLocalMs(ev.startDate, ev.startTime, '00:00:00')
  const endMs = toLocalMs(ev.endDate, ev.endTime, '23:59:59')

  if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
    return params.allowStandardSale ?
        { canSell: true, reason: 'ok_standard', mode: 'standard' }
      : { canSell: false, reason: 'no_active_event', mode: 'blocked' }
  }
  if (now < startMs) {
    return params.allowStandardSale ?
        { canSell: true, reason: 'ok_standard', mode: 'standard' }
      : { canSell: false, reason: 'event_not_started', mode: 'blocked', activeEvent: ev }
  }
  if (now > endMs) {
    return params.allowStandardSale ?
        { canSell: true, reason: 'ok_standard', mode: 'standard' }
      : { canSell: false, reason: 'event_ended', mode: 'blocked', activeEvent: ev }
  }
  return { canSell: true, reason: 'ok_event', mode: 'event', activeEvent: ev }
}

