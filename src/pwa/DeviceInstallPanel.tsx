import { useState } from 'react'
import { triggerInstallPrompt, usePwaInstall } from './installPrompt'
import { IosInstallGuide } from './IosInstallGuide'

/**
 * Admin-Tab "Geraet einrichten".
 * Zeigt Status (installierbar / installiert / iOS-Anleitung / nicht
 * installierbar) und plattformspezifische Hinweise.
 */
export function DeviceInstallPanel() {
  const pwa = usePwaInstall()
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)

  let statusText: string
  if (pwa.installed) statusText = 'App ist installiert / läuft im Standalone-Modus'
  else if (pwa.canInstall) statusText = 'App kann auf diesem Gerät installiert werden'
  else if (pwa.iosNeedsGuide) statusText = 'iOS / iPadOS – manuelle Installation erforderlich'
  else statusText = 'Keine Installation auf diesem Gerät verfügbar'

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-white">Gerät einrichten</h2>
        <p className="mt-1 max-w-2xl text-xs text-slate-400">
          DLRG Kasse als App installieren – auf Tablet, iPad, Android-Tablet,
          Windows/Mac-Desktop oder Chromebook. Die App läuft danach im
          Standalone-Modus ohne Browser-Leiste.
        </p>
      </div>

      <div className="rounded-xl border border-cyan-500/30 bg-black/40 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs font-bold uppercase tracking-wide text-slate-400">
              Status
            </div>
            <div className="mt-1 text-base font-semibold text-cyan-100">
              {statusText}
            </div>
            <div className="mt-1 text-xs text-slate-400">
              Plattform: {pwa.platform}
            </div>
          </div>
          {!pwa.installed && pwa.canInstall && (
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                setFeedback(null)
                try {
                  const r = await triggerInstallPrompt()
                  setFeedback(
                    r === 'accepted'
                      ? 'Installation läuft – das Icon erscheint gleich auf dem Gerät.'
                      : r === 'dismissed'
                        ? 'Installation abgebrochen.'
                        : 'Installations-Dialog momentan nicht verfügbar.',
                  )
                } finally {
                  setBusy(false)
                }
              }}
              className="rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 px-5 py-2 font-bold text-white shadow-[0_0_24px_rgba(34,211,238,0.35)] disabled:opacity-40"
            >
              App jetzt installieren
            </button>
          )}
        </div>
        {feedback && (
          <p className="mt-3 rounded-lg border border-white/10 bg-black/40 p-3 text-sm text-slate-200">
            {feedback}
          </p>
        )}
      </div>

      {pwa.iosNeedsGuide && <IosInstallGuide />}

      {!pwa.canInstall && !pwa.iosNeedsGuide && !pwa.installed && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-950/20 p-4 text-sm text-amber-100">
          <p className="font-semibold">Gerät unterstützt keine PWA-Installation</p>
          <p className="mt-1 text-xs text-amber-200/80">
            Tipps: Chrome / Edge / Brave nutzen, Seite über{' '}
            <strong>HTTPS</strong> öffnen, Service Worker erlauben (kein
            Privat-/Inkognito-Modus). Auf iPad/iPhone bitte mit Safari öffnen.
          </p>
        </div>
      )}

      <div className="rounded-xl border border-white/10 bg-black/40 p-4 text-sm text-slate-200">
        <h4 className="text-base font-bold text-[#FFD700]">
          Plattformspezifische Hinweise
        </h4>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-300">
          <li>
            <strong>Android (Chrome / Edge):</strong> Drei-Punkte-Menü → „App
            installieren“ oder Banner unten bestätigen.
          </li>
          <li>
            <strong>Windows / macOS Chrome / Edge:</strong> Adresszeile rechts auf
            das Installations-Icon klicken oder Menü → „DLRG Kasse installieren“.
          </li>
          <li>
            <strong>iOS / iPadOS Safari:</strong> Teilen-Symbol → „Zum
            Home-Bildschirm“ → „Hinzufügen“.
          </li>
          <li>
            <strong>Bestehende Daten:</strong> Die Installation lässt
            Verkäufe/Bons/Datenbanken unverändert. Nur das App-Shell-Bündel wird
            für Offline-Start zwischengespeichert.
          </li>
        </ul>
      </div>
    </div>
  )
}
