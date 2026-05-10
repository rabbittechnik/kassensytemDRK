/** Eingebettet per Vite `define` (siehe vite.config.ts). */
export function buildMetaSummary(): { version: string; buildFormatted: string } {
  const version = import.meta.env.VITE_APP_VERSION ?? '?'
  const iso = import.meta.env.VITE_APP_BUILD_AT ?? ''
  let buildFormatted = '—'
  if (iso) {
    try {
      buildFormatted = new Intl.DateTimeFormat('de-DE', {
        dateStyle: 'short',
        timeStyle: 'short',
      }).format(new Date(iso))
    } catch {
      buildFormatted = iso
    }
  }
  return { version, buildFormatted }
}
