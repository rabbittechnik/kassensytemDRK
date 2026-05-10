import { API_BASE_URL, apiBaseUrl } from '../api/config'
import { backendHealthFetchUrl } from '../api/http'

export type PwaStartupSnapshot = Record<string, unknown>

/** Alle Daten fuer Console + Overlay — eine Quelle, keine Abweichungen. */
export async function gatherPwaStartupDebugSnapshot(): Promise<PwaStartupSnapshot> {
  const out: PwaStartupSnapshot = {
    timeIso: new Date().toISOString(),
    href: typeof window !== 'undefined' ? window.location.href : '',
    pathname: typeof window !== 'undefined' ? window.location.pathname : '',
    search: typeof window !== 'undefined' ? window.location.search : '',
    referrer: typeof document !== 'undefined' ? document.referrer || '(leer)' : '',
    displayModeStandalone:
      typeof window !== 'undefined'
        ? window.matchMedia?.('(display-mode: standalone)')?.matches ?? null
        : null,
    navigatorStandalone:
      typeof navigator !== 'undefined'
        ? Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
        : null,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    manifestStartUrl: null as string | null,
    manifestScope: null as string | null,
    activeServiceWorkerScriptUrl: null as string | null,
    installingServiceWorkerScriptUrl: null as string | null,
    waitingServiceWorkerScriptUrl: null as string | null,
    cacheNames: [] as string[],
    appVersion: import.meta.env.VITE_APP_VERSION,
    buildAt: import.meta.env.VITE_APP_BUILD_AT,
    viteApiBase: API_BASE_URL,
    normalizedApiBase: apiBaseUrl(),
    healthProbe: {} as Record<string, unknown>,
  }

  try {
    const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')
    if (link?.href) {
      const r = await fetch(link.href, { cache: 'no-store' })
      const j = (await r.json()) as {
        start_url?: string
        scope?: string
        name?: string
      }
      out.manifestStartUrl = j.start_url ?? '(kein start_url im Manifest)'
      out.manifestScope = j.scope ?? '(kein scope)'
      out.manifestFetchResolvedUrl = r.url
      out.manifestFetchStatus = r.status
    } else {
      out.manifestStartUrl = '(kein link[rel=manifest])'
    }
  } catch (e) {
    out.manifestStartUrl = `(Manifest-Fetch fehlgeschlagen: ${String((e as Error)?.message ?? e)})`
  }

  try {
    const reg = await navigator.serviceWorker?.getRegistration()
    const a = reg?.active
    if (a?.scriptURL) out.activeServiceWorkerScriptUrl = a.scriptURL
    if (reg?.installing?.scriptURL) out.installingServiceWorkerScriptUrl = reg.installing.scriptURL
    if (reg?.waiting?.scriptURL) out.waitingServiceWorkerScriptUrl = reg.waiting.scriptURL
  } catch (e) {
    out.serviceWorkerError = String((e as Error)?.message ?? e)
  }

  try {
    out.cacheNames = (await caches?.keys?.()) ?? []
  } catch {
    out.cacheNames = []
  }

  try {
    const url = backendHealthFetchUrl()
    let swCacheMayHaveHealth = false
    try {
      const names = (await caches?.keys?.()) ?? []
      for (const name of names) {
        const c = await caches.open(name)
        const hit = await c.match(url)
        if (hit) {
          swCacheMayHaveHealth = true
          break
        }
      }
    } catch {
      /* ignore */
    }
    const res = await fetch(url, { cache: 'no-store', credentials: 'same-origin' })
    out.healthProbe = {
      requestUrl: url,
      fetchedUrl: res.url,
      ok: res.ok,
      status: res.status,
      contentType: res.headers.get('content-type') ?? '',
      respType: res.type,
      swCachesMayContainHealthUrl: swCacheMayHaveHealth,
    }
  } catch (e) {
    out.healthProbe = { error: String((e as Error)?.message ?? e) }
  }

  return out
}

/**
 * Einmalige Diagnose beim App-Start (Browser + Standalone/PWA).
 * Explizite console.log-Zeilen fuer iPad-Debugging (Remote Web Inspector).
 */
