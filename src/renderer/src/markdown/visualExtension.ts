import {
  Annotation,
  EditorState,
  StateEffect,
  StateField,
  type Extension,
  type Range
} from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import GithubSlugger from 'github-slugger'

import {
  collectVisualBlocks,
  renderVisualBlock,
  type MarkdownRenderContext,
  type VisualBlock
} from './visualBlocks'
import { mountSpecialBlock, type SpecialBlockHandlers } from './specialBlocks'

export const externalDocumentSync = Annotation.define<boolean>()
const visualFocusEffect = StateEffect.define<boolean>()
const headingCollapseEffect = StateEffect.define<{ key: string; collapsed: boolean }>()
const visualFocusState = StateField.define<boolean>({
  create: () => false,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(visualFocusEffect)) value = effect.value
    }
    return value
  }
})

interface H2Section {
  block: VisualBlock
  key: string
  contentFrom: number
  contentTo: number
  hasContent: boolean
}

function collapseStorageKey(context: MarkdownRenderContext, target: string): string {
  return `tnotes-desk-collapse:${context.knowledgeBaseId}:${context.noteUuid}:${target}`
}

function readCollapseState(context: MarkdownRenderContext, target: string): boolean {
  try {
    return globalThis.localStorage?.getItem(collapseStorageKey(context, target)) === '1'
  } catch {
    return false
  }
}

function writeCollapseState(
  context: MarkdownRenderContext,
  target: string,
  collapsed: boolean
): void {
  try {
    globalThis.localStorage?.setItem(collapseStorageKey(context, target), collapsed ? '1' : '0')
  } catch {
    // A disabled storage backend must not prevent document folding.
  }
}

