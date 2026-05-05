const STORAGE_KEY = 'drk-kasse-jwt'
export const STORAGE_ROLE_KEY = 'drk-kasse-role'

/**
 * Basis für alle API-Aufrufe (`apiFetch` / `apiJson` / `login`).
 * Railway (Frontend + API gleicher Host): `VITE_API_BASE_URL=/api` setzen oder weglassen
 * (Default ist `/api`). Pfade werden dann z. B. zu `fetch("/api/teams")` aufgelöst.
 */
export const API_BASE_URL =
  String(import.meta.env.VITE_API_BASE_URL ?? '').trim() || '/api'

/** Normalisierte Basis ohne trailing slash (nie leer; mindestens `/api`). */
export function apiBaseUrl(): string {
  const t = API_BASE_URL.replace(/\/$/, '')
  return t || '/api'
}

/** true, wenn eine API-Basis gesetzt ist (Standard immer `/api` → immer true). */
export function hasApi(): boolean {
  return Boolean(apiBaseUrl())
}

export function getStoredToken(): string | null {
  try {
    const fromLocal = localStorage.getItem(STORAGE_KEY)
    if (fromLocal) return fromLocal
    const fromSession = sessionStorage.getItem(STORAGE_KEY)
    if (fromSession) {
      localStorage.setItem(STORAGE_KEY, fromSession)
      sessionStorage.removeItem(STORAGE_KEY)
    }
    return fromSession
  } catch {
    return null
  }
}

export function setStoredToken(t: string | null) {
  try {
    if (t == null || t === '') {
      localStorage.removeItem(STORAGE_KEY)
      sessionStorage.removeItem(STORAGE_KEY)
    } else {
      localStorage.setItem(STORAGE_KEY, t)
      sessionStorage.setItem(STORAGE_KEY, t)
    }
  } catch {
    /* kiosk may block storage */
  }
}

export function setStoredRole(r: string | null) {
  try {
    if (r == null || r === '') {
      localStorage.removeItem(STORAGE_ROLE_KEY)
      sessionStorage.removeItem(STORAGE_ROLE_KEY)
    } else {
      localStorage.setItem(STORAGE_ROLE_KEY, r)
      sessionStorage.setItem(STORAGE_ROLE_KEY, r)
    }
  } catch {
    /* ignore */
  }
}

export function getStoredRole(): string | null {
  try {
    const fromLocal = localStorage.getItem(STORAGE_ROLE_KEY)
    if (fromLocal) return fromLocal
    const fromSession = sessionStorage.getItem(STORAGE_ROLE_KEY)
    if (fromSession) {
      localStorage.setItem(STORAGE_ROLE_KEY, fromSession)
      sessionStorage.removeItem(STORAGE_ROLE_KEY)
    }
    return fromSession
  } catch {
    return null
  }
}
