import DOMPurify from 'dompurify'
import hljs from 'highlight.js/lib/common'
import MarkdownIt from 'markdown-it'
import taskLists from 'markdown-it-task-lists'

export type VisualBlockKind =
  | 'paragraph'
  | 'heading'
  | 'list'
  | 'table'
  | 'code'
  | 'container'
  | 'component'
  | 'generated'
  | 'mindmap'
  | 'mermaid'
  | 'html'

export interface VisualBlock {
  from: number
  to: number
  source: string
  kind: VisualBlockKind
  generated: boolean
}

export interface MarkdownRenderContext {
  knowledgeBaseId: string
  noteUuid: string
}

const markdown = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: false,
  breaks: false,
  highlight(code, language) {
    if (language && hljs.getLanguage(language)) {
      return hljs.highlight(code, { language, ignoreIllegals: true }).value
    }
    return markdown.utils.escapeHtml(code)
  }
}).use(taskLists, { enabled: true, label: true })

markdown.validateLink = (url: string): boolean => {
  const normalized = url.trim().toLocaleLowerCase()
  return (
    normalized.startsWith('http://') ||
    normalized.startsWith('https://') ||
    normalized.startsWith('#') ||
    normalized.startsWith('./') ||
    normalized.startsWith('../') ||
    normalized.startsWith('/')
  )
}

const defaultImageRule = markdown.renderer.rules.image
markdown.renderer.rules.image = (tokens, index, options, env, renderer) => {
  const token = tokens[index]
  const sourceIndex = token.attrIndex('src')
  if (sourceIndex >= 0) {
    token.attrs![sourceIndex][1] = localImageUrl(
      token.attrs![sourceIndex][1],
      env as MarkdownRenderContext
    )
  }
  return defaultImageRule
    ? defaultImageRule(tokens, index, options, env, renderer)
    : renderer.renderToken(tokens, index, options)
}

function blockKind(line: string): VisualBlockKind {
  if (/^#{1,6}\s/.test(line)) return 'heading'
  if (/^\s*(?:[-+*]|\d+[.)])\s/.test(line)) return 'list'
  if (/^\s*(?:```|~~~)\s*mindmap(?=\s|\[|$)/.test(line)) return 'mindmap'
  if (/^\s*(?:```|~~~)\s*mermaid(?=\s|$)/.test(line)) return 'mermaid'
  if (/^\s*```|^\s*~~~/.test(line)) return 'code'
  if (/^\s*:::\s*/.test(line)) return 'container'
  if (/^\s*<[A-Z][\w.-]*(?:\s|>|\/)/.test(line)) return 'component'
  if (/^\s*</.test(line)) return 'html'
  return 'paragraph'
}

function isTableDelimiter(line: string): boolean {
  return /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/.test(line)
}

function startsBlock(line: string, nextLine = ''): boolean {
  return (
    /^#{1,6}\s/.test(line) ||
    /^\s*(?:```|~~~|:::|<[A-Z])/.test(line) ||
    /^\s*(?:[-+*]|\d+[.)])\s/.test(line) ||
    /^\s*>\s?/.test(line) ||
    (/\|/.test(line) && isTableDelimiter(nextLine))
  )
}

