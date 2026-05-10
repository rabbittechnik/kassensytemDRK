/**
 * Anleitung fuer iOS/iPadOS: Hinzufuegen zum Home-Bildschirm.
 * Wird angezeigt statt des `beforeinstallprompt`-Buttons, weil iOS
 * dieses Browser-Event nicht unterstuetzt.
 */
export function IosInstallGuide(props: {
  variant?: 'panel' | 'modal'
  onClose?: () => void
}) {
  const { variant = 'panel', onClose } = props
  const inner = (
    <div className="space-y-3 text-sm text-slate-200">
      <h4 className="text-base font-black uppercase tracking-wide text-[#FFD700]">
        Auf iPhone / iPad zum Home-Bildschirm hinzufügen
      </h4>
      <ol className="list-decimal space-y-2 pl-5">
        <li>
          In <strong>Safari</strong> diese Seite öffnen
          <span className="ml-1 text-slate-400">
            (andere Browser unterstützen die Installation auf iOS nicht).
          </span>
        </li>
        <li>
          Unten (iPhone) bzw. oben rechts (iPad) auf das{' '}
          <strong>Teilen-Symbol</strong> tippen
          <span className="ml-1 text-slate-400">(Quadrat mit Pfeil nach oben).</span>
        </li>
        <li>
          „<strong>Zum Home-Bildschirm</strong>“ wählen und mit
          „<strong>Hinzufügen</strong>“ bestätigen.
        </li>
      </ol>
      <p className="rounded-lg border border-cyan-500/30 bg-cyan-950/20 px-3 py-2 text-xs text-cyan-100">
        Anschließend startet die DLRG Kasse beim Tippen auf das Icon ohne
        Browser-Leiste – wie eine native App.
      </p>
      {onClose && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border-2 border-[#FFD700]/60 bg-black px-4 py-2 font-bold text-[#FFD700] hover:bg-neutral-900"
          >
            Schließen
          </button>
        </div>
      )}
    </div>
  )
  if (variant === 'modal') {
    return (
      <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
        <div className="panel-dlrg w-full max-w-lg rounded-2xl border border-[#FFD700]/40 p-6 shadow-[0_0_40px_rgba(255,215,0,0.2)]">
          {inner}
        </div>
      </div>
    )
  }
  return (
    <div className="rounded-xl border border-white/10 bg-black/40 p-4">{inner}</div>
  )
}
