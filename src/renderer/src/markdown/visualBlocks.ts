import DOMPurify from 'dompurify'
import hljs from 'highlight.js/lib/common'
import katex from 'katex'
import MarkdownIt from 'markdown-it'
import taskLists from 'markdown-it-task-lists'
import { findTNotesComponent } from '@tnotesjs/core/markdown'

export type VisualBlockKind =
  | 'paragraph'
  | 'heading'
  | 'list'
  | 'table'
  | 'code'
  | 'container'
  | 'component'
  | 'generated'
  | 'math'
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

function renderMath(source: string, displayMode: boolean): string {
  return katex.renderToString(source, {
    displayMode,
    throwOnError: false,
    strict: 'ignore',
    trust: false,
    output: 'htmlAndMathml'
  })
}

markdown.inline.ruler.before('escape', 'math_inline', (state, silent) => {
  if (state.src[state.pos] !== '$' || state.src[state.pos + 1] === '$') return false
  if (/\s/.test(state.src[state.pos + 1] ?? '')) return false
  let cursor = state.pos + 1
  while (cursor < state.posMax) {
    if (state.src[cursor] === '$' && state.src[cursor - 1] !== '\\') break
    cursor += 1
  }
  if (cursor >= state.posMax || cursor === state.pos + 1) return false
  if (/\s/.test(state.src[cursor - 1])) return false
  if (!silent) {
    const token = state.push('math_inline', 'math', 0)
    token.content = state.src.slice(state.pos + 1, cursor)
  }
  state.pos = cursor + 1
  return true
})

markdown.renderer.rules.math_inline = (tokens, index) =>
  `<span class="tn-math-inline">${renderMath(tokens[index].content, false)}</span>`

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
  if (/^\s*(?:```|~~~)\s*(?:mindmap|markmap)(?=\s|\[|$)/.test(line)) return 'mindmap'
  if (/^\s*(?:```|~~~)\s*mermaid(?=\s|$)/.test(line)) return 'mermaid'
  if (/^\s*\$\$/.test(line)) return 'math'
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
    /^\s*(?:```|~~~|:::|<[A-Z]|\$\$)/.test(line) ||
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
    } else if (/^\s*\$\$/.test(line)) {
      if (!/^\s*\$\$[\s\S]+\$\$\s*$/.test(line)) {
        while (lastLine + 1 < lines.length) {
          lastLine += 1
          if (/\$\$\s*$/.test(lines[lastLine])) break
        }
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

function escapeHtml(value: string): string {
  return markdown.utils.escapeHtml(value)
}

function attributeValue(source: string, name: string): string | null {
  const match = source.match(new RegExp(`(?:^|\\s):?${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, 'i'))
  return match?.[2] ?? null
}

