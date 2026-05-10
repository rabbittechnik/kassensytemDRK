import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = { children: ReactNode }

type State = { error: Error | null }

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[DLRG-Kasse] AppErrorBoundary', error, info.componentStack)
  }

  render(): ReactNode {
    if (this.state.error) {
      const msg = this.state.error.message || String(this.state.error)
      return (
        <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 bg-black px-6 py-10 text-center text-slate-200">
          <h1 className="text-xl font-black uppercase tracking-wide text-[#FFD700]">Anzeigefehler</h1>
          <p className="max-w-lg text-sm text-slate-400">
            Die Oberfläche ist abgestürzt. Bitte Seite neu laden. Wenn das in der installierten App
            weiter passiert: unter{' '}
            <span className="font-semibold text-slate-300">Werkzeuge → Cache</span> oder
            App-Daten löschen, dann neu öffnen.
          </p>
          <pre className="max-h-40 max-w-full overflow-auto rounded-lg border border-white/10 bg-black/50 p-3 text-left text-[11px] text-rose-200">
            {msg}
          </pre>
          <button
            type="button"
            className="rounded-xl border-2 border-[#FFD700]/60 bg-neutral-950 px-6 py-3 font-black uppercase text-[#FFD700]"
            onClick={() => window.location.reload()}
          >
            Neu laden
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
