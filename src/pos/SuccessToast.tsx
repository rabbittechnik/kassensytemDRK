export function SuccessToast(props: { message: string }) {
  return (
    <div className="pointer-events-none fixed bottom-28 left-1/2 z-[60] max-w-[min(520px,92vw)] -translate-x-1/2 animate-success">
      <div className="panel-glass rounded-2xl border border-cyan-400/40 px-6 py-4 text-center shadow-[0_0_40px_rgba(34,211,238,0.25)]">
        <p className="text-lg font-semibold text-cyan-50">{props.message}</p>
      </div>
    </div>
  )
}
