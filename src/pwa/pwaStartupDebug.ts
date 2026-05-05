import { API_BASE_URL, apiBaseUrl } from '../api/config'
import { backendHealthFetchUrl } from '../api/http'

/**
 * Einmalige Diagnose beim App-Start (Browser + Standalone/PWA).
 * Hilft beim Debuggen falscher Launch-URLs, SW-Caches und /health-Proben.
 */
export async function logPwaStartupDebug(): Promise<void> {
  try {
    if (typeof window === 'undefined') return

    let manifestStartUrl: string | null = null
    try {
      const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')
      if (link?.href) {
        const r = await fetch(link.href, { cache: 'no-store' })
        const j = (await r.json()) as { start_url?: string; scope?: string }
        manifestStartUrl = j.start_url ?? null
      }
    } catch {
      manifestStartUrl = '(Manifest nicht lesbar)'
    }

    let swVersion = 'kein aktiver Service Worker'
    try {
      const reg = await navigator.serviceWorker?.getRegistration()
      const a = reg?.active
      if (a?.scriptURL) swVersion = a.scriptURL
      else if (reg?.installing?.scriptURL) swVersion = `installing: ${reg.installing.scriptURL}`
      else if (reg?.waiting?.scriptURL) swVersion = `waiting: ${reg.waiting.scriptURL}`
    } catch {
      swVersion = '(SW-Fehler)'
    }

    let cacheNames: string[] = []
    try {
      cacheNames = (await caches?.keys?.()) ?? []
    } catch {
      cacheNames = []
    }

    let healthProbe: Record<string, unknown> = {}
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
      const ct = res.headers.get('content-type') ?? ''
      healthProbe = {
        url,
        fetchedUrl: res.url,
        ok: res.ok,
        status: res.status,
        contentType: ct,
        respType: res.type,
        swCachesMayContainHealthUrl: swCacheMayHaveHealth,
      }
    } catch (e) {
      healthProbe = { error: String((e as Error)?.message ?? e) }
    }

    console.info('[DLRG-Kasse PWA Start]', {
      href: window.location.href,
      path: window.location.pathname,
      search: window.location.search,
      displayModeStandalone: window.matchMedia('(display-mode: standalone)').matches,
      navigatorStandalone: (navigator as Navigator & { standalone?: boolean }).standalone,
      manifestStartUrlFromNetwork: manifestStartUrl,
      serviceWorker: swVersion,
      cacheNames,
      viteApiBase: API_BASE_URL,
      normalizedApiBase: apiBaseUrl(),
      healthProbe,
      appVersion: import.meta.env.VITE_APP_VERSION,
      buildAt: import.meta.env.VITE_APP_BUILD_AT,
    })
  } catch {
    /* ignore bootstrap logging failures */
  }
}

/**
 * Home-Bildschirm-Icon zeigt manchmal noch eine alte `/api/…`-URL → sofort auf App-Root senden.
 */
export function redirectStandaloneAwayFromApiMount(): boolean {
  if (typeof window === 'undefined') return false
  const path = window.location.pathname
  const standalone =
    window.matchMedia?.('(display-mode: standalone)')?.matches ??
    Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone)
  const apiLaunch =
    path === '/api' || path.startsWith('/api/') || path.startsWith('/v1/')
  if (!standalone || !apiLaunch) return false
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

  // JSON error shell (e.g. {"statusCode":403,"error":"Forbidden"})
  const isJsonError =
    raw.startsWith('{') &&
    (raw.includes('"statusCode"') ||
      raw.includes('"error"') ||
      raw.includes('"message"'))

  // Plain-text HTTP error responses (e.g. "Forbidden", "Not Found", "Error Forbidden")
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