function h2HeadingKeys(source: string): string[] {
  const slugger = new GithubSlugger()
  return collectVisualBlocks(source)
    .filter((block) => block.kind === 'heading' && /^##(?!#)\s+/.test(block.source))
    .map((block) => slugger.slug(headingText(block.source)) || `heading-${block.from}`)
}

function createHeadingCollapseState(
  context: MarkdownRenderContext
): StateField<ReadonlySet<string>> {
  return StateField.define<ReadonlySet<string>>({
    create(state) {
      return new Set(
        h2HeadingKeys(state.doc.toString()).filter((key) => readCollapseState(context, `h2:${key}`))
      )
    },
    update(value, transaction) {
      let next = new Set(value)
      if (transaction.docChanged) {
        const validKeys = new Set(h2HeadingKeys(transaction.newDoc.toString()))
        next = new Set(
          [...validKeys].filter((key) => next.has(key) || readCollapseState(context, `h2:${key}`))
        )
      }
      for (const effect of transaction.effects) {
        if (!effect.is(headingCollapseEffect)) continue
        if (effect.value.collapsed) next.add(effect.value.key)
        else next.delete(effect.value.key)
      }
      return next
    }
  })
}

function collectH2Sections(state: EditorState, blocks: readonly VisualBlock[]): H2Section[] {
  const slugger = new GithubSlugger()
  const headings = blocks
    .filter((block) => block.kind === 'heading' && /^##(?!#)\s+/.test(block.source))
    .map((block) => ({
      block,
      key: slugger.slug(headingText(block.source)) || `heading-${block.from}`
    }))

  return headings.map(({ block, key }, index) => {
    const headingLine = state.doc.lineAt(block.from)
    const contentFrom = Math.min(headingLine.to + 1, state.doc.length)
    const contentTo = headings[index + 1]?.block.from ?? state.doc.length
    return {
      block,
      key,
      contentFrom,
      contentTo,
      hasContent:
        contentTo > contentFrom && state.doc.sliceString(contentFrom, contentTo).trim().length > 0
    }
  })
}

function setHeadingCollapsed(
  view: EditorView,
  context: MarkdownRenderContext,
  key: string,
  collapsed: boolean
): void {
  writeCollapseState(context, `h2:${key}`, collapsed)
  view.dispatch({ effects: headingCollapseEffect.of({ key, collapsed }) })
}

function supportsInlineVisualEditing(block: VisualBlock): boolean {
  return ['container', 'component', 'mindmap', 'mermaid'].includes(block.kind) && !block.generated
}

function specialBlockLabel(block: VisualBlock): string {
  if (block.kind === 'mermaid') return '文本绘图 · Mermaid'
  if (block.kind === 'mindmap') return '思维导图 · Mindmap'
  if (block.kind === 'container') {
    const name = block.source.match(/^\s*:::\s*([\w-]+)/)?.[1] ?? 'Container'
    return `TNotes 组件 · ${name}`
  }
  const name = block.source.match(/^\s*<([A-Z][\w.-]*)/)?.[1] ?? 'Component'
  return `TNotes 组件 · ${name}`
}

function headingText(source: string): string {
  return source
    .replace(/^#{1,6}\s+/, '')
    .replace(/\s+#+\s*$/, '')
    .replace(/!\[([^\]]*)]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/[`*_~]/g, '')
    .replace(/<[^>]+>/g, '')
    .trim()
}

function headingPosition(state: EditorState, hash: string, label: string): number | null {
  let decoded = hash.replace(/^#/, '')
  try {
    decoded = decodeURIComponent(decoded)
  } catch {
    // Compare the undecoded hash when it contains malformed escape sequences.
  }
  const slugger = new GithubSlugger()
  for (const block of collectVisualBlocks(state.doc.toString())) {
    if (block.kind !== 'heading') continue
    const text = headingText(block.source)
    if (text === label || slugger.slug(text) === decoded) return block.from
  }
  return null
}

class VisualBlockWidget extends WidgetType {
  constructor(
    private readonly block: VisualBlock,
    private readonly html: string,
    private readonly context: MarkdownRenderContext,
    private readonly openLink: (url: string) => void,
    private readonly handlers: SpecialBlockHandlers,
    private readonly documentSource: string,
    private readonly editable: boolean
  ) {
    super()
  }

  eq(other: VisualBlockWidget): boolean {
    return (
      other.block.from === this.block.from &&
      other.block.to === this.block.to &&
      other.block.source === this.block.source &&
      other.html === this.html &&
      other.editable === this.editable
    )
  }

  get estimatedHeight(): number {
    const lineCount = this.block.source.split('\n').length
    // Generated TOCs are deeply nested lists whose rendered height is unrelated to
    // the number of Markdown source lines. Let CodeMirror measure the real DOM so it
    // never reserves phantom space between TOC entries.
    if (this.block.kind === 'generated') return -1
    if (this.block.kind === 'mindmap' || this.block.kind === 'mermaid') return 390
    if (this.block.kind === 'code') return Math.min(560, 54 + lineCount * 21)
    if (this.block.kind === 'table') return Math.min(460, 42 + lineCount * 34)
    if (this.block.kind === 'list') {
      return Math.min(520, 14 + lineCount * 27)
    }
    if (this.block.kind === 'container' || this.block.kind === 'component') return 180
    if (this.block.kind === 'heading') return /^#\s/.test(this.block.source) ? 66 : 48
    return Math.max(30, Math.min(260, Math.ceil(this.block.source.length / 82) * 27))
  }

  toDOM(view: EditorView): HTMLElement {
    const container = document.createElement('div')
    container.className = `cm-visual-block cm-visual-${this.block.kind}${this.block.generated ? ' cm-visual-generated' : ''}`
    if (this.editable && this.block.kind === 'math') {
      return this.editableMathBlockDOM(view, container)
    }
    if (this.editable && supportsInlineVisualEditing(this.block)) {
      return this.editableSpecialBlockDOM(view, container)
    }
    if (this.block.kind === 'container') {
      const containerKind = this.block.source.match(/^\s*:::\s*([\w-]+)/)?.[1]
      if (containerKind) {
        container.classList.add(`tn-${containerKind}`)
        if (containerKind !== 'swiper' && containerKind !== 'code-group') {
          container.classList.add('tn-container', `tn-container-${containerKind}`)
        }
      }
    } else if (this.block.kind === 'mindmap' || this.block.kind === 'mermaid') {
      container.classList.add(`tn-${this.block.kind}`)
    } else if (this.block.kind === 'component' && /^\s*<N\b/.test(this.block.source)) {
      container.classList.add('tn-note-references')
      const ids = [...this.block.source.matchAll(/['"](\d{4})['"]/g)].map((match) => match[1])
      container.dataset.noteIds = ids.join(',')
    }
    container.innerHTML = this.html
    if (this.block.kind === 'generated') this.installGeneratedToc(container, view)
    const cleanup = mountSpecialBlock(container, this.block, this.context, this.handlers)
    container.addEventListener('tn-destroy', cleanup, { once: true })
    this.installInteractions(container, view)
    return container
  }

  private editableMathBlockDOM(view: EditorView, container: HTMLElement): HTMLElement {
    container.classList.add('tn-formula-editor')
    const preview = document.createElement('div')
    preview.className = 'tn-formula-preview'
    preview.tabIndex = 0
    preview.setAttribute('role', 'button')
    preview.setAttribute('aria-label', '编辑公式')
    preview.setAttribute('aria-expanded', 'false')
    const previewHost = document.createElement('div')
    previewHost.className = 'tn-formula-preview-host'
    previewHost.innerHTML = this.html
    preview.append(previewHost)

    const panel = document.createElement('div')
    panel.className = 'tn-formula-panel'
    panel.hidden = true
    const textarea = document.createElement('textarea')
    textarea.className = 'tn-formula-source'
    textarea.spellcheck = false
    textarea.setAttribute('aria-label', 'LaTeX 公式源码')
    textarea.value = this.formulaBody(this.block.source)
    const footer = document.createElement('footer')
    const help = document.createElement('button')
    help.type = 'button'
    help.className = 'tn-formula-help'
    help.textContent = '?  LaTeX 语法帮助'
    const actions = document.createElement('div')
    const cancel = document.createElement('button')
    cancel.type = 'button'
    cancel.textContent = '取消'
    const apply = document.createElement('button')
    apply.type = 'button'
    apply.className = 'primary'
    apply.textContent = '确定（⌘ Enter）'
    actions.append(cancel, apply)
    footer.append(help, actions)
    panel.append(textarea, footer)
    container.append(preview, panel)

    let previewTimer: ReturnType<typeof setTimeout> | null = null
    const formulaSource = (body: string): string => {
      const normalized = body.trim()
      return this.block.source.includes('\n') ? `$$\n${normalized}\n$$` : `$$ ${normalized} $$`
    }
    const renderPreview = (): void => {
      const source = formulaSource(textarea.value)
      previewHost.innerHTML = renderVisualBlock({ ...this.block, source }, this.context)
      requestAnimationFrame(() => view.requestMeasure())
    }
    const setEditing = (editing: boolean): void => {
      container.classList.toggle('is-editing', editing)
      panel.hidden = !editing
      preview.setAttribute('aria-expanded', String(editing))
      if (editing) {
        requestAnimationFrame(() => {
          textarea.focus()
          textarea.setSelectionRange(textarea.value.length, textarea.value.length)
          view.requestMeasure()
        })
      } else {
        requestAnimationFrame(() => view.requestMeasure())
      }
    }
    const cancelEditing = (): void => {
      if (previewTimer) clearTimeout(previewTimer)
      previewTimer = null
      textarea.value = this.formulaBody(this.block.source)
      previewHost.innerHTML = this.html
      setEditing(false)
    }
    const applyFormula = (): void => {
      const source = formulaSource(textarea.value)
      if (!textarea.value.trim()) return
      if (previewTimer) clearTimeout(previewTimer)
      previewTimer = null
      view.dispatch({
        changes: { from: this.block.from, to: this.block.to, insert: source },
        selection: { anchor: this.block.from + source.length }
      })
      requestAnimationFrame(() => view.focus())
    }
    const openEditor = (event: Event): void => {
      event.preventDefault()
      event.stopPropagation()
      setEditing(true)
    }

    preview.addEventListener('mousedown', (event) => {
      event.preventDefault()
      event.stopPropagation()
    })
    preview.addEventListener('click', openEditor)
    preview.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      openEditor(event)
    })
    textarea.addEventListener('input', () => {
      if (previewTimer) clearTimeout(previewTimer)
      previewTimer = setTimeout(renderPreview, 140)
    })
    textarea.addEventListener('keydown', (event) => {
      event.stopPropagation()
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        applyFormula()
      } else if (event.key === 'Escape') {
        event.preventDefault()
        cancelEditing()
      }
    })
    panel.addEventListener('mousedown', (event) => event.stopPropagation())
    help.addEventListener('click', () => this.openLink('https://katex.org/docs/supported.html'))
    cancel.addEventListener('click', cancelEditing)
    apply.addEventListener('click', applyFormula)
    container.addEventListener(
      'tn-destroy',
      () => {
        if (previewTimer) clearTimeout(previewTimer)
      },
      { once: true }
    )
    return container
  }

  private formulaBody(source: string): string {
    return source
      .replace(/^\s*\$\$\s*/, '')
      .replace(/\s*\$\$\s*$/, '')
      .trim()
  }

  private installGeneratedToc(container: HTMLElement, view: EditorView): void {
    container.classList.add('cm-visual-toc')
    const content = document.createElement('div')
    content.className = 'cm-visual-toc-content'
    const flatToc = this.flattenGeneratedToc(container)
    if (flatToc) content.append(flatToc)
    else content.append(...container.childNodes)

    const header = document.createElement('button')
    header.type = 'button'
    header.className = 'cm-visual-toc-header'
    header.setAttribute('aria-label', '折叠笔记目录')
    const label = document.createElement('span')
    label.textContent = '目录'
    const chevron = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    chevron.setAttribute('viewBox', '0 0 12 12')
    chevron.setAttribute('aria-hidden', 'true')
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('d', 'M4 2.5 7.5 6 4 9.5')
    chevron.append(path)
    header.append(label, chevron)

    const setCollapsed = (collapsed: boolean): void => {
      container.classList.toggle('is-collapsed', collapsed)
      content.hidden = collapsed
      header.setAttribute('aria-expanded', String(!collapsed))
      header.setAttribute('aria-label', collapsed ? '展开笔记目录' : '折叠笔记目录')
    }
    setCollapsed(readCollapseState(this.context, 'toc'))
    header.addEventListener('click', () => {
      const collapsed = !container.classList.contains('is-collapsed')
      setCollapsed(collapsed)
      writeCollapseState(this.context, 'toc', collapsed)
      requestAnimationFrame(() => view.requestMeasure())
    })
    container.replaceChildren(header, content)
  }

  private flattenGeneratedToc(container: HTMLElement): HTMLElement | null {
    const links = [...container.querySelectorAll('a')]
    const sourceRows = this.block.source
      .split('\n')
      .map((line) => line.match(/^(\s*)(?:[-+*]|\d+[.)])\s+/))
      .filter((match): match is RegExpMatchArray => Boolean(match))
    if (links.length === 0 || links.length !== sourceRows.length) return null

    const flat = document.createElement('div')
    flat.className = 'cm-visual-toc-flat'
    flat.setAttribute('role', 'list')
    for (const [index, link] of links.entries()) {
      const depth = Math.min(Math.floor(sourceRows[index][1].replace(/\t/g, '  ').length / 2), 5)
      const row = document.createElement('div')
      row.className = 'cm-visual-toc-item'
      row.dataset.depth = String(depth)
      row.setAttribute('role', 'listitem')
      const marker = document.createElement('span')
      marker.className = 'cm-visual-toc-marker'
      marker.setAttribute('aria-hidden', 'true')
      marker.textContent = depth === 0 ? '•' : depth === 1 ? '◦' : '▪'
      const label = document.createElement('span')
      label.className = 'cm-visual-toc-item-label'
      label.append(link.cloneNode(true))
      row.append(marker, label)
      flat.append(row)
    }
    return flat
  }

  private installInteractions(container: HTMLElement, view: EditorView): void {
    container.addEventListener('mousedown', (event) => {
      const target = event.target as HTMLElement
      const anchor = target.closest('a')
      if (anchor instanceof HTMLAnchorElement) {
        const rawHref = anchor.getAttribute('href') ?? ''
        if (rawHref.startsWith('#')) {
          event.preventDefault()
          event.stopPropagation()
          const position = headingPosition(view.state, rawHref, anchor.textContent?.trim() ?? '')
          if (position !== null) {
            const sections = collectH2Sections(
              view.state,
              collectVisualBlocks(view.state.doc.toString())
            )
            const parent = sections.find(
              (section) => position >= section.contentFrom && position < section.contentTo
            )
            if (parent) setHeadingCollapsed(view, this.context, parent.key, false)
            view.dispatch({
              selection: { anchor: position },
              effects: EditorView.scrollIntoView(position, { y: 'start', yMargin: 28 })
            })
          }
          return
        }
        if (event.metaKey || event.ctrlKey || !this.editable) {
          event.preventDefault()
          event.stopPropagation()
          this.openLink(anchor.href)
          return
        }
      }
      if (target.closest('button, input, label, textarea, select, .tn-mindmap')) {
        event.stopPropagation()
        return
      }
      event.preventDefault()
      view.dispatch({ selection: { anchor: this.block.from } })
      view.focus()
    })
  }

  private editableSpecialBlockDOM(view: EditorView, container: HTMLElement): HTMLElement {
    container.classList.add('tn-visual-block-editor')
    const toolbar = document.createElement('header')
    toolbar.className = 'tn-visual-block-toolbar'
    const label = document.createElement('strong')
    label.textContent = specialBlockLabel(this.block)
    const actions = document.createElement('div')
    const toggleButton = document.createElement('button')
    toggleButton.type = 'button'
    toggleButton.className = 'tn-visual-block-toggle'
    toggleButton.textContent = '编辑源码'
    toggleButton.setAttribute('aria-label', '切换组件源码编辑')
    const cancelButton = document.createElement('button')
    cancelButton.type = 'button'
    cancelButton.textContent = '取消'
    cancelButton.hidden = true
    const applyButton = document.createElement('button')
    applyButton.type = 'button'
    applyButton.className = 'primary'
    applyButton.textContent = '应用'
    applyButton.disabled = true
    actions.append(toggleButton, cancelButton, applyButton)
    toolbar.append(label, actions)

    const layout = document.createElement('div')
    layout.className = 'tn-visual-block-layout'
    const sourcePane = document.createElement('div')
    sourcePane.className = 'tn-visual-block-source'
    const textarea = document.createElement('textarea')
    textarea.value = this.block.source
    textarea.spellcheck = false
    textarea.setAttribute('aria-label', `${specialBlockLabel(this.block)} 源码`)
    sourcePane.append(textarea)
    const previewPane = document.createElement('div')
    previewPane.className = 'tn-visual-block-preview'
    layout.append(sourcePane, previewPane)
    container.append(toolbar, layout)

    let cleanupPreview: (() => void) | null = null
    let previewTimer: ReturnType<typeof setTimeout> | null = null
    const renderPreview = (source: string): void => {
      cleanupPreview?.()
      const host = document.createElement('div')
      host.className = 'tn-visual-block-preview-host'
      const draft = { ...this.block, source }
      const nextDocumentSource = `${this.documentSource.slice(0, this.block.from)}${source}${this.documentSource.slice(this.block.to)}`
      host.innerHTML = renderVisualBlock(draft, this.context, nextDocumentSource)
      previewPane.replaceChildren(host)
      cleanupPreview = mountSpecialBlock(host, draft, this.context, this.handlers)
    }
    const updateDirtyState = (): void => {
      const dirty = textarea.value !== this.block.source
      applyButton.disabled = !dirty
      cancelButton.hidden = !dirty
      container.classList.toggle('is-dirty', dirty)
    }
    const setEditing = (editing: boolean): void => {
      container.classList.toggle('is-editing', editing)
      toggleButton.textContent = editing ? '仅预览' : '编辑源码'
      toggleButton.setAttribute('aria-pressed', String(editing))
      if (editing) requestAnimationFrame(() => textarea.focus())
    }
    const cancel = (): void => {
      if (previewTimer) clearTimeout(previewTimer)
      previewTimer = null
      textarea.value = this.block.source
      updateDirtyState()
      renderPreview(this.block.source)
      setEditing(false)
    }
    const apply = (): void => {
      if (applyButton.disabled) return
      const source = textarea.value
      if (previewTimer) clearTimeout(previewTimer)
      previewTimer = null
      view.dispatch({
        changes: { from: this.block.from, to: this.block.to, insert: source },
        selection: { anchor: this.block.from + source.length }
      })
      requestAnimationFrame(() => view.focus())
    }

    toggleButton.addEventListener('click', () =>
      setEditing(!container.classList.contains('is-editing'))
    )
    cancelButton.addEventListener('click', cancel)
    applyButton.addEventListener('click', apply)
    textarea.addEventListener('input', () => {
      updateDirtyState()
      if (previewTimer) clearTimeout(previewTimer)
      previewTimer = setTimeout(() => renderPreview(textarea.value), 240)
    })
    textarea.addEventListener('keydown', (event) => {
      event.stopPropagation()
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        apply()
      } else if (event.key === 'Escape') {
        event.preventDefault()
        cancel()
      }
    })
    container.addEventListener(
      'tn-destroy',
      () => {
        if (previewTimer) clearTimeout(previewTimer)
        cleanupPreview?.()
      },
      { once: true }
    )
    renderPreview(this.block.source)
    this.installInteractions(container, view)
    return container
  }

  destroy(dom: HTMLElement): void {
    dom.dispatchEvent(new Event('tn-destroy'))
  }

  ignoreEvent(): boolean {
    return false
  }
}

class H2CollapseWidget extends WidgetType {
  constructor(
    private readonly key: string,
    private readonly collapsed: boolean,
    private readonly context: MarkdownRenderContext
  ) {
    super()
  }

  eq(other: H2CollapseWidget): boolean {
    return other.key === this.key && other.collapsed === this.collapsed
  }

  toDOM(view: EditorView): HTMLElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'cm-visual-h2-fold'
    button.dataset.collapsed = String(this.collapsed)
    button.setAttribute('aria-label', this.collapsed ? '展开本节' : '收起本节')
    button.setAttribute('aria-expanded', String(!this.collapsed))
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    icon.setAttribute('viewBox', '0 0 12 12')
    icon.setAttribute('aria-hidden', 'true')
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('d', 'M4 2.5 7.5 6 4 9.5')
    icon.append(path)
    button.append(icon)
    button.addEventListener('mousedown', (event) => {
      event.preventDefault()
      event.stopPropagation()
    })
    button.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      setHeadingCollapsed(view, this.context, this.key, !this.collapsed)
      requestAnimationFrame(() => view.requestMeasure())
    })
    return button
  }

  ignoreEvent(): boolean {
    return false
  }
}

class VisualListMarkerWidget extends WidgetType {
  constructor(private readonly marker: string) {
    super()
  }

  eq(other: VisualListMarkerWidget): boolean {
    return other.marker === this.marker
  }

  toDOM(): HTMLElement {
    const marker = document.createElement('span')
    marker.className = 'cm-visual-list-marker'
    marker.textContent = `${this.marker} `
    return marker
  }
}

function activeLineNumbers(state: EditorState): Set<number> {
  const active = new Set<number>()
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number
    const last = state.doc.lineAt(range.to).number
    for (let lineNumber = first; lineNumber <= last; lineNumber += 1) active.add(lineNumber)
  }
  return active
}

function usesStableSourceLines(block: VisualBlock): boolean {
  if (block.generated || !['heading', 'paragraph', 'list'].includes(block.kind)) return false
  if (block.kind === 'heading') return true
  // Images, raw HTML/components and inline/block math need their dedicated widgets.
  // Plain prose, links, emphasis and inline code stay on native CodeMirror lines so
  // focusing them cannot swap DOM trees and change the document geometry.
  return !/!\[|<|\$|^\s*>/m.test(block.source)
}

const inlineClass: Record<string, string> = {
  StrongEmphasis: 'cm-visual-inline-strong',
  Emphasis: 'cm-visual-inline-emphasis',
  Strikethrough: 'cm-visual-inline-strike',
  InlineCode: 'cm-visual-inline-code',
  Link: 'cm-visual-inline-link',
  Autolink: 'cm-visual-inline-link'
}

function addInlineDecorations(
  state: EditorState,
  block: VisualBlock,
  activeLines: ReadonlySet<number>,
  ranges: Range<Decoration>[]
): void {
  syntaxTree(state).iterate({
    from: block.from,
    to: block.to,
    enter(node) {
      if (node.from < block.from || node.to > block.to) return
      const className = inlineClass[node.name]
      if (className && node.to > node.from) {
        ranges.push(Decoration.mark({ class: className }).range(node.from, node.to))
      }

      const line = state.doc.lineAt(node.from)
      if (activeLines.has(line.number)) return

      let end = node.to
      switch (node.name) {
        case 'EmphasisMark':
        case 'StrikethroughMark':
        case 'CodeMark':
        case 'LinkMark':
          ranges.push(Decoration.replace({}).range(node.from, end))
          break
        case 'LinkTitle':
        case 'LinkLabel':
          ranges.push(Decoration.replace({}).range(node.from, end))
          break
        case 'URL': {
          const previous = node.node.prevSibling
          if (
            node.node.parent?.name === 'Link' &&
            previous?.name === 'LinkMark' &&
            state.doc.sliceString(previous.from, previous.to) === '('
          ) {
            ranges.push(Decoration.replace({}).range(node.from, end))
          }
          break
        }
        case 'Escape':
          end = Math.min(node.from + 1, node.to)
          if (end > node.from) ranges.push(Decoration.replace({}).range(node.from, end))
          break
      }
    }
  })
}

function addStableSourceBlock(
  state: EditorState,
  block: VisualBlock,
  activeLines: ReadonlySet<number>,
  ranges: Range<Decoration>[],
  fold: {
    key: string
    collapsed: boolean
    editable: boolean
    context: MarkdownRenderContext
  } | null
): void {
  const firstLineNumber = state.doc.lineAt(block.from).number
  const lastLineNumber = state.doc.lineAt(block.to).number
  const headingLevel = block.kind === 'heading' ? block.source.match(/^(#{1,6})\s/)?.[1].length : 0

  for (let lineNumber = firstLineNumber; lineNumber <= lastLineNumber; lineNumber += 1) {
    const line = state.doc.line(lineNumber)
    const classes = ['cm-visual-live-line', `cm-visual-live-${block.kind}`]
    if (lineNumber === firstLineNumber) classes.push('cm-visual-live-first')
    if (lineNumber === lastLineNumber) classes.push('cm-visual-live-last')
    if (headingLevel) classes.push(`cm-visual-live-h${headingLevel}`)
    const attributes: Record<string, string> = {}
    if (fold && lineNumber === firstLineNumber) {
      classes.push('cm-visual-h2-foldable')
      if (fold.collapsed) classes.push('cm-visual-h2-collapsed')
      attributes['data-h2-fold-key'] = fold.key
      attributes['data-h2-collapsed'] = String(fold.collapsed)
      attributes['aria-expanded'] = String(!fold.collapsed)
      if (!fold.editable) {
        attributes.role = 'button'
        attributes.tabindex = '0'
        attributes['aria-label'] =
          `${headingText(block.source)}，${fold.collapsed ? '已收起' : '已展开'}`
      }
    }
    ranges.push(Decoration.line({ class: classes.join(' '), attributes }).range(line.from))

    if (fold && fold.editable && lineNumber === firstLineNumber) {
      ranges.push(
        Decoration.widget({
          widget: new H2CollapseWidget(fold.key, fold.collapsed, fold.context),
          side: -1
        }).range(line.from)
      )
    }

    if (activeLines.has(lineNumber)) continue
    if (block.kind === 'heading') {
      const match = line.text.match(/^#{1,6}\s+/)
      if (match) ranges.push(Decoration.replace({}).range(line.from, line.from + match[0].length))
      continue
    }
    if (block.kind === 'list') {
      const match = line.text.match(/^(\s*)([-+*]|\d+[.)])\s+/)
      if (match) {
        const ordered = /^\d/.test(match[2])
        const marker = ordered ? match[2] : match[1].length >= 2 ? '◦' : '•'
        ranges.push(
          Decoration.replace({ widget: new VisualListMarkerWidget(marker) }).range(
            line.from,
            line.from + match[0].length
          )
        )
      }
    }
  }

  if (block.kind === 'heading' && headingLevel) {
    const line = state.doc.line(firstLineNumber)
    const marker = line.text.match(/^#{1,6}\s+/)
    if (marker && activeLines.has(firstLineNumber)) {
      ranges.push(
        Decoration.mark({
          class: `cm-visual-heading-mark cm-visual-heading-mark-h${headingLevel}`
        }).range(line.from, line.from + marker[0].length)
      )
    }
  }
  addInlineDecorations(state, block, activeLines, ranges)
}

function addCompactBlankLines(
  state: EditorState,
  block: VisualBlock,
  nextBlockFrom: number,
  ranges: Range<Decoration>[]
): void {
  for (
    let lineNumber = state.doc.lineAt(block.to).number + 1;
    lineNumber <= state.doc.lines;
    lineNumber += 1
  ) {
    const line = state.doc.line(lineNumber)
    if (line.from >= nextBlockFrom || line.text.trim()) break
    ranges.push(Decoration.line({ class: 'cm-visual-spacer' }).range(line.from))
  }
}

function visualDecorations(
  state: EditorState,
  context: MarkdownRenderContext,
  openLink: (url: string) => void,
  handlers: SpecialBlockHandlers,
  editable: boolean,
  hasFocus: boolean,
  collapsedHeadings: ReadonlySet<string>
): DecorationSet {
  const ranges: Range<Decoration>[] = []
  const source = state.doc.toString()
  const blocks = collectVisualBlocks(source)
  const h2Sections = collectH2Sections(state, blocks)
  const sectionsByHeading = new Map(h2Sections.map((section) => [section.block.from, section]))
  const collapsedSections = h2Sections.filter(
    (section) => section.hasContent && collapsedHeadings.has(section.key)
  )
  const activeLines = editable && hasFocus ? activeLineNumbers(state) : new Set<number>()
  for (const [index, block] of blocks.entries()) {
    const nextBlockFrom = blocks[index + 1]?.from ?? state.doc.length
    if (
      collapsedSections.some(
        (section) => block.from >= section.contentFrom && block.from < section.contentTo
      )
    ) {
      continue
    }
    const section = sectionsByHeading.get(block.from)
    const usesStableBlock = usesStableSourceLines(block) && (editable || block.kind === 'heading')
    if (usesStableBlock) {
      addStableSourceBlock(
        state,
        block,
        activeLines,
        ranges,
        section?.hasContent
          ? {
              key: section.key,
              collapsed: collapsedHeadings.has(section.key),
              editable,
              context
            }
          : null
      )
      if (!section || !collapsedHeadings.has(section.key)) {
        addCompactBlankLines(state, block, nextBlockFrom, ranges)
      }
      continue
    }
    if (block.to <= block.from) continue
    const widget = new VisualBlockWidget(
      block,
      renderVisualBlock(block, context, source),
      context,
      openLink,
      handlers,
      source,
      editable
    )
    ranges.push(
      Decoration.replace({
        widget,
        block: true,
        inclusive: false
      }).range(block.from, nextBlockFrom)
    )
  }
  for (const section of collapsedSections) {
    // Preserve the final line break before the next H2. Hiding that separator would
    // merge the following heading into the folded range and strip its line styling.
    const collapseTo =
      section.contentTo < state.doc.length
        ? Math.max(section.contentFrom, section.contentTo - 1)
        : section.contentTo
    if (collapseTo <= section.contentFrom) continue
    ranges.push(Decoration.replace({}).range(section.contentFrom, collapseTo))
  }
  return Decoration.set(ranges, true)
}

function generatedContentProtection(): Extension {
  return EditorState.transactionFilter.of((transaction) => {
    if (!transaction.docChanged || transaction.annotation(externalDocumentSync)) return transaction
    const generated = collectVisualBlocks(transaction.startState.doc.toString()).filter(
      (block) => block.generated
    )
    let blocked = false
    transaction.changes.iterChangedRanges((fromA, toA) => {
      if (generated.some((block) => fromA <= block.to && toA >= block.from)) blocked = true
    })
    return blocked ? [] : transaction
  })
}

export function visualMarkdownExtensions(
  context: MarkdownRenderContext,
  openLink: (url: string) => void,
  handlers: SpecialBlockHandlers = { openNote: () => undefined },
  editable = true
): Extension[] {
  const headingCollapseState = createHeadingCollapseState(context)

  const toggleReadonlyHeading = (event: Event, view: EditorView): boolean => {
    if (editable) return false
    const target = event.target instanceof Element ? event.target : null
    const row = target?.closest<HTMLElement>('.cm-visual-h2-foldable[data-h2-fold-key]')
    if (!row || !view.dom.contains(row) || target?.closest('a, button')) return false
    const selection = globalThis.getSelection?.()?.toString() ?? ''
    if (selection) return false
    const key = row.dataset.h2FoldKey
    if (!key) return false
    setHeadingCollapsed(view, context, key, row.dataset.h2Collapsed !== 'true')
    requestAnimationFrame(() => view.requestMeasure())
    event.preventDefault()
    return true
  }

  return [
    visualFocusState,
    headingCollapseState,
    EditorView.domEventHandlers({
      focus(_event, view) {
        view.dispatch({ effects: visualFocusEffect.of(true) })
      },
      blur(_event, view) {
        view.dispatch({ effects: visualFocusEffect.of(false) })
      },
      click(event, view) {
        return toggleReadonlyHeading(event, view)
      },
      keydown(event, view) {
        if (event.key !== 'Enter' && event.key !== ' ') return false
        return toggleReadonlyHeading(event, view)
      }
    }),
    EditorView.decorations.compute(
      ['doc', 'selection', visualFocusState, headingCollapseState],
      (state) =>
        visualDecorations(
          state,
          context,
          openLink,
          handlers,
          editable,
          state.field(visualFocusState),
          state.field(headingCollapseState)
        )
    ),
    generatedContentProtection(),
    EditorView.editorAttributes.of({ class: 'cm-visual-editor' })
  ]
}
