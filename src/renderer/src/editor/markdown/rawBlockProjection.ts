import { Plugin } from '@milkdown/kit/prose/state'
import { $nodeSchema, $prose, $remark } from '@milkdown/kit/utils'
import { codeBlockSchema } from '@milkdown/kit/preset/commonmark'

import { renderContainerFromSource, type ResolveImage } from './containerBody'
import {
  parseMarkdownSource,
  serializeMarkdownSource,
  type MarkdownSourceBlock,
  type MarkdownSourceBlockKind
} from './sourcePreservation'

import type { MilkdownPlugin } from '@milkdown/kit/ctx'
import type { MarkdownNode } from '@milkdown/kit/transformer'

type SourceProjectedKind = Extract<
  MarkdownSourceBlockKind,
  | 'raw-frontmatter'
  | 'raw-container'
  | 'raw-include'
  | 'raw-component'
  | 'raw-reference-definition'
  | 'raw-generated-title'
  | 'raw-generated-toc'
  | 'table'
  | 'html'
>

export type ProjectedRawBlockKind = SourceProjectedKind | 'raw-diagram'

export interface ProjectedRawBlock {
  kind: ProjectedRawBlockKind
  source: string
  hidden: boolean
}

const PROJECTED_KINDS = new Set<ProjectedRawBlockKind>([
  'raw-frontmatter',
  'raw-container',
  'raw-include',
  'raw-component',
  'raw-reference-definition',
  'raw-generated-title',
  'raw-generated-toc',
  'raw-diagram',
  'table',
  'html'
])

const MARKER =
  /^<!--desk-raw-block:v1:(raw-frontmatter|raw-container|raw-include|raw-component|raw-reference-definition|raw-generated-title|raw-generated-toc|raw-diagram|table|html):([01]):([A-Za-z0-9+/]*={0,2})-->$/
const REGION_COMMENT = /^ {0,3}<!--\s*(?:end)?region(?::[\s\S]*?)?\s*-->\s*$/i
const HTML_TAG = /<\/?[A-Za-z][\w.-]*(?=[\s/>])/
const DIAGRAM_LANGUAGES = new Set(['mermaid', 'mindmap', 'markmap'])

interface ProjectionMarkdownNode extends MarkdownNode {
  type: string
  value?: string
  children?: ProjectionMarkdownNode[]
  kind?: ProjectedRawBlockKind
  source?: string
  hidden?: boolean
  lang?: string
  deskMathSource?: boolean
}

