export const APP_ZOOM_MIN = 50
export const APP_ZOOM_MAX = 200
export const APP_ZOOM_DEFAULT = 100
export const APP_ZOOM_STEP = 10

export function clampAppZoom(value: number): number {
  return Math.min(APP_ZOOM_MAX, Math.max(APP_ZOOM_MIN, value))
}

export function parseAppZoomInput(input: string): number | null {
  const text = input.trim().replace(/%$/, '').trim()
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) return null
  const value = Number(text)
  return Number.isFinite(value) ? clampAppZoom(value) : null
}
