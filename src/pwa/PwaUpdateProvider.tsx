import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'

export type UpdateProbeResult = 'offline' | 'error' | 'current' | 'available'

/** x.y.z Grobvergleich für Deploy-Hinweis (ohne Semver-Library). */
function isDeployedVersionGreater(remote: string, local: string): boolean {
  const pr = remote.trim().split('.').map((s) => Number.parseInt(s, 10))
  const pl = local.trim().split('.').map((s) => Number.parseInt(s, 10))
  if (pr.some((n) => Number.isNaN(n)) || pl.some((n) => Number.isNaN(n))) {
    return remote.trim() !== local.trim()
  }
  const len = Math.max(pr.length, pl.length)
  for (let i = 0; i < len; i++) {
    const a = pr[i] ?? 0
    const b = pl[i] ?? 0
    if (a > b) return true
    if (a < b) return false
  }
  return false
}

async function fetchDeployedManifest(): Promise<{ version?: string } | null> {
  try {
    const res = await fetch(`${location.origin}/version.json?${Date.now()}`, {
      cache: 'no-store',
    })
    if (!res.ok) return null
    const j = (await res.json()) as { version?: string }
    return j && typeof j.version === 'string' ? j : null
  } catch {
    return null
  }
}

type PwaUpdateContextValue = {
  checkForUpdate: () => Promise<UpdateProbeResult>
  applyUpdate: () => Promise<void>
  offlineReady: boolean
}

const Ctx = createContext<PwaUpdateContextValue | null>(null)

export function PwaUpdateProvider({ children }: { children: ReactNode }) {
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null)

  const {
    offlineReady: [offlineReady],
    updateServiceWorker,
  } = useRegisterSW({
    immediate: true,
    onRegisteredSW(_url, reg) {
      if (reg) setRegistration(reg)
    },
  })

  useEffect(() => {
    if (!registration) return
    void registration.update()
    const id = window.setInterval(
      () => {
        void registration.update()
      },
      5 * 60 * 1000,
    )
    return () => window.clearInterval(id)
  }, [registration])

  const checkForUpdate = useCallback(async (): Promise<UpdateProbeResult> => {
    if (!navigator.onLine) return 'offline'
    try {
      const localVer = String(import.meta.env.VITE_APP_VERSION ?? '').trim()
      const deployed = await fetchDeployedManifest()
      if (
        localVer &&
        deployed?.version &&
        isDeployedVersionGreater(deployed.version, localVer)
      ) {
        return 'available'
      }

      if (!('serviceWorker' in navigator)) return 'error'

      let reg =
        registration ?? (await navigator.serviceWorker.getRegistration()) ?? null
      if (!reg) {
        for (let i = 0; i < 40; i++) {
          await new Promise((r) => setTimeout(r, 150))
          reg = (await navigator.serviceWorker.getRegistration()) ?? null
          if (reg) break
        }
      }
      if (!reg) return 'error'

      if (reg.waiting) return 'available'
      await reg.update()
      for (let i = 0; i < 50; i++) {
        await new Promise((r) => setTimeout(r, 160))
        const next = await navigator.serviceWorker.getRegistration()
        if (next?.waiting) return 'available'
      }
      return 'current'
    } catch {
      return 'error'
    }
  }, [registration])

  /**
   * Bei `registerType: 'autoUpdate'` ruft `updateServiceWorker()` aus virtual:pwa-register
   * absichtlich kein `messageSkipWaiting()` auf — ein Klick „Jetzt aktualisieren“ würde sonst
   * oft nichts tun. Hier: Worker prüfen, ggf. SKIP_WAITING, Caches leeren, SW abmelden, hart neu laden.
   */
  const applyUpdate = useCallback(async () => {
    await updateServiceWorker(true)

    let reg = registration ?? (await navigator.serviceWorker.getRegistration())
    try {
      await reg?.update()
    } catch {
      /* ignore */
    }

    for (let i = 0; i < 30; i++) {
      reg = (await navigator.serviceWorker.getRegistration()) ?? reg
      if (reg?.waiting) break
      await new Promise((r) => setTimeout(r, 150))
    }

    reg = (await navigator.serviceWorker.getRegistration()) ?? reg
    if (reg?.waiting) {
      try {
        reg.waiting.postMessage({ type: 'SKIP_WAITING' })
      } catch {
        /* ignore */
      }
      await new Promise<void>((resolve) => {
        const ms = 12000
        const t = window.setTimeout(resolve, ms)
        navigator.serviceWorker.addEventListener(
          'controllerchange',
          () => {
            window.clearTimeout(t)
            resolve()
          },
          { once: true },
        )
      })
    }

    try {
      if ('caches' in window) {
        const keys = await caches.keys()
        await Promise.all(keys.map((k) => caches.delete(k)))
      }
    } catch {
      /* ignore */
    }
    try {
      const r = await navigator.serviceWorker.getRegistration()
      await r?.unregister()
    } catch {
      /* ignore */
    }

    const url = new URL(window.location.href)
    url.searchParams.set('_pwa_reload', String(Date.now()))
    window.location.replace(url.toString())
  }, [registration, updateServiceWorker])

  const value = useMemo(
    () => ({ checkForUpdate, applyUpdate, offlineReady }),
    [checkForUpdate, applyUpdate, offlineReady],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function usePwaUpdate(): PwaUpdateContextValue {
  const v = useContext(Ctx)
  if (!v) {
    throw new Error('usePwaUpdate: PwaUpdateProvider fehlt')
  }
  return v
}
