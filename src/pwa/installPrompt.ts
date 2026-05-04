import { useSyncExternalStore } from 'react'

/**
 * PWA-Installationssteuerung.
 *
 * - Faengt das `beforeinstallprompt`-Event von Chromium-Browsern auf
 *   (Chrome/Edge/Android) und stellt es spaeter als `triggerInstallPrompt()`
 *   zur Verfuegung.
 * - Erkennt iOS/iPadOS, da Safari kein `beforeinstallprompt` unterstuetzt;
 *   dort muss der User manuell ueber das Teilen-Symbol installieren.
 * - Erkennt den Standalone-Modus.
 */

export type Platform = 'ios' | 'android' | 'desktop' | 'unknown'

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

interface PwaState {
  /** true: Browser-Install-Prompt ist verfuegbar (Chromium). */
  canInstall: boolean
  /** true: App laeuft bereits im Standalone-Modus oder wurde gerade installiert. */
  installed: boolean
  /** Erkannte Plattform fuer plattformspezifische UI. */
  platform: Platform
  /** true: iOS und nicht im Standalone-Modus -> Anleitung zeigen. */
  iosNeedsGuide: boolean
}

let savedPromptEvent: BeforeInstallPromptEvent | null = null
const listeners = new Set<() => void>()
let state: PwaState = computeInitialState()

function emit() {
  for (const fn of listeners) fn()
}

function setState(patch: Partial<PwaState>) {
  state = { ...state, ...patch }
  emit()
}

function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'unknown'
  const ua = navigator.userAgent || ''
  if (/iPad|iPhone|iPod/.test(ua)) return 'ios'
  if (
    ua.includes('Mac') &&
    typeof navigator.maxTouchPoints === 'number' &&
    navigator.maxTouchPoints > 1
  ) {
    return 'ios' // iPadOS ab Safari 13: meldet sich als Mac
  }
  if (/Android/i.test(ua)) return 'android'
  return 'desktop'
}

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  if (window.matchMedia?.('(display-mode: standalone)')?.matches) return true
  const nav = window.navigator as { standalone?: boolean }
  return nav.standalone === true
}

function computeInitialState(): PwaState {
  const platform = detectPlatform()
  const installed = isStandalone()
  return {
    canInstall: false,
    installed,
    platform,
    iosNeedsGuide: platform === 'ios' && !installed,
  }
}

export function initPwaInstallTracking(): void {
  if (typeof window === 'undefined') return
  if (initPwaInstallTracking.done) return
  initPwaInstallTracking.done = true

  window.addEventListener('beforeinstallprompt', (ev) => {
    ev.preventDefault()
    savedPromptEvent = ev as BeforeInstallPromptEvent
    setState({ canInstall: true })
  })

  window.addEventListener('appinstalled', () => {
    savedPromptEvent = null
    setState({ canInstall: false, installed: true, iosNeedsGuide: false })
  })

  // Standalone-Wechsel beobachten (z. B. nach Reload nach Installation).
  if (window.matchMedia) {
    const mql = window.matchMedia('(display-mode: standalone)')
    const onChange = () =>
      setState({
        installed: mql.matches || isStandalone(),
        iosNeedsGuide:
          state.platform === 'ios' && !(mql.matches || isStandalone()),
      })
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onChange)
    }
  }
}
initPwaInstallTracking.done = false as boolean

export async function triggerInstallPrompt(): Promise<
  'accepted' | 'dismissed' | 'unavailable'
> {
  if (!savedPromptEvent) return 'unavailable'
  try {
    await savedPromptEvent.prompt()
    const choice = await savedPromptEvent.userChoice
    savedPromptEvent = null
    setState({ canInstall: false })
    if (choice.outcome === 'accepted') {
      setState({ installed: true, iosNeedsGuide: false })
      return 'accepted'
    }
    return 'dismissed'
  } catch {
    savedPromptEvent = null
    setState({ canInstall: false })
    return 'unavailable'
  }
}

export function subscribePwa(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function getPwaState(): PwaState {
  return state
}

export function usePwaInstall() {
  return useSyncExternalStore(
    subscribePwa,
    () => state,
    () => state,
  )
}
