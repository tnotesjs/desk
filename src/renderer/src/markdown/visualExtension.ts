import { Annotation, EditorState, type Extension } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'

import {
  collectVisualBlocks,
  renderVisualBlock,
  type MarkdownRenderContext,
  type VisualBlock
} from './visualBlocks'
import { mountSpecialBlock, type SpecialBlockHandlers } from './specialBlocks'

export const externalDocumentSync = Annotation.define<boolean>()

class VisualBlockWidget extends WidgetType {
  constructor(
    private readonly block: VisualBlock,
    private readonly html: string,
    private readonly context: MarkdownRenderContext,
    private readonly openLink: (url: string) => void,
    private readonly handlers: SpecialBlockHandlers
  ) {
    super()
  }

  eq(other: VisualBlockWidget): boolean {
    return (
      other.block.from === this.block.from &&
      other.block.to === this.block.to &&
      other.block.source === this.block.source &&
      other.html === this.html
    )
  }

  toDOM(view: EditorView): HTMLElement {
    const container = document.createElement('div')
    container.className = `cm-visual-block cm-visual-${this.block.kind}${this.block.generated ? ' cm-visual-generated' : ''}`
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
    const cleanup = mountSpecialBlock(container, this.block, this.context, this.handlers)
    container.addEventListener('tn-destroy', cleanup, { once: true })
    container.addEventListener('mousedown', (event) => {
      const target = event.target as HTMLElement
      if (target.closest('button, input, label, .tn-mindmap')) {
        event.stopPropagation()
        return
      }
      const anchor = target.closest('a')
      if (anchor instanceof HTMLAnchorElement && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        event.stopPropagation()
        this.openLink(anchor.href)
        return
      }
      event.preventDefault()
      view.dispatch({ selection: { anchor: this.block.from } })
      view.focus()
    })
    return container
  }

  destroy(dom: HTMLElement): void {
    dom.dispatchEvent(new Event('tn-destroy'))
  }

  ignoreEvent(): boolean {
    return false
  }
}

function selectionTouchesBlock(state: EditorState, block: VisualBlock): boolean {
  return state.selection.ranges.some((range) => range.from <= block.to && range.to >= block.from)
}

function visualDecorations(
  state: EditorState,
  context: MarkdownRenderContext,
  openLink: (url: string) => void,
  handlers: SpecialBlockHandlers
): DecorationSet {
  const ranges = collectVisualBlocks(state.doc.toString()).flatMap((block) => {
    const firstLine = state.doc.lineAt(block.from)
    const lineClass = Decoration.line({
      class: `cm-visual-source cm-visual-source-${block.kind}`
    }).range(firstLine.from)
    if (!block.generated && selectionTouchesBlock(state, block)) return [lineClass]
    if (block.to <= block.from) return []
    const widget = new VisualBlockWidget(
      block,
      renderVisualBlock(block, context),
      context,
      openLink,
      handlers
    )
    return [
      Decoration.replace({
        widget,
        block: true,
        inclusive: false
      }).range(block.from, block.to)
    ]
  })
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
  handlers: SpecialBlockHandlers = { openNote: () => undefined }
): Extension[] {
  return [
    EditorView.decorations.compute(['doc', 'selection'], (state) =>
      visualDecorations(state, context, openLink, handlers)
    ),
    generatedContentProtection(),
    EditorView.editorAttributes.of({ class: 'cm-visual-editor' })
  ]
}
