import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useState } from 'react'
import { db } from '../db/database'
import { setSetting } from '../db/sales'
import { sha256Hex } from '../lib/pin'
import { formatMoney } from '../lib/format'
import { exportSalesCsv } from '../export/exportSales'
import { exportDemoSalesCsv } from '../export/exportDemo'
import type { CategoryRow, DepositType, ProductOutputGroup, ProductRow } from '../types'

const OUTPUT_GROUP_OPTIONS: { value: ProductOutputGroup; label: string }[] = [
  { value: 'getraenke', label: 'Getränke' },
  { value: 'kuchen_suess', label: 'Kuchen / Süßes' },
  { value: 'heisses_essen', label: 'Heißes Essen' },
  { value: 'keine_ausgabe', label: 'Keine Ausgabe' },
]
const DEPOSIT_TYPE_OPTIONS: { value: DepositType; label: string }[] = [
  { value: 'flasche_dose', label: 'Flasche/Dose' },
  { value: 'becher', label: 'Becher' },
  { value: 'schale', label: 'Schale' },
  { value: 'teller', label: 'Teller' },
  { value: 'sonstiges', label: 'Sonstiges' },
]
import { TeamsBilling } from './TeamsBilling'
import { ReceiptManagePanel } from './ReceiptManagePanel'
import {
  exitDemoMode,
  snapshotDemoSales,
  useDemoMode,
  useDemoSales,
} from '../demo/demoStore'
import { DemoCodeOverlay } from '../demo/DemoCodeOverlay'
import { logDemoModeAudit } from '../demo/demoAudit'
import { IssuerServerSettingsBlock } from './IssuerServerSettings'
import { EventsManagement } from './EventsManagement'
import { DeviceInstallPanel } from '../pwa/DeviceInstallPanel'
import { InstallAppButton } from '../pwa/InstallAppButton'
import { IosInstallGuide } from '../pwa/IosInstallGuide'
import { todayKey } from '../lib/format'
import { buildMetaSummary } from '../lib/buildMeta'

const tabs = [
  'Artikel',
  'Kategorien',
  'Teams / Rechnungen',
  'Veranstaltungen',
  'Export',
  'Gerät',
  'Einstellungen',
] as const

export function AdminScreen(props: { onBack: () => void }) {
  const [tab, setTab] = useState<(typeof tabs)[number]>('Artikel')
  const demoMode = useDemoMode()
  const [demoCodeOpen, setDemoCodeOpen] = useState(false)
  const [iosGuideOpen, setIosGuideOpen] = useState(false)

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3 md:p-5">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3">
        <div>
          <h1 className="text-2xl font-bold text-white">
            {demoMode ? 'Admin (DEMO)' : 'Admin'}
          </h1>
          <p className="text-sm text-slate-400">
            Artikel · Teams · Veranstaltungen · Export · Einstellungen
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <InstallAppButton
            variant="admin"
            onShowIosGuide={() => setIosGuideOpen(true)}
          />
          {demoMode ? (
            <button
              type="button"
              onClick={() => {
                void logDemoModeAudit('leave')
                exitDemoMode()
              }}
              className="rounded-xl border-2 border-amber-400/70 bg-amber-500/15 px-4 py-2 font-black uppercase text-amber-100 hover:bg-amber-500/25"
            >
              Demo-Modus verlassen
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setDemoCodeOpen(true)}
              className="rounded-xl border-2 border-yellow-500/50 bg-neutral-900 px-4 py-2 font-bold uppercase text-yellow-200 hover:bg-yellow-950/30"
              title="Demo-Modus für Vorführungen aktivieren"
            >
              Demo-Modus
            </button>
          )}
          <button
            type="button"
            onClick={props.onBack}
            className="rounded-xl border-2 border-[#FFD700]/50 bg-black px-5 py-2 font-bold text-[#FFD700] hover:bg-neutral-950"
          >
            Zur Kasse
          </button>
        </div>
      </header>

      <nav className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={[
              'rounded-xl px-4 py-2 text-sm font-semibold transition',
              tab === t
                ? 'border border-cyan-400/60 bg-cyan-500/15 text-cyan-50'
                : 'border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10',
            ].join(' ')}
          >
            {t}
          </button>
        ))}
      </nav>

      <div className="panel-glass min-h-0 flex-1 overflow-y-auto rounded-2xl p-4">
        {tab === 'Artikel' && <ProductsAdmin />}
        {tab === 'Kategorien' && <CategoriesAdmin />}
        {tab === 'Teams / Rechnungen' && <TeamsBilling />}
        {tab === 'Veranstaltungen' && <EventsManagement />}
        {tab === 'Export' && <ExportPanel />}
        {tab === 'Gerät' && <DeviceInstallPanel />}
        {tab === 'Einstellungen' && <SettingsPanel />}
      </div>

      {demoCodeOpen && (
        <DemoCodeOverlay onClose={() => setDemoCodeOpen(false)} />
      )}

      {iosGuideOpen && (
        <IosInstallGuide variant="modal" onClose={() => setIosGuideOpen(false)} />
      )}
    </div>
  )
}

