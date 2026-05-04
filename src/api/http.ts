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

/**
 * Baut die Request-URL: `resolveApiUrl("/teams")` mit Basis `/api` → `/api/teams`.
 * Wenn `path` bereits mit der Basis beginnt (z. B. fälschlich `/api/teams`), wird nicht
 * verdoppelt → weiterhin `/api/teams`.
 */
export function resolveApiUrl(path: string): string {
  const b = apiBaseUrl().replace(/\/$/, '')
  const rel = path.startsWith('/') ? path : `/${path}`
  if (!b) return rel
  if (b.startsWith('/') && (rel === b || rel.startsWith(`${b}/`))) return rel
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
      ' Prüfen Sie: Server läuft, API unter gleicher Origin (z. B. /api), Backend-Env API_MOUNT_PATH=/api, CORS, Netzwerk. Bei Railway: VITE_API_BASE_URL=/api vor dem Frontend-Build setzen oder leer lassen (Default /api).'
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
