import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { format } from 'date-fns'
import { de } from 'date-fns/locale'
import { db } from '../db/database'
import { setSetting } from '../db/sales'
import { apiJson } from '../api/http'
import { getStoredToken } from '../api/config'
import type { EventRow, EventStatus } from '../types'

type ApiEvent = {
  id: string
  name: string
  startDate: string
  endDate: string
  startTime?: string | null
  endTime?: string | null
  location?: string | null
  description?: string | null
  status: EventStatus
  createdAt: number
  updatedAt: number
  closedAt?: number | null
}

const STATUS_LABEL: Record<EventStatus, string> = {
  planned: 'Geplant',
  active: 'Aktiv',
  completed: 'Abgeschlossen',
  archived: 'Archiviert',
}

function formatRange(start: string, end: string) {
  try {
    const a = new Date(start + 'T12:00:00')
    const b = new Date(end + 'T12:00:00')
    return `${format(a, 'dd.MM.yyyy', { locale: de })} – ${format(b, 'dd.MM.yyyy', { locale: de })}`
  } catch {
    return `${start} – ${end}`
  }
}

export function EventsManagement() {
  const [search, setSearch] = useState('')
  const [apiEvents, setApiEvents] = useState<ApiEvent[] | null>(null)
  const [apiErr, setApiErr] = useState<string | null>(null)
  const [allowNoEvent, setAllowNoEvent] = useState(true)
  const [editor, setEditor] = useState<EventRow | 'new' | null>(null)
  const token = getStoredToken()
  const useApi = Boolean(token)

  const localEvents = useLiveQuery(() => db.events.orderBy('startDate').reverse().toArray(), [])
  const allowLocal = useLiveQuery(
    () => db.settings.get('allow_sales_without_event'),
    [],
  )?.value

  useEffect(() => {
    if (allowLocal !== undefined) setAllowNoEvent(allowLocal !== '0')
  }, [allowLocal])

  const loadApi = useCallback(async () => {
    if (!useApi) return
    setApiErr(null)
    try {
      const rows = await apiJson<ApiEvent[]>('/events')
      setApiEvents(Array.isArray(rows) ? rows : [])
      const st = await apiJson<Record<string, string>>('/settings')
      setAllowNoEvent(st.allow_sales_without_event !== '0')
    } catch (e) {
      setApiErr(String((e as Error).message ?? e))
      setApiEvents([])
    }
  }, [useApi])

  useEffect(() => {
    void loadApi()
  }, [loadApi])

  const displayList: EventRow[] = useMemo(() => {
    if (useApi) {
      return (apiEvents ?? []).map((e) => ({
        id: e.id,
        name: e.name,
        startDate: e.startDate,
        endDate: e.endDate,
        startTime: e.startTime ?? null,
        endTime: e.endTime ?? null,
        location: e.location ?? null,
        description: e.description ?? null,
        status: e.status,
        createdAt: e.createdAt,
        updatedAt: e.updatedAt,
        closedAt: e.closedAt ?? null,
      }))
    }
    return localEvents ?? []
  }, [useApi, apiEvents, localEvents])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return displayList
    return displayList.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        (e.location ?? '').toLowerCase().includes(q) ||
        e.startDate.includes(q) ||
        e.endDate.includes(q),
    )
  }, [displayList, search])

  async function saveAllowNoEvent(v: boolean) {
    setAllowNoEvent(v)
    if (useApi) {
      try {
        await apiJson('/settings', {
          method: 'PATCH',
          body: JSON.stringify({ allowSalesWithoutEvent: v }),
        })
      } catch {
        setAllowNoEvent(!v)
      }
    } else {
      await setSetting('allow_sales_without_event', v ? '1' : '0')
    }
  }

  const activateEvent = useCallback(
    async (id: string, api: boolean) => {
      if (api) {
        try {
          await apiJson(`/events/${encodeURIComponent(id)}/activate`, { method: 'POST' })
          await loadApi()
        } catch (e) {
          alert(String((e as Error).message ?? e))
        }
      } else {
        await db.transaction('rw', db.events, db.settings, async () => {
          const now = Date.now()
          const all = await db.events.toArray()
          for (const x of all) {
            if (x.status === 'active')
              await db.events.update(x.id, { status: 'planned', updatedAt: now })
          }
          await db.events.update(id, { status: 'active', updatedAt: now })
          await setSetting('active_event_id', id)
        })
      }
    },
    [loadApi],
  )

  const completeEvent = useCallback(
    async (id: string, api: boolean, reload: () => Promise<void>) => {
      if (!confirm('Veranstaltung wirklich abschließen?')) return
      if (api) {
        try {
          await apiJson(`/events/${encodeURIComponent(id)}/complete`, { method: 'POST' })
          await reload()
        } catch (e) {
          alert(String((e as Error).message ?? e))
        }
      } else {
        const now = Date.now()
        await db.events.update(id, {
          status: 'completed',
          closedAt: now,
          updatedAt: now,
        })
        const cur = (await db.settings.get('active_event_id'))?.value
        if (cur === id) await setSetting('active_event_id', '')
      }
    },
    [],
  )

  const archiveEvent = useCallback(
    async (id: string, api: boolean, reload: () => Promise<void>) => {
      if (!confirm('Veranstaltung archivieren?')) return
      if (api) {
        try {
          await apiJson(`/events/${encodeURIComponent(id)}/archive`, { method: 'POST' })
          await reload()
        } catch (e) {
          alert(String((e as Error).message ?? e))
        }
      } else {
        const now = Date.now()
        await db.events.update(id, { status: 'archived', updatedAt: now })
        const cur = (await db.settings.get('active_event_id'))?.value
        if (cur === id) await setSetting('active_event_id', '')
      }
    },
    [],
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">Veranstaltungen</h2>
          <p className="text-sm text-slate-400">
            Zentrale Zuordnung für Verkäufe, Teamrechnungen und Tagesabschlüsse (Phase 1).
          </p>
        </div>
        <button
          type="button"
          className="rounded-xl bg-gradient-to-r from-blue-600 to-cyan-500 px-4 py-2 font-semibold text-white disabled:opacity-40"
          disabled={useApi && !token}
          onClick={() => setEditor('new')}
        >
          Neue Veranstaltung
        </button>
      </div>

      {!useApi && (
        <p className="rounded-lg border border-amber-500/40 bg-amber-950/20 p-3 text-sm text-amber-100">
          Ohne API-Anmeldung werden Veranstaltungen nur lokal in diesem Gerät gespeichert.
          Mit Server-Login stehen alle Kassen die gleichen Daten zur Verfügung.
        </p>
      )}
      {useApi && apiErr && (
        <p className="rounded-lg border border-rose-500/40 bg-rose-950/25 p-3 text-sm text-rose-100">
          {apiErr}
        </p>
      )}

      <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
        <input
          type="checkbox"
          checked={allowNoEvent}
          onChange={(e) => void saveAllowNoEvent(e.target.checked)}
        />
        Verkauf ohne Veranstaltung erlauben (Standardmodus, wenn keine aktiv)
      </label>

      <input
        type="search"
        placeholder="Suchen (Name, Ort, Datum)…"
        className="w-full max-w-md rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-white placeholder:text-slate-600"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead>
            <tr className="border-b border-white/10 text-slate-400">
              <th className="py-2 pr-3">Name</th>
              <th className="py-2 pr-3">Zeitraum</th>
              <th className="py-2 pr-3">Ort</th>
              <th className="py-2 pr-3">Status</th>
              <th className="py-2">Aktionen</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((e) => (
              <tr key={e.id} className="border-b border-white/5 hover:bg-white/[0.03]">
                <td className="py-2 pr-3 font-medium text-slate-100">{e.name}</td>
                <td className="py-2 pr-3 text-slate-300">{formatRange(e.startDate, e.endDate)}</td>
                <td className="py-2 pr-3 text-slate-400">{e.location?.trim() || '—'}</td>
                <td className="py-2 pr-3">
                  <span
                    className={[
                      'rounded-lg px-2 py-0.5 text-xs font-bold uppercase',
                      e.status === 'active'
                        ? 'bg-emerald-500/20 text-emerald-200'
                        : e.status === 'planned'
                          ? 'bg-slate-500/20 text-slate-200'
                          : 'bg-white/10 text-slate-400',
                    ].join(' ')}
                  >
                    {STATUS_LABEL[e.status]}
                  </span>
                </td>
                <td className="py-2">
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="text-xs text-blue-300 hover:underline"
                      onClick={() => setEditor(e)}
                    >
                      Bearbeiten
                    </button>
                    {(e.status === 'planned' || e.status === 'active') && (
                      <button
                        type="button"
                        className="text-xs text-emerald-300 hover:underline"
                        onClick={() => void activateEvent(e.id, useApi)}
                      >
                        Aktiv setzen
                      </button>
                    )}
                    {(e.status === 'planned' || e.status === 'active') && (
                      <button
                        type="button"
                        className="text-xs text-amber-200 hover:underline"
                        onClick={() => void completeEvent(e.id, useApi, loadApi)}
                      >
                        Abschließen
                      </button>
                    )}
                    {e.status !== 'archived' && (
                      <button
                        type="button"
                        className="text-xs text-slate-400 hover:underline"
                        onClick={() => void archiveEvent(e.id, useApi, loadApi)}
                      >
                        Archivieren
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {filtered.length === 0 && (
        <p className="text-sm text-slate-500">Keine Veranstaltungen passend zur Suche.</p>
      )}

      {editor && (
        <EventEditorModal
          mode={editor}
          useApi={useApi}
          onClose={() => setEditor(null)}
          onSaved={() => {
            void loadApi()
            setEditor(null)
          }}
        />
      )}
    </div>
  )
}

function EventEditorModal(props: {
  mode: EventRow | 'new'
  useApi: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const isNew = props.mode === 'new'
  const ex = isNew ? null : props.mode
  const [name, setName] = useState(ex?.name ?? '')
  const [startDate, setStartDate] = useState(ex?.startDate ?? format(new Date(), 'yyyy-MM-dd'))
  const [endDate, setEndDate] = useState(ex?.endDate ?? format(new Date(), 'yyyy-MM-dd'))
  const [startTime, setStartTime] = useState(ex?.startTime ?? '')
  const [endTime, setEndTime] = useState(ex?.endTime ?? '')
  const [location, setLocation] = useState(ex?.location ?? '')
  const [description, setDescription] = useState(ex?.description ?? '')
  const [busy, setBusy] = useState(false)

  const save = useCallback(async () => {
    const n = name.trim()
    if (!n || !startDate || !endDate) return
    setBusy(true)
    try {
      if (props.useApi) {
        if (isNew) {
          await apiJson<{ id: string }>('/events', {
            method: 'POST',
            body: JSON.stringify({
              name: n,
              startDate,
              endDate,
              startTime: startTime.trim() || null,
              endTime: endTime.trim() || null,
              location: location.trim() || null,
              description: description.trim() || null,
              status: 'planned',
            }),
          })
        } else if (ex) {
          await apiJson(`/events/${encodeURIComponent(ex.id)}`, {
            method: 'PATCH',
            body: JSON.stringify({
              name: n,
              startDate,
              endDate,
              startTime: startTime.trim() || null,
              endTime: endTime.trim() || null,
              location: location.trim() || null,
              description: description.trim() || null,
            }),
          })
        }
      } else {
        const now = Date.now()
        if (isNew) {
          await db.events.add({
            id: crypto.randomUUID(),
            name: n,
            startDate,
            endDate,
            startTime: startTime.trim() || null,
            endTime: endTime.trim() || null,
            location: location.trim() || null,
            description: description.trim() || null,
            status: 'planned',
            createdAt: now,
            updatedAt: now,
          })
        } else if (ex) {
          await db.events.update(ex.id, {
            name: n,
            startDate,
            endDate,
            startTime: startTime.trim() || null,
            endTime: endTime.trim() || null,
            location: location.trim() || null,
            description: description.trim() || null,
            updatedAt: now,
          })
        }
      }
      props.onSaved()
    } catch (e) {
      alert(String((e as Error).message ?? e))
    } finally {
      setBusy(false)
    }
  }, [
    description,
    endDate,
    endTime,
    ex,
    isNew,
    location,
    name,
    props,
    startDate,
    startTime,
  ])

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4 backdrop-blur">
      <div className="panel-glass max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl p-6">
        <h3 className="text-lg font-bold text-white">
          {isNew ? 'Neue Veranstaltung' : 'Veranstaltung bearbeiten'}
        </h3>
        <label className="mt-4 block text-sm text-slate-400">Name</label>
        <input
          className="mt-1 w-full rounded-xl border border-white/15 bg-black/30 px-3 py-3 text-white"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-sm text-slate-400">Startdatum</label>
            <input
              type="date"
              className="mt-1 w-full rounded-xl border border-white/15 bg-black/30 px-3 py-3 text-white"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm text-slate-400">Enddatum</label>
            <input
              type="date"
              className="mt-1 w-full rounded-xl border border-white/15 bg-black/30 px-3 py-3 text-white"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-sm text-slate-400">Startzeit (optional)</label>
            <input
              className="mt-1 w-full rounded-xl border border-white/15 bg-black/30 px-3 py-3 text-white"
              placeholder="z. B. 10:00"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm text-slate-400">Endzeit (optional)</label>
            <input
              className="mt-1 w-full rounded-xl border border-white/15 bg-black/30 px-3 py-3 text-white"
              placeholder="z. B. 18:00"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
            />
          </div>
        </div>
        <label className="mt-3 block text-sm text-slate-400">Ort (optional)</label>
        <input
          className="mt-1 w-full rounded-xl border border-white/15 bg-black/30 px-3 py-3 text-white"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
        />
        <label className="mt-3 block text-sm text-slate-400">Beschreibung (optional)</label>
        <textarea
          className="mt-1 min-h-[72px] w-full rounded-xl border border-white/15 bg-black/30 px-3 py-3 text-white"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-xl border border-white/15 px-4 py-2 text-slate-200"
            onClick={props.onClose}
          >
            Abbrechen
          </button>
          <button
            type="button"
            disabled={busy}
            className="rounded-xl bg-gradient-to-r from-blue-600 to-cyan-500 px-4 py-2 font-semibold text-white disabled:opacity-40"
            onClick={() => void save()}
          >
            Speichern
          </button>
        </div>
      </div>
    </div>
  )
}
