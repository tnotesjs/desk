import {
  applyFenceHighlights,
  encodeHighlightsAttr,
  parseHighlightRanges
} from './lineHighlight'
import { parseFenceTitleFromMeta } from './fenceInfo'

/** Parse a VitePress-style body include line: `<<< ./path [title]` / `{lang}`. */
export interface DeskIncludeRef {
  path: string
  title?: string
  lang?: string
}

export function parseDeskIncludeLine(line: string): DeskIncludeRef | null {
  const match = line.trim().match(/^<<<\s+(.+)$/)
  if (!match) return null

  let rest = match[1].trim()
  let title: string | undefined
  const titleMatch = rest.match(/\s+\[([^\]]+)\]\s*$/)
  if (titleMatch) {
    title = titleMatch[1].trim() || undefined
    rest = rest.slice(0, titleMatch.index).trim()
  }

  let lang: string | undefined
  const langMatch = rest.match(/\s+\{([^}]+)\}\s*$/)
  if (langMatch) {
    lang = langMatch[1].trim() || undefined
    rest = rest.slice(0, langMatch.index).trim()
  }

  // Strip VitePress highlight / region suffixes before the path settles:
  // `./file.js#region{1,2}` → `./file.js`
  rest = rest.replace(/#[\w-]+$/, '').replace(/\{[^}]*\}\s*$/, '').trim()

  const path = rest.replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, '$1$2').trim()
  return path ? { path, title, lang } : null
}

/** Basename used as the default code-group tab label (VitePress behaviour). */
export function includeTabTitle(include: DeskIncludeRef): string {
  if (include.title) return include.title
  const base = include.path.split(/[/\\]/).pop() ?? include.path
  return base || include.path
}

const EXT_LANG: Record<string, string> = {
  js: 'js',
  mjs: 'js',
  cjs: 'js',
  jsx: 'jsx',
  ts: 'ts',
  tsx: 'tsx',
  json: 'json',
  md: 'md',
  markdown: 'md',
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'scss',
  less: 'less',
  py: 'py',
  rb: 'rb',
  go: 'go',
  rs: 'rs',
  java: 'java',
  kt: 'kotlin',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'toml',
  xml: 'xml',
  svg: 'xml',
  vue: 'vue',
  sql: 'sql',
  txt: 'txt'
}

