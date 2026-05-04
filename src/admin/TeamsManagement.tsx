import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiJson, ApiError, describeApiReachability } from '../api/http'
import { login } from '../api/auth'
import { getStoredRole, getStoredToken } from '../api/config'
import { formatDateTime } from '../lib/format'
import {
  addDemoTeam,
  archiveDemoTeam,
  isDemoMode,
  toggleDemoTeamActive,
  updateDemoTeam,
  useDemoMode,
  useDemoTeams,
} from '../demo/demoStore'

type TeamRow = Record<string, unknown>

function pickStr(r: TeamRow, ...keys: string[]) {
  for (const k of keys) {
    const v = r[k]
    if (v != null && String(v) !== '') return String(v)
  }
  return ''
}

function pickNum(r: TeamRow, k: string, fallback: number) {
  const v = r[k]
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : fallback
}

function pickBool(r: TeamRow, k: string) {
  const v = r[k]
  if (typeof v === 'boolean') return v
  return Boolean(Number(v ?? 0))
}

type ModalState =
  | null
  | { mode: 'create' }
  | {
      mode: 'edit'
      id: string
    }

const emptyForm = {
  name: '',
  shortName: '',
  contactName: '',
  invoiceEmail: '',
  phone: '',
  billingAddress: '',
  customerNo: '',
  internalNote: '',
  defaultPaymentDays: '14',
  active: true,
  costCenter: '',
  department: '',
  localGroup: '',
}

