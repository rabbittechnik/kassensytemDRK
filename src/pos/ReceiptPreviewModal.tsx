export interface DemoPreviewReceiptItem {
  id: string
  type: 'customer' | 'getraenke' | 'kuchen_suess' | 'heisses_essen'
  title: string
  text: string
  width: 58 | 80
  canPrint: boolean
}

export function ReceiptPreviewModal(props: {
  open: boolean
  receipts: DemoPreviewReceiptItem[]
  selectedId: string | null
  onSelect: (id: string) => void
  onClose: () => void
  onPrintCurrent: () => void
  onPrintAll: () => void
  onCopyCurrent: () => void
}) {
  const {
    open,
    receipts,
    selectedId,
    onSelect,
    onClose,
    onPrintCurrent,
    onPrintAll,
    onCopyCurrent,
  } = props

  if (!open) return null
  const current = receipts.find((r) => r.id === selectedId) ?? receipts[0] ?? null
  if (!current) return null

  return (
    <div
      className="fixed inset-0 z-[140] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal
      aria-labelledby="demo-receipt-preview-title"
    >
      <div className="panel-glass flex max-h-[90vh] w-full max-w-5xl flex-col rounded-2xl border border-yellow-500/40 p-5">
        <h2
          id="demo-receipt-preview-title"
          className="text-lg font-black uppercase tracking-wide text-[#FFD700]"
        >
          Bon‑Vorschau – Demo‑Modus
        </h2>
        <p className="mt-1 text-sm text-slate-300">
          Dies ist nur eine Vorschau. Es wurde kein echter Verkauf gespeichert.
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          {receipts.map((r) => (
            <button
              key={r.id}
              type="button"
              className={[
                'rounded-lg border px-3 py-2 text-xs font-bold uppercase tracking-wide transition',
                current.id === r.id ?
                  'border-[#ff003c]/70 bg-red-950/35 text-white'
                : 'border-white/20 bg-black/35 text-slate-200 hover:bg-white/10',
              ].join(' ')}
              onClick={() => onSelect(r.id)}
            >
              {r.title}
            </button>
          ))}
        </div>

        <div className="mt-4 min-h-0 flex-1 overflow-auto rounded-xl border border-white/20 bg-neutral-900/50 p-4">
          <div className="mb-3 text-xs text-slate-400">
            Bonart: <span className="font-semibold text-slate-200">{current.title}</span>
          </div>
          <div
            className={[
              'mx-auto whitespace-pre-wrap rounded border border-neutral-300 bg-white p-4 font-mono text-[12px] leading-[1.35] text-black shadow-[0_6px_16px_rgba(0,0,0,0.25)]',
              current.width === 80 ? 'max-w-[540px]' : 'max-w-[360px]',
            ].join(' ')}
          >
            {current.text}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            className="rounded-lg border border-white/25 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-white/10"
            onClick={onCopyCurrent}
          >
            Als Text kopieren
          </button>
          <button
            type="button"
            className="rounded-lg border border-cyan-500/50 px-3 py-2 text-xs font-semibold text-cyan-200 hover:bg-cyan-950/30"
            disabled={!current.canPrint}
            onClick={onPrintCurrent}
          >
            Drucken testen
          </button>
          <button
            type="button"
            className="rounded-lg border border-cyan-600/50 px-3 py-2 text-xs font-semibold text-cyan-100 hover:bg-cyan-950/30"
            onClick={onPrintAll}
          >
            Alle Demo‑Bons drucken
          </button>
          <button
            type="button"
            className="rounded-lg border border-white/25 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-white/10"
            onClick={onClose}
          >
            Schließen
          </button>
        </div>
      </div>
    </div>
  )
}
