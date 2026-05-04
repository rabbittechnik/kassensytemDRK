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
