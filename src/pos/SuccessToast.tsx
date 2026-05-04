export function SuccessToast(props: { message: string }) {
  return (
    <div className="pointer-events-none fixed bottom-32 left-1/2 z-[60] max-w-[min(520px,92vw)] -translate-x-1/2 animate-success">
      <div className="panel-dlrg rounded-2xl border border-[#FFD700]/50 bg-black/90 px-6 py-4 text-center shadow-[0_0_40px_rgba(255,215,0,0.2)]">
        <p className="text-lg font-semibold text-[#FFD700]">{props.message}</p>
      </div>
    </div>
  )
}
