import { useMemo, useState } from 'react'

/** Bricht alte Service-Worker-Caches unter `/assets/products/*` beim Release. */
const ASSET_IMG_V =
  typeof import.meta.env.VITE_APP_VERSION === 'string'
    ? import.meta.env.VITE_APP_VERSION.trim()
    : ''

function withProductAssetVersion(relPath: string): string {
  if (!relPath.startsWith('/') || !ASSET_IMG_V) return relPath
  const sep = relPath.includes('?') ? '&' : '?'
  return `${relPath}${sep}v=${encodeURIComponent(ASSET_IMG_V)}`
}

/** Dateiname unter `public/assets/products/` ohne `p-`, ggf. Sonder-Mapping */
const ID_TO_PRODUCT_SLUG: Record<string, string> = {
  'p-rote': 'rote-wurst',
  /** Datei heißt currywurst.png (nicht curry.png aus ID p-curry) */
  'p-curry': 'currywurst',
  'p-bitterlemon': 'bitter-lemon',
  'p-kuchenstueck': 'kuchenstueck',
  'p-broetchen': 'broetchen',
  /** Eigene Datei: umgeht dauerhaft gecachte alte „vegetarisch.png“ unter SW „CacheFirst“. */
  'p-veg': 'veg-maultaschen-burger',
  /** Kombi-Angebot */
  'p-kk': '',
}

function autoImageHref(productId: string): string | null {
  if (!productId.startsWith('p-')) return null
  const slug = ID_TO_PRODUCT_SLUG[productId]
  if (slug === '') return null
  const fileStem = slug ?? productId.slice(2)
  if (!fileStem) return null
  return withProductAssetVersion(`/assets/products/${fileStem}.png`)
}

/** Sync/DB kann noch `/assets/products/curry.png` halten — dann würde das alte Bild Vorrang vor `currywurst.png` haben. */
function isLegacyCurryCatalogImage(productId: string, imageUrl: string): boolean {
  if (productId !== 'p-curry') return false
  const u = imageUrl.trim()
  if (!u) return false
  if (u.toLowerCase().includes('currywurst')) return false
  return (
    /\/assets\/products\/curry(?:\.png)?(?:[?#]|$)/i.test(u) ||
    /^assets\/products\/curry(?:\.png)?(?:[?#]|$)/i.test(u)
  )
}

function resolvedImageSrc(
  productId: string,
  imageUrl?: string | null,
): string | null {
  let u = imageUrl?.trim() ?? ''
  if (isLegacyCurryCatalogImage(productId, u)) u = ''
  const href = u || autoImageHref(productId)
  if (!href) return null
  if (href.startsWith('/')) return withProductAssetVersion(href)
  return href
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
  /** Kein 🥗 als Fallback (wirkt wie Salatblatt) – Maultaschen-Burger-Bezug */
  if (n.includes('vegetar')) return '🍔'
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
      className="relative aspect-square h-full max-h-full min-h-0 w-[40%] max-w-[5.5rem] shrink-0 overflow-hidden rounded-l-xl border-r border-red-500/40 sm:max-w-[6.5rem]"
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
        <div className="absolute inset-0 flex items-center justify-center p-1.5">
          <img
            src={src}
            alt=""
            draggable={false}
            className="h-full w-full object-contain object-center"
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
