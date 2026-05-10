/** Kioskparse: Unterstützt „12,34“ oder „12.34“ → Cent */
export function parseEurosToCents(raw: string): number | null {
  const s = raw.trim().replace(/\s+/g, '')
  if (!s) return null
  const comma = s.lastIndexOf(',')
  const dot = s.lastIndexOf('.')
  let norm: string
  if (comma > dot) {
    norm = s.replace(/\./g, '').replace(',', '.')
  } else if (dot > comma) {
    norm = s.replace(/,/g, '')
  } else {
    norm = s.replace(',', '.')
  }
  const euros = Number.parseFloat(norm)
  if (!Number.isFinite(euros)) return null
  return Math.round(euros * 100)
}
