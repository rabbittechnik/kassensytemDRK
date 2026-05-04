const STORAGE_KEY = 'drk-kasse-jwt'
export const STORAGE_ROLE_KEY = 'drk-kasse-role'

export function apiBaseUrl(): string | null {
  const u = import.meta.env.VITE_API_BASE_URL?.trim()
  if (!u) return null
  return u.replace(/\/$/, '')
}

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
