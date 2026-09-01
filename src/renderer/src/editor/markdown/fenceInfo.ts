/** Extract the last `[title]` segment from a fence info/meta string. */
export function parseFenceTitleFromMeta(meta?: string | null): string {
  if (!meta) return ''
  const matches = [...meta.matchAll(/\[([^\]]*)\]/g)]
  const last = matches[matches.length - 1]
  return (last?.[1] ?? '').trim()
}

/**
 * Rewrite the opening fence line's trailing `[title]`, preserving highlight
 * meta such as `{30-51}`. Empty title removes the bracket segment.
 */
export function applyFenceTitle(opening: string, title: string): string {
  const match = opening.match(/^( {0,3}(?:`{3,}|~{3,}))([ \t]*)(\S+)?([\s\S]*)$/)
  if (!match) return opening
  const [, fence, whitespace, language = '', remaining = ''] = match
  let rest = remaining.replace(/\s*\[[^\]]*\]\s*(?=$)/, '').replace(/[ \t]+$/g, '')
  const trimmedTitle = title.trim()
  if (trimmedTitle) {
    rest = `${rest} [${trimmedTitle}]`.replace(/^\s+/, language ? ' ' : '')
  }
  return `${fence}${whitespace}${language}${rest}`
}