export function includeLanguage(include: DeskIncludeRef): string {
  if (include.lang) {
    // `{1,2 ts:line-numbers}` → take first token that looks like a language id
    const token = include.lang.split(/[\s:]+/).find((part) => /^[A-Za-z][\w#+-]*$/.test(part))
    if (token && !/^\d/.test(token)) return token
  }
  const base = include.path.split(/[/\\]/).pop() ?? ''
  const ext = base.includes('.') ? base.slice(base.lastIndexOf('.') + 1).toLowerCase() : ''
  return EXT_LANG[ext] ?? ext
}

/** True when a container / fence body still contains unresolved `<<<` lines. */
export function bodyHasIncludeLines(body: string): boolean {
  return body.split(/\r?\n/).some((line) => parseDeskIncludeLine(line) != null)
}

/** One tab in a code-group body: either a VitePress include or an inline fence. */
export type CodeGroupEntry =
  | { kind: 'include'; include: DeskIncludeRef; rawLine: string }
  | {
      kind: 'fence'
      filename: string
      lang: string
      info: string
      code: string
      /** Encoded `{1-3,7}` or empty. */
      highlights: string
    }

/**
 * Order-preserving parse of a code-group body so `<<<` and ``` fences can coexist.
 * Blank / non-entry lines between entries are dropped on serialize (VitePress ignores them).
 */
export function parseCodeGroupEntries(body: string): CodeGroupEntry[] {
  const lines = body.replace(/\r\n?/g, '\n').split('\n')
  const entries: CodeGroupEntry[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i] ?? ''
    const include = parseDeskIncludeLine(line)
    if (include) {
      entries.push({ kind: 'include', include, rawLine: line.trim() })
      i += 1
      continue
    }
    const fenceOpen = line.match(/^ {0,3}(`{3,}|~{3,})([^\n]*)$/)
    if (fenceOpen) {
      const marker = fenceOpen[1]
      const info = (fenceOpen[2] ?? '').trim()
      const lang = info.match(/^\S+/)?.[0] ?? ''
      const meta = info.slice(lang.length).trim()
      const filename = parseFenceTitleFromMeta(meta)
      const highlights = encodeHighlightsAttr(parseHighlightRanges(meta))
      i += 1
      const contentLines: string[] = []
      while (i < lines.length) {
        const cur = lines[i] ?? ''
        if (new RegExp(`^ {0,3}${marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[ \\t]*$`).test(cur)) {
          i += 1
          break
        }
        contentLines.push(cur)
        i += 1
      }
      entries.push({
        kind: 'fence',
        filename,
        lang,
        info,
        code: contentLines.join('\n').replace(/\n$/, ''),
        highlights
      })
      continue
    }
    i += 1
  }
  return entries
}

export function codeGroupEntryTabTitle(entry: CodeGroupEntry, index: number): string {
  if (entry.kind === 'include') return includeTabTitle(entry.include)
  return entry.filename || `代码 ${index + 1}`
}

/** Build a VitePress `<<<` line from a parsed include ref. */
export function serializeIncludeLine(include: DeskIncludeRef): string {
  const needsQuotes = /[\s"'\\]/.test(include.path)
  const path = needsQuotes ? `"${include.path.replace(/"/g, '\\"')}"` : include.path
  let line = `<<< ${path}`
  if (include.lang) line += ` {${include.lang}}`
  if (include.title) line += ` [${include.title}]`
  return line
}

export function withCodeGroupEntryTitle(entry: CodeGroupEntry, title: string): CodeGroupEntry {
  const trimmed = title.trim()
  if (entry.kind === 'include') {
    const include: DeskIncludeRef = {
      ...entry.include,
      title: trimmed || undefined
    }
    return { kind: 'include', include, rawLine: serializeIncludeLine(include) }
  }
  const lang = entry.lang || 'text'
  const highlights = parseHighlightRanges(entry.highlights || entry.info)
  const withHighlights = applyFenceHighlights(lang, highlights)
  const info = trimmed ? `${withHighlights} [${trimmed}]` : withHighlights
  return { ...entry, filename: trimmed, info, highlights: encodeHighlightsAttr(highlights) }
}

export function withCodeGroupEntryLanguage(entry: CodeGroupEntry, language: string): CodeGroupEntry {
  const lang = language.trim() || 'text'
  if (entry.kind === 'include') {
    const include: DeskIncludeRef = { ...entry.include, lang }
    return { kind: 'include', include, rawLine: serializeIncludeLine(include) }
  }
  const title = entry.filename
  const highlights = parseHighlightRanges(entry.highlights || entry.info)
  const withHighlights = applyFenceHighlights(lang, highlights)
  const info = title ? `${withHighlights} [${title}]` : withHighlights
  return { ...entry, lang, info, highlights: encodeHighlightsAttr(highlights) }
}

export function withCodeGroupEntryHighlights(
  entry: CodeGroupEntry,
  highlightsEncoded: string
): CodeGroupEntry {
  if (entry.kind === 'include') return entry
  const highlights = parseHighlightRanges(highlightsEncoded)
  const lang = entry.lang || 'text'
  const title = entry.filename
  const base = applyFenceHighlights(lang, highlights)
  const info = title ? `${base} [${title}]` : base
  return { ...entry, info, highlights: encodeHighlightsAttr(highlights) }
}

/** Serialize entries back to a code-group body (used when an inline fence is saved). */
export function serializeCodeGroupEntries(entries: CodeGroupEntry[]): string {
  const chunks: string[] = []
  for (const entry of entries) {
    if (entry.kind === 'include') {
      chunks.push(entry.rawLine)
      chunks.push('')
      continue
    }
    const info = entry.info || entry.lang || ''
    const open = info ? `\`\`\`${info}` : '```'
    const code = entry.code.replace(/\n$/, '')
    chunks.push(open)
    if (code.length > 0) chunks.push(code)
    chunks.push('```')
    chunks.push('')
  }
  return chunks.join('\n').replace(/\n+$/, '\n')
}

/**
 * Rewrites VitePress `<<<` lines into fenced code blocks so markdown-it /
 * code-group rendering can see real fences. `getContent(path)` must return the
 * file text (or an error placeholder string).
 */
export function expandIncludeLinesToFences(
  body: string,
  getContent: (path: string) => string
): string {
  const lines = body.replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []
  for (const line of lines) {
    const include = parseDeskIncludeLine(line)
    if (!include) {
      out.push(line)
      continue
    }
    const lang = includeLanguage(include)
    const title = includeTabTitle(include)
    const content = getContent(include.path).replace(/\n$/, '')
    out.push(`\`\`\`${lang} [${title}]`)
    if (content.length > 0) out.push(content)
    out.push('```')
    out.push('')
  }
  return out.join('\n').replace(/\n+$/, '\n')
}
