/** Einfache „Bild“-Fläche links in der Kachel (offline, ohne externe Assets). */
export function ProductVisual(props: { name: string; categoryId: string }) {
  const id = props.categoryId.toLowerCase()
  const hue = /kuchen|cake/.test(id) ? 45 : /essen|food/.test(id) ? 28 : 0
  const emoji = emojiForProduct(props.name)
  return (
    <div
      className="relative flex h-full min-h-[72px] w-[44%] shrink-0 items-center justify-center overflow-hidden rounded-l-xl border-r border-red-500/40"
      style={{
        background: `linear-gradient(145deg, hsla(${hue}, 85%, 22%, 0.95) 0%, #0a0a0a 100%)`,
        boxShadow: 'inset 0 0 24px rgba(255,0,60,0.12)',
      }}
    >
      <span className="select-none text-4xl drop-shadow-[0_0_12px_rgba(255,215,0,0.35)]">
        {emoji}
      </span>
    </div>
  )
}

function emojiForProduct(name: string): string {
  const n = name.toLowerCase()
  if (n.includes('wasser')) return '💧'
  if (n.includes('cola')) return '🥤'
  if (n.includes('fanta')) return '🧃'
  if (n.includes('spezi')) return '🥤'
  if (n.includes('kaffee')) return '☕'
  if (n.includes('tee')) return '🍵'
  if (n.includes('apfelschorle')) return '🍎'
  if (n.includes('energy')) return '⚡'
  if (n.includes('eistee')) return '🧊'
  if (n.includes('limo')) return '🍋'
  if (n.includes('orangensaft')) return '🍊'
  if (n.includes('bitter')) return '🍸'
  if (n.includes('wurst') || n.includes('curry')) return '🌭'
  if (n.includes('pommes')) return '🍟'
  if (n.includes('brötchen')) return '🥐'
  if (n.includes('vegetar')) return '🥗'
  if (n.includes('kuchen') || n.includes('torte')) return '🍰'
  if (n.includes('muffin')) return '🧁'
  if (n.includes('kombi')) return '🫖'
  return '🛒'
}