export function collectVisualBlocks(source: string): VisualBlock[] {
  const lines = source.split('\n')
  const starts: number[] = []
  let offset = 0
  for (const line of lines) {
    starts.push(offset)
    offset += line.length + 1
  }

  const blocks: VisualBlock[] = []
  let lineIndex = 0
  while (lineIndex < lines.length) {
    if (!lines[lineIndex].trim()) {
      lineIndex += 1
      continue
    }
    const firstLine = lineIndex
    const line = lines[lineIndex]
    let lastLine = firstLine
    let kind = blockKind(line)
    let generated = firstLine === 0 && /^#\s/.test(line)

    if (/^\s*<!--\s*region:toc\s*-->/.test(line)) {
      kind = 'generated'
      generated = true
      while (lastLine + 1 < lines.length) {
        lastLine += 1
        if (/^\s*<!--\s*endregion:toc\s*-->/.test(lines[lastLine])) break
      }
    } else if (/^\s*(```|~~~)/.test(line)) {
      const fence = line.trim().slice(0, 3)
      while (lastLine + 1 < lines.length) {
        lastLine += 1
        if (lines[lastLine].trim().startsWith(fence)) break
      }
    } else if (/^\s*:::\s*/.test(line)) {
      while (lastLine + 1 < lines.length) {
        lastLine += 1
        if (/^\s*:::\s*$/.test(lines[lastLine])) break
      }
    } else if (/^\s*<[A-Z][\w.-]*/.test(line)) {
      const name = line.match(/^\s*<([A-Z][\w.-]*)/)?.[1]
      if (name && !/\/\s*>\s*$/.test(line)) {
        while (lastLine + 1 < lines.length) {
          lastLine += 1
          if (new RegExp(`</${name}\\s*>`).test(lines[lastLine])) break
        }
      }
    } else if (lineIndex + 1 < lines.length && isTableDelimiter(lines[lineIndex + 1])) {
      kind = 'table'
      lastLine += 1
      while (lastLine + 1 < lines.length && /\|/.test(lines[lastLine + 1])) lastLine += 1
    } else if (/^\s*(?:[-+*]|\d+[.)])\s/.test(line)) {
      while (lastLine + 1 < lines.length && lines[lastLine + 1].trim()) lastLine += 1
    } else if (!/^#{1,6}\s/.test(line)) {
      while (lastLine + 1 < lines.length && lines[lastLine + 1].trim()) {
        if (startsBlock(lines[lastLine + 1], lines[lastLine + 2] ?? '')) break
        lastLine += 1
      }
    }

    const from = starts[firstLine]
    const to = starts[lastLine] + lines[lastLine].length
    blocks.push({ from, to, source: source.slice(from, to), kind, generated })
    lineIndex = lastLine + 1
  }
  return blocks
}

function localImageUrl(src: string, context: MarkdownRenderContext): string {
  if (/^(?:https?:|data:)/i.test(src)) return src
  const params = new URLSearchParams({
    knowledgeBaseId: context.knowledgeBaseId,
    noteUuid: context.noteUuid,
    path: src
  })
  return `tnotes-asset://asset?${params.toString()}`
}

function codeGroupSource(source: string): string {
  const body = source.replace(/^\s*:::\s*code-group[^\n]*\n/, '').replace(/\n?\s*:::\s*$/, '')
  const tabs: Array<{ title: string; language: string; code?: string; reference?: string }> = []
  const fencePattern = /^```([^\n]*)\n([\s\S]*?)\n```\s*$/gm
  for (const match of body.matchAll(fencePattern)) {
    const info = match[1].trim()
    const title = info.match(/\[([^\]]+)]/)?.[1]
    const language = info.replace(/\s*\[[^\]]+]\s*/, '').trim() || 'text'
    tabs.push({ title: title || language, language, code: match[2] })
  }
  const referencePattern = /^<<<\s+(\S+)(?:\s+\[([^\]]+)])?\s*$/gm
  for (const match of body.matchAll(referencePattern)) {
    const reference = match[1]
    const label = match[2]
    const extension = reference.split('.').pop() || 'text'
    tabs.push({
      title: label || reference.split('/').pop() || reference,
      language: extension,
      reference
    })
  }
  if (tabs.length === 0) return `<pre><code>${markdown.utils.escapeHtml(body)}</code></pre>`
  const buttons = tabs
    .map(
      (tab, index) =>
        `<button type="button" data-code-tab="${index}"${index === 0 ? ' class="active"' : ''}>${markdown.utils.escapeHtml(tab.title)}</button>`
    )
    .join('')
  const panels = tabs
    .map((tab, index) => {
      const active = index === 0 ? ' class="active"' : ''
      if (tab.reference) {
        return `<pre data-code-panel="${index}"${active}><code class="tn-code-reference language-${markdown.utils.escapeHtml(tab.language)}" data-reference="${markdown.utils.escapeHtml(tab.reference)}" data-language="${markdown.utils.escapeHtml(tab.language)}">正在读取 ${markdown.utils.escapeHtml(tab.reference)}…</code></pre>`
      }
      const code =
        tab.language && hljs.getLanguage(tab.language)
          ? hljs.highlight(tab.code ?? '', { language: tab.language, ignoreIllegals: true }).value
          : markdown.utils.escapeHtml(tab.code ?? '')
      return `<pre data-code-panel="${index}"${active}><code class="language-${markdown.utils.escapeHtml(tab.language)}">${code}</code></pre>`
    })
    .join('')
  return `<aside class="tn-code-group"><nav>${buttons}</nav>${panels}</aside>`
}

