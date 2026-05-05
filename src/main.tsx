import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initPwaInstallTracking } from './pwa/installPrompt'
import {
  logPwaStartupDebug,
  redirectStandaloneAwayFromApiMount,
  redirectStandaloneIfJsonErrorShell,
} from './pwa/pwaStartupDebug'

/** Service Worker: Registrierung über `PwaUpdateProvider` (`useRegisterSW`). */
initPwaInstallTracking()

function mountReact() {
  const el = document.getElementById('root')
  if (!el) return
  createRoot(el).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

/** Standalone soll nie auf geschütztem `/api/…`-Dokument hängen bleiben oder JSON-Fehlerhülle anzeigen. */
function boot() {
  if (redirectStandaloneIfJsonErrorShell()) return
  void logPwaStartupDebug()
  mountReact()
}

if (redirectStandaloneAwayFromApiMount()) {
  // location.replace läuft — kein weiteres Mount.
} else if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true })
} else {
  boot()
}
