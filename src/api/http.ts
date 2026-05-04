import { apiBaseUrl, getStoredToken } from './config'
import { isDemoMode } from '../demo/demoStore'

/** Erweiterte fetch-Optionen mit Demo-Header-Steuerung. */
export interface ApiFetchInit extends RequestInit {
  /** true: kein automatischer `X-Demo-Mode`-Header (z. B. Audit-Endpunkt). */
  skipDemoHeader?: boolean
}

export class ApiError extends Error {
  status: number
  body?: unknown
  declare cause?: unknown
  constructor(message: string, status: number, body?: unknown, options?: ErrorOptions) {
    super(message, options)
    this.status = status
    this.body = body
  }
}

/** Vollständige URL oder Pfad relativ zur aktuellen Seite (z. B. `/teams` mit Basis `/api` → `/api/teams`). */
export function resolveApiUrl(path: string): string {
  const base = apiBaseUrl()
  const rel = path.startsWith('/') ? path : `/${path}`
  const b = base.replace(/\/$/, '')
  if (!b) return rel
  if (b.startsWith('/')) return `${b}${rel}`
  return `${b}${rel}`
}

export function describeApiReachability(path = '/health'): string {
  try {
    const u = resolveApiUrl(path)
    if (typeof window !== 'undefined' && window.location?.origin && u.startsWith('/')) {
      return `${window.location.origin}${u}`
    }
    return u
  } catch {
    return '(nicht konfiguriert)'
  }
}

export async function apiFetch(path: string, init: ApiFetchInit = {}): Promise<Response> {
  const token = getStoredToken()
  const headers = new Headers(init.headers)
  const m = String(init.method ?? 'GET').toUpperCase()

  const hasBody = init.body != null && m !== 'GET' && m !== 'HEAD'

  if (hasBody && !headers.has('Content-Type'))
    headers.set('Content-Type', 'application/json')

  if (token) headers.set('Authorization', `Bearer ${token}`)

  // Demo-Modus: setzt automatisch X-Demo-Mode: true. Das Backend lehnt
  // damit jegliche Schreiboperationen ab (Backstop-Schutz). Audit-Endpunkt
  // sendet skipDemoHeader, weil er gezielt ins echte Audit-Log darf.
  if (!init.skipDemoHeader && isDemoMode()) {
    headers.set('X-Demo-Mode', 'true')
  }

  const url = resolveApiUrl(path)

  // skipDemoHeader ist unsere eigene Erweiterung -- vor fetch() entfernen.
  const fetchInit: RequestInit = { ...init, headers }
  delete (fetchInit as ApiFetchInit).skipDemoHeader

  try {
    const res = await fetch(url, fetchInit)
    return res
  } catch (cause: unknown) {
    const where =
      typeof window !== 'undefined' && window.location?.origin && url.startsWith('/')
        ? `${window.location.origin}${url}`
        : url
    const hint =
      ' Prüfen Sie: Server läuft, Railway-URL/API-Pfad (/api?), CORS, Netzwerk, und ob Vite mit demselben Basis-Pfad gebaut wurde (Variable bei Railway vor dem Build setzen).'
    const msg = `Die API unter «${where}» ist nicht erreichbar.${hint}`
    throw new ApiError(msg, 0, undefined, { cause })
  }
}

export async function apiBlob(path: string, init?: ApiFetchInit): Promise<Blob> {
  const res = await apiFetch(path, init)
  if (!res.ok)
    throw new ApiError(await res.text().catch(() => res.statusText), res.status)

  return res.blob()
}

export async function apiJson<T>(path: string, init?: ApiFetchInit): Promise<T> {
  const res = await apiFetch(path, init)
  const text = await res.text()
  let body: unknown = {}
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = {}
    }
  }
  if (!res.ok)
    throw new ApiError(
      (body as { error?: string }).error ??
        `${res.status} ${res.statusText}`.trim(),
      res.status,
      body,
    )
  return body as T
}
