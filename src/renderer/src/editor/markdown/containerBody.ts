import MarkdownIt from 'markdown-it'
import taskLists from 'markdown-it-task-lists'
import linkAttributes from 'markdown-it-link-attributes'
import DOMPurify from 'dompurify'

export interface ParsedContainer {
  name: string
  title: string
  body: string
  hasBody: boolean
}

/** Fence-aware parse used when rewriting structured callouts. */
export interface ParsedContainerFences extends ParsedContainer {
  /** Opening fence markers only, e.g. `:::` or `::::` (with leading indent). */
  openColons: string
  /** Closing fence line as stored (trimmed trailing blanks excluded from index). */
  closeLine: string
  /** Whether the original source ended with a trailing newline after the close fence. */
  trailingNewline: boolean
}

export type ResolveImage = (src: string) => string

const COLLAPSIBLE_TYPES = new Set(['details'])
const CALLOUT_TYPES = new Set(['info', 'tip', 'warning', 'danger', 'note'])

/** Callouts that use structured title+body editing (fences stay locked). */
export const STRUCTURED_CALLOUT_TYPES = new Set([
  'tip',
  'info',
  'warning',
  'danger',
  'details'
])

export function isStructuredCalloutName(name: string): boolean {
  return STRUCTURED_CALLOUT_TYPES.has(name.toLowerCase())
}

export function isStructuredCalloutSource(source: string): boolean {
  return isStructuredCalloutName(parseContainerSource(source).name)
}

/**
 * Splits a `::: name [title] ... :::` source block into its name, optional
 * VitePress-style title (the bare text after the name, not a `[label]`) and
 * the inner body. Blank lines at the body edges are stripped.
 */
export function parseContainerSource(source: string): ParsedContainer {
  const { name, title, body, hasBody } = parseContainerFences(source)
  return { name, title, body, hasBody }
}

export function parseContainerFences(source: string): ParsedContainerFences {
  const trailingNewline = /\r?\n$/.test(source)
  const normalized = source.replace(/\r\n?/g, '\n')
  const lines = normalized.split('\n')
  // Drop a single trailing empty segment from the final newline so close-fence
  // detection sees the real last content line.
  if (trailingNewline && lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop()
  }

  const opening = lines[0] ?? ''
  const match = opening.match(/^( {0,3}:{3,})[ \t]*([A-Za-z][\w-]*)?([ \t]+([\s\S]*))?$/)
  const openColons = match?.[1] ?? ':::'
  const name = (match?.[2] ?? '').toLowerCase()
  const title = (match?.[4] ?? '').trim()

  let end = lines.length - 1
  while (end >= 0 && lines[end].trim() === '') end -= 1
  let closeLine = openColons
  if (end >= 0 && /^ {0,3}:{3,}[ \t]*$/.test(lines[end])) {
    closeLine = lines[end].replace(/\s+$/, '')
    end -= 1
  }
  let start = 1
  while (start <= end && lines[start].trim() === '') start += 1
  while (end >= start && lines[end].trim() === '') end -= 1
  const body = start <= end ? lines.slice(start, end + 1).join('\n') : ''
  return {
    name,
    title,
    body,
    hasBody: body.trim().length > 0,
    openColons,
    closeLine,
    trailingNewline
  }
}

/**
 * Rebuilds a VitePress container source from structured title/body edits,
 * reusing the original colon count / close fence when possible.
 */
export function rebuildContainerSource(
  previousSource: string,
  next: { title: string; body: string; name?: string }
): string {
  const parsed = parseContainerFences(previousSource)
  const name = (next.name ?? (parsed.name || 'info')).toLowerCase()
  const title = next.title.trim()
  const openLine = title ? `${parsed.openColons} ${name} ${title}` : `${parsed.openColons} ${name}`
  const body = next.body.replace(/\r\n?/g, '\n').replace(/^\n+|\n+$/g, '')
  const closeLine = parsed.closeLine || parsed.openColons
  const core =
    body.length > 0 ? `${openLine}\n\n${body}\n\n${closeLine}` : `${openLine}\n\n\n${closeLine}`
  return parsed.trailingNewline || previousSource === '' ? `${core}\n` : core
}

let markdownIt: InstanceType<typeof MarkdownIt> | null = null

function getMarkdownIt(): InstanceType<typeof MarkdownIt> {
  if (markdownIt) return markdownIt
  const instance = new MarkdownIt({ html: true, linkify: true, breaks: false })
  instance.use(taskLists)
  instance.use(linkAttributes, { attrs: { target: '_self', rel: 'noopener' } })

  markdownIt = instance
  return instance
}

function rewriteImageSources(html: string, resolveImage: ResolveImage): string {
  const host = document.createElement('div')
  host.innerHTML = html
  host.querySelectorAll('img').forEach((image) => {
    const source = image.getAttribute('src') ?? ''
    const resolved = source ? resolveImage(source) : ''
    if (resolved) image.setAttribute('src', resolved)
    else image.removeAttribute('src')
  })
  return host.innerHTML
}

