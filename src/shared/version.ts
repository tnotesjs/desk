export function parseVersion(value: string): number[] | null {
  const core = value.trim().replace(/^v/i, '').split('-')[0]
  if (!core) return null
  const parts = core.split('.').map((part) => (/^\d+$/.test(part) ? Number(part) : NaN))
  if (parts.some((part) => Number.isNaN(part))) return null
  while (parts.length < 3) parts.push(0)
  return parts
}

export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left)
  const b = parseVersion(right)
  if (!a || !b) return 0
  const length = Math.max(a.length, b.length)
  for (let index = 0; index < length; index += 1) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0)
    if (diff !== 0) return diff > 0 ? 1 : -1
  }
  return 0
}