export async function logPwaStartupDebug(): Promise<void> {
  try {
    if (typeof window === 'undefined') return

    const snap = await gatherPwaStartupDebugSnapshot()

    console.log('[DLRG-Kasse PWA] window.location.href =', snap.href)
    console.log('[DLRG-Kasse PWA] document.referrer =', snap.referrer)
    console.log(
      '[DLRG-Kasse PWA] display-mode: standalone =',
      snap.displayModeStandalone === true ? 'ja' : 'nein',
      '(raw:',
      snap.displayModeStandalone,
      ')',
    )
    console.log(
      '[DLRG-Kasse PWA] navigator.standalone =',
      snap.navigatorStandalone === true ? 'ja' : 'nein',
      '(raw:',
      snap.navigatorStandalone,
      ')',
    )
    console.log('[DLRG-Kasse PWA] manifest start_url (Netzwerk) =', snap.manifestStartUrl)
    console.log('[DLRG-Kasse PWA] manifest scope (Netzwerk) =', snap.manifestScope)
    console.log('[DLRG-Kasse PWA] active service worker scriptURL =', snap.activeServiceWorkerScriptUrl)
    console.log('[DLRG-Kasse PWA] cache names =', snap.cacheNames)
    console.log('[DLRG-Kasse PWA] app version / build =', snap.appVersion, '/', snap.buildAt)
    console.log('[DLRG-Kasse PWA] voller Snapshot (Objekt) =', snap)

    console.info('[DLRG-Kasse PWA Start — kompakt]', {
      href: snap.href,
      referrer: snap.referrer,
      displayModeStandalone: snap.displayModeStandalone,
      navigatorStandalone: snap.navigatorStandalone,
      manifestStartUrl: snap.manifestStartUrl,
      serviceWorker: snap.activeServiceWorkerScriptUrl,
      cacheNames: snap.cacheNames,
      viteApiBase: snap.viteApiBase,
      healthProbe: snap.healthProbe,
    })
  } catch {
    /* ignore bootstrap logging failures */
  }
}

/**
 * Home-Bildschirm-Icon kann eine API-/Fremd-Route als Startadresse behalten.
 */
export function redirectStandaloneAwayFromApiMount(): boolean {
  if (typeof window === 'undefined') return false
  const path = window.location.pathname
  const standalone =
    window.matchMedia?.('(display-mode: standalone)')?.matches ??
    Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone)
  if (!standalone) return false

  const apiLaunch =
    path === '/api' ||
    path.startsWith('/api/') ||
    path.startsWith('/v1/') ||
    path === '/connect' ||
    path.startsWith('/connect/') ||
    path === '/callback' ||
    path.startsWith('/callback/') ||
    path === '/oauth' ||
    path.startsWith('/oauth/')
  if (!apiLaunch) return false
  window.location.replace(`${window.location.origin}/`)
  return true
}

/** Wenn die dokumenteigene Antwort eine JSON-Fehlerhülle ist (z. B. 403), auf `/` gehen. */
export function redirectStandaloneIfJsonErrorShell(): boolean {
  if (typeof window === 'undefined') return false
  const standalone =
    window.matchMedia?.('(display-mode: standalone)')?.matches ??
    Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone)
  const raw = (document.body?.textContent ?? '').trim()
  if (!standalone || raw.length === 0 || raw.length > 2000) return false

  const isJsonError =
    raw.startsWith('{') &&
    (raw.includes('"statusCode"') ||
      raw.includes('"error"') ||
      raw.includes('"message"'))

  const isPlainTextError =
    !raw.startsWith('<') &&
    /\b(forbidden|unauthorized|not found|error|403|401|404)\b/i.test(raw)

  if (!isJsonError && !isPlainTextError) return false

  try {
    sessionStorage.setItem(
      'drk-kasse-json-shell-from',
      `${window.location.pathname}${window.location.search}`,
    )
  } catch {
    /* ignore */
  }
  window.location.replace(`${window.location.origin}/`)
  return true
}
