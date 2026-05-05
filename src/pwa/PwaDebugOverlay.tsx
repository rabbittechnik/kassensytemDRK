import { useEffect, useState } from 'react'
import { gatherPwaStartupDebugSnapshot } from './pwaStartupDebug'

function debugEnabled(): boolean {
  try {
    if (typeof window === 'undefined') return false
    if (new URLSearchParams(window.location.search).get('dlrgPwaDebug') === '1') return true
    return window.localStorage.getItem('dlrgPwaDebug') === '1'
  } catch {
    return false
  }
}

/**
 * Sichtbare Diagnose: `?dlrgPwaDebug=1` oder `localStorage.dlrgPwaDebug=1`.
 * Zeigt dieselben Werte wie die Console-Ausgabe (fuer iPad/Safari ohne Mac-Konsole).
 */
export function PwaDebugOverlay() {
  const [on, setOn] = useState(() => debugEnabled())
  const [snap, setSnap] = useState<string>('…')

  useEffect(() => {
    if (!on) return
    let alive = true
    void (async () => {
      const s = await gatherPwaStartupDebugSnapshot()
      if (!alive) return
      setSnap(JSON.stringify(s, null, 2))
    })()
    return () => {
      alive = false
    }
  }, [on])

  useEffect(() => {
    const sync = () => setOn(debugEnabled())
    window.addEventListener('popstate', sync)
    return () => window.removeEventListener('popstate', sync)
  }, [])

  if (!on) return null

  return (
    <div className="fixed bottom-0 left-0 right-0 z-[200] max-h-[45vh] overflow-auto border-t-2 border-amber-500/80 bg-black/95 p-2 font-mono text-[10px] text-lime-200 shadow-[0_-8px_32px_rgba(0,0,0,0.8)]">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-amber-200">
        <span className="font-black uppercase">dlrgPwaDebug</span>
        <button
          type="button"
          className="rounded border border-white/30 px-2 py-0.5 text-white"
          onClick={() => {
            try {
              window.localStorage.removeItem('dlrgPwaDebug')
            } catch {
              /* ignore */
            }
            window.location.search = ''
          }}
        >
          Aus / Neu ohne ?param
        </button>
      </div>
      <pre className="whitespace-pre-wrap break-all text-[10px] leading-snug">{snap}</pre>
    </div>
  )
}
