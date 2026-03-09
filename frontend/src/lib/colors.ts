export function hexToRgba(hex: string | null | undefined, alpha: number): string | null {
  if (!hex) return null
  const normalized = hex.replace('#', '')
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return null
  const r = Number.parseInt(normalized.slice(0, 2), 16)
  const g = Number.parseInt(normalized.slice(2, 4), 16)
  const b = Number.parseInt(normalized.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
