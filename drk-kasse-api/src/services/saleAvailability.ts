import type BetterSqlite3 from 'better-sqlite3'

export type SaleAvailabilityMode = 'event' | 'standard' | 'blocked'
export type SaleAvailabilityReason =
  | 'ok_event'
  | 'ok_standard'
  | 'no_active_event'
  | 'event_not_started'
  | 'event_ended'

type EventWindowRow = {
  id: string
  name: string
  status: string
  start_date: string
  end_date: string
  start_time: string | null
  end_time: string | null
}

function toMs(date: string, time: string | null | undefined, fallback: string): number {
  return new Date(`${date}T${(time?.trim() || fallback).slice(0, 8)}`).getTime()
}

function getSetting(db: BetterSqlite3.Database, key: string): string | undefined {
  const r = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as
    | { value: string }
    | undefined
  return r?.value
}

function loadEvent(db: BetterSqlite3.Database, id: string): EventWindowRow | null {
  const row = db
    .prepare(
      `SELECT id, name, status, start_date, end_date, start_time, end_time
       FROM events WHERE id = ?`,
    )
    .get(id) as EventWindowRow | undefined
  return row ?? null
}

export function evaluateEventWindow(
  event: EventWindowRow | null,
  nowMs: number,
): {
  valid: boolean
  reason: SaleAvailabilityReason
} {
  if (!event || event.status !== 'active') {
    return { valid: false, reason: 'no_active_event' }
  }
  const startMs = toMs(event.start_date, event.start_time, '00:00:00')
  const endMs = toMs(event.end_date, event.end_time, '23:59:59')
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
    return { valid: false, reason: 'no_active_event' }
  }
  if (nowMs < startMs) return { valid: false, reason: 'event_not_started' }
  if (nowMs > endMs) return { valid: false, reason: 'event_ended' }
  return { valid: true, reason: 'ok_event' }
}

export function getSaleAvailability(params: {
  db: BetterSqlite3.Database
  nowMs?: number
}): {
  canSell: boolean
  mode: SaleAvailabilityMode
  reason: SaleAvailabilityReason
  allowStandardSale: boolean
  activeEvent: EventWindowRow | null
} {
  const now = params.nowMs ?? Date.now()
  const allowStandardSale = getSetting(params.db, 'allow_sales_without_event') !== '0'
  const configuredActiveEventId = getSetting(params.db, 'active_event_id')?.trim() ?? ''
  const configuredEvent = configuredActiveEventId ? loadEvent(params.db, configuredActiveEventId) : null
  const verdict = evaluateEventWindow(configuredEvent, now)

  if (verdict.valid) {
    return {
      canSell: true,
      mode: 'event',
      reason: 'ok_event',
      allowStandardSale,
      activeEvent: configuredEvent,
    }
  }
  if (allowStandardSale) {
    return {
      canSell: true,
      mode: 'standard',
      reason: 'ok_standard',
      allowStandardSale,
      activeEvent: null,
    }
  }
  return {
    canSell: false,
    mode: 'blocked',
    reason: verdict.reason,
    allowStandardSale,
    activeEvent: configuredEvent,
  }
}

export function getEventById(db: BetterSqlite3.Database, id: string): EventWindowRow | null {
  return loadEvent(db, id)
}

