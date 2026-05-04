import { apiJson } from './http'
import { setStoredRole, setStoredToken } from './config'

export async function login(username: string, pin: string) {
  const root = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '')
  if (!root) throw new Error('NO_API')
  const res = await fetch(`${root}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, pin }),
  })
  const j = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((j as { error?: string }).error ?? 'LOGIN')
  const token = String((j as { token?: string }).token ?? '')
  if (!token) throw new Error('NO_TOKEN')
  setStoredToken(token)
  setStoredRole(String((j as { role?: string }).role ?? ''))
  return j as {
    token: string
    role: string
    username: string
  }
}

export function logOut() {
  setStoredToken(null)
  setStoredRole(null)
}

export function meProfile() {
  return apiJson<{ user: { sub: string; role: string; username?: string } }>(
    '/auth/me',
  )
}
