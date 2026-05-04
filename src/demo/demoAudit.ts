import { apiFetch } from '../api/http'
import { getStoredToken, hasApi } from '../api/config'

/**
 * Best-effort Audit-Eintrag fuer Aktivierung/Verlassen des Demo-Modus.
 * Bewusst OHNE X-Demo-Mode-Header (skipDemoHeader), damit der
 * Backend-Guard diese Audit-Anfrage durchlaesst.
 * Echte Demo-Verkaufsdaten werden NIE als echte Umsaetze gespeichert.
 */
export async function logDemoModeAudit(event: 'enter' | 'leave'): Promise<void> {
  if (!hasApi()) return
  if (!getStoredToken()) return
  try {
    await apiFetch('/audit/demo-mode', {
      method: 'POST',
      body: JSON.stringify({ event }),
      skipDemoHeader: true,
    })
  } catch {
    /* still demo, audit ist optional */
  }
}
