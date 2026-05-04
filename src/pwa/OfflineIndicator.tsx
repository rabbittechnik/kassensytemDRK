import { useEffect, useState } from 'react'
import { apiFetch } from '../api/http'
import { hasApi } from '../api/config'

/**
 * Offline-Indikator als Fixed-Banner unten am Bildschirm.
 * Quelle:
 *  - `navigator.onLine` und `online`/`offline`-Events fuer Geraete-Status
 *  - Heartbeat alle 20 s gegen `/health` fuer Backend-Erreichbarkeit
 * Banner-Text: "Offline - Backend nicht erreichbar".
 *
 * Beeinflusst keine Kassendaten; reine Status-Visualisierung.
 */
export function OfflineIndicator() {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  )
  const [backendOk, setBackendOk] = useState<boolean | null>(null)

  useEffect(() => {
    const onOn = () => setOnline(true)
    const onOff = () => setOnline(false)
    window.addEventListener('online', onOn)
    window.addEventListener('offline', onOff)
    return () => {
      window.removeEventListener('online', onOn)
      window.removeEventListener('offline', onOff)
    }
  }, [])

  useEffect(() => {
    if (!hasApi()) return
    let cancelled = false
    let timer: number | null = null

    const ping = async () => {
      try {
        const res = await apiFetch('/health', { method: 'GET' })
        if (!cancelled) setBackendOk(res.ok)
      } catch {
        if (!cancelled) setBackendOk(false)
      }
    }

    void ping()
    timer = window.setInterval(() => void ping(), 20_000)
    return () => {
      cancelled = true
      if (timer != null) window.clearInterval(timer)
    }
  }, [online])

  const apiKnown = hasApi()
  const showBanner = !online || (apiKnown && backendOk === false)
  // Wenn keine API konfiguriert ist, zeigen wir nur den Geraete-Offline-Status.
  // (apiKnown ist dann false, also greift backendOk-Logik nicht.)
  if (!showBanner) return null

  const text = !online
    ? 'Offline – keine Internetverbindung'
    : 'Offline – Backend nicht erreichbar'

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-3 z-[120] flex justify-center px-3"
    >
      <div className="pointer-events-auto rounded-full border-2 border-amber-500/70 bg-black/85 px-4 py-2 text-xs font-black uppercase tracking-wide text-amber-200 shadow-[0_0_24px_rgba(255,191,0,0.35)]">
        ⚠ {text}
      </div>
    </div>
  )
}
