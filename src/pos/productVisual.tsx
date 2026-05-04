import { useMemo, useState } from 'react'

/** Dateiname unter `public/assets/products/` ohne `p-`, ggf. Sonder-Mapping */
const ID_TO_PRODUCT_SLUG: Record<string, string> = {
  'p-rote': 'rote-wurst',
  'p-bitterlemon': 'bitter-lemon',
  'p-kuchenstueck': 'kuchenstueck',
  'p-broetchen': 'broetchen',
  'p-veg': 'vegetarisch',
  /** Kombi-Angebot */
  'p-kk': '',
}

function autoImageHref(productId: string): string | null {
  if (!productId.startsWith('p-')) return null
  const slug = ID_TO_PRODUCT_SLUG[productId]
  if (slug === '') return null
  const fileStem = slug ?? productId.slice(2)
  if (!fileStem) return null
  return `/assets/products/${fileStem}.png`
}

function resolvedImageSrc(
  productId: string,
  imageUrl?: string | null,
): string | null {
  const u = imageUrl?.trim()
  if (u) return u
  return autoImageHref(productId)
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

/** Linksbereich der Kachel: Bild wird in den Rahmen skaliert (nicht umgekehrt). */
export function ProductVisual(props: {
  productId: string
  name: string
  categoryId: string
  imageUrl?: string | null
}) {
  const cat = props.categoryId.toLowerCase()
  const hue = /kuchen|cake/.test(cat) ? 45 : /essen|food/.test(cat) ? 28 : 0
  const emoji = emojiForProduct(props.name)
  const src = useMemo(
    () =>
      resolvedImageSrc(props.productId, props.imageUrl ?? null),
    [props.productId, props.imageUrl],
  )
  const [imgFailed, setImgFailed] = useState(false)
  const showImg = Boolean(src && !imgFailed)

  return (
    <div
      className="relative h-full max-h-full min-h-0 w-[42%] max-w-[6.75rem] shrink-0 overflow-hidden rounded-l-xl border-r border-red-500/40"
      style={
        showImg ?
          { background: '#050505' }
        : {
            background: `linear-gradient(145deg, hsla(${hue}, 85%, 22%, 0.95) 0%, #0a0a0a 100%)`,
            boxShadow: 'inset 0 0 24px rgba(255,0,60,0.12)',
          }
      }
    >
      {showImg && src ?
        <div className="flex h-full w-full items-center justify-center p-1 sm:p-1.5">
          <img
            src={src}
            alt=""
            draggable={false}
            className="max-h-full max-w-full object-contain object-center"
            onError={() => setImgFailed(true)}
          />
        </div>
      : <span className="flex h-full w-full select-none items-center justify-center text-2xl drop-shadow-[0_0_12px_rgba(255,215,0,0.35)] sm:text-3xl">
          {emoji}
        </span>
      }
    </div>
  )
}
