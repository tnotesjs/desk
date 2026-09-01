/**
 * VitePress-style fence highlight ranges: `{1,2,5-7}` ↔ Set of 1-based line numbers.
 */

const HIGHLIGHT_BLOCK_RE = /\{([0-9,\s-]+)\}/

/** Parse `{1,2,5-7}` (or any fence meta containing it) into a Set of line numbers. */
export function parseHighlightRanges(meta?: string | null): Set<number> {
  const lines = new Set<number>()
  if (!meta) return lines
  const match = meta.match(HIGHLIGHT_BLOCK_RE)
  if (!match?.[1]) return lines
  for (const part of match[1].split(',')) {
    const token = part.trim()
    if (!token) continue
    const range = token.match(/^(\d+)\s*-\s*(\d+)$/)
    if (range) {
      const start = Number(range[1])
      const end = Number(range[2])
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue
      const from = Math.min(start, end)
      const to = Math.max(start, end)
      for (let line = from; line <= to; line += 1) {
        if (line > 0) lines.add(line)
      }
      continue
    }
    if (/^\d+$/.test(token)) {
      const line = Number(token)
      if (line > 0) lines.add(line)
    }
  }
  return lines
}

/**
 * Format a set of 1-based line numbers as `{1-3,7}` (no spaces).
 * Empty set → `''` (caller decides whether to omit braces).
 */
export function formatHighlightRanges(lines: Set<number>): string {
  if (lines.size === 0) return ''
  const sorted = [...lines].filter((n) => Number.isInteger(n) && n > 0).sort((a, b) => a - b)
  if (sorted.length === 0) return ''
  const parts: string[] = []
  let start = sorted[0]!
  let prev = sorted[0]!
  for (let i = 1; i < sorted.length; i += 1) {
    const current = sorted[i]!
    if (current === prev + 1) {
      prev = current
      continue
    }
    parts.push(start === prev ? `${start}` : `${start}-${prev}`)
    start = current
    prev = current
  }
  parts.push(start === prev ? `${start}` : `${start}-${prev}`)
  return `{${parts.join(',')}}`
}

/** Keep only lines in `[1, maxLine]` (inclusive). */
export function clampHighlightRanges(lines: Set<number>, maxLine: number): Set<number> {
  const next = new Set<number>()
  if (maxLine < 1) return next
  for (const line of lines) {
    if (Number.isInteger(line) && line >= 1 && line <= maxLine) next.add(line)
  }
  return next
}

/** Toggle a 1-based line in the set; returns a new Set. */
export function toggleHighlightLine(lines: Set<number>, line: number): Set<number> {
  const next = new Set(lines)
  if (next.has(line)) next.delete(line)
  else if (line > 0) next.add(line)
  return next
}

/**
 * Rewrite `{…}` inside a fence info/meta string (after the language token).
 * Keeps `[title]` and other tokens. Empty highlights removes the `{…}` block.
 *
 * Examples:
 * - `js {1,2} [App]` + {1-3} → `js {1-3} [App]`
 * - `ts [App]` + {1} → `ts {1} [App]`
 * - `{1-3}` alone + empty → ``
 */
export function applyFenceHighlights(info: string, lines: Set<number>): string {
  const formatted = formatHighlightRanges(lines)
  const trimmed = info.trim()
  if (!trimmed && !formatted) return ''

  // Strip existing `{…}` highlight block(s); keep the rest (title, etc.).
  const rest = trimmed.replace(/\s*\{[0-9,\s-]*\}\s*/g, ' ').replace(/\s+/g, ' ').trim()

  if (!formatted) return rest

  // Prefer: lang? {highlights} [title]?
  // If rest starts with a language-like first token, insert after it.
  const langMatch = rest.match(/^(\S+)([\s\S]*)$/)
  if (langMatch) {
    const [, first, after = ''] = langMatch
    // If the whole rest is only a title `[…]`, treat as no-lang meta.
    if (first.startsWith('[') && first.endsWith(']')) {
      return `${formatted} ${rest}`.trim()
    }
    const suffix = after.trim()
    return suffix ? `${first} ${formatted} ${suffix}` : `${first} ${formatted}`
  }
  return formatted
}

/**
 * Build fence meta from language + highlights + title (for Crepe toMarkdown).
 * Returns the `meta` string only (without language), or language+meta combined
 * helpers use `buildFenceInfo`.
 */
export function buildFenceInfo(language: string, highlights: Set<number>, title: string): string {
  const lang = language.trim()
  const highlight = formatHighlightRanges(highlights)
  const trimmedTitle = title.trim()
  const titlePart = trimmedTitle ? `[${trimmedTitle}]` : ''
  return [lang, highlight, titlePart].filter(Boolean).join(' ')
}

/** Encode a Set as a compact attr string (`{1-3,7}` or `''`). */
export function encodeHighlightsAttr(lines: Set<number>): string {
  return formatHighlightRanges(lines)
}

/** Decode a highlights attr (`{1-3,7}` or raw list) into a Set. */
export function decodeHighlightsAttr(value?: string | null): Set<number> {
  return parseHighlightRanges(value ?? '')
}
