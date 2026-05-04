const STORAGE_KEY = 'drk-kasse-jwt'
export const STORAGE_ROLE_KEY = 'drk-kasse-role'

/**
 * Basis-URL für API-Aufrufe (Vite blendet `VITE_API_BASE_URL` beim Build ein).
 * Ist nichts gesetzt, wird `/api` verwendet (gleiche Origin wie das Frontend, z. B. Railway mit `API_MOUNT_PATH=/api`).
 */
export function apiBaseUrl(): string {
  const raw = import.meta.env.VITE_API_BASE_URL
  if (raw === undefined || raw === null) return '/api'
  const t = String(raw).trim()
  if (t === '') return '/api'
  return t.replace(/\/$/, '')
}

/** true, sobald relative oder absolute API-Basis vorliegt (Standard ist immer `/api`). */
export function hasApi(): boolean {
  return Boolean(apiBaseUrl())
}

export function getStoredToken(): string | null {
  try {
    return sessionStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

export function setStoredToken(t: string | null) {
  try {
    if (t == null || t === '') sessionStorage.removeItem(STORAGE_KEY)
    else sessionStorage.setItem(STORAGE_KEY, t)
  } catch {
    /* kiosk may block storage */
  }
}

export function setStoredRole(r: string | null) {
  try {
    if (r == null || r === '') sessionStorage.removeItem(STORAGE_ROLE_KEY)
    else sessionStorage.setItem(STORAGE_ROLE_KEY, r)
  } catch {
    /* ignore */
  }
}

export function getStoredRole(): string | null {
  try {
    return sessionStorage.getItem(STORAGE_ROLE_KEY)
  } catch {
    return null
  }
}
