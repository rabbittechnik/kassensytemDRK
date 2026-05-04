/** Format cents as de-DE currency string without currency symbol clutter in tables */
export function formatCentsEUR(cents: number): string {
  const euros = cents / 100
  return new Intl.NumberFormat('de-DE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(euros)
}
