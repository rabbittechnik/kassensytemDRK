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
      const reg =
        registration ?? (await navigator.serviceWorker.getRegistration()) ?? null
      if (!reg) return 'current'
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

  const applyUpdate = useCallback(async () => {
    await updateServiceWorker(true)
  }, [updateServiceWorker])

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