function swiperSource(source: string, context: MarkdownRenderContext): string {
  const body = source.replace(/^\s*:::\s*swiper[^\n]*\n/, '').replace(/\n?\s*:::\s*$/, '')
  const images = [...body.matchAll(/^\s*(!\[[^\]]*]\([^\n]+\))\s*$/gm)].map((match) => match[1])
  if (images.length === 0) return markdown.render(body, context)
  const slides = images
    .map(
      (image, index) =>
        `<figure data-swiper-slide="${index}"${index === 0 ? ' class="active"' : ''}>${markdown.renderInline(image, context)}</figure>`
    )
    .join('')
  return `<section class="tn-swiper"><div class="tn-swiper-track">${slides}</div><footer><button type="button" data-swiper-action="previous" aria-label="上一张">←</button><span data-swiper-status>1 / ${images.length}</span><button type="button" data-swiper-action="next" aria-label="下一张">→</button></footer></section>`
}

function componentSource(source: string): string {
  const name = source.match(/^\s*<([A-Z][\w.-]*)/)?.[1] || 'Component'
  const ids = name === 'N' ? [...source.matchAll(/['"](\d{4})['"]/g)].map((match) => match[1]) : []
  if (name === 'N' && ids.length > 0) {
    return `<section class="tn-note-references" data-note-ids="${ids.join(',')}"><span>正在解析关联笔记…</span></section>`
  }
  return `<aside class="tn-component-placeholder"><strong>${markdown.utils.escapeHtml(name)}</strong><span>自定义组件</span></aside>`
}

function containerSource(source: string, context: MarkdownRenderContext): string {
  const match = source.match(/^\s*:::\s*([\w-]+)(?:\s+([^\n]+))?\n([\s\S]*?)\n?\s*:::\s*$/)
  if (!match) return source
  const kind = match[1]
  const title = match[2] || kind.toLocaleUpperCase()
  if (kind === 'swiper') return swiperSource(source, context)
  if (kind === 'code-group') return codeGroupSource(source)
  if (kind === 'details') {
    return `<details class="tn-container tn-container-details"><summary>${markdown.utils.escapeHtml(title)}</summary>${markdown.render(match[3], context)}</details>`
  }
  return `<aside class="tn-container tn-container-${kind}"><strong>${markdown.utils.escapeHtml(title)}</strong>${markdown.render(match[3], context)}</aside>`
}

export function renderVisualBlock(block: VisualBlock, context: MarkdownRenderContext): string {
  const rawHtml =
    block.kind === 'container'
      ? containerSource(block.source, context)
      : block.kind === 'component'
        ? componentSource(block.source)
        : block.kind === 'mindmap'
          ? '<section class="tn-mindmap"><div class="tn-special-loading">正在加载脑图…</div></section>'
          : block.kind === 'mermaid'
            ? '<section class="tn-mermaid"><div class="tn-special-loading">正在绘制 Mermaid…</div></section>'
            : markdown.render(block.source.replace(/<!--\s*(?:end)?region:toc\s*-->/g, ''), context)
  return DOMPurify.sanitize(rawHtml, {
    USE_PROFILES: { html: true },
    ADD_ATTR: [
      'class',
      'disabled',
      'data-code-tab',
      'data-code-panel',
      'data-reference',
      'data-language',
      'data-swiper-slide',
      'data-swiper-action',
      'data-swiper-status',
      'data-note-ids'
    ],
    FORBID_TAGS: ['script', 'style', 'iframe', 'form', 'object', 'embed'],
    FORBID_ATTR: ['style'],
    ALLOWED_URI_REGEXP:
      /^(?:(?:https?|tnotes-asset):|(?:\.|\/|#)|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i
  })
}