function renderBody(body: string, resolveImage: ResolveImage): string {
  const raw = getMarkdownIt().render(body)
  const sanitized = DOMPurify.sanitize(raw)
  return rewriteImageSources(sanitized, resolveImage)
}

interface CodeFence {
  filename: string
  lang: string
  code: string
}

function buildFencePanel(fence: CodeFence): HTMLElement {
  const panel = document.createElement('div')
  panel.className = 'code-group-panel'

  const pre = document.createElement('pre')
  const code = document.createElement('code')
  if (fence.lang) code.className = `language-${fence.lang}`
  code.textContent = fence.code
  pre.append(code)
  panel.append(pre)
  return panel
}

function buildCodeGroup(bodyMarkdown: string): HTMLElement {
  const group = document.createElement('div')
  group.className = 'custom-block custom-block-code-group'
  const fences: CodeFence[] = []
  const md = getMarkdownIt()
  const tokens = md.parse(bodyMarkdown, {})
  for (const token of tokens) {
    if (token.type !== 'fence') continue
    const info = String(token.info ?? '')
    const lang = info.match(/^\S+/)?.[0] ?? ''
    const meta = info.slice(lang.length).trim()
    const filename = meta.replace(/^\[|\]$/g, '').trim()
    fences.push({ filename, lang, code: token.content.replace(/\n$/, '') })
  }

  if (fences.length <= 1) {
    const body = document.createElement('div')
    body.className = 'custom-block-body'
    body.append(fences[0] ? buildFencePanel(fences[0]) : document.createTextNode(''))
    group.append(body)
    return group
  }

  const tabs = document.createElement('div')
  tabs.className = 'code-group-tabs'
  const contents = document.createElement('div')
  contents.className = 'code-group-panels'
  const tabEls: HTMLButtonElement[] = []
  const panelEls: HTMLDivElement[] = []

  fences.forEach((fence, index) => {
    const tab = document.createElement('button')
    tab.type = 'button'
    tab.className = 'code-group-tab'
    tab.textContent = fence.filename || `代码 ${index + 1}`
    const panelEl = buildFencePanel(fence) as HTMLDivElement
    if (index === 0) {
      tab.classList.add('active')
      panelEl.classList.add('active')
    }
    tab.addEventListener('click', () => {
      tabEls.forEach((button, buttonIndex) =>
        button.classList.toggle('active', buttonIndex === index)
      )
      panelEls.forEach((pane, paneIndex) => pane.classList.toggle('active', paneIndex === index))
    })
    tabEls.push(tab)
    panelEls.push(panelEl)
    tabs.append(tab)
    contents.append(panelEl)
  })

  group.append(tabs, contents)
  return group
}

function buildContainerDom(name: string, title: string, bodyHtml: string): HTMLElement {
  const body = document.createElement('div')
  body.className = 'custom-block-body'
  body.innerHTML = bodyHtml

  if (COLLAPSIBLE_TYPES.has(name)) {
    const details = document.createElement('details')
    details.className = `custom-block custom-block-${name}`
    const summary = document.createElement('summary')
    summary.className = 'custom-block-title'
    summary.textContent = title || 'Details'
    // Keep the toggle deterministic inside the non-editable atom rather than
    // relying on the browser default (which ProseMirror can swallow).
    summary.addEventListener('click', (event) => {
      event.preventDefault()
      details.open = !details.open
    })
    details.append(summary, body)
    return details
  }

  if (CALLOUT_TYPES.has(name)) {
    const block = document.createElement('div')
    block.className = `custom-block custom-block-${name}`
    const titleEl = document.createElement('p')
    titleEl.className = 'custom-block-title'
    titleEl.textContent = title || name.toUpperCase()
    block.append(titleEl, body)
    return block
  }

  if (name === 'swiper') {
    const block = document.createElement('div')
    block.className = 'custom-block custom-block-swiper'
    const gallery = document.createElement('div')
    gallery.className = 'custom-block-body swiper-body'
    gallery.innerHTML = bodyHtml
    block.append(gallery)
    return block
  }

  const block = document.createElement('div')
  block.className = `custom-block custom-block-${name}`
  block.append(body)
  return block
}

const defaultResolveImage: ResolveImage = (src) =>
  src.startsWith('https://') || src.startsWith('data:') || src.startsWith('#') ? src : ''

/**
 * Renders a `:::` container source into a read-only, faithful DOM node that
 * mirrors VitePress's `.custom-block` / `details` structure. The container
 * remains an atom (non-editable); only its source is stored on the node, so
 * the editor never rewrites it.
 */
export function renderContainerFromSource(
  source: string,
  resolveImage: ResolveImage = defaultResolveImage
): HTMLElement {
  const { name, title, body, hasBody } = parseContainerSource(source)
  if (name === 'code-group') return buildCodeGroup(body)
  const bodyHtml = hasBody ? renderBody(body, resolveImage) : ''
  return buildContainerDom(name, title, bodyHtml)
}