function quotedValues(value: string | null): string[] {
  if (!value) return []
  return [...value.matchAll(/(["'])([\s\S]*?)\1/g)].map((match) => match[2].trim()).filter(Boolean)
}

function inlineComponents(source: string): string {
  return source.replace(
    /<Tooltip\s+[^>]*text\s*=\s*(["'])([\s\S]*?)\1[^>]*>([\s\S]*?)<\/Tooltip\s*>/gi,
    (_match, _quote: string, tooltip: string, body: string) =>
      `<span class="tn-tooltip" data-tooltip="${escapeHtml(tooltip)}">${body}</span>`
  )
}

function renderMarkdown(source: string, context: MarkdownRenderContext): string {
  return markdown.render(inlineComponents(source), context)
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
  if (images.length === 0) return renderMarkdown(body, context)
  const slides = images
    .map(
      (image, index) =>
        `<figure data-swiper-slide="${index}"${index === 0 ? ' class="active"' : ''}>${markdown.renderInline(image, context)}</figure>`
    )
    .join('')
  return `<section class="tn-swiper"><div class="tn-swiper-track">${slides}</div><footer><button type="button" data-swiper-action="previous" aria-label="上一张">←</button><span data-swiper-status>1 / ${images.length}</span><button type="button" data-swiper-action="next" aria-label="下一张">→</button></footer></section>`
}

function bilibiliSource(source: string): string {
  const id = attributeValue(source, 'id')?.trim()
  if (!id || !/^BV[\w-]+$/i.test(id)) {
    return '<aside class="tn-component-placeholder"><strong>Bilibili</strong><span>缺少有效 BV 号</span></aside>'
  }
  const url = `https://www.bilibili.com/video/${encodeURIComponent(id)}`
  return `<a class="tn-bilibili" href="${url}"><span class="tn-bilibili-play">▶</span><span><strong>Bilibili 视频</strong><small>${escapeHtml(id)} · Cmd/Ctrl + 点击打开</small></span></a>`
}

function wordListSource(source: string): string {
  let words = [...new Set(quotedValues(attributeValue(source, 'words')))]
  if (/\bneedSort(?:\s|>|\/)/i.test(source)) {
    words = words.sort((left, right) => left.localeCompare(right, 'en', { sensitivity: 'base' }))
  }
  if (words.length === 0) {
    return '<aside class="tn-component-placeholder"><strong>EnWordList</strong><span>没有解析到单词</span></aside>'
  }
  const items = words
    .map(
      (word) =>
        `<label class="tn-word"><input type="checkbox"><span>${escapeHtml(word)}</span></label>`
    )
    .join('')
  return `<section class="tn-word-list"><header><strong>单词清单</strong><span>${words.length} 个</span></header><div>${items}</div></section>`
}

function footprintsSource(source: string, context: MarkdownRenderContext): string {
  const times = (attributeValue(source, 'times')?.match(/\d+/g) ?? []).map(Number)
  const [year, month, day, hour, minute] = times
  const timestamp = year
    ? `${year}-${String(month ?? 1).padStart(2, '0')}-${String(day ?? 1).padStart(2, '0')}${
        hour === undefined
          ? ''
          : ` ${String(hour).padStart(2, '0')}:${String(minute ?? 0).padStart(2, '0')}`
      }`
    : '足迹'
  const text =
    source.match(/<template\s+[^>]*#text-area[^>]*>([\s\S]*?)<\/template\s*>/i)?.[1] ?? ''
  const imageBody =
    source.match(/<template\s+[^>]*#image-list[^>]*>([\s\S]*?)<\/template\s*>/i)?.[1] ?? ''
  const images = [...imageBody.matchAll(/<img\s+[^>]*src\s*=\s*(["'])(.*?)\1[^>]*>/gi)]
    .map((match) => `<img src="${escapeHtml(localImageUrl(match[2], context))}" alt="足迹图片">`)
    .join('')
  return `<article class="tn-footprints"><header><span>●</span><strong>${timestamp}</strong></header><div class="tn-footprints-text">${text}</div>${images ? `<div class="tn-footprints-images">${images}</div>` : ''}</article>`
}

function mindmapComponentSource(source: string): string {
  const content = attributeValue(source, 'content') ?? ''
  let decoded = content
  try {
    decoded = decodeURIComponent(content)
  } catch {
    // Keep the original source when it is not URL encoded.
  }
  return `<section class="tn-mindmap" data-mindmap-content="${escapeHtml(encodeURIComponent(decoded))}"><div class="tn-special-loading">正在加载脑图…</div></section>`
}

function mermaidComponentSource(source: string): string {
  const content = source
    .replace(/^\s*<Mermaid(?:\s[^>]*)?>/i, '')
    .replace(/<\/Mermaid\s*>\s*$/i, '')
    .trim()
  return `<section class="tn-mermaid" data-mermaid-content="${escapeHtml(content)}"><div class="tn-special-loading">正在绘制 Mermaid…</div></section>`
}

function componentSource(source: string, context: MarkdownRenderContext): string {
  const name = source.match(/^\s*<([A-Z][\w.-]*)/)?.[1] || 'Component'
  const descriptor = findTNotesComponent(name)
  if (name === 'B' || name === 'BilibiliOutsidePlayer') return bilibiliSource(source)
  if (name === 'E' || name === 'EnWordList') return wordListSource(source)
  if (name === 'F' || name === 'Footprints') return footprintsSource(source, context)
  if (name === 'MindmapPreview') return mindmapComponentSource(source)
  if (name === 'Mermaid') return mermaidComponentSource(source)
  if (name === 'Tooltip') return inlineComponents(source)
  const ids =
    name === 'N' || name === 'NotesTable'
      ? [...source.matchAll(/['"](\d{4})['"]/g)].map((match) => match[1])
      : []
  if (ids.length > 0) {
    return `<section class="tn-note-references" data-note-ids="${ids.join(',')}"><span>正在解析关联笔记…</span></section>`
  }
  const label = descriptor?.editable === 'placeholder' ? '站点布局组件' : '自定义组件'
  return `<aside class="tn-component-placeholder"><strong>${markdown.utils.escapeHtml(name)}</strong><span>${label}</span></aside>`
}

function containerSource(source: string, context: MarkdownRenderContext): string {
  const match = source.match(/^\s*:::\s*([\w-]+)(?:\s+([^\n]+))?\n([\s\S]*?)\n?\s*:::\s*$/)
  if (!match) return source
  const kind = match[1]
  const title = match[2] || kind.toLocaleUpperCase()
  if (kind === 'swiper') return swiperSource(source, context)
  if (kind === 'code-group') return codeGroupSource(source)
  if (kind === 'details') {
    return `<details class="tn-container tn-container-details"><summary>${markdown.utils.escapeHtml(title)}</summary>${renderMarkdown(match[3], context)}</details>`
  }
  return `<aside class="tn-container tn-container-${kind}"><strong>${markdown.utils.escapeHtml(title)}</strong>${renderMarkdown(match[3], context)}</aside>`
}

export function renderVisualBlock(block: VisualBlock, context: MarkdownRenderContext): string {
  const rawHtml =
    block.kind === 'container'
      ? containerSource(block.source, context)
      : block.kind === 'component'
        ? `<div class="tn-component-host">${componentSource(block.source, context)}</div>`
        : block.kind === 'math'
          ? `<div class="tn-math-block">${renderMath(
              block.source.replace(/^\s*\$\$\s*/, '').replace(/\s*\$\$\s*$/, ''),
              true
            )}</div>`
          : block.kind === 'mindmap'
            ? '<section class="tn-mindmap"><div class="tn-special-loading">正在加载脑图…</div></section>'
            : block.kind === 'mermaid'
              ? '<section class="tn-mermaid"><div class="tn-special-loading">正在绘制 Mermaid…</div></section>'
              : renderMarkdown(
                  block.source.replace(/<!--\s*(?:end)?region:toc\s*-->/g, ''),
                  context
                )
  return DOMPurify.sanitize(rawHtml, {
    USE_PROFILES: { html: true, mathMl: true },
    ADD_TAGS: ['section', 'article'],
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
      'data-note-ids',
      'data-tooltip',
      'data-mindmap-content',
      'data-mermaid-content'
    ],
    FORBID_TAGS: ['script', 'style', 'iframe', 'form', 'object', 'embed'],
    FORBID_ATTR: ['style'],
    ALLOWED_URI_REGEXP:
      /^(?:(?:https?|tnotes-asset):|(?:\.|\/|#)|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i
  })
}
