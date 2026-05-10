import { useState } from 'react'
import { triggerInstallPrompt, usePwaInstall } from './installPrompt'

/**
 * Header-Button "App installieren".
 * - Sichtbar, wenn `canInstall` (Chromium) oder iOS-Anleitung benoetigt wird
 *   (in dem Fall Click oeffnet den Hinweis-Tooltip / triggert den Callback).
 * - Versteckt nach erfolgreicher Installation.
 */
export function InstallAppButton(props: {
  variant?: 'pos' | 'admin'
  onShowIosGuide?: () => void
}) {
  const { variant = 'pos', onShowIosGuide } = props
  const pwa = usePwaInstall()
  const [busy, setBusy] = useState(false)

  if (pwa.installed) return null

  const showButton = pwa.canInstall || pwa.iosNeedsGuide
  if (!showButton) return null

  const baseCls =
    variant === 'admin'
      ? 'rounded-xl border-2 border-cyan-400/60 bg-cyan-950/40 px-4 py-2 text-sm font-bold uppercase text-cyan-100 hover:bg-cyan-900/40'
      : 'rounded-lg border border-cyan-400/60 bg-cyan-950/40 px-3 py-2 text-xs font-bold uppercase text-cyan-100 hover:bg-cyan-900/40'

  return (
    <button
      type="button"
      disabled={busy}
      title={
        pwa.iosNeedsGuide
          ? 'Anleitung: Teilen-Symbol → „Zum Home-Bildschirm“'
          : 'Als App installieren'
      }
      className={baseCls + ' disabled:opacity-40'}
      onClick={async () => {
        if (pwa.iosNeedsGuide) {
          onShowIosGuide?.()
          return
        }
        setBusy(true)
        try {
          await triggerInstallPrompt()
        } finally {
          setBusy(false)
        }
      }}
    >
      {pwa.iosNeedsGuide ? 'Zum Startbildschirm hinzufügen' : 'App installieren'}
    </button>
  )
}