export function TeamsManagement(props: { onTeamsChanged: () => void }) {
  const demoMode = useDemoMode()
  const demoTeams = useDemoTeams()
  const [authRev, setAuthRev] = useState(0)
  const [teams, setTeams] = useState<TeamRow[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'active' | 'inactive'>('all')
  const [modal, setModal] = useState<ModalState>(null)
  const [form, setForm] = useState(emptyForm)
  const [loginUser, setLoginUser] = useState('admin')
  const [loginPin, setLoginPin] = useState('')
  const [loginErr, setLoginErr] = useState<string | null>(null)
  const [loginBusy, setLoginBusy] = useState(false)

  useEffect(() => {
    const fn = () => setAuthRev((x) => x + 1)
    window.addEventListener('drk-kasse-auth', fn)
    return () => window.removeEventListener('drk-kasse-auth', fn)
  }, [])

  const token = getStoredToken()
  const role = getStoredRole()
  const isApiAdmin = Boolean(token) && role === 'admin'
  // Im Demo-Modus arbeiten wir grundsaetzlich auf der demoTeams-Liste,
  // unabhaengig vom API-Login. Echte teams-Tabelle wird NIE beruehrt.
  const isAdminLike = isApiAdmin || demoMode

  const loadTeams = useCallback(async () => {
    if (demoMode) {
      setTeams(
        demoTeams.map((t) => ({
          id: t.id,
          name: t.name,
          short_name: t.shortName ?? '',
          contact_name: t.contactName ?? '',
          invoice_email: t.invoiceEmail ?? '',
          phone: t.phone ?? '',
          billing_address: t.billingAddress ?? '',
          customer_no: '',
          internal_note: '',
          default_payment_days: t.paymentTermsDays,
          active: t.active ? 1 : 0,
          cost_center: '',
          department: '',
          local_group: '',
          updated_at: 0,
          is_demo: 1,
        })),
      )
      setErr(null)
      return
    }
    if (!token || role !== 'admin') {
      setTeams([])
      return
    }
    setBusy(true)
    setErr(null)
    try {
      const rows = await apiJson<TeamRow[]>('/teams/all')
      setTeams(Array.isArray(rows) ? rows : [])
    } catch (e) {
      if (e instanceof ApiError && e.status === 401)
        setErr('Nicht angemeldet oder keine Berechtigung. Bitte erneut an der API anmelden (Benutzer admin).')
      else if (e instanceof ApiError && e.status === 0)
        setErr(
          `Backend nicht erreichbar oder nicht angemeldet. Bitte API-Verbindung prüfen. (${describeApiReachability('/health')})`,
        )
      else setErr(String((e as Error).message))
      setTeams([])
    } finally {
      setBusy(false)
    }
  }, [demoMode, demoTeams, token, role, authRev])

  useEffect(() => {
    void loadTeams()
  }, [loadTeams])

  const filtered = useMemo(() => {
    let rows = teams
    const q = search.trim().toLowerCase()
    if (q) {
      rows = rows.filter((t) => {
        const blob = [
          pickStr(t, 'name'),
          pickStr(t, 'short_name'),
          pickStr(t, 'contact_name'),
          pickStr(t, 'invoice_email'),
          pickStr(t, 'customer_no'),
        ]
          .join(' ')
          .toLowerCase()
        return blob.includes(q)
      })
    }
    if (filter === 'active') rows = rows.filter((t) => pickBool(t, 'active'))
    if (filter === 'inactive') rows = rows.filter((t) => !pickBool(t, 'active'))
    return rows
  }, [teams, search, filter])

  function openCreate() {
    setForm({ ...emptyForm })
    setModal({ mode: 'create' })
  }

  function openEdit(row: TeamRow) {
    const id = pickStr(row, 'id')
    setForm({
      name: pickStr(row, 'name'),
      shortName: pickStr(row, 'short_name'),
      contactName: pickStr(row, 'contact_name'),
      invoiceEmail: pickStr(row, 'invoice_email'),
      phone: pickStr(row, 'phone'),
      billingAddress: pickStr(row, 'billing_address'),
      customerNo: pickStr(row, 'customer_no'),
      internalNote: pickStr(row, 'internal_note'),
      defaultPaymentDays: String(pickNum(row, 'default_payment_days', 14)),
      active: pickBool(row, 'active'),
      costCenter: pickStr(row, 'cost_center'),
      department: pickStr(row, 'department'),
      localGroup: pickStr(row, 'local_group'),
    })
    setModal({ mode: 'edit', id })
  }

  function closeModal() {
    setModal(null)
    setForm(emptyForm)
  }

  async function submitModal() {
    if (!form.name.trim()) return
    const days = Number.parseInt(form.defaultPaymentDays.trim(), 10)
    const defaultPaymentDays = Number.isFinite(days) && days > 0 ? days : 14
    const body = {
      name: form.name.trim(),
      shortName: form.shortName.trim() || undefined,
      contactName: form.contactName.trim(),
      invoiceEmail: form.invoiceEmail.trim(),
      phone: form.phone.trim(),
      billingAddress: form.billingAddress.trim(),
      customerNo: form.customerNo.trim() || undefined,
      internalNote: form.internalNote.trim(),
      defaultPaymentDays,
      active: form.active,
      costCenter: form.costCenter.trim() || undefined,
      department: form.department.trim() || undefined,
      localGroup: form.localGroup.trim() || undefined,
    }
    setBusy(true)
    setErr(null)
    try {
      // DEMO-Modus: ausschliesslich in-memory Demo-Teams.
      if (isDemoMode()) {
        if (modal?.mode === 'create') {
          addDemoTeam({
            name: body.name,
            shortName: body.shortName,
            contactName: body.contactName,
            invoiceEmail: body.invoiceEmail,
            phone: body.phone,
            billingAddress: body.billingAddress,
            paymentTermsDays: body.defaultPaymentDays,
            active: body.active,
          })
        } else if (modal?.mode === 'edit') {
          updateDemoTeam(modal.id, {
            name: body.name,
            shortName: body.shortName,
            contactName: body.contactName,
            invoiceEmail: body.invoiceEmail,
            phone: body.phone,
            billingAddress: body.billingAddress,
            paymentTermsDays: body.defaultPaymentDays,
            active: body.active,
          })
        }
        closeModal()
        await loadTeams()
        props.onTeamsChanged()
        return
      }

      if (modal?.mode === 'create') {
        await apiJson('/teams', { method: 'POST', body: JSON.stringify(body) })
      } else if (modal?.mode === 'edit') {
        await apiJson(`/teams/${modal.id}`, {
          method: 'PUT',
          body: JSON.stringify(body),
        })
      }
      closeModal()
      await loadTeams()
      props.onTeamsChanged()
    } catch (e) {
      setErr(String((e as Error).message))
    } finally {
      setBusy(false)
    }
  }

  async function archiveTeam(id: string) {
    if (!window.confirm('Dieses Team wirklich deaktivieren (archivieren)?')) return
    setBusy(true)
    setErr(null)
    try {
      if (isDemoMode()) {
        archiveDemoTeam(id)
        await loadTeams()
        props.onTeamsChanged()
        return
      }
      await apiJson(`/teams/${id}`, { method: 'DELETE' })
      await loadTeams()
      props.onTeamsChanged()
    } catch (e) {
      setErr(String((e as Error).message))
    } finally {
      setBusy(false)
    }
  }

  async function toggleActive(id: string, next: boolean) {
    setBusy(true)
    setErr(null)
    try {
      if (isDemoMode()) {
        toggleDemoTeamActive(id, next)
        await loadTeams()
        props.onTeamsChanged()
        return
      }
      await apiJson(`/teams/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ active: next }),
      })
      await loadTeams()
      props.onTeamsChanged()
    } catch (e) {
      setErr(String((e as Error).message))
    } finally {
      setBusy(false)
    }
  }

  async function seedDemo() {
    if (isDemoMode()) {
      setErr('Im Demo-Modus deaktiviert (Demo-Teams sind bereits geladen).')
      return
    }
    if (!window.confirm('Demo-Teams anlegen? Nur möglich, wenn noch keine Teams existieren.')) return
    setBusy(true)
    setErr(null)
    try {
      await apiJson('/teams/seed-demo', { method: 'POST', body: '{}' })
      await loadTeams()
      props.onTeamsChanged()
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setErr('Es existieren bereits Teams — Demo-Import übersprungen.')
      } else setErr(String((e as Error).message))
    } finally {
      setBusy(false)
    }
  }

  async function submitLogin() {
    setLoginBusy(true)
    setLoginErr(null)
    try {
      await login(loginUser.trim(), loginPin)
      setLoginPin('')
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) setLoginErr(e.message)
      else setLoginErr('Anmeldung fehlgeschlagen (Benutzer/PIN oder Serverfehler).')
    } finally {
      setLoginBusy(false)
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold text-white">
            {demoMode ? 'Teams / Vereine (DEMO)' : 'Teams / Vereine'}
          </h3>
          {demoMode ? (
            <p className="mt-1 max-w-2xl text-xs font-bold text-yellow-300">
              Demo-Team – wird nicht dauerhaft gespeichert. Echte Teams bleiben
              unverändert.
            </p>
          ) : (
            <p className="mt-1 max-w-2xl text-xs text-neutral-400">
              Stammdaten liegen in der Server-SQLite unter{' '}
              <code className="text-cyan-200">$DATA_ROOT/db/kasse.sqlite</code> — auf Railway{' '}
              <code className="text-cyan-200">DATA_ROOT=/DATA</code> setzen und Volume mounten, damit nichts bei
              Deployments verloren geht.
            </p>
          )}
        </div>
        {isAdminLike ? (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void loadTeams()}
              className="rounded-lg border border-cyan-500/50 px-3 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-500/10 disabled:opacity-40"
            >
              Liste aktualisieren
            </button>
            {!demoMode && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void seedDemo()}
                className="rounded-lg border border-white/15 px-3 py-2 text-sm text-neutral-300 hover:bg-white/5 disabled:opacity-40"
              >
                Demo-Teams (nur wenn leer)
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={openCreate}
              className="rounded-lg bg-gradient-to-r from-cyan-600 to-blue-600 px-4 py-2 text-sm font-bold text-white shadow-[0_0_24px_rgba(34,211,238,0.35)] disabled:opacity-40"
            >
              {demoMode ? 'Demo-Team anlegen' : 'Team / Verein anlegen'}
            </button>
          </div>
        ) : null}
      </div>

      {!token && !demoMode ? (
        <div className="rounded-xl border border-cyan-500/30 bg-black/40 p-5 shadow-[0_0_40px_rgba(6,182,212,0.12)]">
          <p className="text-sm font-semibold text-cyan-100">API-Anmeldung</p>
          <p className="mt-1 text-xs text-neutral-400">
            Melden Sie sich mit Benutzer <code className="text-cyan-200">admin</code> und der
            API-PIN an. Auf Railway nutzt die Kasse standardmässig dieselbe Adresse wie die
            Seite; die API liegt unter dem Pfad{' '}
            <code className="text-cyan-200">/api</code> (keine separate VITE-URL nötig).
            Health-Check:{' '}
            <code className="text-cyan-200">{describeApiReachability('/health')}</code>
          </p>
          <div className="mt-4 grid max-w-md gap-3 md:grid-cols-2">
            <label className="text-xs text-neutral-500 md:col-span-2">
              Benutzer
              <input
                className="mt-1 w-full rounded-lg border border-cyan-500/30 bg-neutral-950 px-3 py-2 text-white"
                value={loginUser}
                onChange={(e) => setLoginUser(e.target.value)}
                autoComplete="username"
              />
            </label>
            <label className="text-xs text-neutral-500 md:col-span-2">
              PIN
              <input
                type="password"
                inputMode="numeric"
                className="mt-1 w-full rounded-lg border border-cyan-500/30 bg-neutral-950 px-3 py-2 text-white"
                value={loginPin}
                onChange={(e) => setLoginPin(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void submitLogin()
                }}
                autoComplete="current-password"
              />
            </label>
          </div>
          {loginErr && <p className="mt-3 text-sm text-red-400">{loginErr}</p>}
          <button
            type="button"
            disabled={loginBusy || loginPin.length < 4}
            onClick={() => void submitLogin()}
            className="mt-4 rounded-lg bg-gradient-to-r from-rose-600 to-orange-500 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-40"
          >
            Anmelden
          </button>
        </div>
      ) : null}

      {token && role !== 'admin' && !demoMode ? (
        <p className="rounded-lg border border-amber-500/40 bg-amber-950/30 p-3 text-sm text-amber-100">
          Angemeldet als <strong>{role ?? '?'}</strong>. Für die Teamverwaltung bitte mit{' '}
          <code className="text-cyan-200">admin</code> an der API anmelden (Abmelden über die Kasse, falls
          vorhanden, dann neu anmelden).
        </p>
      ) : null}

      {!token && !demoMode ? (
        <p className="text-xs text-neutral-500">
          Hinweis: Die lokale Kasse funktioniert ohne API weiter; Teams werden nur auf dem Server gespeichert.
        </p>
      ) : null}

      {err && (
        <p className="rounded-lg border border-red-500/40 bg-red-950/30 p-3 text-sm text-red-100">{err}</p>
      )}

      {isAdminLike ? (
        <>
          <div className="flex flex-wrap gap-3">
            <input
              placeholder="Suche (Name, Kurzname, E-Mail, Kunden-Nr.)…"
              className="min-w-[200px] flex-1 rounded-lg border border-white/15 bg-neutral-950 px-3 py-2 text-sm text-white"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select
              className="rounded-lg border border-white/15 bg-neutral-950 px-3 py-2 text-sm text-white"
              value={filter}
              onChange={(e) => setFilter(e.target.value as typeof filter)}
            >
              <option value="all">Alle</option>
              <option value="active">Nur aktiv</option>
              <option value="inactive">Nur inaktiv</option>
            </select>
          </div>

          <div className="overflow-auto rounded-xl border border-white/10">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b border-white/10 bg-black/40 text-xs uppercase tracking-wide text-neutral-500">
                <tr>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Kurz</th>
                  <th className="px-3 py-2">Kontakt</th>
                  <th className="px-3 py-2">Ziel (Tage)</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Geändert</th>
                  <th className="px-3 py-2 text-right">Aktionen</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((t) => {
                  const id = pickStr(t, 'id')
                  const active = pickBool(t, 'active')
                  const updated = pickNum(t, 'updated_at', 0)
                  return (
                    <tr key={id || Math.random()} className="border-t border-white/5 hover:bg-white/[0.03]">
                      <td className="px-3 py-2 font-medium text-white">{pickStr(t, 'name')}</td>
                      <td className="px-3 py-2 text-neutral-300">{pickStr(t, 'short_name') || '—'}</td>
                      <td className="max-w-[200px] truncate px-3 py-2 text-neutral-400">
                        {pickStr(t, 'contact_name') || pickStr(t, 'invoice_email') || '—'}
                      </td>
                      <td className="px-3 py-2 tabular-nums text-neutral-300">
                        {pickNum(t, 'default_payment_days', 14)}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={
                            active ? 'text-emerald-300' : 'text-neutral-500 line-through decoration-neutral-500'
                          }
                        >
                          {active ? 'Aktiv' : 'Inaktiv'}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs text-neutral-500">
                        {updated ? formatDateTime(updated) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          className="mr-1 rounded border border-cyan-500/40 px-2 py-1 text-xs text-cyan-200 hover:bg-cyan-500/10"
                          onClick={() => openEdit(t)}
                        >
                          Bearbeiten
                        </button>
                        {active ? (
                          <button
                            type="button"
                            className="mr-1 rounded border border-amber-600/50 px-2 py-1 text-xs text-amber-200 hover:bg-amber-900/30"
                            onClick={() => void toggleActive(id, false)}
                          >
                            Deaktivieren
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="mr-1 rounded border border-emerald-600/50 px-2 py-1 text-xs text-emerald-200 hover:bg-emerald-900/30"
                            onClick={() => void toggleActive(id, true)}
                          >
                            Aktivieren
                          </button>
                        )}
                        <button
                          type="button"
                          className="rounded border border-red-900/60 px-2 py-1 text-xs text-red-300 hover:bg-red-950/40"
                          onClick={() => void archiveTeam(id)}
                        >
                          Archiv
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {filtered.length === 0 && !busy ? (
              <p className="p-6 text-center text-sm text-neutral-500">Keine Teams für die aktuelle Filterung.</p>
            ) : null}
          </div>
        </>
      ) : null}

      {modal ? (
        <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm">
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-cyan-400/40 p-6 shadow-[0_0_48px_rgba(34,211,238,0.25)]"
            style={{
              background: 'linear-gradient(160deg, rgba(8,20,30,0.98) 0%, rgba(5,8,15,0.98) 100%)',
            }}
          >
            <h4 className="text-lg font-black tracking-tight text-[#FFD700]">
              {modal.mode === 'create'
                ? demoMode
                  ? 'Neues Demo-Team / Verein'
                  : 'Neues Team / Verein'
                : demoMode
                  ? 'Demo-Team bearbeiten'
                  : 'Team bearbeiten'}
            </h4>
            <p className="mt-1 text-xs text-cyan-100/80">Pflicht: Name · Zahlungsziel in Tagen</p>
            {demoMode && (
              <p className="mt-2 rounded-lg border border-yellow-500/40 bg-yellow-950/20 px-3 py-2 text-xs font-bold text-yellow-200">
                Demo-Team – wird nicht dauerhaft gespeichert
              </p>
            )}

            <div className="mt-4 grid gap-3">
              <label className="text-xs text-neutral-400">
                Name *
                <input
                  className="mt-1 w-full rounded-lg border border-cyan-500/35 bg-black/50 px-3 py-2 text-white"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
              </label>
              <label className="text-xs text-neutral-400">
                Kurzname (optional)
                <input
                  className="mt-1 w-full rounded-lg border border-cyan-500/35 bg-black/50 px-3 py-2 text-white"
                  value={form.shortName}
                  onChange={(e) => setForm((f) => ({ ...f, shortName: e.target.value }))}
                />
              </label>
              <label className="text-xs text-neutral-400">
                Ansprechpartner/in
                <input
                  className="mt-1 w-full rounded-lg border border-cyan-500/35 bg-black/50 px-3 py-2 text-white"
                  value={form.contactName}
                  onChange={(e) => setForm((f) => ({ ...f, contactName: e.target.value }))}
                />
              </label>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="text-xs text-neutral-400">
                  Rechnungs-E-Mail
                  <input
                    type="email"
                    className="mt-1 w-full rounded-lg border border-cyan-500/35 bg-black/50 px-3 py-2 text-white"
                    value={form.invoiceEmail}
                    onChange={(e) => setForm((f) => ({ ...f, invoiceEmail: e.target.value }))}
                  />
                </label>
                <label className="text-xs text-neutral-400">
                  Telefon
                  <input
                    className="mt-1 w-full rounded-lg border border-cyan-500/35 bg-black/50 px-3 py-2 text-white"
                    value={form.phone}
                    onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                  />
                </label>
              </div>
              <label className="text-xs text-neutral-400">
                Rechnungsadresse
                <textarea
                  rows={2}
                  className="mt-1 w-full resize-y rounded-lg border border-cyan-500/35 bg-black/50 px-3 py-2 text-white"
                  value={form.billingAddress}
                  onChange={(e) => setForm((f) => ({ ...f, billingAddress: e.target.value }))}
                />
              </label>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="text-xs text-neutral-400">
                  Kunden-Nr.
                  <input
                    className="mt-1 w-full rounded-lg border border-cyan-500/35 bg-black/50 px-3 py-2 text-white"
                    value={form.customerNo}
                    onChange={(e) => setForm((f) => ({ ...f, customerNo: e.target.value }))}
                  />
                </label>
                <label className="text-xs text-neutral-400">
                  Zahlungsziel (Tage)
                  <input
                    inputMode="numeric"
                    className="mt-1 w-full rounded-lg border border-cyan-500/35 bg-black/50 px-3 py-2 text-white"
                    value={form.defaultPaymentDays}
                    onChange={(e) => setForm((f) => ({ ...f, defaultPaymentDays: e.target.value }))}
                  />
                </label>
              </div>
              <label className="text-xs text-neutral-400">
                Interne Notiz
                <input
                  className="mt-1 w-full rounded-lg border border-cyan-500/35 bg-black/50 px-3 py-2 text-white"
                  value={form.internalNote}
                  onChange={(e) => setForm((f) => ({ ...f, internalNote: e.target.value }))}
                />
              </label>
              <div className="grid gap-3 md:grid-cols-3">
                <label className="text-xs text-neutral-400">
                  Kostenstelle
                  <input
                    className="mt-1 w-full rounded-lg border border-cyan-500/35 bg-black/50 px-3 py-2 text-white"
                    value={form.costCenter}
                    onChange={(e) => setForm((f) => ({ ...f, costCenter: e.target.value }))}
                  />
                </label>
                <label className="text-xs text-neutral-400">
                  Abteilung
                  <input
                    className="mt-1 w-full rounded-lg border border-cyan-500/35 bg-black/50 px-3 py-2 text-white"
                    value={form.department}
                    onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))}
                  />
                </label>
                <label className="text-xs text-neutral-400">
                  Ortsgruppe
                  <input
                    className="mt-1 w-full rounded-lg border border-cyan-500/35 bg-black/50 px-3 py-2 text-white"
                    value={form.localGroup}
                    onChange={(e) => setForm((f) => ({ ...f, localGroup: e.target.value }))}
                  />
                </label>
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-neutral-200">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
                />
                Aktiv (in Auswahl „Auf Rechnung“ sichtbar)
              </label>
            </div>

            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                className="rounded-lg border border-white/20 px-4 py-2 text-sm text-neutral-300 hover:bg-white/5"
                onClick={closeModal}
              >
                Abbrechen
              </button>
              <button
                type="button"
                disabled={busy || !form.name.trim()}
                onClick={() => void submitModal()}
                className="rounded-lg bg-gradient-to-r from-cyan-600 to-blue-600 px-5 py-2 text-sm font-bold text-white shadow-[0_0_20px_rgba(34,211,238,0.35)] disabled:opacity-40"
              >
                Speichern
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}
