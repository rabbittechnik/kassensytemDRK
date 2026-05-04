import { useEffect, useMemo, useState } from 'react'
import { apiJson } from '../api/http'
import { formatMoney } from '../lib/format'
import type { CartLine } from '../types'

type TeamRow = {
  id: string
  name: string
  contact_name?: string
  invoice_email?: string | null
}

type EventRow = {
  id: string
  name: string
  start_date?: string
  end_date?: string
  startDate?: string
  endDate?: string
  status: string
}

export function InvoiceSaleModal(props: {
  cartLines: CartLine[]
  totalCents: number
  onCancel: () => void
  onConfirmed: (p: {

    teamId: string

    eventId: string

    contactName?: string

    note?: string
  }) => void | Promise<void>
}) {

  const [q, setQ] = useState('')

  const [teams, setTeams] = useState<TeamRow[]>([])
  const [events, setEvents] = useState<EventRow[]>([])
  const [teamId, setTeamId] = useState('')
  const [eventId, setEventId] = useState('')
  const [contact, setContact] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void apiJson<EventRow[]>('/events')
      .then((ev) => {
        if (!alive) return

        const act = ev.filter((e) => e.status === 'active')

        setEvents(act)

        if (act.length === 1) setEventId(act[0].id)
      })
      .catch(() => {})

    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {

    let alive = true

    const timer = window.setTimeout(() => {

      const search = q.trim()

      void apiJson<TeamRow[]>(
        `/teams${search ? `?q=${encodeURIComponent(search)}` : ''}`,
      )

        .then((t) => {
          if (alive) setTeams(Array.isArray(t) ? t : [])
        })

        .catch(() => {})

    }, 200)



    return () => {
      alive = false
      window.clearTimeout(timer)

    }


  }, [q])



  const selectedTeam = useMemo(() => teams.find((t) => t.id === teamId), [teamId, teams])

  async function submit() {
    setErr(null)

    if (!teamId) {
      setErr('Bitte Verein / Team auswählen.')

      return
    }

    if (!eventId) {
      setErr('Bitte Veranstaltung auswählen.')

      return
    }



    setBusy(true)

    try {
      await props.onConfirmed({
        teamId,
        eventId,
        contactName: contact.trim() || undefined,

        note: note.trim() || undefined,
      })
    } catch (e) {
      setErr(String((e as Error).message || e))
    } finally {

      setBusy(false)
    }
  }

  return (

    <div

      className="fixed inset-0 z-[64] flex items-center justify-center bg-black/85 p-3 backdrop-blur-md"


      role="dialog"

      aria-modal
    >
      <div className="panel-dlrg w-full max-w-xl overflow-hidden rounded-2xl border border-[#ff003c]/50 shadow-[0_0_72px_rgba(255,0,60,0.35)]">
        <div className="border-b border-[#ff003c]/35 bg-neutral-950/80 px-5 py-4">
          <h2 className="text-xl font-black tracking-wide text-[#FFD700]">Auf Rechnung verbuchen</h2>


          <p className="mt-1 text-sm font-semibold text-neutral-400">
            Team wählen, Veranstaltung zuordnen, optional Hinweis. Summe{' '}


            <span className="text-[#FFD700]">{formatMoney(props.totalCents)}</span>
          </p>
        </div>

        <div className="max-h-[60vh] space-y-3 overflow-y-auto px-5 py-4">
          <label className="block text-xs font-bold uppercase tracking-wider text-neutral-500">

            Verein suchen

            <input

              autoFocus


              value={q}
              onChange={(e) => setQ(e.target.value)}

              className="mt-1 w-full rounded-xl border border-[#ff003c]/35 bg-neutral-950 px-3 py-3 text-white outline-none focus:border-[#FFD700]/50"


              placeholder="z. B. DLRG Mössingen"
            />

          </label>



          <div className="max-h-40 overflow-y-auto rounded-xl border border-white/10">
            {(teams ?? []).length === 0 ? (
              <p className="p-4 text-sm text-neutral-500">Keine Teams gefunden …</p>
            ) : (

              (teams ?? []).map((t) => (
                <button
                  key={t.id}


                  type="button"
                  className={[

                    'flex w-full items-center justify-between border-b border-white/5 px-4 py-3 text-left',

                    teamId === t.id ? 'bg-red-950/50' : 'hover:bg-neutral-950',
                  ].join(' ')}
                  onClick={() => {

                    setTeamId(t.id)
                    setContact(t.contact_name?.trim() ?? '')
                  }}

                >
                  <span className="font-bold text-white">{t.name}</span>
                  <span className="text-neutral-400">›</span>
                </button>
              ))
            )}

          </div>



          {selectedTeam && (
            <p className="text-xs text-neutral-400">
              E-Mail für Rechnung:{' '}


              <span className="text-neutral-300">

                {(selectedTeam.invoice_email ?? '—').toString()}
              </span>
            </p>
          )}



          <label className="block text-xs font-bold uppercase tracking-wider text-neutral-500">

            Veranstaltung (Event)

            <select


              value={eventId}


              onChange={(e) => setEventId(e.target.value)}
              className="mt-1 w-full rounded-xl border border-[#ff003c]/35 bg-neutral-950 px-3 py-3 font-semibold text-white outline-none focus:border-[#FFD700]/50"

            >
              <option value="">Bitte auswählen …</option>

              {events.map((e) => {
                const s = String(e.startDate ?? e.start_date ?? '')
                const nd = String(e.endDate ?? e.end_date ?? '')

                return (
                  <option key={e.id} value={e.id}>
                    {e.name}


                    {' '}
                    ({s} · {nd})
                  </option>
                )
              })}
            </select>
          </label>



          <label className="block text-xs font-bold uppercase tracking-wider text-neutral-500">

            Ansprechpartner/in (optional)
            <input

              value={contact}

              onChange={(e) => setContact(e.target.value)}
              className="mt-1 w-full rounded-xl border border-[#ff003c]/35 bg-neutral-950 px-3 py-3 text-white outline-none focus:border-[#FFD700]/50"


            />

          </label>



          <label className="block text-xs font-bold uppercase tracking-wider text-neutral-500">

            Notiz (optional)
            <input

              value={note}


              onChange={(e) => setNote(e.target.value)}


              placeholder="z. B. Helferteam Samstag"


              className="mt-1 w-full rounded-xl border border-[#ff003c]/35 bg-neutral-950 px-3 py-3 text-white outline-none focus:border-[#FFD700]/50"

            />

          </label>



          <div className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-neutral-500">
            Auf dem Bondrucker kann optional nur die Testsystem-Hinweise erscheinen – der echte Nachweis liegt auf dem Server.
          </div>
        </div>



        {err ? (
          <div className="px-5 pb-2 text-sm font-semibold text-red-400">{err}</div>
        ) : null}



        <div className="flex gap-2 border-t border-[#ff003c]/30 bg-black px-5 py-4">
          <button

            type="button"

            disabled={busy}
            className="flex-1 rounded-xl border border-white/15 py-3 font-bold text-neutral-300 disabled:opacity-40"

            onClick={props.onCancel}
          >

            Abbrechen
          </button>

          <button

            type="button"

            disabled={
              busy ||

              props.cartLines.length === 0 ||

              !teamId ||

              !eventId
            }
            className="flex-1 rounded-xl border-2 border-[#ff003c] bg-red-950/40 py-3 font-black uppercase text-white shadow-[0_0_24px_rgba(255,0,60,0.25)] hover:bg-red-950/55 disabled:opacity-40"

            onClick={() => void submit()}
          >
            Rechnungsposten verbuchen
          </button>
        </div>
      </div>
    </div>
  )
}