function encodeBase64(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

function decodeBase64(value: string): string {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return new TextDecoder().decode(bytes)
}

function isProjectedKind(kind: MarkdownSourceBlockKind): kind is SourceProjectedKind {
  return PROJECTED_KINDS.has(kind as SourceProjectedKind)
}

function shouldProjectBlock(block: MarkdownSourceBlock): block is MarkdownSourceBlock & {
  kind: SourceProjectedKind
} {
  if (!isProjectedKind(block.kind)) return false
  return block.kind !== 'table' || HTML_TAG.test(block.source)
}

function isRegionComment(block: MarkdownSourceBlock): boolean {
  return block.kind === 'html' && REGION_COMMENT.test(block.source)
}

function fenceLanguage(source: string): string {
  return source.match(/^ {0,3}(?:`{3,}|~{3,})\s*([^\s]+)/)?.[1]?.toLowerCase() ?? ''
}

function isDiagramFence(block: MarkdownSourceBlock): boolean {
  return block.kind === 'raw-fence' && DIAGRAM_LANGUAGES.has(fenceLanguage(block.source))
}

export function createProjectedRawBlockMarker(block: ProjectedRawBlock): string {
  return `<!--desk-raw-block:v1:${block.kind}:${block.hidden ? '1' : '0'}:${encodeBase64(block.source)}-->`
}

export function readProjectedRawBlockMarker(value: string): ProjectedRawBlock | null {
  const match = value.trim().match(MARKER)
  if (!match) return null
  try {
    return {
      kind: match[1] as ProjectedRawBlockKind,
      hidden: match[2] === '1',
      source: decodeBase64(match[3])
    }
  } catch {
    return null
  }
}

/**
 * Replaces only syntax that CommonMark cannot safely model with internal markers.
 * Fenced code is deliberately excluded so Crepe's normal code editor remains available.
 */
export function projectRawBlocksForMilkdown(source: string): string {
  const document = parseMarkdownSource(source)
  const replacements = new Map<string, string>()

  document.blocks.forEach((block) => {
    if (isDiagramFence(block)) {
      replacements.set(
        block.id,
        createProjectedRawBlockMarker({
          kind: 'raw-diagram',
          source: block.source,
          hidden: false
        })
      )
      return
    }
    if (!shouldProjectBlock(block)) return
    const marker = createProjectedRawBlockMarker({
      kind: block.kind,
      source: block.source,
      // Reference definitions are metadata consumed by the Markdown parser to
      // resolve `[text][id]` links. They must never surface as a visible source
      // card; keep them as a hidden atom so serialization still restores their
      // exact original bytes.
      hidden: isRegionComment(block) || block.kind === 'raw-reference-definition'
    })
    // Keep definitions in the parser input so reference usages still resolve. Remark consumes
    // them; the adjacent atom is what restores their exact source during serialization.
    replacements.set(
      block.id,
      block.kind === 'raw-reference-definition' ? `${block.source}\n${marker}` : marker
    )
  })

  return serializeMarkdownSource(document, replacements)
}

function rawBlockLabel(block: ProjectedRawBlock): string {
  if (block.kind === 'raw-frontmatter') return 'Frontmatter'
  if (block.kind === 'raw-generated-title') return '自动生成标题'
  if (block.kind === 'raw-generated-toc') return '自动生成目录'
  if (block.kind === 'raw-include') return '文件引用'
  if (block.kind === 'raw-reference-definition') return '链接定义'
  if (block.kind === 'raw-diagram') {
    const lang = fenceLanguage(block.source)
    return lang ? `图表 · ${lang}` : '图表'
  }
  if (block.kind === 'table') return '表格 · HTML'
  if (block.kind === 'raw-container') {
    const name = block.source.match(/^ {0,3}:{3,}\s+([^\s]+)/)?.[1]
    return name ? `自定义容器 · ${name}` : '自定义容器'
  }
  if (block.kind === 'raw-component') {
    const name = block.source.match(/^ {0,3}<([A-Z][\w.-]*)/)?.[1]
    return name ? `组件 · ${name}` : '组件'
  }
  const tag = block.source.match(/^ {0,3}<\/?([a-z][\w.-]*)/)?.[1]
  return tag ? `HTML · ${tag}` : 'HTML'
}

function rawBlockPreview(source: string): string {
  const firstLine = source.split(/\r?\n/, 1)[0].trim()
  if (firstLine.length <= 96) return firstLine
  return `${firstLine.slice(0, 93)}…`
}

interface TocItem {
  level: number
  text: string
  href: string
}

function parseTocItems(source: string): TocItem[] {
  const items: TocItem[] = []
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^(\s*)- \[([^\]]+)\]\(#([^)]+)\)/)
    if (!match) continue
    const indent = [...match[1]].reduce((width, char) => width + (char === '\t' ? 2 : 1), 0)
    items.push({ level: Math.floor(indent / 2), text: match[2], href: `#${match[3]}` })
  }
  return items
}

function renderTocLevel(
  items: TocItem[],
  index: number,
  level: number,
  container: HTMLElement
): number {
  let cursor = index
  while (cursor < items.length) {
    const item = items[cursor]
    if (item.level < level) break

    const listItem = document.createElement('li')
    const anchor = document.createElement('a')
    anchor.textContent = item.text
    anchor.href = item.href
    anchor.className = 'desk-generated-toc__link'
    listItem.append(anchor)
    container.append(listItem)
    cursor += 1

    if (cursor < items.length && items[cursor].level > level) {
      const nested = document.createElement('ul')
      listItem.append(nested)
      cursor = renderTocLevel(items, cursor, level + 1, nested)
    }
  }
  return cursor
}

function renderGeneratedTitleNode(source: string): HTMLElement {
  const heading = document.createElement('h1')
  heading.className = 'desk-generated-title'
  heading.contentEditable = 'false'
  heading.setAttribute('data-title', '自动生成标题')

  const body = source.replace(/^ {0,3}#{1,6}[ \t]+/, '').trimEnd()
  const inlineLink = /\[([^\]]+)\]\(([^)\s]+)\)/g
  let lastIndex = 0
  for (const match of body.matchAll(inlineLink)) {
    const [, text, href] = match
    const linkStart = match.index ?? 0
    if (linkStart > lastIndex) {
      heading.append(document.createTextNode(body.slice(lastIndex, linkStart)))
    }
    if (/^(https?:|#)/i.test(href)) {
      const anchor = document.createElement('a')
      anchor.textContent = text
      anchor.href = href
      heading.append(anchor)
    } else {
      heading.append(document.createTextNode(text))
    }
    lastIndex = linkStart + match[0].length
  }
  if (lastIndex < body.length) {
    heading.append(document.createTextNode(body.slice(lastIndex)))
  }
  return heading
}

function renderGeneratedTocNode(source: string): HTMLElement {
  const container = document.createElement('div')
  container.className = 'desk-generated-toc'
  container.contentEditable = 'false'
  container.setAttribute('data-title', '自动生成目录')

  const toggle = document.createElement('button')
  toggle.type = 'button'
  toggle.className = 'desk-generated-toc__toggle'
  toggle.setAttribute('aria-expanded', 'true')
  toggle.setAttribute('aria-label', '折叠目录')
  const toggleLabel = document.createElement('span')
  toggleLabel.className = 'desk-generated-toc__toggle-label'
  toggleLabel.textContent = '目录'
  const toggleIcon = document.createElement('span')
  toggleIcon.className = 'desk-generated-toc__toggle-icon'
  toggleIcon.setAttribute('aria-hidden', 'true')
  toggle.append(toggleIcon, toggleLabel)

  const list = document.createElement('ul')
  list.className = 'desk-generated-toc__list'
  renderTocLevel(parseTocItems(source), 0, 0, list)

  toggle.addEventListener('click', (event) => {
    event.stopPropagation()
    const collapsed = container.classList.toggle('is-collapsed')
    toggle.setAttribute('aria-expanded', String(!collapsed))
    toggle.setAttribute('aria-label', collapsed ? '展开目录' : '折叠目录')
  })

  container.append(toggle, list)
  return container
}

/**
 * Builds the DOM that backs a projected raw-block atom. `raw-container` renders
 * its enclosed markdown as a faithful read-only VitePress-style container; every
 * other kind keeps the immutable source-card presentation. `resolveImage` lets
 * the hosting editor rewrite note-local relative image paths; when omitted
 * relative paths are dropped defensively.
 */
export function renderDeskRawBlockElement(
  block: ProjectedRawBlock,
  resolveImage?: ResolveImage
): HTMLElement {
  if (block.kind === 'raw-diagram' && !block.hidden) {
    const wrapper = document.createElement('div')
    wrapper.dataset.type = 'desk-raw-block'
    wrapper.dataset.kind = 'raw-diagram'
    wrapper.dataset.source = encodeBase64(block.source)
    wrapper.dataset.hidden = 'false'
    wrapper.contentEditable = 'false'
    wrapper.className = 'desk-raw-block desk-raw-block--diagram'
    const diagram = document.createElement('div')
    diagram.className = 'desk-diagram'
    wrapper.append(diagram)
    return wrapper
  }
  if (block.kind === 'raw-container' && !block.hidden) {
    const container = renderContainerFromSource(block.source, resolveImage)
    const wrapper = document.createElement('div')
    wrapper.dataset.type = 'desk-raw-block'
    wrapper.dataset.kind = 'raw-container'
    wrapper.dataset.source = encodeBase64(block.source)
    wrapper.dataset.hidden = 'false'
    wrapper.contentEditable = 'false'
    wrapper.className = 'desk-raw-block desk-raw-block--container'
    wrapper.append(container)
    return wrapper
  }
  if (block.kind === 'raw-generated-title') {
    const rendered = renderGeneratedTitleNode(block.source)
    rendered.dataset.type = 'desk-raw-block'
    rendered.dataset.kind = block.kind
    rendered.dataset.source = encodeBase64(block.source)
    rendered.dataset.hidden = 'false'
    return rendered
  }
  if (block.kind === 'raw-generated-toc') {
    const rendered = renderGeneratedTocNode(block.source)
    rendered.dataset.type = 'desk-raw-block'
    rendered.dataset.kind = block.kind
    rendered.dataset.source = encodeBase64(block.source)
    rendered.dataset.hidden = 'false'
    return rendered
  }

  const element = document.createElement('div')
  element.dataset.type = 'desk-raw-block'
  element.dataset.kind = block.kind
  element.dataset.source = encodeBase64(block.source)
  element.dataset.hidden = String(block.hidden)
  element.contentEditable = 'false'
  element.title = '当前版本请在源码视图中编辑此内容'

  if (block.hidden) {
    element.className = 'desk-raw-block desk-raw-block--hidden'
    element.setAttribute('aria-hidden', 'true')
    return element
  }

  element.className = 'desk-raw-block'
  const label = document.createElement('span')
  label.className = 'desk-raw-block__label'
  label.textContent = rawBlockLabel(block)
  const preview = document.createElement('code')
  preview.className = 'desk-raw-block__preview'
  preview.textContent = rawBlockPreview(block.source)
  element.append(label, preview)
  return element
}

function replaceProjectionMarkers(node: ProjectionMarkdownNode): void {
  if (!node.children) return

  node.children = node.children.map((child) => {
    // Crepe's remark-math transformer creates a positionless `code` node with this exact
    // language. Preserve that provenance before the ProseMirror code-block model flattens it.
    if (child.type === 'code' && child.lang === 'LaTeX' && !child.position) {
      child.deskMathSource = true
    }
    const direct = child.type === 'html' ? readProjectedRawBlockMarker(child.value ?? '') : null
    if (direct) return { type: 'deskRawBlock', ...direct }

    const paragraphChild = child.type === 'paragraph' ? child.children?.[0] : undefined
    const paragraph =
      child.type === 'paragraph' && child.children?.length === 1 && paragraphChild?.type === 'html'
        ? readProjectedRawBlockMarker(paragraphChild.value ?? '')
        : null
    if (paragraph) return { type: 'deskRawBlock', ...paragraph }

    replaceProjectionMarkers(child)
    return child
  })
}

export const rawBlockProjectionRemark = $remark('deskRawBlockProjection', () => () => (tree) => {
  replaceProjectionMarkers(tree as ProjectionMarkdownNode)
})

export const rawBlockSchema = $nodeSchema('deskRawBlock', () => ({
  atom: true,
  group: 'block',
  isolating: true,
  selectable: false,
  attrs: {
    kind: { default: 'html', validate: 'string' },
    source: { default: '', validate: 'string' },
    hidden: { default: false, validate: 'boolean' }
  },
  parseDOM: [
    {
      tag: 'div[data-type="desk-raw-block"]',
      getAttrs: (dom) => {
        const source = dom.dataset.source
        if (!source) return false
        try {
          return {
            kind: dom.dataset.kind ?? 'html',
            source: decodeBase64(source),
            hidden: dom.dataset.hidden === 'true'
          }
        } catch {
          return false
        }
      }
    }
  ],
  toDOM: (node) => {
    const block: ProjectedRawBlock = {
      kind: node.attrs.kind,
      source: node.attrs.source,
      hidden: node.attrs.hidden
    }
    return renderDeskRawBlockElement(block)
  },
  parseMarkdown: {
    match: (node) => node.type === 'deskRawBlock',
    runner: (state, node, type) => {
      state.addNode(type, {
        kind: node.kind,
        source: node.source,
        hidden: node.hidden
      })
    }
  },
  toMarkdown: {
    match: (node) => node.type.name === 'deskRawBlock',
    runner: (state, node) => {
      state.addNode('html', undefined, node.attrs.source)
    }
  }
}))

/**
 * Crepe normally serializes every `latex` fence as `$$` math. We retain provenance from its
 * remark-math transform so authored fences use the base code serializer while genuine math
 * nodes and freshly inserted `LaTeX` formula nodes still serialize as `$$`.
 */
export const sourcePreservingCodeBlockSchema = codeBlockSchema.extendSchema((base) => (ctx) => {
  const schema = base(ctx)
  return {
    ...schema,
    attrs: {
      ...schema.attrs,
      deskMathSource: { default: null }
    },
    parseMarkdown: {
      match: schema.parseMarkdown.match,
      runner: (state, node, type) => {
        state.openNode(type, {
          language: node.lang ?? '',
          deskMathSource: node.deskMathSource === true
        })
        if (typeof node.value === 'string' && node.value) state.addText(node.value)
        state.closeNode()
      }
    },
    toMarkdown: {
      match: schema.toMarkdown.match,
      runner: (state, node) => {
        const isMathSource =
          node.attrs.deskMathSource === true ||
          (node.attrs.deskMathSource == null && node.attrs.language === 'LaTeX')
        if (isMathSource) {
          state.addNode('math', undefined, node.content.firstChild?.text ?? '')
          return
        }
        schema.toMarkdown.runner(state, node)
      }
    }
  }
})

function rawBlockSignatures(document: {
  descendants(
    visitor: (node: { type: { name: string }; attrs: Record<string, unknown> }) => void
  ): void
}): string[] {
  const signatures: string[] = []
  document.descendants((node) => {
    if (node.type.name !== 'deskRawBlock') return
    // `raw-container` is now editorially mutable (source-editor editing); every
    // other projected kind stays immutable until a dedicated editor lands.
    if (node.attrs.kind === 'raw-container') return
    signatures.push(
      `${String(node.attrs.kind)}\u0000${String(node.attrs.hidden)}\u0000${String(node.attrs.source)}`
    )
  })
  return signatures
}

/** Raw cards remain immutable until their dedicated visual interactions are implemented. */
export const immutableRawBlockPlugin = $prose(
  () =>
    new Plugin({
      filterTransaction: (transaction, state) => {
        if (!transaction.docChanged) return true
        const before = rawBlockSignatures(state.doc)
        const after = rawBlockSignatures(transaction.doc)
        return (
          before.length === after.length && before.every((value, index) => value === after[index])
        )
      }
    })
)

export const rawBlockProjectionPlugins: MilkdownPlugin[] = [
  ...rawBlockProjectionRemark,
  ...rawBlockSchema,
  ...sourcePreservingCodeBlockSchema,
  immutableRawBlockPlugin
]
