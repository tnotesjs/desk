import { StateEffect, StateField, type Extension, type RangeSet } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, lineNumbers } from '@codemirror/view'

import {
  clampHighlightRanges,
  decodeHighlightsAttr,
  encodeHighlightsAttr,
  toggleHighlightLine
} from './lineHighlight'

export interface CodeLineHighlightOptions {
  /** Initial highlights as `{1-3,7}` or empty. */
  initial?: string
  /** Called after a user toggle (or prune). Receives the encoded attr and CM view. */
  onChange?: (encoded: string, view: EditorView) => void
  /** When true, gutter clicks are ignored. */
  readOnly?: () => boolean
  /**
   * When true (default), install `lineNumbers()`.
   * Set false when the host already provides lineNumbers (Crepe basicSetup).
   */
  provideLineNumbers?: boolean
}

const setHighlightsEffect = StateEffect.define<Set<number>>()

function lineNumberFromGutterTarget(target: EventTarget | null, root: HTMLElement): number | null {
  const el = target instanceof Element ? target.closest('.cm-gutterElement') : null
  if (!el || !root.contains(el)) return null
  // Only respond to line-number gutters, not fold gutters.
  if (!el.closest('.cm-lineNumbers')) return null
  const text = (el.textContent ?? '').trim()
  if (!/^\d+$/.test(text)) return null
  const line = Number(text)
  return line > 0 ? line : null
}

function buildDecorations(
  lines: Set<number>,
  maxLine: number,
  doc: { line: (n: number) => { from: number } }
): RangeSet<Decoration> {
  if (lines.size === 0) return Decoration.none
  return Decoration.set(
    [...lines]
      .filter((line) => line >= 1 && line <= maxLine)
      .sort((a, b) => a - b)
      .map((line) => Decoration.line({ class: 'cm-highlighted-line' }).range(doc.line(line).from))
  )
}

/**
 * CodeMirror extensions for VitePress-style clickable line highlights.
 * Returns extensions plus `setHighlights` to sync from outside (PM attrs).
 */
export function createCodeLineHighlightExtension(options: CodeLineHighlightOptions = {}): {
  extensions: Extension[]
  setHighlights: (view: EditorView, encoded: string) => void
} {
  const initial = decodeHighlightsAttr(options.initial)
  const lastEmittedByView = new WeakMap<EditorView, string>()

  const highlightsField = StateField.define<Set<number>>({
    create: () => new Set(initial),
    update(value, transaction) {
      let next = value
      for (const effect of transaction.effects) {
        if (effect.is(setHighlightsEffect)) next = effect.value
      }
      if (transaction.docChanged) {
        next = clampHighlightRanges(next, transaction.state.doc.lines)
      }
      return next
    }
  })

  const highlightDecorations = StateField.define<RangeSet<Decoration>>({
    create(state) {
      return buildDecorations(state.field(highlightsField), state.doc.lines, state.doc)
    },
    update(decorations, transaction) {
      const lines = transaction.state.field(highlightsField)
      if (
        transaction.docChanged ||
        transaction.effects.some((effect) => effect.is(setHighlightsEffect))
      ) {
        return buildDecorations(lines, transaction.state.doc.lines, transaction.state.doc)
      }
      return decorations.map(transaction.changes)
    },
    provide: (field) => EditorView.decorations.from(field)
  })

  const emitIfChanged = (lines: Set<number>, view: EditorView): void => {
    const encoded = encodeHighlightsAttr(lines)
    if (lastEmittedByView.get(view) === encoded) return
    lastEmittedByView.set(view, encoded)
    options.onChange?.(encoded, view)
  }

  const gutterClickPlugin = ViewPlugin.fromClass(
    class {
      private readonly onMouseDown: (event: MouseEvent) => void

      constructor(readonly view: EditorView) {
        // Seed so the first prune after mount compares against initial highlights.
        lastEmittedByView.set(view, encodeHighlightsAttr(view.state.field(highlightsField)))
        this.onMouseDown = (event: MouseEvent): void => {
          if (options.readOnly?.()) return
          const line = lineNumberFromGutterTarget(event.target, view.dom)
          if (line == null) return
          event.preventDefault()
          event.stopPropagation()
          const current = view.state.field(highlightsField)
          const next = clampHighlightRanges(
            toggleHighlightLine(current, line),
            view.state.doc.lines
          )
          view.dispatch({ effects: setHighlightsEffect.of(next) })
          emitIfChanged(next, view)
        }
        view.dom.addEventListener('mousedown', this.onMouseDown, true)
      }

      destroy(): void {
        this.view.dom.removeEventListener('mousedown', this.onMouseDown, true)
      }
    }
  )

  const pruneListener = EditorView.updateListener.of((update) => {
    if (!update.docChanged) return
    const lines = update.state.field(highlightsField)
    const clamped = clampHighlightRanges(lines, update.state.doc.lines)
    if (encodeHighlightsAttr(clamped) !== lastEmittedByView.get(update.view)) {
      emitIfChanged(clamped, update.view)
    }
  })

  const base: Extension[] = [
    highlightsField,
    highlightDecorations,
    gutterClickPlugin,
    pruneListener,
    EditorView.theme({
      '.cm-highlighted-line': {
        backgroundColor: 'color-mix(in srgb, var(--accent) 18%, transparent)'
      },
      /* Active-line overlay must not hide highlight marks. */
      '.cm-highlighted-line.cm-activeLine': {
        backgroundColor: 'color-mix(in srgb, var(--accent) 26%, transparent)'
      },
      '.cm-lineNumbers .cm-gutterElement': {
        cursor: 'pointer'
      },
      '.cm-lineNumbers .cm-gutterElement:hover': {
        color: 'var(--accent-strong, var(--accent))'
      }
    })
  ]

  if (options.provideLineNumbers !== false) {
    base.unshift(lineNumbers())
  }

  return {
    extensions: base,
    setHighlights: (view, encoded) => {
      const next = clampHighlightRanges(decodeHighlightsAttr(encoded), view.state.doc.lines)
      lastEmittedByView.set(view, encodeHighlightsAttr(next))
      view.dispatch({ effects: setHighlightsEffect.of(next) })
    }
  }
}

/** Convenience: just the extension array (no external setter). */
export function codeLineHighlightExtension(options: CodeLineHighlightOptions = {}): Extension {
  return createCodeLineHighlightExtension(options).extensions
}
