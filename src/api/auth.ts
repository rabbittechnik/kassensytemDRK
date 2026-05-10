import { apiJson, ApiError, describeApiReachability, resolveApiUrl } from './http'
import { setStoredRole, setStoredToken } from './config'

const AUTH_EVENT = 'drk-kasse-auth'

function notifyAuthListeners() {
  try {
    window.dispatchEvent(new Event(AUTH_EVENT))
  } catch {
    /* ignore */
  }
}

export async function login(username: string, pin: string) {
  let res: Response
  try {
    res = await fetch(resolveApiUrl('/auth/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, pin }),
    })
  } catch {
    throw new ApiError(
      `Anmeldung fehlgeschlagen: keine Verbindung zur API (${describeApiReachability('/auth/login')}).`,
      0,
    )
  }
  const j = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((j as { error?: string }).error ?? 'LOGIN')
  const token = String((j as { token?: string }).token ?? '')
  if (!token) throw new Error('NO_TOKEN')
  setStoredToken(token)
  setStoredRole(String((j as { role?: string }).role ?? ''))
  notifyAuthListeners()
  return j as {
    token: string
    role: string
    username: string
  }
}

export function logOut() {
  setStoredToken(null)
  setStoredRole(null)
  notifyAuthListeners()
}

export function meProfile() {
  return apiJson<{ user: { sub: string; role: string; username?: string } }>(
    '/auth/me',
  )
}
