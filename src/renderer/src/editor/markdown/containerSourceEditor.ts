import { autocompletion, completionKeymap } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import {
  bracketMatching,
  defaultHighlightStyle,
  foldGutter,
  indentOnInput,
  syntaxHighlighting
} from '@codemirror/language'
import { searchKeymap } from '@codemirror/search'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import {
  crosshairCursor,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  placeholder,
  rectangularSelection
} from '@codemirror/view'
import { githubDark, githubLight } from '@uiw/codemirror-theme-github'

import { isEmptyRawBlockSource } from './rawBlockEmpty'

export interface ContainerSourceEditorHandle {
  getValue(): string
  focus(): void
  destroy(): void
}

export interface ContainerSourceEditorOptions {
  /**
   * When the source is empty (see `isEmptyRawBlockSource`) and Backspace is
   * pressed at the document start, remove the surrounding deskRawBlock.
   * Return true if the key was handled.
   */
  onEmptyBackspace?: () => boolean
  /** Shown when the document is empty (CodeMirror placeholder). */
  placeholder?: string
}

/**
 * Shared predicate + callback for the empty-Backspace gesture. Exported for
 * unit tests; the CodeMirror keymap delegates here.
 */
export function handleEmptyRawBlockBackspace(
  docText: string,
  selection: { empty: boolean; anchor: number },
  rangeCount: number,
  onEmptyBackspace: () => boolean
): boolean {
  if (rangeCount > 1) return false
  if (!selection.empty || selection.anchor > 0) return false
  if (!isEmptyRawBlockSource(docText)) return false
  return onEmptyBackspace()
}

function themeExtension(): Extension {
  return document.documentElement.dataset.theme === 'light' ? githubLight : githubDark
}

/**
 * Mounts a CodeMirror 6 markdown editor into `host` for editing the raw source
 * of an advanced block (container / special fence). Returns a small handle so
 * the caller can read the value, focus and tear the editor down.
 */
export function createContainerSourceEditor(
  host: HTMLElement,
  initialValue: string,
  onChange: (value: string) => void,
  onCommit: () => void,
  options: ContainerSourceEditorOptions = {}
): ContainerSourceEditorHandle {
  const themeCompartment = new Compartment()
  const view = new EditorView({
    state: EditorState.create({
      doc: initialValue,
      extensions: [
        highlightSpecialChars(),
        history(),
        // Prefer native ::selection so multi-line highlights wrap characters
        // only — same as MarkdownSourceEditor. drawSelection() paints full-width
        // line rectangles.
        dropCursor(),
        indentOnInput(),
        bracketMatching(),
        rectangularSelection(),
        crosshairCursor(),
        highlightActiveLine(),
        autocompletion({ activateOnTyping: true, icons: false, maxRenderedOptions: 60 }),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        markdown(),
        EditorState.allowMultipleSelections.of(true),
        ...(options.placeholder ? [placeholder(options.placeholder)] : []),
        keymap.of([
          {
            key: 'Mod-Enter',
            run: () => {
              setTimeout(onCommit, 0)
              return true
            }
          },
          {
            key: 'Backspace',
            run: () => {
              const { onEmptyBackspace } = options
              if (!onEmptyBackspace) return false
              const ranges = view.state.selection.ranges
              const selection = ranges[0]
              if (!selection) return false
              return handleEmptyRawBlockBackspace(
                view.state.doc.toString(),
                { empty: selection.empty, anchor: selection.anchor },
                ranges.length,
                onEmptyBackspace
              )
            }
          },
          indentWithTab,
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
          ...completionKeymap
        ]),
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChange(update.state.doc.toString())
        }),
        EditorView.theme({
          '&': { height: '100%' },
          '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.65' },
          '.cm-content': { caretColor: 'var(--accent-strong)' },
          '&.cm-focused': { outline: 'none' },
          '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent-strong)' },
          '.cm-gutters': {
            backgroundColor: 'var(--editor-bg)',
            color: 'var(--muted)',
            borderRightColor: 'var(--border)'
          },
          '.cm-activeLine, .cm-activeLineGutter': {
            backgroundColor: 'color-mix(in srgb, var(--hover) 62%, transparent)'
          }
        }),
        EditorView.editorAttributes.of({ class: 'cm-source-editor' }),
        lineNumbers(),
        foldGutter(),
        highlightActiveLineGutter(),
        themeCompartment.of(themeExtension())
      ]
    }),
    parent: host
  })

  return {
    getValue: () => view.state.doc.toString(),
    focus: () => view.focus(),
    destroy: () => view.destroy()
  }
}
