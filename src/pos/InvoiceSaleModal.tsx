import { useEffect, useMemo, useRef, useState } from 'react'
import { apiJson } from '../api/http'
import { formatMoney } from '../lib/format'
import type { CartLine } from '../types'
import {
  addDemoTeam,
  isDemoMode,
  useDemoMode,
  useDemoTeams,
} from '../demo/demoStore'

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
    teamName: string
  }) => void | Promise<void>
}) {

  const { cartLines, totalCents, onCancel, onConfirmed } = props
  const demoMode = useDemoMode()
  const demoTeams = useDemoTeams()

  const [q, setQ] = useState('')

  const [apiTeams, setApiTeams] = useState<TeamRow[]>([])
  const [apiEvents, setApiEvents] = useState<EventRow[]>([])
  const [teamId, setTeamId] = useState('')
  const [eventId, setEventId] = useState('')

  // In Demo: synthetisches Demo-Event und gefilterte Demo-Teams als
  // derivierte Werte (kein setState im Effekt, kein Cascade-Render).
  const demoEventList = useMemo<EventRow[]>(() => {
    if (!demoMode) return []
    const today = new Date().toISOString().slice(0, 10)
    return [
      {
        id: 'demo-event',
        name: 'DEMO-Veranstaltung',
        startDate: today,
        endDate: today,
        status: 'active',
      },
    ]
  }, [demoMode])

  const demoTeamList = useMemo<TeamRow[]>(() => {
    if (!demoMode) return []
    const search = q.trim().toLowerCase()
    return demoTeams
      .filter((t) => t.active)
      .filter((t) =>
        search
          ? `${t.name} ${t.shortName ?? ''}`.toLowerCase().includes(search)
          : true,
      )
      .map<TeamRow>((t) => ({
        id: t.id,
        name: t.name,
        contact_name: t.contactName ?? '',
        invoice_email: t.invoiceEmail ?? null,
      }))
  }, [demoMode, demoTeams, q])

  const teams: TeamRow[] = demoMode ? demoTeamList : apiTeams
  const events: EventRow[] = demoMode ? demoEventList : apiEvents

  const demoEventAutoSet = useRef(false)
  useEffect(() => {
    if (demoMode && !demoEventAutoSet.current && demoEventList.length === 1) {
      demoEventAutoSet.current = true
      setEventId(demoEventList[0].id)
    }
  }, [demoMode, demoEventList])
  const [contact, setContact] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const [showNewTeam, setShowNewTeam] = useState(false)
  const [newName, setNewName] = useState('')
  const [newInvoiceEmail, setNewInvoiceEmail] = useState('')
  const [newContactName, setNewContactName] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [newBillingAddress, setNewBillingAddress] = useState('')
  const [newPaymentDays, setNewPaymentDays] = useState('14')
  const [newCustomerNo, setNewCustomerNo] = useState('')
  const [newInternalNote, setNewInternalNote] = useState('')
  const [newCostCenter, setNewCostCenter] = useState('')
  const [newDepartment, setNewDepartment] = useState('')
  const [newLocalGroup, setNewLocalGroup] = useState('')
  const [createBusy, setCreateBusy] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  useEffect(() => {
    if (demoMode) return
    let alive = true
    void apiJson<EventRow[]>('/events')
      .then((ev) => {
        if (!alive) return
        const act = ev.filter((e) => e.status === 'active')
        setApiEvents(act)
        if (act.length === 1) setEventId(act[0].id)
      })
      .catch(() => {})

    return () => {
      alive = false
    }
  }, [demoMode])

  useEffect(() => {
    if (demoMode) return
    let alive = true
    const timer = window.setTimeout(() => {
      const search = q.trim()
      void apiJson<TeamRow[]>(
        `/teams${search ? `?q=${encodeURIComponent(search)}` : ''}`,
      )
        .then((t) => {
          if (alive) setApiTeams(Array.isArray(t) ? t : [])
        })
        .catch(() => {})
    }, 200)

    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [demoMode, q])



  const selectedTeam = useMemo(() => teams.find((t) => t.id === teamId), [teamId, teams])

  async function createTeamAndSelect() {
    const name = newName.trim()
    if (!name) {
      setErr('Teamname angeben.')
      return
    }
    const pd = Number.parseInt(newPaymentDays.trim(), 10)
    const defaultPaymentDays = Number.isFinite(pd) && pd > 0 ? pd : 14

    setErr(null)
    setCreateBusy(true)
    try {
      // DEMO-Modus: ausschliesslich in-memory Demo-Team, KEIN POST /teams.
      if (isDemoMode()) {
        const t = addDemoTeam({
          name,
          shortName: undefined,
          contactName: newContactName.trim(),
          invoiceEmail: newInvoiceEmail.trim(),
          phone: newPhone.trim(),
          billingAddress: newBillingAddress.trim(),
          paymentTermsDays: defaultPaymentDays,
          active: true,
        })
        setTeamId(t.id)
        setContact(newContactName.trim())
        setQ('')
        setShowNewTeam(false)
        setNewName('')
        setNewInvoiceEmail('')
        setNewContactName('')
        setNewPhone('')
        setNewBillingAddress('')
        setNewPaymentDays('14')
        setNewCustomerNo('')
        setNewInternalNote('')
        setNewCostCenter('')
        setNewDepartment('')
        setNewLocalGroup('')
        return
      }

      const r = await apiJson<{ id: string }>('/teams', {
        method: 'POST',
        body: JSON.stringify({
          name,
          invoiceEmail: newInvoiceEmail.trim(),
          contactName: newContactName.trim(),
          phone: newPhone.trim(),
          billingAddress: newBillingAddress.trim(),
          defaultPaymentDays,
          ...(newCustomerNo.trim()
            ? { customerNo: newCustomerNo.trim() }
            : {}),
          ...(newInternalNote.trim()
            ? { internalNote: newInternalNote.trim() }
            : {}),
          ...(newCostCenter.trim() ? { costCenter: newCostCenter.trim() } : {}),
          ...(newDepartment.trim() ? { department: newDepartment.trim() } : {}),
          ...(newLocalGroup.trim() ? { localGroup: newLocalGroup.trim() } : {}),
        }),
      })

      const id = r?.id?.trim?.() ?? ''
      if (!id) throw new Error('Keine Team-ID von der API.')

      setApiTeams((prev) => [
        {
          id,
          name,
          contact_name: newContactName.trim(),
          invoice_email: newInvoiceEmail.trim() || null,
        },
        ...prev.filter((t) => t.id !== id),
      ])
      setTeamId(id)
      setContact(newContactName.trim())
      setQ('')
      setShowNewTeam(false)
      setNewName('')
      setNewInvoiceEmail('')
      setNewContactName('')
      setNewPhone('')
      setNewBillingAddress('')
      setNewPaymentDays('14')
      setNewCustomerNo('')
      setNewInternalNote('')
      setNewCostCenter('')
      setNewDepartment('')
      setNewLocalGroup('')
    } catch (e) {
      setErr(String((e as Error).message ?? e))
    } finally {
      setCreateBusy(false)
    }
  }

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
      await onConfirmed({
        teamId,
        eventId,
        contactName: contact.trim() || undefined,
        note: note.trim() || undefined,
        teamName: (selectedTeam?.name ?? '').trim(),
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
          <h2 className="text-xl font-black tracking-wide text-[#FFD700]">
            {demoMode ? 'Auf Rechnung verbuchen (DEMO – simuliert)' : 'Auf Rechnung verbuchen'}
          </h2>


          <p className="mt-1 text-sm font-semibold text-neutral-400">
            Team wählen, Veranstaltung zuordnen, optional Hinweis. Esc oder „Zurück“
            ohne Buchung schließen. Summe{' '}


            <span className="text-[#FFD700]">{formatMoney(totalCents)}</span>
          </p>
          {demoMode && (
            <p className="mt-2 rounded-lg border border-yellow-500/40 bg-yellow-950/20 px-3 py-2 text-xs font-bold text-yellow-200">
              Demo-Team – wird nicht dauerhaft gespeichert. Es wird KEINE echte
              Rechnung erstellt, KEIN echter Umsatz erzeugt.
            </p>
          )}
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

          <div className="overflow-hidden rounded-xl border border-[#FFD700]/25 bg-yellow-950/10">
            <button
              type="button"
              className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-bold text-[#FFD700]"
              onClick={() => setShowNewTeam((v) => !v)}
              aria-expanded={showNewTeam}
            >
              <span>Neues Team / Verein anlegen (Server)</span>
              <span className="tabular-nums text-neutral-400">{showNewTeam ? '▾' : '▸'}</span>
            </button>
            {showNewTeam ? (
            <div className="space-y-2 border-t border-white/10 px-4 py-3">
              <label className="block text-xs font-bold uppercase tracking-wider text-neutral-500">
                Name *
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-[#ff003c]/35 bg-neutral-950 px-3 py-2 text-white outline-none focus:border-[#FFD700]/50"
                  placeholder="z. B. DLRG Ortsgruppe …"
                />
              </label>
              <label className="block text-xs font-bold uppercase tracking-wider text-neutral-500">
                Rechnungs-E-Mail
                <input
                  type="email"
                  value={newInvoiceEmail}
                  onChange={(e) => setNewInvoiceEmail(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-[#ff003c]/35 bg-neutral-950 px-3 py-2 text-white outline-none focus:border-[#FFD700]/50"
                />
              </label>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="block text-xs font-bold uppercase tracking-wider text-neutral-500">
                  Ansprechpartner/in
                  <input
                    value={newContactName}
                    onChange={(e) => setNewContactName(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-[#ff003c]/35 bg-neutral-950 px-3 py-2 text-white outline-none focus:border-[#FFD700]/50"
                  />
                </label>
                <label className="block text-xs font-bold uppercase tracking-wider text-neutral-500">
                  Telefon
                  <input
                    value={newPhone}
                    onChange={(e) => setNewPhone(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-[#ff003c]/35 bg-neutral-950 px-3 py-2 text-white outline-none focus:border-[#FFD700]/50"
                  />
                </label>
              </div>
              <label className="block text-xs font-bold uppercase tracking-wider text-neutral-500">
                Rechnungsanschrift
                <textarea
                  value={newBillingAddress}
                  onChange={(e) => setNewBillingAddress(e.target.value)}
                  rows={2}
                  className="mt-1 w-full resize-y rounded-xl border border-[#ff003c]/35 bg-neutral-950 px-3 py-2 text-sm text-white outline-none focus:border-[#FFD700]/50"
                />
              </label>
              <label className="block text-xs font-bold uppercase tracking-wider text-neutral-500">
                Zahlungsziel (Tage)
                <input
                  inputMode="numeric"
                  value={newPaymentDays}
                  onChange={(e) => setNewPaymentDays(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-[#ff003c]/35 bg-neutral-950 px-3 py-2 text-white outline-none focus:border-[#FFD700]/50 sm:max-w-[10rem]"
                />
              </label>
              <p className="text-[11px] text-neutral-500">Optional:</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="block text-xs font-bold uppercase tracking-wider text-neutral-500">
                  Kunden‑Nr.
                  <input
                    value={newCustomerNo}
                    onChange={(e) => setNewCustomerNo(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-[#ff003c]/35 bg-neutral-950 px-3 py-2 text-white outline-none focus:border-[#FFD700]/50"
                  />
                </label>
                <label className="block text-xs font-bold uppercase tracking-wider text-neutral-500">
                  Kostenstelle
                  <input
                    value={newCostCenter}
                    onChange={(e) => setNewCostCenter(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-[#ff003c]/35 bg-neutral-950 px-3 py-2 text-white outline-none focus:border-[#FFD700]/50"
                  />
                </label>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="block text-xs font-bold uppercase tracking-wider text-neutral-500">
                  Abteilung
                  <input
                    value={newDepartment}
                    onChange={(e) => setNewDepartment(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-[#ff003c]/35 bg-neutral-950 px-3 py-2 text-white outline-none focus:border-[#FFD700]/50"
                  />
                </label>
                <label className="block text-xs font-bold uppercase tracking-wider text-neutral-500">
                  Ortsgruppe
                  <input
                    value={newLocalGroup}
                    onChange={(e) => setNewLocalGroup(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-[#ff003c]/35 bg-neutral-950 px-3 py-2 text-white outline-none focus:border-[#FFD700]/50"
                  />
                </label>
              </div>
              <label className="block text-xs font-bold uppercase tracking-wider text-neutral-500">
                Interne Notiz
                <input
                  value={newInternalNote}
                  onChange={(e) => setNewInternalNote(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-[#ff003c]/35 bg-neutral-950 px-3 py-2 text-white outline-none focus:border-[#FFD700]/50"
                />
              </label>
              <button
                type="button"
                disabled={createBusy || !newName.trim()}
                className="w-full rounded-xl border-2 border-[#FFD700]/60 bg-black/60 py-3 font-black text-[#FFD700] hover:bg-yellow-950/30 disabled:opacity-40"
                onClick={() => void createTeamAndSelect()}
              >
                Team speichern &amp; auswählen
              </button>
            </div>
            ) : null}
          </div>

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

            onClick={onCancel}
          >

            ← Zurück zur Kasse
          </button>

          <button

            type="button"

            disabled={
              busy ||

              cartLines.length === 0 ||

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
