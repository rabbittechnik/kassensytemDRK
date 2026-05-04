import { apiBaseUrl, getStoredToken } from './config'

export class ApiError extends Error {
  status: number
  body?: unknown
  constructor(message: string, status: number, body?: unknown) {
    super(message)
    this.status = status
    this.body = body
  }
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const base = apiBaseUrl()
  if (!base) throw new ApiError('API nicht konfiguriert', 0)

  const token = getStoredToken()
  const headers = new Headers(init.headers)
  const m = String(init.method ?? 'GET').toUpperCase()

  const hasBody = init.body != null && m !== 'GET' && m !== 'HEAD'

  if (hasBody && !headers.has('Content-Type'))
    headers.set('Content-Type', 'application/json')

  if (token) headers.set('Authorization', `Bearer ${token}`)

  const res = await fetch(`${base}${path.startsWith('/') ? path : '/' + path}`, {
    ...init,
    headers,
  })
  return res
}

export async function apiBlob(path: string): Promise<Blob> {
  const res = await apiFetch(path)
  if (!res.ok)
    throw new ApiError(await res.text().catch(() => res.statusText), res.status)

  return res.blob()
}

export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(path, init)
  const text = await res.text()
  const body = text ? JSON.parse(text) : {}
  if (!res.ok)
    throw new ApiError(
      (body as { error?: string }).error ?? res.statusText,
      res.status,
      body,
    )
  return body as T
}
