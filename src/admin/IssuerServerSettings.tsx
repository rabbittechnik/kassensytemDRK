import { useCallback, useEffect, useState } from 'react'
import { apiJson } from '../api/http'
import { getStoredRole, getStoredToken } from '../api/config'
import { useDemoMode } from '../demo/demoStore'

/** Entspricht IssuerBlock auf dem Server (PDF / Rechnungen). */
export type IssuerFormState = {
  name: string
  street: string
  postalCode: string
  city: string
  country: string
  email: string
  phone: string
  bankName: string
  iban: string
  bic: string
  taxNumber: string
  vatId: string
}

const EMPTY: IssuerFormState = {
  name: '',
  street: '',
  postalCode: '',
  city: '',
  country: 'DE',
  email: '',
  phone: '',
  bankName: '',
  iban: '',
  bic: '',
  taxNumber: '',
  vatId: '',
}

type SettingsResponse = {
  org_name?: string
  issuer_snapshot?: string
}

export function IssuerServerSettingsBlock() {
  const demoMode = useDemoMode()
  const token = getStoredToken()
  const admin = getStoredRole() === 'admin'

  const [issuer, setIssuer] = useState<IssuerFormState>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [info, setInfo] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!token || !admin) {
      setLoading(false)
      return
    }
    setErr(null)
    setLoading(true)
    try {
      const s = await apiJson<SettingsResponse>('/settings')
      const raw = s.issuer_snapshot?.trim()
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as Partial<IssuerFormState>
          setIssuer({ ...EMPTY, ...parsed })
        } catch {
          setIssuer(EMPTY)
        }
      } else {
        setIssuer(EMPTY)
      }
    } catch (e) {
      setErr(String((e as Error).message ?? e))
    } finally {
      setLoading(false)
    }
  }, [token, admin])

  useEffect(() => {
    void load()
  }, [load])

  const save = async () => {
    if (!token || !admin || demoMode) return
    setSaving(true)
    setErr(null)
    setInfo(null)
    try {
      await apiJson('/settings', {
        method: 'PATCH',
        body: JSON.stringify({ issuerSnapshot: issuer }),
      })
      setInfo('Rechnungs- und Bankdaten wurden auf dem Server gespeichert.')
      await load()
    } catch (e) {
      setErr(String((e as Error).message ?? e))
    } finally {
      setSaving(false)
    }
  }

  if (!token) {
    return (
      <div className="mt-6 rounded-2xl border border-white/15 bg-white/5 p-4">
        <h3 className="font-semibold text-[#FFD700]">Rechnung · Bank (Server)</h3>
        <p className="mt-2 text-sm text-slate-400">
          Mit einem gültigen Login an der Kasse anmelden – dann können hier die Daten für
          Rechnungs-PDFs (Aussteller, IBAN, …) auf dem Server hinterlegt werden.
        </p>
      </div>
    )
  }

  if (!admin) {
    return (
      <div className="mt-6 rounded-2xl border border-white/15 bg-white/5 p-4">
        <h3 className="font-semibold text-[#FFD700]">Rechnung · Bank (Server)</h3>
        <p className="mt-2 text-sm text-slate-400">
          Nur Benutzer mit Rolle <strong className="text-slate-200">Admin</strong> können die
          Rechnungsaussteller-Daten auf dem Server ändern.
        </p>
      </div>
    )
  }

  return (
    <div className="mt-6 space-y-4 rounded-2xl border border-[#FFD700]/30 bg-[#FFD700]/5 p-4">
      <div>
        <h3 className="font-semibold text-[#FFD700]">Rechnung · Bankverbindung (Server)</h3>
        <p className="mt-1 text-xs text-slate-400">
          Diese Angaben erscheinen auf <strong className="text-slate-300">Sammelrechnungen</strong>{' '}
          und anderen Rechnungs-PDFs. Sie werden in der API unter{' '}
          <code className="rounded bg-black/40 px-1 text-[10px] text-cyan-200">issuer_snapshot</code>{' '}
          gespeichert – nicht in diesem Browser allein.
        </p>
      </div>

      {demoMode ? (
        <p className="rounded-lg border border-amber-500/40 bg-amber-950/25 px-3 py-2 text-xs font-semibold text-amber-100">
          Demo-Modus: Speichern auf dem Server ist deaktiviert. Demo verlassen, dann hier
          Bankdaten eintragen und speichern.
        </p>
      ) : null}

      {loading ? (
        <p className="text-sm text-slate-400">Lade Server-Einstellungen…</p>
      ) : null}

      {err ? (
        <p className="rounded-lg border border-red-500/40 bg-red-950/30 px-3 py-2 text-sm text-red-200">
          {err}
        </p>
      ) : null}

      {info ? (
        <p className="rounded-lg border border-emerald-500/40 bg-emerald-950/30 px-3 py-2 text-sm text-emerald-100">
          {info}
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs text-slate-400 sm:col-span-2">
          Name Rechnungsaussteller / Organisation
          <input
            className="mt-1 w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-white"
            value={issuer.name}
            onChange={(e) => setIssuer((x) => ({ ...x, name: e.target.value }))}
            placeholder="z. B. DLRG Ortsverein Musterstadt"
            disabled={loading}
          />
        </label>
        <label className="block text-xs text-slate-400 sm:col-span-2">
          Straße
          <input
            className="mt-1 w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-white"
            value={issuer.street}
            onChange={(e) => setIssuer((x) => ({ ...x, street: e.target.value }))}
            disabled={loading}
          />
        </label>
        <label className="block text-xs text-slate-400">
          PLZ
          <input
            className="mt-1 w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-white"
            value={issuer.postalCode}
            onChange={(e) => setIssuer((x) => ({ ...x, postalCode: e.target.value }))}
            disabled={loading}
          />
        </label>
        <label className="block text-xs text-slate-400">
          Ort
          <input
            className="mt-1 w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-white"
            value={issuer.city}
            onChange={(e) => setIssuer((x) => ({ ...x, city: e.target.value }))}
            disabled={loading}
          />
        </label>
        <label className="block text-xs text-slate-400">
          Land
          <input
            className="mt-1 w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-white"
            value={issuer.country}
            onChange={(e) => setIssuer((x) => ({ ...x, country: e.target.value }))}
            disabled={loading}
          />
        </label>
        <label className="block text-xs text-slate-400">
          E-Mail
          <input
            type="email"
            className="mt-1 w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-white"
            value={issuer.email}
            onChange={(e) => setIssuer((x) => ({ ...x, email: e.target.value }))}
            disabled={loading}
          />
        </label>
        <label className="block text-xs text-slate-400">
          Telefon
          <input
            className="mt-1 w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-white"
            value={issuer.phone}
            onChange={(e) => setIssuer((x) => ({ ...x, phone: e.target.value }))}
            disabled={loading}
          />
        </label>

        <div className="border-t border-white/10 pt-3 sm:col-span-2">
          <p className="text-[11px] font-bold uppercase tracking-wide text-cyan-300">
            Bankverbindung (für Rechnungs-PDF)
          </p>
        </div>
        <label className="block text-xs text-slate-400 sm:col-span-2">
          Kreditinstitut / Bankname (optional)
          <input
            className="mt-1 w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-white"
            value={issuer.bankName}
            onChange={(e) => setIssuer((x) => ({ ...x, bankName: e.target.value }))}
            disabled={loading}
          />
        </label>
        <label className="block text-xs text-slate-400 sm:col-span-2">
          IBAN
          <input
            className="mt-1 w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 font-mono text-sm text-white"
            value={issuer.iban}
            onChange={(e) => setIssuer((x) => ({ ...x, iban: e.target.value }))}
            placeholder="DE…"
            disabled={loading}
          />
        </label>
        <label className="block text-xs text-slate-400">
          BIC (optional)
          <input
            className="mt-1 w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 font-mono text-sm text-white"
            value={issuer.bic}
            onChange={(e) => setIssuer((x) => ({ ...x, bic: e.target.value }))}
            disabled={loading}
          />
        </label>
        <label className="block text-xs text-slate-400">
          Steuernummer (optional)
          <input
            className="mt-1 w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-white"
            value={issuer.taxNumber}
            onChange={(e) => setIssuer((x) => ({ ...x, taxNumber: e.target.value }))}
            disabled={loading}
          />
        </label>
        <label className="block text-xs text-slate-400 sm:col-span-2">
          USt-IdNr. (optional)
          <input
            className="mt-1 w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-white"
            value={issuer.vatId}
            onChange={(e) => setIssuer((x) => ({ ...x, vatId: e.target.value }))}
            disabled={loading}
          />
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-xl bg-gradient-to-r from-[#FFD700] to-amber-600 px-5 py-2.5 font-bold text-black disabled:opacity-40"
          disabled={loading || saving || demoMode}
          onClick={() => void save()}
        >
          {saving ? 'Speichern…' : 'Auf Server speichern'}
        </button>
        <button
          type="button"
          className="rounded-xl border border-white/20 px-4 py-2 text-sm text-slate-300 hover:bg-white/5"
          disabled={loading}
          onClick={() => void load()}
        >
          Neu laden
        </button>
      </div>
    </div>
  )
}