function ProductsAdmin() {
  const categories = useLiveQuery(
    () => db.categories.orderBy('sortOrder').toArray(),
    [],
  )
  const products = useLiveQuery(() => db.products.orderBy('sortOrder').toArray(), [])
  const [editing, setEditing] = useState<ProductRow | 'new' | null>(null)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-white">Artikel</h2>
        <button
          type="button"
          className="rounded-xl bg-gradient-to-r from-blue-600 to-cyan-500 px-4 py-2 font-semibold text-white"
          onClick={() => setEditing('new')}
        >
          Neuer Artikel
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead>
            <tr className="border-b border-white/10 text-slate-400">
              <th className="py-2 pr-3">Name</th>
              <th className="py-2 pr-3">Kategorie</th>
              <th className="py-2 pr-3">Preis</th>
              <th className="py-2 pr-3">Ausgabe</th>
              <th className="py-2 pr-3">Aktiv</th>
              <th className="py-2">Aktion</th>
            </tr>
          </thead>
          <tbody>
            {(products ?? []).map((p) => {
              const cname =
                categories?.find((c) => c.id === p.categoryId)?.name ?? '—'
              const ogLabel =
                OUTPUT_GROUP_OPTIONS.find((o) => o.value === (p.outputGroup ?? 'keine_ausgabe'))
                  ?.label ?? '—'
              return (
                <tr
                  key={p.id}
                  className="border-b border-white/5 hover:bg-white/[0.03]"
                >
                  <td className="py-2 pr-3 font-medium text-slate-100">
                    {p.name}
                  </td>
                  <td className="py-2 pr-3 text-slate-300">{cname}</td>
                  <td className="py-2 pr-3 tabular-nums text-cyan-100">
                    {formatMoney(p.priceCents)}
                  </td>
                  <td className="py-2 pr-3 text-slate-400">{ogLabel}</td>
                  <td className="py-2 pr-3">{p.active ? 'Ja' : 'Nein'}</td>
                  <td className="py-2">
                    <button
                      type="button"
                      className="text-sm text-blue-300 hover:underline"
                      onClick={() => setEditing(p)}
                    >
                      Bearbeiten
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {editing && (
        <ProductEditor
          key={editing === 'new' ? 'new' : editing.id}
          mode={editing}
          categories={categories ?? []}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

function ProductEditor(props: {
  mode: ProductRow | 'new'
  categories: CategoryRow[]
  onClose: () => void
}) {
  const { onClose, categories: catList, mode } = props
  const isNew = mode === 'new'
  const existing: ProductRow | undefined =
    mode === 'new' ? undefined : mode
  const [name, setName] = useState(existing?.name ?? '')
  const [priceStr, setPriceStr] = useState(
    existing
      ? (existing.priceCents / 100).toFixed(2).replace('.', ',')
      : '1,00',
  )
  const [categoryId, setCategoryId] = useState(
    existing?.categoryId ?? catList[0]?.id ?? '',
  )
  const [active, setActive] = useState(existing?.active ?? true)
  const [outputGroup, setOutputGroup] = useState<ProductOutputGroup>(
    existing?.outputGroup ?? 'keine_ausgabe',
  )
  const [imageUrl, setImageUrl] = useState(
    (existing?.imageUrl ?? '').trim(),
  )
  const [depositEnabled, setDepositEnabled] = useState(
    existing?.depositEnabled ?? false,
  )
  const [depositAmountStr, setDepositAmountStr] = useState(
    (((existing?.depositAmount ?? 0) as number) / 100).toFixed(2).replace('.', ','),
  )
  const [depositType, setDepositType] = useState<DepositType>(
    existing?.depositType ?? 'flasche_dose',
  )
  const [depositName, setDepositName] = useState(existing?.depositName ?? 'Flasche/Dose')

  const save = useCallback(async () => {
    const euros = parseFloat(priceStr.replace(',', '.'))
    if (!name.trim() || Number.isNaN(euros) || !categoryId) return
    const priceCents = Math.round(euros * 100)
    const depEuro = parseFloat(depositAmountStr.replace(',', '.'))
    const depositAmount = Number.isNaN(depEuro) ? 0 : Math.max(0, Math.round(depEuro * 100))
    const effectiveDepositEnabled = depositEnabled || depositAmount > 0
    if (effectiveDepositEnabled && depositAmount <= 0) {
      alert('Pfand aktiv benötigt einen Pfandbetrag größer 0,00 EUR.')
      return
    }
    if (isNew) {
      const max =
        (await db.products.orderBy('sortOrder').last())?.sortOrder ?? 0
      await db.products.add({
        id: crypto.randomUUID(),
        name: name.trim(),
        categoryId,
        priceCents,
        active,
        outputGroup,
        sortOrder: max + 10,
        ...(imageUrl.trim() ?
          { imageUrl: imageUrl.trim() }
        : {}),
        depositEnabled: effectiveDepositEnabled,
        depositAmount,
        depositName: effectiveDepositEnabled ? (depositName.trim() || 'Pfand') : null,
        depositType: effectiveDepositEnabled ? depositType : null,
      })
    } else if (existing) {
      await db.products.update(existing.id, {
        name: name.trim(),
        categoryId,
        priceCents,
        active,
        outputGroup,
        imageUrl: imageUrl.trim() ? imageUrl.trim() : null,
        depositEnabled: effectiveDepositEnabled,
        depositAmount,
        depositName: effectiveDepositEnabled ? (depositName.trim() || 'Pfand') : null,
        depositType: effectiveDepositEnabled ? depositType : null,
      })
    }
    onClose()
  }, [
    active,
    categoryId,
    existing,
    imageUrl,
    depositEnabled,
    depositName,
    depositAmountStr,
    depositType,
    isNew,
    name,
    outputGroup,
    priceStr,
    onClose,
  ])

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4 backdrop-blur">
      <div className="panel-glass w-full max-w-md rounded-2xl p-6">
        <h3 className="text-lg font-bold text-white">
          {isNew ? 'Neuer Artikel' : 'Artikel bearbeiten'}
        </h3>
        <label className="mt-4 block text-sm text-slate-400">Name</label>
        <input
          className="mt-1 w-full rounded-xl border border-white/15 bg-black/30 px-3 py-3 text-white"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <label className="mt-3 block text-sm text-slate-400">Preis (EUR)</label>
        <input
          className="mt-1 w-full rounded-xl border border-white/15 bg-black/30 px-3 py-3 text-white"
          inputMode="decimal"
          value={priceStr}
          onChange={(e) => setPriceStr(e.target.value)}
        />
        <label className="mt-3 block text-sm text-slate-400">Kategorie</label>
        <select
          className="mt-1 w-full rounded-xl border border-white/15 bg-black/40 px-3 py-3 text-white"
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
        >
          {catList.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <label className="mt-3 block text-sm text-slate-400">
          Ausgabegruppe (Servier-/Ausgabe-Bon)
        </label>
        <select
          className="mt-1 w-full rounded-xl border border-white/15 bg-black/40 px-3 py-3 text-white"
          value={outputGroup}
          onChange={(e) => setOutputGroup(e.target.value as ProductOutputGroup)}
        >
          {OUTPUT_GROUP_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <label className="mt-3 block text-sm text-slate-400">
          Bild‑URL (optional, leer = Standard nach Artikel‑ID oder Emoji)
        </label>
        <input
          className="mt-1 w-full rounded-xl border border-white/15 bg-black/30 px-3 py-3 font-mono text-sm text-white placeholder:text-slate-600"
          placeholder="/assets/products/wasser.png"
          value={imageUrl}
          onChange={(e) => setImageUrl(e.target.value)}
        />
        <label className="mt-4 flex items-center gap-2 text-slate-200">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
          />
          Im Verkauf sichtbar
        </label>
        <label className="mt-2 flex items-center gap-2 text-slate-200">
          <input
            type="checkbox"
            checked={depositEnabled}
            onChange={(e) => setDepositEnabled(e.target.checked)}
          />
          Pfand aktiv
        </label>
        <label className="mt-3 block text-sm text-slate-400">Pfandbetrag (EUR)</label>
        <input
          className="mt-1 w-full rounded-xl border border-white/15 bg-black/30 px-3 py-3 text-white disabled:opacity-50"
          inputMode="decimal"
          disabled={!depositEnabled}
          value={depositAmountStr}
          onChange={(e) => setDepositAmountStr(e.target.value)}
        />
        <label className="mt-3 block text-sm text-slate-400">Pfandtyp</label>
        <label className="mt-3 block text-sm text-slate-400">Pfandname</label>
        <input
          className="mt-1 w-full rounded-xl border border-white/15 bg-black/30 px-3 py-3 text-white disabled:opacity-50"
          disabled={!depositEnabled && Number((parseFloat(depositAmountStr.replace(',', '.')) || 0)) <= 0}
          value={depositName}
          onChange={(e) => setDepositName(e.target.value)}
          placeholder="Flasche/Dose"
        />
        <label className="mt-3 block text-sm text-slate-400">Pfandtyp</label>
        <select
          className="mt-1 w-full rounded-xl border border-white/15 bg-black/40 px-3 py-3 text-white disabled:opacity-50"
          disabled={!depositEnabled}
          value={depositType}
          onChange={(e) => setDepositType(e.target.value as DepositType)}
        >
          {DEPOSIT_TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-xl border border-white/15 px-4 py-2 text-slate-200"
            onClick={onClose}
          >
            Abbrechen
          </button>
          {!isNew && existing && (
            <button
              type="button"
              className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-rose-100"
              onClick={async () => {
                if (confirm('Artikel wirklich löschen?')) {
                  await db.products.delete(existing.id)
                  onClose()
                }
              }}
            >
              Löschen
            </button>
          )}
          <button
            type="button"
            className="rounded-xl bg-gradient-to-r from-blue-600 to-cyan-500 px-4 py-2 font-semibold text-white"
            onClick={() => void save()}
          >
            Speichern
          </button>
        </div>
      </div>
    </div>
  )
}

function CategoriesAdmin() {
  const categories = useLiveQuery(
    () => db.categories.orderBy('sortOrder').toArray(),
    [],
  )

  const add = useCallback(async () => {
    const name = window.prompt('Name der Kategorie?')
    if (!name?.trim()) return
    const last = await db.categories.orderBy('sortOrder').last()
    const max = last?.sortOrder ?? 0
    await db.categories.add({
      id: crypto.randomUUID(),
      name: name.trim(),
      sortOrder: max + 10,
    })
  }, [])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-white">Kategorien</h2>
        <button
          type="button"
          className="rounded-xl bg-white/10 px-4 py-2 font-semibold text-white hover:bg-white/15"
          onClick={() => void add()}
        >
          Neue Kategorie
        </button>
      </div>
      <ul className="space-y-2">
        {(categories ?? []).map((c) => (
          <li
            key={c.id}
            className="flex items-center justify-between rounded-xl border border-white/10 bg-black/20 px-4 py-3"
          >
            <span className="font-medium text-slate-100">{c.name}</span>
            <button
              type="button"
              className="text-sm text-rose-300 hover:underline"
              onClick={async () => {
                const cnt = await db.products
                  .where('categoryId')
                  .equals(c.id)
                  .count()
                if (cnt > 0) {
                  alert(
                    `Kategorie enthält noch ${cnt} Artikel – bitte zuerst verschieben oder löschen.`,
                  )
                  return
                }
                if (confirm('Kategorie löschen?')) await db.categories.delete(c.id)
              }}
            >
              Löschen
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function ExportPanel() {
  const demoMode = useDemoMode()
  const demoSales = useDemoSales()
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-white">
        {demoMode ? 'Export · Verkaufsübersicht (DEMO)' : 'Export · Verkaufsübersicht'}
      </h2>
      {demoMode ? (
        <p className="rounded-lg border border-yellow-500/40 bg-yellow-950/20 p-3 text-sm font-bold text-yellow-200">
          DEMO-Export – nur Demo-Verkäufe werden ausgegeben. Die echten Verkäufe
          (db.sales) werden NICHT angefasst.
        </p>
      ) : (
        <p className="text-sm text-slate-400">
          Alle gespeicherten Verkäufe werden als CSV exportiert (Kopfzeilen +
          Positionen). Für einen einzelnen Tag nutzen Sie den Tagesabschluss auf
          der Kasse.
        </p>
      )}
      <button
        type="button"
        className="rounded-xl bg-gradient-to-r from-blue-600 to-cyan-500 px-5 py-3 font-semibold text-white"
        onClick={() => {
          if (demoMode) {
            const sales = demoSales.length > 0 ? demoSales : snapshotDemoSales()
            const day = sales[0]?.dayKey ?? todayKey()
            exportDemoSalesCsv(day, sales)
          } else {
            void exportSalesCsv()
          }
        }}
      >
        {demoMode ? 'Demo-Export (CSV)' : 'Gesamter Export (CSV)'}
      </button>
    </div>
  )
}

function SettingsPanel() {
  const appMeta = buildMetaSummary()
  const org = useLiveQuery(
    () => db.settings.where('key').equals('orgName').first(),
    [],
  )
  const footer = useLiveQuery(
    () => db.settings.where('key').equals('receiptFooter').first(),
    [],
  )
  const sumup = useLiveQuery(
    () => db.settings.where('key').equals('sumupNote').first(),
    [],
  )

  const [pin1, setPin1] = useState('')
  const [pin2, setPin2] = useState('')

  const savePin = useCallback(async () => {
    if (pin1.length >= 4 && pin1 === pin2) {
      const h = await sha256Hex(pin1)
      await setSetting('adminPinHash', h)
      setPin1('')
      setPin2('')
      alert('PIN wurde geändert.')
    } else if (pin1 || pin2) {
      alert('PIN: mindestens 4 Zeichen und beide Felder gleich.')
    }
  }, [pin1, pin2])

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <h2 className="text-lg font-semibold text-white">Einstellungen</h2>
      <p className="font-mono text-[11px] text-slate-500">
        Version: {appMeta.version} · Build: {appMeta.buildFormatted}
      </p>
      <p className="text-xs text-slate-500">
        Textfelder werden bei Eingabe direkt gespeichert (IndexedDB).
      </p>
      <label className="text-sm text-slate-400">Anzeigename / Organisation</label>
      <input
        className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-3 text-white"
        value={org?.value ?? ''}
        onChange={(e) =>
          void setSetting('orgName', e.target.value || 'DLRG')
        }
      />
      <label className="text-sm text-slate-400">Bon‑Fußzeile</label>
      <input
        className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-3 text-white"
        value={footer?.value ?? ''}
        onChange={(e) => void setSetting('receiptFooter', e.target.value)}
      />
      <label className="text-sm text-slate-400">Hinweis Kartenzahlung / SumUp</label>
      <textarea
        className="min-h-[88px] w-full rounded-xl border border-white/15 bg-black/30 px-3 py-3 text-white"
        value={sumup?.value ?? ''}
        onChange={(e) => void setSetting('sumupNote', e.target.value)}
      />

      <IssuerServerSettingsBlock />

      <div className="rounded-2xl border border-rose-500/30 bg-rose-500/5 p-4">
        <h3 className="font-semibold text-rose-100">Admin‑PIN ändern</h3>
        <p className="mt-1 text-xs text-rose-200/70">Standard bei Erststart: 1234</p>
        <input
          type="password"
          placeholder="Neue PIN"
          className="mt-3 w-full rounded-xl border border-white/15 bg-black/30 px-3 py-3 text-white"
          value={pin1}
          onChange={(e) => setPin1(e.target.value)}
        />
        <input
          type="password"
          placeholder="PIN wiederholen"
          className="mt-2 w-full rounded-xl border border-white/15 bg-black/30 px-3 py-3 text-white"
          value={pin2}
          onChange={(e) => setPin2(e.target.value)}
        />
      </div>
      <button
        type="button"
        className="w-full rounded-xl bg-gradient-to-r from-rose-600 to-orange-500 py-3 font-semibold text-white"
        onClick={() => void savePin()}
      >
        PIN speichern
      </button>

      <BonSettingsBlock />
      <ReceiptManagePanel />
    </div>
  )
}

function BonSettingsBlock() {
  const width = useLiveQuery(() => db.settings.where('key').equals('receiptWidthMm').first(), [])
  const pc = useLiveQuery(() => db.settings.where('key').equals('printCustomerReceipt').first(), [])
  const pob = useLiveQuery(() => db.settings.where('key').equals('printOutputBons').first(), [])
  const pg = useLiveQuery(() => db.settings.where('key').equals('printOutputBonGetraenke').first(), [])
  const pk = useLiveQuery(() => db.settings.where('key').equals('printOutputBonKuchen').first(), [])
  const ph = useLiveQuery(() => db.settings.where('key').equals('printOutputBonHeiss').first(), [])
  const demoAuto = useLiveQuery(() => db.settings.where('key').equals('demoAutoPrintReceipts').first(), [])
  const depEnabled = useLiveQuery(() => db.settings.where('key').equals('deposit_feature_enabled').first(), [])
  const depDefault = useLiveQuery(() => db.settings.where('key').equals('deposit_default_amount').first(), [])
  const depAutoVoucher = useLiveQuery(() => db.settings.where('key').equals('deposit_auto_print_voucher').first(), [])
  const depPrintRedeem = useLiveQuery(() => db.settings.where('key').equals('deposit_print_redemption_receipt').first(), [])
  const depShowOnOutput = useLiveQuery(() => db.settings.where('key').equals('deposit_show_on_output_bons').first(), [])
  const helpersDeposit = useLiveQuery(() => db.settings.where('key').equals('helpers_deposit_enabled').first(), [])
  const tag = useLiveQuery(() => db.settings.where('key').equals('receiptTagline').first(), [])
  const reg = useLiveQuery(() => db.settings.where('key').equals('registerName').first(), [])
  const cash = useLiveQuery(() => db.settings.where('key').equals('cashierName').first(), [])

  return (
    <div className="mt-6 space-y-3 rounded-2xl border border-cyan-500/25 bg-cyan-950/10 p-4">
      <h3 className="font-semibold text-cyan-100">Bondruck</h3>
      <label className="block text-xs text-slate-400">
        Bonbreite
        <select
          className="mt-1 w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-white"
          value={width?.value === '80' ? '80' : '58'}
          onChange={(e) => void setSetting('receiptWidthMm', e.target.value)}
        >
          <option value="58">58 mm (ca. 32 Zeichen)</option>
          <option value="80">80 mm (ca. 48 Zeichen)</option>
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm text-slate-300">
        <input
          type="checkbox"
          checked={pc?.value !== '0'}
          onChange={(e) => void setSetting('printCustomerReceipt', e.target.checked ? '1' : '0')}
        />
        Kundenbon automatisch drucken
      </label>
      <label className="flex items-center gap-2 text-sm text-slate-300">
        <input
          type="checkbox"
          checked={pob?.value !== '0'}
          onChange={(e) => void setSetting('printOutputBons', e.target.checked ? '1' : '0')}
        />
        Ausgabe-Bons (Getränke / Kuchen / Essen) automatisch drucken
      </label>
      <p className="text-[11px] text-slate-500">
        Bei aktivem Haupt-Häkchen werden nur nicht-leere Stations-Bons gedruckt. Später: eigene Drucker pro Station.
      </p>
      <label className="flex items-center gap-2 text-sm text-slate-400">
        <input
          type="checkbox"
          checked={pg?.value !== '0'}
          disabled={pob?.value === '0'}
          onChange={(e) =>
            void setSetting('printOutputBonGetraenke', e.target.checked ? '1' : '0')
          }
        />
        Ausgabe-Bon Getränke drucken
      </label>
      <label className="flex items-center gap-2 text-sm text-slate-400">
        <input
          type="checkbox"
          checked={pk?.value !== '0'}
          disabled={pob?.value === '0'}
          onChange={(e) =>
            void setSetting('printOutputBonKuchen', e.target.checked ? '1' : '0')
          }
        />
        Ausgabe-Bon Kuchen/Süßes drucken
      </label>
      <label className="flex items-center gap-2 text-sm text-slate-400">
        <input
          type="checkbox"
          checked={ph?.value !== '0'}
          disabled={pob?.value === '0'}
          onChange={(e) =>
            void setSetting('printOutputBonHeiss', e.target.checked ? '1' : '0')
          }
        />
        Ausgabe-Bon Heißes Essen drucken
      </label>
      <label className="flex items-center gap-2 text-sm text-yellow-200">
        <input
          type="checkbox"
          checked={demoAuto?.value === '1'}
          onChange={(e) =>
            void setSetting('demoAutoPrintReceipts', e.target.checked ? '1' : '0')
          }
        />
        Demo-Bons automatisch drucken (sonst nur Vorschau)
      </label>
      <div className="mt-2 rounded-xl border border-sky-500/30 bg-sky-950/10 p-3">
        <p className="mb-2 text-xs font-bold uppercase tracking-wide text-sky-200">Pfand-Einstellungen</p>
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={depEnabled?.value !== '0'}
            onChange={(e) => void setSetting('deposit_feature_enabled', e.target.checked ? '1' : '0')}
          />
          Pfandfunktion aktiv
        </label>
        <label className="mt-2 block text-xs text-slate-400">
          Standardpfand (Cent)
          <input
            className="mt-1 w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-white"
            inputMode="numeric"
            value={depDefault?.value ?? '25'}
            onChange={(e) => void setSetting('deposit_default_amount', e.target.value.replace(/[^\d]/g, '') || '0')}
          />
        </label>
        <label className="mt-2 flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={depAutoVoucher?.value !== '0'}
            onChange={(e) => void setSetting('deposit_auto_print_voucher', e.target.checked ? '1' : '0')}
          />
          Pfandbon automatisch drucken
        </label>
        <label className="mt-2 flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={depPrintRedeem?.value === '1'}
            onChange={(e) => void setSetting('deposit_print_redemption_receipt', e.target.checked ? '1' : '0')}
          />
          Pfandauszahlungsbeleg drucken
        </label>
        <label className="mt-2 flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={depShowOnOutput?.value === '1'}
            onChange={(e) => void setSetting('deposit_show_on_output_bons', e.target.checked ? '1' : '0')}
          />
          Pfand auf Ausgabe-Bons anzeigen
        </label>
        <label className="mt-2 flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={helpersDeposit?.value === '1'}
            onChange={(e) => void setSetting('helpers_deposit_enabled', e.target.checked ? '1' : '0')}
          />
          Pfand bei Helferverpflegung berechnen
        </label>
      </div>
      <label className="block text-xs text-slate-400">
        Bon‑Spruch (optional, Zeilenumbruch möglich)
        <textarea
          className="mt-1 min-h-[72px] w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-white"
          value={tag?.value ?? ''}
          onChange={(e) => void setSetting('receiptTagline', e.target.value)}
        />
      </label>
      <label className="block text-xs text-slate-400">
        Kasse / Stand (auf Bon)
        <input
          className="mt-1 w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-white"
          value={reg?.value ?? ''}
          onChange={(e) => void setSetting('registerName', e.target.value)}
        />
      </label>
      <label className="block text-xs text-slate-400">
        Kassierer/in (auf Bon & Nachdruck‑Protokoll)
        <input
          className="mt-1 w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-white"
          value={cash?.value ?? ''}
          onChange={(e) => void setSetting('cashierName', e.target.value)}
        />
      </label>
    </div>
  )
}
